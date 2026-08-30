# homebox-mcp

An [MCP](https://modelcontextprotocol.io) server for a self-hosted
[Homebox](https://homebox.software) inventory instance. It covers every
read **and** write endpoint of the [Homebox API](https://homebox.software/en/api/):
items, locations, labels, notifiers, maintenance entries, attachments,
users, group settings, statistics, bulk actions, QR codes, and CSV
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

All 40 Homebox v1 API endpoints are covered, exposed as 56 MCP tools:

- **Items** — list/search, get, create, update, patch (quantity), delete,
  breadcrumb path, custom fields, CSV import/export, attachments
  (add/get/update/delete), maintenance log (list/create/update/delete)
- **Locations** — list, tree, get, create, update, delete
- **Labels** — list, get, create, update, delete
- **Notifiers** — list, create, update, delete, test
- **Users** — get/update/delete self, change password, register (via group
  invitation)
- **Group** — get/update settings, invitations, statistics (overall, by
  label, by location, purchase price over time)
- **Bulk actions** — ensure asset IDs, ensure import refs, set primary
  photos, zero item time fields
- **Misc** — server status, currency list, asset-ID lookup, QR code
  generation, bill-of-materials report

See `src/tools/*.ts` for the exact input schema of each tool.

## Development

```bash
npm run dev        # tsx watch
npm run typecheck
```
