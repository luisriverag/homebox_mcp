import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, test } from "node:test";

// Must be set before config.js (and anything importing it) is first loaded,
// since config reads process.env once at module-import time.
process.env.MCP_TRANSPORT = "http";
process.env.MCP_HTTP_HOST = "127.0.0.1";
process.env.MCP_HTTP_PORT = "8799";
process.env.MCP_AUTH_TOKEN = "";
process.env.READONLY = "Y";

const { runHttpServer } = await import("../src/mcp/server.js");

const BASE_URL = "http://127.0.0.1:8799/mcp";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: any;
  error?: { code: number; message: string };
}

/** The transport may answer with a single JSON body or an SSE-framed one
 * carrying exactly one `data:` event; tools/list and initialize never need
 * more than that here. */
async function readJsonRpcResponse(res: Response): Promise<JsonRpcResponse> {
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (contentType.startsWith("application/json")) {
    return JSON.parse(text);
  }
  const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
  assert.ok(dataLine, `expected an SSE data: line, got: ${text}`);
  return JSON.parse(dataLine!.slice("data:".length).trim());
}

async function postMcp(body: unknown, extraHeaders: Record<string, string> = {}): Promise<Response> {
  return fetch(BASE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

let nextRequestId = 1;
function initializeRequest() {
  return {
    jsonrpc: "2.0",
    id: nextRequestId++,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "http-transport-test", version: "0.0.0" },
    },
  };
}

function toolsListRequest() {
  return { jsonrpc: "2.0", id: nextRequestId++, method: "tools/list", params: {} };
}

async function initializeSession(): Promise<string> {
  const res = await postMcp(initializeRequest());
  assert.equal(res.status, 200);
  const sessionId = res.headers.get("mcp-session-id");
  assert.ok(sessionId, "expected a mcp-session-id response header on initialize");
  await readJsonRpcResponse(res); // drain the body
  return sessionId!;
}

// One server for the whole file: each test below either creates its own
// session (a fresh, unique id) or deliberately uses one that was never
// created, so they don't interfere with each other despite sharing state.
let server: Server;

before(async () => {
  server = await runHttpServer();
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

test("a session persists across multiple sequential requests", async () => {
  const sessionId = await initializeSession();

  // Regression coverage: an earlier per-request McpServer+transport design
  // tore the session down as soon as one request's response finished,
  // which could break a later request in the *same* logical client session
  // (surfacing to real MCP clients as "SSE stream ended without a
  // response") even though each individual request succeeded server-side.
  // Two more requests reusing the same session id must both still work.
  for (let i = 0; i < 2; i++) {
    const res = await postMcp(toolsListRequest(), { "mcp-session-id": sessionId });
    assert.equal(res.status, 200);
    const body = await readJsonRpcResponse(res);
    assert.ok(Array.isArray(body.result?.tools), `expected a tools array, got: ${JSON.stringify(body)}`);
    assert.ok(body.result.tools.length > 0);
  }
});

test("tool-call responses are sent as a plain JSON body, not an SSE stream", async () => {
  // Regression coverage: without enableJsonResponse, a response only
  // completing partway through an SSE stream (a dropped connection, a
  // proxy timeout, anything cutting the transfer short) is unrecoverable
  // client-side for the reference MCP client -- it gives up immediately
  // with "SSE stream ended without a response" even though the server had
  // already produced a complete, successful result. A single JSON body has
  // no equivalent partial-transfer window.
  const sessionId = await initializeSession();
  const res = await postMcp(toolsListRequest(), { "mcp-session-id": sessionId });
  assert.equal(res.status, 200);
  assert.ok(
    (res.headers.get("content-type") ?? "").startsWith("application/json"),
    `expected a JSON response, got content-type: ${res.headers.get("content-type")}`,
  );
});

test("an unknown session id is rejected with 404", async () => {
  const res = await postMcp(toolsListRequest(), { "mcp-session-id": "00000000-0000-0000-0000-000000000000" });
  assert.equal(res.status, 404);
});

test("a non-initialize request with no session id is rejected with 400", async () => {
  const res = await postMcp(toolsListRequest());
  assert.equal(res.status, 400);
});

test("DELETE tears the session down; it's a 404 afterward", async () => {
  const sessionId = await initializeSession();

  const deleteRes = await fetch(BASE_URL, {
    method: "DELETE",
    headers: { "mcp-session-id": sessionId, accept: "application/json, text/event-stream" },
  });
  assert.ok(deleteRes.status < 400, `DELETE failed with ${deleteRes.status}`);

  const res = await postMcp(toolsListRequest(), { "mcp-session-id": sessionId });
  assert.equal(res.status, 404);
});
