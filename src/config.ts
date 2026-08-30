import "dotenv/config";

function parseBoolYN(name: string, fallback: "Y" | "N"): boolean {
  const raw = (process.env[name] ?? fallback).trim().toUpperCase();
  if (raw === "Y" || raw === "YES" || raw === "TRUE" || raw === "1") return true;
  if (raw === "N" || raw === "NO" || raw === "FALSE" || raw === "0") return false;
  throw new Error(`Environment variable ${name} must be Y or N, got: ${raw}`);
}

export const config = {
  readonly: parseBoolYN("READONLY", "Y"),
  homebox: {
    url: (process.env.HOMEBOX_URL ?? "http://localhost:7745").replace(/\/+$/, ""),
    username: process.env.HOMEBOX_USERNAME ?? "",
    password: process.env.HOMEBOX_PASSWORD ?? "",
  },
};

export function assertHomeboxConfigured(): void {
  if (!config.homebox.username || !config.homebox.password) {
    throw new Error(
      "HOMEBOX_USERNAME and HOMEBOX_PASSWORD must be set in the environment (see .env.example).",
    );
  }
}
