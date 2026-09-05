# homebox-mcp

An [MCP](https://modelcontextprotocol.io) server for a self-hosted
[Homebox](https://homebox.software) inventory instance — specifically the
actively-maintained [sysadminsmedia/homebox](https://github.com/sysadminsmedia/homebox)
fork's current API (`entities`/`tags`), not the older, archived `hay-kot/homebox`
API (`items`/`labels`/`locations`) that most existing docs and search results
still describe. It covers every read **and** write endpoint: items,
locations, tags, notifiers, maintenance entries, attachments, users, group
settings/members/invitations, statistics, bulk actions, QR codes, and CSV
import/export.

This is a plain MCP server with no bundled chat front end — point any
MCP-capable client at it: Claude Desktop, Claude Code, or a bot like
[ocabra_telegram](https://github.com/luisriverag/ocabra_telegram), which
uses this server's tools to give natural-language, tool-calling access to
your inventory over Telegram. Defaults to stdio (a client spawns this
process directly); set `MCP_TRANSPORT=http` to serve MCP over Streamable
HTTP as an always-on service instead, for a client on a different
host/container — see "Running as an HTTP service" below.

## Contents

- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running](#running)
- [Client configuration](#client-configuration)
- [Docker](#docker)
- [Tool coverage](#tool-coverage)
- [Security checklist](#security-checklist)
- [Potential improvements](#potential-improvements)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## How it fits together

```
                    ┌───────────────────────┐
                    │   src/tools/*.ts       │
                    │  one definition per    │
                    │  Homebox endpoint      │
                    └───────────┬────────────┘
                                ▼
                    ┌───────────────────────┐
                    │ src/mcp/server.ts      │
                    │ MCP server (stdio or   │
                    │ Streamable HTTP)       │
                    └───────────┬────────────┘
                                ▼
                    ┌───────────────────────┐
                    │ src/homebox/client.ts │
                    │ login, token refresh, │
                    │ generic REST calls    │
                    └───────────┬────────────┘
                                ▼
                       your Homebox instance
```

Every tool is defined once, in `src/tools/`, as
`{ name, description, write, zod-shape, handler }`, and registered with the
MCP server in `src/mcp/server.ts`.

For request lifecycles, authentication boundaries, and extension points, see
the [architecture guide](docs/ARCHITECTURE.md).

## Prerequisites

- A current [`sysadminsmedia/homebox`](https://github.com/sysadminsmedia/homebox)
  instance that exposes the `/api/v1/entities` API. The archived
  `hay-kot/homebox` API is not supported.
- A dedicated Homebox account for the MCP server. Its Homebox permissions
  still apply in addition to this server's `READONLY` setting.
- Node.js 22 and npm for a source install, or Docker with Docker Compose for
  the container install.
- An MCP client. Running this process in a terminal does not provide a chat
  interface.

## Choose a transport

| Situation | Transport | What the client connects to |
|---|---|---|
| The MCP client can spawn a local process | `stdio` (default) | `node /absolute/path/to/dist/index.js` |
| The client is on another host or in another container | `http` | `http://<server>:8765/mcp` |
| Docker Compose deployment | `http` (set by the image) | The published port and `MCP_HTTP_PATH` |

Use stdio when possible: it needs no listening port or MCP bearer token. Use
HTTP when the process boundary makes stdio unavailable, and set
`MCP_AUTH_TOKEN` before exposing the listener.

## Setup

```bash
git clone <repository-url> homebox_mcp
cd homebox_mcp
cp .env.example .env
# set HOMEBOX_URL, HOMEBOX_USERNAME, and HOMEBOX_PASSWORD in .env
npm ci
npm run build
```

Keep `READONLY=Y` for the first connection. After confirming the client can
list and retrieve inventory, change it to `N` only if write operations are
required, then restart the server.

### Environment variables (`.env`)

| Variable | Required | Description |
|---|---|---|
| `HOMEBOX_URL` | yes | Base URL of your Homebox instance, with no `/api` suffix, e.g. `http://homebox:7745` |
| `HOMEBOX_USERNAME` / `HOMEBOX_PASSWORD` | yes | Login for a Homebox account the agent uses. Create a dedicated user rather than reusing your own. |
| `READONLY` | yes | `Y` — only read/lookup tools are registered, every create/update/delete tool is left out entirely. `N` — full read & write access. |
| `MCP_TRANSPORT` | no | `stdio` (default) or `http` — see "Running as an HTTP service". |
| `MCP_HTTP_HOST` / `MCP_HTTP_PORT` / `MCP_HTTP_PATH` | no | Only used when `MCP_TRANSPORT=http`. Defaults: `0.0.0.0`, `8765`, `/mcp`. |
| `MCP_AUTH_TOKEN` | no | Only used when `MCP_TRANSPORT=http` — required in practice; see "Running as an HTTP service". |

`READONLY` is enforced at the tool-registration layer: when `READONLY=Y`,
write tools (`items_create`, `items_delete`, `locations_update`, …) are
never registered with the MCP server, so a connected client — or a model
driving it — cannot call them regardless of what it's asked to do. Toggle
it in `.env` and restart the server to change modes.

Who is allowed to *talk* to this server at all (e.g. which Telegram user)
is not this server's concern — that's the client's decision (whatever
spawns it over stdio, or whatever holds `MCP_AUTH_TOKEN` over HTTP).
See `ocabra_telegram`'s `HOMEBOX_ADMIN_TELEGRAM_ID`.

## Running

```bash
npm run build
node dist/index.js
```

By default the process speaks MCP over stdio, meant to be spawned by a
client rather than run standalone. Set `MCP_TRANSPORT=http` (see
`.env.example`) to run it as an always-on HTTP service instead.

The startup message is written to stderr so it does not corrupt the MCP
protocol on stdout. In stdio mode, seeing the process wait without printing a
prompt is expected: it is waiting for an MCP client to send protocol messages.

### Running as an HTTP service

```bash
MCP_TRANSPORT=http MCP_AUTH_TOKEN=$(openssl rand -hex 32) node dist/index.js
```

This is the mode to use whenever the client (e.g. `ocabra_telegram`)
doesn't run on the same host — a stdio-piped subprocess can't cross that
boundary the way plain HTTP does. `MCP_HTTP_HOST` (default `0.0.0.0`),
`MCP_HTTP_PORT` (default `8765`), and `MCP_HTTP_PATH` (default `/mcp`)
control the listener; `MCP_AUTH_TOKEN` gates every request behind a
matching `Authorization: Bearer <token>` header (constant-time compared)
— set it unless you've deliberately decided the network path here is
trusted on its own, since an unset token on a reachable port lets anyone
who can reach it drive every tool this server exposes (Homebox reads, and
writes unless `READONLY=Y`). The HTTP transport is stateless — each
request gets a fresh `McpServer`/transport pair, no session store to
manage, matching this being a single-admin-user tool rather than a
multi-tenant service.

On successful startup, stderr includes the listener address, number of
registered tools, readonly mode, and whether HTTP authentication is enabled:

```text
homebox-mcp: MCP server ready over HTTP on 0.0.0.0:8765/mcp (64 tools, READONLY=N, auth=on)
```

The `/mcp` route is an MCP endpoint, not a conventional browser page or
health-check URL. `GET /mcp` intentionally returns `405`; connect with an MCP
Streamable HTTP client using `POST` instead. A `401` response means the bearer
token is absent or does not exactly match `MCP_AUTH_TOKEN`.

## Client configuration

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "homebox": {
      "command": "node",
      "args": ["/absolute/path/to/homebox_mcp/dist/index.js"],
      "env": {
        "HOMEBOX_URL": "http://localhost:7745",
        "HOMEBOX_USERNAME": "agent@example.com",
        "HOMEBOX_PASSWORD": "change-me",
        "READONLY": "Y"
      }
    }
  }
}
```

The path in `args` must be absolute because GUI clients often start with a
different working directory. Restart the MCP client after changing its
configuration or rebuilding the server. Environment variables configured in
the client take precedence over relying on a project-local `.env` whose
location may not be the client's working directory.

### ocabra_telegram

`ocabra_telegram`'s `bot.py` drives this server with OpenAI-style
tool-calling against its Ocabra backend, over MCP's Streamable HTTP
transport (the official `mcp` Python SDK client) — not a spawned
subprocess, so this server can run on the same host, a different host on
your LAN, or its own container.

1. Run this server with `MCP_TRANSPORT=http` and a `MCP_AUTH_TOKEN` set
   (see "Running as an HTTP service" above, or "Docker" below).
2. In `ocabra_telegram`'s `.env`:
   ```
   HOMEBOX_MCP_ENABLED=true
   HOMEBOX_MCP_URL=http://homebox-mcp-host:8765/mcp
   HOMEBOX_MCP_AUTH_TOKEN=same-token-as-MCP_AUTH_TOKEN-above
   HOMEBOX_ADMIN_TELEGRAM_ID=123456789
   ```
   `HOMEBOX_MCP_URL`/`HOMEBOX_MCP_AUTH_TOKEN` must match what this server
   is actually serving (`MCP_HTTP_HOST`/`PORT`/`PATH`/`MCP_AUTH_TOKEN`
   above) — the exact same secret goes on both sides.

See that repo's README, "Homebox Integration", for the full list.

### Docker

```bash
cp .env.example .env   # fill in HOMEBOX_URL/USERNAME/PASSWORD, MCP_AUTH_TOKEN, ...
cp docker-compose.yml.sample docker-compose.yml
docker compose up -d --build
```

`docker-compose.yml` is gitignored (like `.env`) precisely so a later
`git pull` never clobbers anything you change in it — edit your own copy
freely; `docker-compose.yml.sample` is the tracked template to re-diff
against if this project changes it.

The image runs this server with `MCP_TRANSPORT=http` and `restart:
always`, publishing port 8765 (see `docker-compose.yml` to change it or
bind to a specific interface).

Follow startup, MCP request, tool-call, authentication, Homebox API, and error
logs with:

```bash
docker compose logs -f homebox-mcp
```

Activity log lines include an ISO timestamp and useful request status and
duration fields. Tool arguments, request bodies, passwords, and tokens are not
logged. Logs are written to stderr so they cannot interfere with MCP's stdio
protocol.

Inside Compose, `HOMEBOX_URL=http://homebox:7745` works only when a service
named `homebox` is reachable on a shared Docker network. If Homebox runs on
the Docker host or elsewhere, set `HOMEBOX_URL` to an address that is
reachable **from the container**, not necessarily the address used by your
browser.

## Tool coverage

64 MCP tools, covering Homebox's current `/v1/entities` + `/v1/tags` API:

- **Items** — list/search, get, create, update, patch, delete, breadcrumb
  path, custom fields, CSV import/export, attachments (add/get/update/
  delete, plus external/link attachments), bilingual English/Spanish search
  with alternate names, maintenance log (list/create/
  update/delete, plus an all-items maintenance query)
- **Locations** — list, tree, get, create, update, delete. Homebox has no
  separate "locations" resource anymore — a location is an entity whose
  entity type has `isLocation: true`; `locations_list`/`locations_tree` use
  `/v1/entities/tree`, which is still location-scoped.
- **Tags** — list, get, create, update, delete (called "Labels" in the
  archived Homebox API)
- **Entity types** — list (the built-in "Item"/"Location" types plus any
  custom templates, and their `isLocation` flag)
- **Notifiers** — list, create, update, delete, test
- **Users** — get/update/delete self, change password, register (via group
  invitation)
- **Group** — get/update settings, invitations (list/create/delete),
  members (list/remove), statistics (overall, by tag, by location, purchase
  price over time)
- **Bulk actions** — ensure asset IDs, ensure import refs, set primary
  photos, zero item time fields, create missing thumbnails
- **Misc** — server status, currency list, asset-ID lookup, QR code
  generation, bill-of-materials report

See `src/tools/*.ts` for the exact input schema of each tool.
For a complete, browsable list of tool names and access levels, see the
[tool reference](docs/TOOLS.md).

Tool names use a `<resource>_<operation>` convention such as `items_list`,
`items_get`, and `items_create`. Write tools are also prefixed with `[write]`
in their MCP descriptions. With `READONLY=Y`, write tools are omitted from
tool discovery entirely rather than being exposed and rejected later.

## Security checklist

Before enabling write tools or exposing the HTTP transport, verify all of the
following:

- Use a dedicated Homebox account and grant it only the permissions the client
  needs.
- Start with `READONLY=Y`. Changing it to `N` exposes all write tools, including
  permanent deletion, account deletion, member removal, and inventory-wide
  bulk actions.
- Set a long, randomly generated `MCP_AUTH_TOKEN` for HTTP mode. Do not reuse
  the Homebox password as this token.
- Restrict the published port with a firewall, private network, VPN, or a
  specific Docker bind address. The bearer token protects requests, but does
  not encrypt traffic; use a trusted network or a TLS-terminating reverse proxy
  when requests cross an untrusted network.
- Do not commit `.env` or `docker-compose.yml`; both are ignored so local
  credentials and deployment-specific settings stay out of version control.
- Treat logs and tool results as potentially sensitive because inventory names,
  values, attachments, and user details may be returned to the MCP client.

## Potential improvements

See [`docs/IDEAS.md`](docs/IDEAS.md) for a prioritized list of possible testing,
operability, security, packaging, and tool-UX improvements. The document is a
roadmap, not a commitment that every idea will be implemented.

### A note on Homebox API versions

Homebox's original repo (`hay-kot/homebox`) was archived; active development
continues at `sysadminsmedia/homebox`, which reorganized the API somewhere
around mid-2025: `items` and `locations` merged into a single generic
`entities` resource (distinguished by an `entityTypeId`, with locations
being entities whose type has `isLocation: true`), and `labels` was renamed
to `tags`. If you're running an old, unmaintained fork still on the
`items`/`locations`/`labels` API, this version of homebox_mcp will not work
against it — every call will 404. Check what your instance actually serves
with `curl http://<your-homebox>/api/v1/status` (always works, no auth) and
`curl http://<your-homebox>/api/v1/entities` vs `.../api/v1/items` (with a
valid Bearer token) to see which one responds instead of 404.

## Troubleshooting

### The client shows no Homebox tools

1. Run `npm run build` and confirm `dist/index.js` exists.
2. Use an absolute script path in stdio client configuration.
3. Check the MCP client's own logs for process startup errors.
4. Run `node dist/index.js` from the project directory to surface invalid
   environment values. Stop it with <kbd>Ctrl</kbd>+<kbd>C</kbd> after the
   startup message appears.

### Homebox returns `401`

This is authentication between this server and Homebox, not HTTP transport
authentication. Confirm `HOMEBOX_USERNAME` and `HOMEBOX_PASSWORD`, verify the
account can sign in to the same instance, and ensure `HOMEBOX_URL` points to
that instance. The server refreshes an expired Homebox token automatically and
retries one failed request.

### The MCP endpoint returns `401`

Send `Authorization: Bearer <token>` where `<token>` exactly matches
`MCP_AUTH_TOKEN`. This token protects access to MCP; it is separate from the
Homebox login and should not be set to the Homebox password.

### Requests return `404`

- For Homebox API calls, confirm the instance uses the current `entities` and
  `tags` API described in [A note on Homebox API versions](#a-note-on-homebox-api-versions).
- For MCP requests, confirm the client URL path matches `MCP_HTTP_PATH`
  (default `/mcp`).

### Write tools are missing

This is expected when `READONLY=Y`. Set `READONLY=N` and restart the process
only after reviewing the credentials and network access available to the MCP
client.

## Development

```bash
npm ci
npm run dev        # run src/index.ts in watch mode
npm run typecheck  # validate TypeScript without emitting dist/
npm run build      # compile the production JavaScript into dist/
```

If the compiler reports that it cannot find declarations for a dependency
(for example, `TS7016` for `express`), restore the complete lockfile-defined
dependency tree before building:

```bash
npm ci
npm run build
```

Type declarations are development dependencies, so an install created with
`--omit=dev` is suitable for running `dist/`, but not for compiling the
TypeScript sources.

There is currently no automated test suite. Before submitting a change, run
both `npm run typecheck` and `npm run build`. Tool implementations live in
`src/tools/`; the shared Homebox HTTP client lives in `src/homebox/client.ts`,
and transport registration lives in `src/mcp/server.ts`.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the repository layout, tool
definition conventions, validation checklist, and guidance for keeping the
tool reference synchronized.
