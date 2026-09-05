# Architecture

homebox-mcp is a stateless adapter between an MCP client and one configured
Homebox account. It translates MCP tool calls into Homebox REST API requests;
it does not store inventory, user sessions, or client conversation history.

This document describes the current implementation. Potential future changes
belong in [`IDEAS.md`](IDEAS.md), and individual tool names are indexed in
[`TOOLS.md`](TOOLS.md).

## Component overview

```text
MCP client
   │
   ├── stdio: JSON-RPC over child-process stdin/stdout
   │
   └── HTTP: Streamable HTTP POST + optional MCP bearer token
          │
          ▼
    src/mcp/server.ts
      ├── selects active tools
      ├── validates tool inputs through MCP/Zod
      ├── invokes tool handlers
      └── formats successful and error results
          │
          ▼
    src/tools/*.ts
      ├── describes the MCP interface
      ├── maps arguments to Homebox paths and bodies
      └── applies endpoint-specific transformations
          │
          ▼
    src/homebox/client.ts
      ├── obtains and refreshes a Homebox token
      ├── serializes query, JSON, and multipart requests
      └── parses JSON, text, and binary responses
          │
          ▼
    Homebox /api/v1
```

Configuration is read once from environment variables in `src/config.ts`.
`src/index.ts` starts the selected transport and turns a startup failure into a
non-zero process exit.

## Startup and tool registration

1. Importing the entry point loads `.env` through `dotenv/config` and parses
   the configuration.
2. `runMcpServer()` selects stdio or HTTP from `MCP_TRANSPORT`.
3. `buildServer()` creates an MCP server and obtains the current tool list from
   `activeTools()`.
4. When `READONLY=Y`, `activeTools()` removes every definition whose `write`
   flag is true. Those tools are never registered or advertised to the client.
5. Each remaining `ToolDef` is registered with its name, description, and Zod
   input shape. Write-tool descriptions receive a visible `[write]` prefix in
   full-access mode.

Homebox credentials are checked lazily when the first authenticated Homebox
request needs a token, rather than while MCP transport startup is occurring.
This allows the process to initialize, but a tool call fails clearly if the
username or password is absent.

## Request lifecycle

For a normal tool call:

1. The MCP SDK validates arguments against the registered Zod shape.
2. The tool handler selects a Homebox endpoint and builds its query or body.
3. `HomeboxClient` obtains a token if none is cached or the cached token is
   close to expiry.
4. The client sends the request with exactly one `Authorization: Bearer ...`
   header.
5. A Homebox `401` clears the cached token, performs one refresh, and retries
   the request once. Other failures are not automatically retried.
6. The client parses the response according to the handler's requested mode.
7. The MCP layer renders strings directly, objects as indented JSON, and an
   empty successful response as `OK`.

A `HomeboxApiError` includes the HTTP status, API path, and a bounded rendering
of the upstream body. The MCP wrapper logs the failure to stderr and returns an
`isError` result to the caller. Unexpected errors follow the same MCP error
path without exposing a stack trace as tool content.

## Transport lifecycles

### Stdio

One `McpServer` and one `StdioServerTransport` live for the process lifetime.
Protocol output uses stdout. Startup and error logs use stderr so they cannot
corrupt the JSON-RPC stream. The spawning MCP client owns process lifecycle and
supplies configuration through its environment or the process working
directory's `.env`.

### Streamable HTTP

Express owns the listening socket. Optional MCP authentication middleware
compares the complete `Authorization` header with
`Bearer ${MCP_AUTH_TOKEN}` before requests reach the MCP route.

The HTTP mode is stateful at the MCP transport level: an `initialize` `POST`
(no `Mcp-Session-Id` header) creates one `McpServer`/`StreamableHTTPServerTransport`
pair and returns the transport-assigned session id in the `Mcp-Session-Id`
response header; every subsequent `GET`/`POST`/`DELETE` on the MCP path must
echo that header, and is routed to the matching pair from an in-memory
session map. A request naming an unknown session id gets `404`; a
non-`initialize` request with no session id gets `400`. A session's pair is
torn down (and removed from the map) on `DELETE` or when the transport's own
`onclose` fires (e.g. the underlying connection drops). An earlier
per-request design — a fresh pair for every single request, discarded as
soon as that request's own response closed — could tear a transport down
while an adjacent request in the *same* logical client session still had an
SSE response in flight, since ocabra_telegram and similar clients hold one
session open across many sequential tool calls; this surfaced client-side as
the official MCP SDK's own "SSE stream ended without a response" even
though this server had already sent a complete, successful reply.

