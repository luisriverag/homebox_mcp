type LogDetails = Record<string, unknown>;

function serialize(details: LogDetails): string {
  return Object.entries(details)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
}

/**
 * Write operational logs to stderr. Stdout must remain reserved for the MCP
 * protocol when the server uses stdio transport.
 */
export function logActivity(message: string, details: LogDetails = {}): void {
  const suffix = serialize(details);
  console.error(
    `${new Date().toISOString()} INFO homebox-mcp: ${message}${suffix ? ` ${suffix}` : ""}`,
  );
}

