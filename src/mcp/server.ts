import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
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

async function runHttpServer(): Promise<void> {
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

  // Stateless: a fresh McpServer + transport per request, no session store
  // to manage — this is a single-admin-user tool, not a multi-tenant
  // service, so there's nothing sessions would buy here.
  app.post(httpPath, async (req: HttpRequest, res: HttpResponse) => {
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
    let server: McpServer | undefined;
    let transport: StreamableHTTPServerTransport | undefined;
    let cleanedUp = false;
    // Idempotent, and registered on the response's own "close" event before
    // handleRequest is even called: closing only after a successful handoff
    // misses a client that disconnects mid-request (res "close" can fire
    // during that await), and only closing from a catch block misses a
    // throw from the transport's own constructor. Either gap leaks one
    // McpServer + transport pair per request on a long-running,
    // restart:always service.
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      transport?.close();
      server?.close();
    };

    try {
      server = buildServer();
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", cleanup);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("homebox-mcp: error handling MCP request:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
      cleanup();
    }
  });

  const methodNotAllowed = (_req: HttpRequest, res: HttpResponse) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  };
  app.get(httpPath, methodNotAllowed);
  app.delete(httpPath, methodNotAllowed);

  let startupSettled = false;
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(httpPort, httpHost, () => {
      logActivity("MCP server ready", {
        transport: "http",
        address: `${httpHost}:${httpPort}${httpPath}`,
        tools: activeTools().length,
        readonly: config.readonly,
        auth: authToken ? "on" : "off",
      });
      startupSettled = true;
      resolve();
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
