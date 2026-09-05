import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { config } from "../config.js";
import { activeTools } from "../tools/index.js";
import { HomeboxApiError, isBinaryResponse } from "../homebox/client.js";
import { logActivity } from "../logger.js";
import { isToolContentResult } from "../tools/types.js";

// Keep the few Express-facing annotations structural. Express is only used
// indirectly through createMcpExpressApp(), and importing its DefinitelyTyped
// declarations here made an otherwise valid build depend on @types/express
// being present in the local node_modules tree.
interface HttpRequest extends IncomingMessage {
  body: unknown;
  header(name: string): string | undefined;
}

interface HttpResponse extends ServerResponse {
  status(code: number): HttpResponse;
  json(body: unknown): HttpResponse;
}

type Next = () => void;

export function resultToContent(result: unknown): CallToolResult["content"] {
  if (result === undefined) {
    return [{ type: "text" as const, text: "OK" }];
  }
  if (typeof result === "string") {
    return [{ type: "text" as const, text: result }];
  }
  if (isToolContentResult(result)) {
    return [
      { type: "text" as const, text: JSON.stringify(result.value, null, 2) },
      ...result.binaries.flatMap(resultToContent),
    ];
  }
  if (isBinaryResponse(result)) {
    if (result.mimeType.startsWith("image/")) {
      return [{ type: "image" as const, data: result.data, mimeType: result.mimeType }];
    }
    return [
      {
        type: "resource" as const,
        resource: {
          uri: result.uri,
          blob: result.data,
          mimeType: result.mimeType,
        },
      },
    ];
  }
  return [{ type: "text" as const, text: JSON.stringify(result, null, 2) }];
}

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "homebox-mcp",
    version: "0.1.0",
  });

  const tools = activeTools();

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.name,
        description: tool.write ? `[write] ${tool.description}` : tool.description,
        inputSchema: tool.shape,
      },
      async (args: any) => {
        const startedAt = Date.now();
        logActivity("tool call started", { tool: tool.name, write: tool.write });
        try {
          const result = await tool.handler(args);
          logActivity("tool call completed", {
            tool: tool.name,
            durationMs: Date.now() - startedAt,
          });
          return { content: resultToContent(result) };
        } catch (err) {
          const message =
            err instanceof HomeboxApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err);
          // Converting this to a normal (isError) tool result means it
          // never becomes an unhandled-exception log line anywhere --
          // without logging it here explicitly, a failing tool call is
          // invisible server-side, only ever seen as whatever the
          // client's model paraphrases it into for the end user.
          logActivity("tool call failed", {
            tool: tool.name,
            durationMs: Date.now() - startedAt,
            error: message,
          });
          return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
        }
      },
    );
  }

  return server;
}

export async function runMcpServer(): Promise<void> {
  if (config.mcp.transport === "http") {
    await runHttpServer();
    return;
  }

  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logActivity("MCP server ready", {
    transport: "stdio",
    tools: activeTools().length,
    readonly: config.readonly,
  });
}

/** Constant-time string compare that tolerates differing lengths (Node's
 * timingSafeEqual throws on a length mismatch instead of just returning
 * false), so a bearer-token check doesn't leak the expected length via
 * comparison time or an uncaught exception. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Exported (only) so tests can close the returned http.Server; runMcpServer
 * is the normal production entry point and just awaits this and discards it. */
