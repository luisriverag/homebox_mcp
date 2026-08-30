import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `homebox-mcp: MCP server ready over stdio (${activeTools().length} tools, READONLY=${config.readonly ? "Y" : "N"})`,
  );
}
