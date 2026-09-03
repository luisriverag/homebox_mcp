# Potential improvements

This document collects possible improvements for homebox-mcp. It is a roadmap
and discussion aid, not a release plan: an item appearing here does not mean it
is scheduled, and priorities can change as Homebox and MCP evolve.

Before implementing an idea, open an issue or proposal that describes the user
problem, expected behavior, compatibility impact, and validation plan. Prefer
small changes that preserve the existing tool names and default-safe behavior.

## Suggested priorities

### 1. Add automated tests

The project currently relies on TypeScript compilation and manual validation.
A first test suite would provide the highest-confidence improvement.

- Unit-test environment parsing, URL normalization, query serialization, and
  bearer-token handling.
- Test Homebox token reuse, expiry, concurrent login coalescing, and the single
  retry after a `401` response with a mocked HTTP server.
- Test that `READONLY=Y` excludes every write tool while preserving every read
  tool.
- Assert that tool names are unique and that the documented tool count matches
  the registry.
- Exercise stdio and Streamable HTTP initialization, tool discovery, malformed
  requests, method rejection, and authenticated versus unauthenticated calls.
- Add representative handler tests for multipart uploads, binary responses,
  CSV import/export, entity merging, and destructive operations.

**Done when:** tests run without a live Homebox instance, cover failure paths as
well as successful calls, and are available through a single `npm test`
command.

### 2. Add continuous integration

Run repeatable checks for every pull request and supported Node.js version.

- Install dependencies with `npm ci`.
- Run formatting or lint checks, `npm run typecheck`, the test suite, and
  `npm run build`.
- Verify that generated or manually maintained documentation remains aligned
  with the tool registry.
- Build the Docker image to catch production-stage dependency or copy errors.
- Enable dependency-update automation with grouped, reviewable updates.

**Done when:** the repository has a required CI workflow whose commands are the
same ones contributors can run locally.

### 3. Make tool documentation self-checking

[`TOOLS.md`](TOOLS.md) is useful to people but can drift as tools change.

- Generate the tool name, access level, description, and input fields from the
  registered `ToolDef` values.
- Keep hand-written operational guidance separate from generated tables.
- Add a CI check that fails when generated output is stale.
- Include the number of tools available in both readonly and read/write modes.

**Done when:** adding, renaming, or changing a tool produces an obvious docs
update and cannot silently leave the reference stale.

## Reliability and operability

### Add explicit health and readiness endpoints

The MCP path intentionally is not a browser-style health endpoint. HTTP
deployments could expose separate endpoints with narrowly defined semantics:

- **Liveness** confirms the Node.js process and HTTP listener are responsive.
- **Readiness** optionally confirms that credentials are configured and
  Homebox is reachable without returning inventory or secrets.
- Health routes should not require an MCP session, disclose credentials, or
  mutate Homebox state.

The route names, authentication policy, timeout, and whether readiness should
log in to Homebox need agreement before implementation.

### Graceful shutdown

Handle `SIGINT` and `SIGTERM` by stopping the HTTP listener, rejecting new
requests, closing active MCP server/transport pairs, and exiting after a bounded
grace period. This would make container restarts and deployments more
predictable.

### Structured, configurable logging

- Add log levels so operators can select errors only or include request-level
  diagnostics.
- Offer structured JSON logs for log aggregation while keeping human-readable
  output as the default.
- Add request correlation IDs for HTTP calls and tool invocations.
- Redact authorization headers, passwords, invitation tokens, attachment data,
  and other sensitive values.
- Keep all stdio-mode logs on stderr so stdout remains protocol-only.

### Timeouts and bounded responses

- Add configurable connect/request timeouts for Homebox calls.
- Return a clear error when Homebox is slow or unreachable.
- Review limits for CSV exports, attachment payloads, base64 images, and deeply
  nested location trees so one call cannot consume unbounded memory.
- Consider pagination helpers where the upstream API supports them, without
  hiding truncation from the caller.

### Observability

Consider opt-in metrics for request counts, durations, error status classes,
Homebox login refreshes, and active HTTP requests. Metrics must avoid tool
arguments and inventory contents. OpenTelemetry support could be evaluated if
it does not impose a large default dependency or configuration burden.

