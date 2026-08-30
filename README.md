# homebox-mcp

An [MCP](https://modelcontextprotocol.io) server for a self-hosted
[Homebox](https://homebox.software) inventory instance, plus a Telegram bot
that lets you talk to your inventory in plain language ("what's in the
garage?", "move the drill to the shed", "add a Fragile label").

Both share one tool registry covering every read **and** write endpoint of
the [Homebox API](https://homebox.software/en/api/): items, locations,
labels, notifiers, maintenance entries, attachments, users, group settings,
statistics, bulk actions, QR codes, and CSV import/export.

## How it fits together

```
                    ┌───────────────────────┐
                    │   src/tools/*.ts       │
                    │  one definition per    │
                    │  Homebox endpoint      │
                    └───────────┬────────────┘
                                │
             ┌──────────────────┴──────────────────┐
             ▼                                      ▼
   ┌───────────────────┐                 ┌────────────────────────┐
   │ src/mcp/server.ts  │                 │ src/telegram/bot.ts    │
   │ MCP server (stdio) │                 │ + agent.ts             │
   │ for Claude Desktop/│                 │ Telegram bot driven by │
   │ Claude Code/etc.   │                 │ Claude's tool-use loop │
   └───────────────────┘                 └────────────────────────┘
             │                                      │
             └──────────────────┬───────────────────┘
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
`{ name, description, write, zod-shape, handler }`. Both front ends
(the MCP server and the Telegram agent) build their tool list from the same
`activeTools()` registry, so a Homebox operation only needs to be taught to
the system in one place.

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
| `READONLY` | yes | `Y` — only read/lookup tools exist, all create/update/delete tools are removed. `N` — full read & write access. |
| `TELEGRAM_BOT_TOKEN` | for Telegram | Token from [@BotFather](https://t.me/BotFather) |
| `ADMIN_TELEGRAMID` | for Telegram | The **only** Telegram numeric user ID the bot will respond to (get yours from [@userinfobot](https://t.me/userinfobot)). Every other sender is silently ignored. |
| `ANTHROPIC_API_KEY` | for Telegram | Powers the natural-language understanding in the Telegram bot |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-sonnet-5` |
| `MODE` | no | `mcp` \| `telegram` \| `both` (default `both`) |

`READONLY` is enforced at the tool-registration layer: when `READONLY=Y`,
write tools (`items_create`, `items_delete`, `locations_update`, …) are never
registered with the MCP server and never offered to Claude in the Telegram
agent — the model literally cannot call them, not just told not to. Toggle
it in `.env` and restart to change modes.

## Running the MCP server

For an MCP client (Claude Desktop, Claude Code, etc.) that spawns the
process over stdio:

```bash
MODE=mcp npm run mcp
```

Example Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "homebox": {
      "command": "node",
      "args": ["/absolute/path/to/homebox_mcp/dist/index.js"],
      "env": {
        "MODE": "mcp",
        "HOMEBOX_URL": "http://localhost:7745",
        "HOMEBOX_USERNAME": "agent@example.com",
        "HOMEBOX_PASSWORD": "change-me",
        "READONLY": "Y"
      }
    }
  }
}
```

## Running the Telegram bot

```bash
MODE=telegram npm run bot
```

or with Docker (see `docker-compose.yml` — point `HOMEBOX_URL` at your
existing Homebox deployment, put both containers on the same Docker network
if needed):

```bash
docker compose up -d --build homebox-agent
```

Message the bot on Telegram. Only `ADMIN_TELEGRAMID` gets a response; every
other message is logged and dropped. Built-in commands: `/start`/`/help`,
`/reset` (clears conversation memory for that chat).

Example messages:

- "What's in the garage?"
- "How many items do I have labeled Electronics?"
- "Add a new item: Bosch drill, in the Workshop, label it Power Tools" *(write)*
- "The camping tent moved to the Attic" *(write)*
- "Log maintenance on the lawnmower: oil change today" *(write)*

## Tool coverage

All 40 Homebox v1 API endpoints are covered, exposed as ~45 MCP tools:

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
npm run dev        # tsx watch, MODE from .env
npm run typecheck
```
