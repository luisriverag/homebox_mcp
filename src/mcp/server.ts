import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";
import { activeTools } from "../tools/index.js";
import { HomeboxApiError } from "../homebox/client.js";

function resultToContent(result: unknown) {
  if (result === undefined) {
    return [{ type: "text" as const, text: "OK" }];
  }
  if (typeof result === "string") {
    return [{ type: "text" as const, text: result }];
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
        try {
          const result = await tool.handler(args);
          return { content: resultToContent(result) };
        } catch (err) {
          const message =
            err instanceof HomeboxApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err);
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
  console.error(
    `homebox-mcp: MCP server ready over stdio (${activeTools().length} tools, READONLY=${config.readonly ? "Y" : "N"})`,
  );
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

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!authToken) {
      next();
      return;
    }
    const provided = req.header("authorization") ?? "";
    if (!safeEqual(provided, `Bearer ${authToken}`)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  });

  // Stateless: a fresh McpServer + transport per request, no session store
  // to manage — this is a single-admin-user tool, not a multi-tenant
  // service, so there's nothing sessions would buy here.
  app.post(httpPath, async (req: Request, res: Response) => {
    const server = buildServer();
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        transport.close();
        server.close();
      });
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
  });

  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  };
  app.get(httpPath, methodNotAllowed);
  app.delete(httpPath, methodNotAllowed);

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(httpPort, httpHost, () => {
      console.error(
        `homebox-mcp: MCP server ready over HTTP on ${httpHost}:${httpPort}${httpPath} ` +
          `(${activeTools().length} tools, READONLY=${config.readonly ? "Y" : "N"}, ` +
          `auth=${authToken ? "on" : "OFF"})`,
      );
      resolve();
    });
    server.on("error", reject);
  });
}