Tool-call responses (the `hasRequests` branch of a POST) are further
configured with `enableJsonResponse: true`, so each one is sent as a
single complete JSON body instead of an SSE stream. This closes a second,
independent gap behind the same symptom: the reference MCP client
(`mcp` Python SDK's `streamable_http` transport) only attempts to resume an
SSE response that gets interrupted before completion if that stream
carried a resumable event ID, which requires an `eventStore` — not
configured here, since nothing server-initiated needs mid-call resumption.
Without one, any interruption of an in-progress SSE response — a dropped
connection, an intermediate proxy timeout, anything cutting the stream
before the final event — is unrecoverable client-side and reported as "SSE
stream ended without a response", even though the server had already
produced a complete, successful result. A plain JSON response has no
equivalent partial-transfer window: the client either gets the whole body
or the request fails outright, which is visibly different from "the tool
call itself failed." Larger tool results (base64-encoded photos and other
binary attachments) spend proportionally longer as an open SSE stream and
were the ones actually observed hitting this in production; plain
JSON-returning tools (item and location listings, etc.) never exhibited it.
The standalone GET stream (for potential future server-initiated
notifications) is unaffected by this option — it still uses SSE.

The HTTP bearer token controls access to the MCP endpoint. It is separate from
the Homebox credential and token used for downstream REST requests.

## Authentication and trust boundaries

There are three distinct control points:

| Boundary | Mechanism | Protects |
|---|---|---|
| MCP client to local process | Process ownership and stdio access | Who can discover and invoke tools. |
| MCP client to HTTP server | `MCP_AUTH_TOKEN`, when configured | Who can reach MCP tools over the network. |
| homebox-mcp to Homebox | Homebox username, password, and issued token | Which Homebox group and permissions API calls use. |

`READONLY` is an additional capability boundary inside the MCP server. It does
not alter the Homebox account's permissions, and Homebox permissions do not
replace the need to protect a network-reachable MCP endpoint.

Neither the MCP bearer token nor the Homebox bearer token provides transport
encryption. Network deployments need a trusted network, VPN, or TLS reverse
proxy when traffic can cross an untrusted path.

## Homebox client behavior

The shared client constructs URLs as `<HOMEBOX_URL>/api<v1-path>`. Tool handlers
therefore pass paths such as `/v1/entities`, not `/api/v1/entities`.

Supported request and response modes are:

| Mode | Behavior |
|---|---|
| Default body | Serialize as JSON and set `Content-Type: application/json`. |
| `multipart` | Build `FormData`; the runtime supplies its boundary header. |
| Default response | Parse JSON for JSON content types, otherwise return text. |
| `raw` | Return response text, used for CSV. |
| `binary` | Return a typed base64 payload with its MIME type and a stable `homebox://` URI. |
| HTTP `204` | Return `undefined`, rendered by MCP as `OK`. |

Concurrent calls share one in-flight login promise, preventing a burst of
parallel requests from triggering duplicate logins. Cached tokens are refreshed
when they are within 30 seconds of their reported expiry. If Homebox omits or
returns an invalid expiry, the client uses a 12-hour fallback.

## Tool definition model

A `ToolDef` keeps all MCP-facing behavior together:

- `name` is the stable identifier visible to clients.
- `description` explains behavior and caveats.
- `write` controls readonly filtering and the `[write]` label.
- `shape` is the Zod raw shape used for input validation and MCP schema
  discovery.
- `handler` maps validated arguments to a Homebox operation.

Resource-specific arrays are combined in `src/tools/index.ts`. A tool module
can use helpers from `src/homebox/` when multiple endpoints need consistent
entity-type lookup or update merging.

Values inserted into URL path segments should use `safeId`, which permits only
letters, digits, and hyphens. This rejects separators and traversal-like input
before it can alter the intended endpoint path.

## Data transformations

Most successful Homebox responses pass through unchanged. Deliberate
transformations include:

- Filtering location entities out of mixed entity search results for
  `items_list`.
- Expanding item searches across English/Spanish alternate names and merging
  the result pages by entity ID.
- Resolving discovered tag names, running additive related-tag searches
  independently from free text, and reporting the tag IDs used. Explicit
  `tags` remain a strict filter and disable additive tag searches.
- Flattening or traversing entity trees for location-oriented tools.
- Merging the current resource into full-update bodies so omitted fields are
  preserved rather than reset.
- Converting file input from base64 to bytes for uploads.
- Converting binary Homebox responses to native MCP image content or embedded
  resources (with base64 used as MCP's binary wire encoding).

Transformations that can affect pagination, omitted records, or field values
should be stated in the corresponding tool description.

## Extension points

- Add Homebox operations as `ToolDef` entries in the relevant `src/tools/`
  module and include new modules in `allTools`.
- Add shared REST behavior to `HomeboxClient` rather than reproducing login or
  response handling in tool handlers.
- Add entity-specific normalization to focused helpers under `src/homebox/`.
- Keep transport concerns in `src/mcp/server.ts`; tool handlers should not need
  to know whether the caller uses stdio or HTTP.

See [`../CONTRIBUTING.md`](../CONTRIBUTING.md) for the implementation checklist
and compatibility expectations for these changes.

## Current boundaries

The server intentionally has no database, background worker, bundled chat UI,
multi-user credential vault, response cache, or compatibility adapter for the
archived Homebox API. It exposes tools, but no MCP resources or prompts. These
constraints keep request state and authority straightforward; proposals to
change them should explain the concrete use case and resulting security and
lifecycle model.
