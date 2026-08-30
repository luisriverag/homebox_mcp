import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseBoolYN(name: string, fallback: "Y" | "N"): boolean {
  const raw = (process.env[name] ?? fallback).trim().toUpperCase();
  if (raw === "Y" || raw === "YES" || raw === "TRUE" || raw === "1") return true;
  if (raw === "N" || raw === "NO" || raw === "FALSE" || raw === "0") return false;
  throw new Error(`Environment variable ${name} must be Y or N, got: ${raw}`);
}

export type Mode = "mcp" | "telegram" | "both";

function parseMode(): Mode {
  const raw = (process.env.MODE ?? "mcp").trim().toLowerCase();
  if (raw === "mcp" || raw === "telegram" || raw === "both") return raw;
  throw new Error(`Environment variable MODE must be one of mcp|telegram|both, got: ${raw}`);
}

export const config = {
  mode: parseMode(),
  readonly: parseBoolYN("READONLY", "Y"),
  homebox: {
    url: (process.env.HOMEBOX_URL ?? "http://localhost:7745").replace(/\/+$/, ""),
    username: process.env.HOMEBOX_USERNAME ?? "",
    password: process.env.HOMEBOX_PASSWORD ?? "",
  },
  telegram: {
    get botToken(): string {
      return required("TELEGRAM_BOT_TOKEN");
    },
    get adminId(): string {
      return required("ADMIN_TELEGRAMID");
    },
  },
  anthropic: {
    get apiKey(): string {
      return required("ANTHROPIC_API_KEY");
    },
    model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
  },
};

export function assertHomeboxConfigured(): void {
  if (!config.homebox.username || !config.homebox.password) {
    throw new Error(
      "HOMEBOX_USERNAME and HOMEBOX_PASSWORD must be set in the environment (see .env.example).",
    );
  }
}
