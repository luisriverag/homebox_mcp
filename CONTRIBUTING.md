# Contributing to homebox-mcp

Thank you for improving homebox-mcp. This guide describes the repository's
current conventions and the checks expected for a change. For future work that
has not yet been scheduled, see [`docs/IDEAS.md`](docs/IDEAS.md).

## Development setup

Requirements:

- Node.js 22
- npm
- A current Homebox instance only when manually testing live API behavior

Install the locked dependency set and validate a clean checkout:

```bash
npm ci
npm run typecheck
npm run build
```

Use `npm run dev` to run the TypeScript entry point in watch mode. Keep
`READONLY=Y` and use a non-production Homebox account and inventory while
developing unless the change specifically requires writes.

## Repository map

| Path | Responsibility |
|---|---|
| `src/index.ts` | Process entry point and fatal startup error handling. |
| `src/config.ts` | Environment parsing, defaults, and required credential checks. |
| `src/mcp/server.ts` | Tool registration plus stdio and Streamable HTTP transports. |
| `src/homebox/client.ts` | Homebox login, token refresh, request serialization, and response parsing, including the entity-id-suggestion enrichment on unknown-id errors. |
| `src/homebox/similarity.ts` | Levenshtein-distance matching used to suggest the correct entity id after a `404`/`400 invalid route key`. |
| `src/homebox/entityMerge.ts` | Preserving existing fields for full entity updates. |
| `src/homebox/entityTypes.ts` | Resolving default and custom entity type IDs. |
| `src/homebox/search.ts` | Alternate-name query expansion and related-tag resolution for `items_list`. |
| `src/homebox/deepSearch.ts` | Exhaustive `items_list` `deepSearch` over full item details. |
| `src/logger.ts` | `logActivity()`, the shared stderr activity-log writer. |
| `src/tools/types.ts` | Shared `ToolDef`, `defineTool`, and safe path-ID schema. |
| `src/tools/index.ts` | Combines every resource module's tools into `allTools` and applies `READONLY` filtering. |
| `src/tools/*.ts` | MCP tool definitions grouped by Homebox resource area. |
| `docs/TOOLS.md` | Operator-facing index of registered tools and access levels. |
| `docs/IDEAS.md` | Non-binding roadmap and design questions. |
| `docs/ARCHITECTURE.md` | Runtime components, request lifecycles, and trust boundaries. |

Generated JavaScript is written to `dist/` and is intentionally ignored. Do
not commit `node_modules/`, `.env`, `docker-compose.yml`, logs, or generated
build output.

## Adding or changing a tool

Every tool is a `ToolDef` with one source of truth for its name, description,
access classification, Zod input shape, and handler:

```ts
defineTool({
  name: "widgets_get",
  description: "Get a widget by ID.",
  write: false,
  shape: {
    id: safeId.describe("Homebox widget UUID"),
  },
  handler: ({ id }) => homebox.get(`/v1/widgets/${id}`),
});
```

When contributing a tool:

1. **Use a stable name.** Follow `<resource>_<operation>`, using the existing
   plural resource prefix where one exists. Tool names are a public interface
   used in client permissions, prompts, and automation.
2. **Write for the caller.** The description should explain the result, notable
   upstream behavior, and safety implications. Do not merely repeat the name.
3. **Classify access by side effect.** Set `write: true` for anything that can
   create, upload, send, modify, delete, register, import, or trigger an action.
   This flag controls whether the tool is registered when `READONLY=Y`; it is
   not just documentation.
4. **Constrain inputs.** Use Zod bounds and enums that match the Homebox API.
   Add `.describe(...)` when a parameter's units, format, null behavior, or ID
   source is not obvious to an MCP client.
5. **Protect path segments.** Use `safeId` for user-supplied values interpolated
   into URL path segments. Do not accept an unconstrained string for those
   values.
6. **Use the shared client.** Pass paths relative to `/api`, normally beginning
   with `/v1`. Use its `raw`, `binary`, or `multipart` options rather than
   duplicating authentication and response handling.
