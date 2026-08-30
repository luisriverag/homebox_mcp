import { runMcpServer } from "./mcp/server.js";

runMcpServer().catch((err) => {
  console.error("homebox-mcp: fatal error:", err);
  process.exit(1);
});