## Security and access control

### Require authentication for non-loopback HTTP listeners

Today, an unset `MCP_AUTH_TOKEN` produces a warning. A safer future major
version could refuse to start without a token when binding to a non-loopback
address, with an explicit escape hatch for intentionally protected networks.
This would be a behavior change and should include a migration notice.

### Finer-grained tool policy

`READONLY` provides a strong, simple boundary but is all-or-nothing for writes.
Potential policy controls include:

- An allowlist or denylist of exact tool names.
- Categories such as item edits, user administration, imports, and bulk
  actions.
- A separate switch for destructive operations.
- Startup validation that rejects unknown names rather than silently ignoring
  policy mistakes.

Any policy must be enforced while tools are registered, as `READONLY` is now,
so forbidden tools never appear in discovery.

### Reverse-proxy guidance

Document a minimal TLS reverse-proxy example, trusted-proxy behavior, request
size limits, timeout recommendations, and safe forwarding of the
`Authorization` header. Examples should avoid presenting a public listener as
safe merely because TLS is enabled.

## Tool and API experience

### Compatibility detection

At startup or through a diagnostic command, detect whether the configured
Homebox instance exposes the supported `entities`/`tags` API. Return a focused
compatibility error for archived `items`/`labels` instances instead of allowing
the first ordinary tool call to fail with a generic `404`.

### Safer destructive operations

Evaluate explicit confirmation inputs for account deletion, member removal,
imports, bulk actions, and permanent deletes. Confirmation belongs primarily
in the calling client, so server-side designs should improve safety without
pretending to establish human intent that the server cannot independently
verify.

### Better large-result ergonomics

- Audit list tools for consistent page, page-size, sort, and filter inputs.
- Clearly report upstream pagination metadata and any server-side filtering.
- Consider summary modes for large inventories and maintenance histories.
- Avoid silently dropping or truncating records; make limits visible in tool
  results.

### Resources and prompts

Investigate whether stable, read-only inventory views are a better fit for MCP
resources and whether common multi-step tasks benefit from optional MCP
prompts. Tools should remain available for dynamic queries and mutations, and
new surfaces should not duplicate the entire API without a clear client need.

### Homebox version compatibility matrix

Record which Homebox releases or API revisions are exercised in tests. If API
behavior differs by version, document the difference and either adapt based on
the reported server version or fail with an actionable minimum-version error.

## Packaging and release process

### Publish versioned artifacts

Possible distribution improvements include:

- Publish a versioned container image for tagged releases.
- Add OCI labels, a non-root runtime user, a health check once health semantics
  exist, and multi-architecture builds.
- Decide whether publishing an npm package would materially simplify stdio
  installation compared with cloning and building the repository.
- Pin or deliberately constrain runtime versions and document the support
  policy.
- Add release notes that call out tool additions, removals, schema changes, and
  Homebox compatibility changes.

### Reproducible container builds

Use `npm ci` in Docker stages, copy the lockfile before installation, and
consider build provenance or an image vulnerability scan in release CI. Avoid
adding package-manager caches or development dependencies to the runtime
image.

## Documentation follow-ups

- Add tested configuration examples for more MCP clients when users request
  them.
- Add an end-to-end example showing tool discovery and a harmless read call,
  without embedding real credentials or inventory data.
- Document upgrade and rollback steps for source and container installs.
- Add a contributor guide covering tool naming, Zod schemas, read/write
  classification, error handling, tests, and documentation updates.
- Add an architecture decision record if transport, authentication, or policy
  behavior becomes more complex.

## Ideas that need evidence first

The following may be useful, but should not be implemented until a concrete
use case demonstrates the cost and desired behavior:

- A persistent MCP session store for the HTTP transport.
- Caching inventory responses, which risks stale or cross-request data.
- Multi-user credential storage inside this server.
- A bundled chat interface or autonomous background jobs.
- A compatibility layer for the archived `hay-kot/homebox` API.

Keeping these out of scope preserves the server's current role as a small
bridge between one configured Homebox account and an MCP-capable client.