7. **Preserve omitted update fields.** Homebox endpoints that replace a full
   resource may require retrieving the current object and merging changes.
   Follow the existing update tools and `entityUpdateBodyFromCurrent` rather
   than accidentally resetting fields to API defaults.
8. **Return useful failures.** Let `HomeboxApiError` reach the MCP registration
   wrapper, which logs it and converts it to an `isError` tool result. Do not
   log secrets, bearer tokens, passwords, invitation tokens, or attachment
   contents.
9. **Register the collection.** A new tool module must be imported and spread
   into `allTools` in `src/tools/index.ts`.
10. **Update documentation.** Add or revise the corresponding entry in
    `docs/TOOLS.md`, including its correct Read or Write access level. Update
    the README's tool count and coverage summary if the registry changed.

### Input and output compatibility

Changing a tool name, removing an input, making an optional input required, or
changing the shape of its result can break MCP clients. Prefer additive,
optional inputs and preserve existing response fields. If an upstream Homebox
change requires a breaking change, document the affected Homebox versions and
the migration path in the pull request.

Avoid reshaping successful Homebox responses solely for cosmetic consistency.
When filtering or transforming an upstream response is necessary, disclose it
in the tool description so callers understand pagination and missing-field
behavior.

## Working with the Homebox client

`HomeboxClient` adds `/api` to paths passed by tools, authenticates with the
configured account, caches the token until shortly before expiry, and retries
one request after a `401`. Keep those concerns centralized in the client.

Choose response handling deliberately:

- Default handling parses JSON when Homebox returns JSON and text otherwise.
- `{ raw: true }` returns text, such as CSV exports.
- `{ binary: true }` returns base64 data and the response content type.
- `{ multipart: true }` builds `FormData`; do not manually set its
  `Content-Type` header because the runtime must supply the boundary.
- A `204` response becomes `undefined`, which the MCP layer renders as `OK`.

Query values should use the shared `Query` types. Array values are serialized
as repeated query parameters; `undefined` values are omitted.

## Documentation changes

Documentation should describe current behavior separately from proposals:

- Put installation, operation, configuration, and troubleshooting in
  `README.md`.
- Put the complete tool index in `docs/TOOLS.md`.
- Put unimplemented proposals and open design questions in `docs/IDEAS.md`.
- Put runtime design and cross-component behavior in `docs/ARCHITECTURE.md`.
- Put contribution mechanics and code conventions in this file.

Use repository-relative links for local files. Examples must use placeholder
credentials and inventory data. Never copy a real `.env`, bearer token,
Homebox password, user record, or attachment into documentation, fixtures, or
commit history.

When changing tool documentation, verify that every registered tool still has
exactly one reference entry and that stated tool counts remain accurate.

## Validation checklist

Run the checks relevant to every change before committing:

```bash
npm run typecheck
npm run build
git diff --check
```

Because the repository does not yet have an automated test suite, changes to
runtime behavior also need focused manual validation. In the pull request,
state which transport, `READONLY` mode, Homebox version, endpoint, success
case, and failure case were exercised. Never run destructive validation
against an inventory that cannot be restored.

For tool-registry changes, additionally confirm:

- Every tool name is unique.
- Read-only mode exposes no tool whose `write` flag is true.
- Full mode exposes the expected number of tools.
- `docs/TOOLS.md` contains each tool with the matching access level.
- Tool descriptions and Zod schemas visible through MCP discovery are clear.

## Pull request notes

A useful pull request description includes:

- The user or operator problem being solved.
- Any tool-name, input-schema, output, environment, transport, or Homebox
  compatibility impact.
- Security implications, especially changes to authentication, path handling,
  logging, writes, uploads, or destructive operations.
- The exact validation commands and manual scenarios run.
- Follow-up work deliberately left out of scope.

Keep commits focused and do not combine unrelated formatting, dependency, or
generated-file changes with functional work.
