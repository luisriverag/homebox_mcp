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

This is a plain stdio MCP server with no bundled chat front end — point any
MCP-capable client at it: Claude Desktop, Claude Code, or a bot like
[ocabra_telegram](https://github.com/luisriverag/ocabra_telegram), which
uses this server's tools to give natural-language, tool-calling access to
your inventory over Telegram.

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
                    │ MCP server (stdio)     │
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

`READONLY` is enforced at the tool-registration layer: when `READONLY=Y`,
write tools (`items_create`, `items_delete`, `locations_update`, …) are
never registered with the MCP server, so a connected client — or a model
driving it — cannot call them regardless of what it's asked to do. Toggle
it in `.env` and restart the server to change modes.

Who is allowed to *talk* to this server at all (e.g. which Telegram user)
is not this server's concern — it's whatever spawns it that decides that.
See `ocabra_telegram`'s `HOMEBOX_ADMIN_TELEGRAM_ID`.

## Running

```bash
npm run build
node dist/index.js
```

The process speaks MCP over stdio: it's meant to be spawned by a client,
not run standalone as a network service.

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

`ocabra_telegram`'s `bot.py` spawns this server as a subprocess and drives
it with OpenAI-style tool-calling against its Ocabra backend. Set, in
`ocabra_telegram`'s `.env`:

```
HOMEBOX_MCP_ENABLED=true
HOMEBOX_MCP_ENTRY=/absolute/path/to/homebox_mcp/dist/index.js
HOMEBOX_URL=http://localhost:7745
HOMEBOX_USERNAME=agent@example.com
HOMEBOX_PASSWORD=change-me
HOMEBOX_READONLY=Y
HOMEBOX_ADMIN_TELEGRAM_ID=123456789
```

See that repo's README for the full list.

### Docker

```bash
docker build -t homebox-mcp .
docker run -i --rm --env-file .env homebox-mcp
```

`-i` is required — the server reads MCP requests from stdin.

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