export async function runHttpServer(): Promise<import("node:http").Server> {
  const { httpHost, httpPort, httpPath, authToken } = config.mcp;

  if (!authToken) {
    console.error(
      "homebox-mcp: WARNING MCP_AUTH_TOKEN is not set. This MCP HTTP endpoint has " +
        "no authentication — anyone who can reach it can drive every tool this " +
        "server exposes (Homebox reads, and writes unless READONLY=Y). Set " +
        "MCP_AUTH_TOKEN unless the network path here is otherwise fully trusted.",
    );
  }

  const app = createMcpExpressApp({ host: httpHost });

  app.use((req: HttpRequest, res: HttpResponse, next: Next) => {
    if (!authToken) {
      next();
      return;
    }
    const provided = req.header("authorization") ?? "";
    if (!safeEqual(provided, `Bearer ${authToken}`)) {
      logActivity("MCP request rejected", {
        method: req.method,
        path: httpPath,
        status: 401,
      });
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  });

  // Stateful: one McpServer + transport per client session, keyed by the
  // Mcp-Session-Id the transport generates on initialize and the client
  // echoes back on every subsequent request. An earlier version of this
  // spun up a fresh McpServer + transport pair for every single request and
  // tore it down as soon as that request's own response finished -- but a
  // client session (e.g. ocabra_telegram's tool-calling loop) reuses one
  // connection across many sequential tool calls, and tearing the
  // transport down per-request could race an adjacent request's still-open
  // SSE response, which surfaced client-side as the official SDK's own
  // "SSE stream ended without a response" even though this server had
  // already sent a complete, successful reply. Matches the SDK's own
  // documented stateful-session pattern.
  const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

  async function resolveSession(
    req: HttpRequest,
    res: HttpResponse,
  ): Promise<{ server: McpServer; transport: StreamableHTTPServerTransport } | undefined> {
    const sessionId = req.header("mcp-session-id");
    if (sessionId) {
      const existing = sessions.get(sessionId);
      if (existing) return existing;
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Session not found" },
        id: null,
      });
      return undefined;
    }

    if (req.method === "POST" && isInitializeRequest(req.body)) {
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          sessions.set(newSessionId, { server, transport });
        },
        // Tool-call responses are single request/single response -- nothing
        // here needs a long-lived SSE stream. Sending each as one complete
        // JSON body instead avoids a failure mode with no recovery path: the
        // MCP client only resumes an interrupted SSE response if the stream
        // carried a resumable event id (which requires an eventStore, not
        // configured here), and otherwise gives up immediately with "SSE
        // stream ended without a response" -- even though this server had
        // already produced a complete, successful result. Larger responses
        // (base64-encoded photos in particular) spend longer as an open SSE
        // stream and are disproportionately exposed to that gap; a single
        // JSON body has no equivalent "cut off partway through" window.
        enableJsonResponse: true,
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await server.connect(transport);
      return { server, transport };
    }

    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: No valid session ID provided" },
      id: null,
    });
    return undefined;
  }

  const handleMcpRequest = async (req: HttpRequest, res: HttpResponse) => {
    const startedAt = Date.now();
    logActivity("MCP request received", { method: req.method, path: httpPath });
    res.on("finish", () => {
      logActivity("MCP request completed", {
        method: req.method,
        path: httpPath,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });

    try {
      const session = await resolveSession(req, res);
      if (!session) return; // resolveSession already sent the error response
      await session.transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("homebox-mcp: error handling MCP request:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  };

  app.post(httpPath, handleMcpRequest);
  app.get(httpPath, handleMcpRequest);
  app.delete(httpPath, handleMcpRequest);

  let startupSettled = false;
  return await new Promise<import("node:http").Server>((resolve, reject) => {
    const server = app.listen(httpPort, httpHost, () => {
      logActivity("MCP server ready", {
        transport: "http",
        address: `${httpHost}:${httpPort}${httpPath}`,
        tools: activeTools().length,
        readonly: config.readonly,
        auth: authToken ? "on" : "off",
      });
      startupSettled = true;
      resolve(server);
    });
    // Rejecting after the promise above already resolved is a no-op, so a
    // *later* listener error (EMFILE under load, etc.) would otherwise be
    // silently swallowed — always log it too, so the service doesn't keep
    // "running" with a dead listener and zero operator-visible signal.
    server.on("error", (err: Error) => {
      console.error("homebox-mcp: HTTP server error:", err);
      if (!startupSettled) reject(err);
    });
  });
}
