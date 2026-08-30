import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { config } from "../config.js";
import { activeTools } from "../tools/index.js";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

const MAX_TOOL_TURNS = 8;
const MAX_HISTORY_MESSAGES = 20;

function toClaudeTools(): Anthropic.Tool[] {
  return activeTools().map((tool) => {
    const schema = zodToJsonSchema(z.object(tool.shape), {
      target: "jsonSchema7",
      $refStrategy: "none",
    }) as Record<string, unknown>;
    delete schema.$schema;
    return {
      name: tool.name,
      description: tool.description,
      input_schema: schema as Anthropic.Tool.InputSchema,
    };
  });
}

function systemPrompt(): string {
  return [
    "You are a helpful home-inventory assistant for a self-hosted Homebox instance, reachable over Telegram.",
    "You act only through the provided tools — never invent item, location, or label IDs; look them up first (e.g. items_list, locations_list, labels_list) before referencing them.",
    "When a user describes something in natural language (\"the blue camping tent is now in the garage\", \"add a new label called Kitchen\", \"what's in the attic?\"), figure out the right tool calls, resolving names to IDs by searching first.",
    config.readonly
      ? "READONLY mode is ON: only read/lookup tools are available. If the user asks to add, change, move, or delete anything, explain that the agent is currently read-only and no changes were made."
      : "READONLY mode is OFF: you may create, update, and delete data. Before any destructive or hard-to-reverse action (deleting an item/location/label, deleting a user account), briefly confirm what you're about to do in your reply, but still go ahead and perform it since the user is the sole authorized operator of this bot.",
    "Keep replies concise and conversational — this is a chat, not a report. Summarize results in plain language rather than dumping raw JSON, unless the user asks for raw data.",
  ].join("\n");
}

export type ChatMessage = Anthropic.MessageParam;

export async function runAgent(
  chatHistory: ChatMessage[],
  userText: string,
): Promise<{ reply: string; history: ChatMessage[] }> {
  const tools = activeTools();
  const toolsByName = new Map(tools.map((t) => [t.name, t]));
  const claudeTools = toClaudeTools();

  let messages: ChatMessage[] = [...chatHistory, { role: "user", content: userText }];

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const response = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: 2048,
      system: systemPrompt(),
      tools: claudeTools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { reply: text || "(no response)", history: trimHistory(messages) };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const tool = toolsByName.get(block.name);
      let outputText: string;
      let isError = false;
      if (!tool) {
        outputText = `Unknown or disabled tool: ${block.name}`;
        isError = true;
      } else {
        try {
          const result = await tool.handler(block.input as any);
          outputText =
            result === undefined ? "OK" : typeof result === "string" ? result : JSON.stringify(result);
        } catch (err) {
          isError = true;
          outputText = err instanceof Error ? err.message : String(err);
        }
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: outputText,
        is_error: isError,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return {
    reply: "That request needed too many steps to complete — try breaking it into something more specific.",
    history: trimHistory(messages),
  };
}

function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= MAX_HISTORY_MESSAGES) return messages;
  return messages.slice(messages.length - MAX_HISTORY_MESSAGES);
}
