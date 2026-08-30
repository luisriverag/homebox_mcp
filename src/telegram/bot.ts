import { Bot, type Context } from "grammy";
import { config } from "../config.js";
import { runAgent, type ChatMessage } from "./agent.js";

export function runTelegramBot(): Bot {
  const bot = new Bot(config.telegram.botToken);
  const adminId = config.telegram.adminId;
  const histories = new Map<number, ChatMessage[]>();

  console.error(
    `homebox-mcp: Telegram bot ready (admin=${adminId}, READONLY=${config.readonly ? "Y" : "N"})`,
  );

  bot.command("start", (ctx) => replyIfAdmin(ctx, sendWelcome));
  bot.command("help", (ctx) => replyIfAdmin(ctx, sendWelcome));
  bot.command("reset", (ctx) =>
    replyIfAdmin(ctx, async (ctx) => {
      histories.delete(ctx.chat!.id);
      await ctx.reply("Conversation reset.");
    }),
  );

  bot.on("message:text", (ctx) => replyIfAdmin(ctx, handleMessage));

  bot.catch((err) => {
    console.error("homebox-mcp: Telegram bot error:", err.message);
  });

  async function replyIfAdmin(ctx: Context, fn: (ctx: Context) => Promise<void>): Promise<void> {
    const senderId = ctx.from?.id;
    if (String(senderId) !== adminId) {
      console.error(`homebox-mcp: ignoring message from unauthorized user ${senderId}`);
      return;
    }
    await fn(ctx);
  }

  async function sendWelcome(ctx: Context): Promise<void> {
    await ctx.reply(
      `Hi! I'm your Homebox assistant. Ask me about your inventory, or (when not read-only) tell me to add/move/label things.\nMode: ${
        config.readonly ? "read-only" : "read & write"
      }.`,
    );
  }

  async function handleMessage(ctx: Context): Promise<void> {
    const chatId = ctx.chat!.id;
    const text = ctx.message?.text?.trim();
    if (!text) return;

    await ctx.replyWithChatAction("typing");
    try {
      const history = histories.get(chatId) ?? [];
      const { reply, history: newHistory } = await runAgent(history, text);
      histories.set(chatId, newHistory);
      await ctx.reply(reply);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("homebox-mcp: agent error:", message);
      await ctx.reply(`Sorry, something went wrong: ${message}`);
    }
  }

  bot.start();
  return bot;
}
