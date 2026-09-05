import assert from "node:assert/strict";
import test from "node:test";
import { logActivity } from "../src/logger.js";

test("activity logs are timestamped, structured, and written to stderr", () => {
  const originalError = console.error;
  const lines: string[] = [];
  console.error = (...values: unknown[]) => lines.push(values.join(" "));

  try {
    logActivity("request completed", { method: "GET", status: 200, omitted: undefined });
  } finally {
    console.error = originalError;
  }

  assert.equal(lines.length, 1);
  assert.match(
    lines[0],
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z INFO homebox-mcp: request completed method="GET" status=200$/,
  );
});
