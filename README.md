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

## Setup

```bash
cp .env.example .env
# fill in .env — see below
npm install
npm run build
```

### Environment variables (`.env`)

| Variable | Required | Description |
|---|---|---|
| `HOMEBOX_URL` | yes | Base URL of your Homebox instance, e.g. `http://homebox:7745` |
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
docker compose up -d --build
```

The image runs this server with `MCP_TRANSPORT=http` and `restart:
always`, publishing port 8765 (see `docker-compose.yml` to change it or
bind to a specific interface).

## Tool coverage

64 MCP tools, covering Homebox's current `/v1/entities` + `/v1/tags` API:

- **Items** — list/search, get, create, update, patch, delete, breadcrumb
  path, custom fields, CSV import/export, attachments (add/get/update/
  delete, plus external/link attachments), maintenance log (list/create/
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

## Development

```bash
npm run dev        # tsx watch
npm run typecheck
```
