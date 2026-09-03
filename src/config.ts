import "dotenv/config";

function parseBoolYN(name: string, fallback: "Y" | "N"): boolean {
  const raw = (process.env[name] ?? fallback).trim().toUpperCase();
  if (raw === "Y" || raw === "YES" || raw === "TRUE" || raw === "1") return true;
  if (raw === "N" || raw === "NO" || raw === "FALSE" || raw === "0") return false;
  throw new Error(`Environment variable ${name} must be Y or N, got: ${raw}`);
}

function parseTransport(name: string, fallback: "stdio" | "http"): "stdio" | "http" {
  const raw = (process.env[name] ?? fallback).trim().toLowerCase();
  if (raw === "stdio" || raw === "http") return raw;
  throw new Error(`Environment variable ${name} must be "stdio" or "http", got: ${raw}`);
}

function parsePort(name: string, fallback: number): number {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || String(port) !== raw) {
    throw new Error(`Environment variable ${name} must be a port number (1-65535), got: ${raw}`);
  }
  return port;
}

export const config = {
  readonly: parseBoolYN("READONLY", "Y"),
  homebox: {
    url: (process.env.HOMEBOX_URL ?? "http://localhost:7745").replace(/\/+$/, ""),
    username: process.env.HOMEBOX_USERNAME ?? "",
    password: process.env.HOMEBOX_PASSWORD ?? "",
  },
  // Defaults to stdio (a client spawns this process and pipes its
  // stdin/stdout directly, for local/CLI-managed use). "http" instead
  // serves MCP over Streamable HTTP as an always-on service — for a
  // client on a different host/container, or the Docker image (which
  // sets this to "http" itself). See README.md, "Running as an HTTP
  // service".
  mcp: {
    transport: parseTransport("MCP_TRANSPORT", "stdio"),
    httpHost: process.env.MCP_HTTP_HOST ?? "0.0.0.0",
    httpPort: parsePort("MCP_HTTP_PORT", 8765),
    httpPath: process.env.MCP_HTTP_PATH ?? "/mcp",
    // Required in practice whenever transport is "http": every request
    // must carry a matching `Authorization: Bearer <this>` header,
    // checked with a constant-time compare. Leave unset only if the
    // network path here is deliberately trusted on its own — an unset
    // token on an otherwise reachable port lets anyone who can reach it
    // drive every tool this server exposes.
    authToken: process.env.MCP_AUTH_TOKEN ?? "",
  },
};

export function assertHomeboxConfigured(): void {
  if (!config.homebox.username || !config.homebox.password) {
    throw new Error(
      "HOMEBOX_USERNAME and HOMEBOX_PASSWORD must be set in the environment (see .env.example).",
    );
  }
}
