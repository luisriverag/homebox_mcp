import { config } from "./config.js";

async function main(): Promise<void> {
  if (config.mode === "mcp" || config.mode === "both") {
    const { runMcpServer } = await import("./mcp/server.js");
    await runMcpServer();
  }

  if (config.mode === "telegram" || config.mode === "both") {
    const { runTelegramBot } = await import("./telegram/bot.js");
    runTelegramBot();
  }
}

main().catch((err) => {
  console.error("homebox-mcp: fatal error:", err);
  process.exit(1);
});
