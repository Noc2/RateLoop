# Tokenless MCP cross-client compatibility review

Date: 2026-07-17

Reviewed base commit: `21a1b5563` on `tokenless`

Scope: the public handoff MCP, OAuth-protected workspace MCP, connection message, Codex and Claude plugins, generic-client configuration, and the human-review tool loop.

## Executive conclusion

RateLoop has a sound MCP foundation, but the workspace connection should not yet be described as working with every AI model or every MCP client.

The important compatibility boundary is the **MCP host and agent loop**, not the model brand. A model that cannot call tools cannot use MCP. A tool-capable model can use RateLoop only when its host supports the required remote HTTP transport, OAuth behavior, tool-result handling, approval UI, and session lifecycle. Hosted model APIs add another boundary because several require the application to obtain and supply the OAuth token instead of running interactive MCP authorization themselves.

The current implementation is strongest for the bundled Codex and Claude Code paths. It is likely compatible with generic Streamable HTTP clients that implement OAuth discovery plus Dynamic Client Registration (DCR), but those paths are not covered by a cross-client test matrix. One protected-server lifecycle issue should be fixed before broader compatibility claims: the server can begin a connection without an MCP session and then require a session immediately after verification, even though the client was never given a session ID.

Recommended order:

1. Fix the mid-connection session transition and add a realistic lifecycle regression test.
2. Put the official MCP conformance runner and an authenticated workspace harness in CI.
3. Publish a verified client-support matrix and client-specific setup snippets behind an **Other MCP client** disclosure.
4. Add a one-call, idempotent connection tool so correctness does not depend on a model reliably sequencing three tools.
5. Add current OAuth Client ID Metadata Document support, while retaining DCR as a fallback.
6. Improve tool schemas and model-facing results, then test them through the schema adapters used by several model providers.

## What was checked

### Repository paths

- The protected Streamable HTTP route in [`packages/nextjs/app/api/agent/v1/mcp/route.ts`](../packages/nextjs/app/api/agent/v1/mcp/route.ts).
- Protocol negotiation and tool definitions in [`packages/nextjs/lib/mcp/workspaceProtocol.ts`](../packages/nextjs/lib/mcp/workspaceProtocol.ts) and [`packages/nextjs/lib/mcp/protocol.ts`](../packages/nextjs/lib/mcp/protocol.ts).
- OAuth discovery, DCR, PKCE, resource binding, refresh rotation, revocation, and device authorization in [`packages/nextjs/lib/tokenless/agentOAuth.ts`](../packages/nextjs/lib/tokenless/agentOAuth.ts) and related tests.
- Single-use connection intent claim and verification in [`packages/nextjs/lib/tokenless/agentConnectionIntents.ts`](../packages/nextjs/lib/tokenless/agentConnectionIntents.ts).
- Stateful elicitation and session binding in [`packages/nextjs/lib/mcp/workspaceElicitation.ts`](../packages/nextjs/lib/mcp/workspaceElicitation.ts).
- The generated connection prompt in [`packages/nextjs/components/tokenless/agents/agentConnectionMessage.ts`](../packages/nextjs/components/tokenless/agents/agentConnectionMessage.ts).
- Codex and Claude plugin manifests and the workspace connection skill under [`plugins/rateloop-workspace`](../plugins/rateloop-workspace).
- Generic connection guidance in [`packages/nextjs/public/docs/agent-connection.md`](../packages/nextjs/public/docs/agent-connection.md) and [`packages/nextjs/app/(public)/docs/ai/page.tsx`](../packages/nextjs/app/(public)/docs/ai/page.tsx).

### Verification performed

- All 25 targeted workspace MCP, OAuth, device flow, connection-intent, elicitation, and connection-message tests passed.
- The live tokenless protected-resource metadata and authorization-server metadata were reachable and matched the checked-in implementation.
- An unauthenticated initialize request to the live workspace MCP returned `401`, a resource-specific RFC 9728 `WWW-Authenticate` challenge, and no credential material.
- `@modelcontextprotocol/conformance` 0.1.16 passed the live public MCP for:
  - `server-initialize`
  - `tools-list` with the expected four public handoff tools

The authenticated workspace flow was not exercised against the deployed environment because this review had no user connection intent and did not create one. The local tests cover its service logic, but they are not a substitute for real host OAuth and lifecycle smoke tests.

## Current strengths to preserve

1. **The public and workspace MCP servers are separate.** The public server cannot silently substitute for the protected workspace server.
2. **OAuth credentials stay out of chat and configuration.** Operational tokens are issued to the host; the one-time fragment is accepted only by the protected claim tool.
3. **OAuth has strong bindings.** The implementation uses S256 PKCE, exact redirect matching, resource indicators, hash-only token storage, refresh-token rotation, family-wide replay revocation, and server-side workspace binding.
4. **Transport behavior is mostly current.** The route uses one Streamable HTTP endpoint, enforces the required POST `Accept` types, validates `Origin`, supports protocol versions `2025-03-26`, `2025-06-18`, and `2025-11-25`, returns JSON tool results, and supports authenticated GET/SSE plus session deletion.
5. **Tools expose both text and structured results.** JSON text is a valuable compatibility fallback when a host ignores `structuredContent`.
6. **Tool risk annotations are present.** Read-only, additive, idempotent, destructive, and open-world hints are materially accurate.
7. **Elicitation is progressive enhancement.** It is enabled only for a negotiated client capability and otherwise falls back to the normal browser approval path.
8. **Connection verification is non-evaluative.** It does not create review opportunities or adaptive-review evidence.
9. **The skill fails closed.** It does not infer OAuth success, expose the connection URL, invent host UI, create a polling service, or report success before server verification.

## Findings and improvements

### P1 — Do not introduce an MCP session after initialization has already completed

The route creates an `MCP-Session-Id` only when an OAuth principal is already bound to a connected integration during `initialize`. A normal new connection initializes while the principal is still unbound, so it receives no session ID. The model then calls claim, context, and verify. Once verification changes the connection to `connected`, every later non-initialize request is rejected unless it contains an `MCP-Session-Id` that the client was never issued.

This creates a lifecycle discontinuity:

```text
initialize (unbound) -> no MCP-Session-Id
claim -> context -> verify (becomes connected)
next ping/tools/list/tool call -> 400 mcp_session_required
```

MCP permits a server to create a session in the initialize response. It does not define a server changing a previously sessionless initialized connection into a session-required connection after a tool call. A host may happen to reconnect between tasks, but connection correctness must not depend on that behavior.

Recommended implementation choices, in preference order:

1. Issue an OAuth session on the initial authenticated `initialize`, bind it to the token family and OAuth subject, and atomically attach the workspace/integration after a successful claim. Do not allow that attachment to change to another workspace.
2. If pre-claim sessions are intentionally avoided, keep that initialized connection stateless for its lifetime. Begin requiring a session only after the client performs a later initialize and receives a session ID.

Add a regression test with the actual order a conforming host uses:

```text
initialize -> notifications/initialized -> tools/list -> claim -> context -> verify -> ping -> tools/list
```

The final two operations must succeed without an undocumented reconnect. Test both a sessionful design and the explicit stateless alternative, not the current mixture.

### P1 — Replace the “common JSON” implication with verified host-specific setup

The downloadable file uses this shape:

```json
{
  "mcpServers": {
    "rateloop-workspace": {
      "type": "http",
      "url": "https://rateloop-tokenless.vercel.app/api/agent/v1/mcp"
    }
  }
}
```

That is valid for the bundled plugins, but there is no universal MCP configuration-file schema:

- VS Code uses a top-level `servers` object and supports an optional `oauth.clientId`.
- Gemini CLI distinguishes `httpUrl` in JSON, although its CLI accepts `--transport http` with a URL.
- Claude Code accepts a remote HTTP server through its CLI and runs OAuth from `/mcp`.
- OpenAI and Anthropic hosted MCP APIs expect the caller application to supply an authorization token; they are not equivalent to an interactive desktop-host OAuth connection.
- GitHub Copilot cloud agent and code review currently do not support remote OAuth MCP servers.

Keep the primary Codex path short. Behind an explicit **Other MCP client** action, publish only snippets that have been verified against the named client and version. Each snippet should identify:

- whether it supports the protected workspace server or only the public server;
- whether OAuth discovery is automatic, manual, or application-managed;
- the exact transport field and configuration envelope;
- whether the host consumes MCP `instructions`;
- whether tool calls are user-approved;
- whether async elicitation is supported;
- whether RateLoop can be advisory only or a verified adapter can own the output boundary.

Do not generate unverified install links or guess redirect URIs. The existing restraint around VS Code and Cursor install metadata is correct.

### P1 — Add official conformance and cross-client lifecycle tests to CI

The local tests are thorough about RateLoop policy and security, but the protocol implementation is handwritten and there is no official MCP SDK or conformance dependency in the workspace. That makes specification drift more likely.

Add the official conformance runner as a pinned CI job:

- Run the active server suite against a locally started public MCP.
- Run applicable server scenarios against an authenticated workspace fixture.
- Keep a reviewed expected-failures file only for intentionally unsupported optional features; fail when a new failure appears or an old expected failure unexpectedly passes.
- Run the suite for all three advertised protocol versions.

Add an authenticated lifecycle harness that performs OAuth discovery, DCR, PKCE, token exchange, initialize, notification, tool discovery, claim, context, verification, session reuse, refresh rotation, revocation, and 401 recovery. The harness must create disposable test data and must never log access tokens, refresh tokens, connection fragments, or full authorization URLs.

Add release smoke tests for the current stable versions of:

- Codex with the installed RateLoop Workspace plugin;
- Claude Code with the Claude plugin;
- VS Code/Copilot Chat remote HTTP MCP;
- Gemini CLI remote HTTP MCP;
- the official TypeScript and Python MCP clients.

Treat hosted OpenAI/Anthropic MCP connectors and GitHub cloud agents as separate integration modes because their authentication capabilities differ from desktop clients.

### P1 — Offer one idempotent connection tool for model-robust onboarding

Today a model must correctly sequence:

```text
rateloop_claim_connection_intent
-> rateloop_get_agent_context
-> rateloop_verify_connection
```

The bundled skill teaches this sequence, but generic hosts may not install the skill, may ignore server `instructions`, or may use a smaller model that is less reliable at multi-step tool orchestration. Prompt instructions are helpful but are not a protocol guarantee.

Add a safe, idempotent tool such as `rateloop_connect_workspace` that accepts the complete connection URL once and performs claim, context load, and verification as one server-side transaction or resumable idempotent operation. Its result should contain:

- `connected: true` only after the same verification performed today;
- the effective agent context needed for the next action;
- a short machine-readable `nextAction`;
- no reflected connection URL or OAuth material.

Keep the existing tools available for inspection and recovery. The combined tool must retain all existing workspace, OAuth-family, expiry, and non-evaluative verification checks. It must not gain publishing, spending, private-artifact, or workspace-administration authority.

### P2 — Support Client ID Metadata Documents while retaining DCR

The current authorization-server metadata advertises DCR through `registration_endpoint`, but not Client ID Metadata Documents (CIMD). MCP `2025-11-25` recommends CIMD for clients and authorization servers, with preregistration first when available and DCR as a fallback.

Add CIMD only with a full security design:

- advertise support in authorization-server metadata;
- require HTTPS client IDs with a path;
- fetch with strict SSRF protection, redirect limits, response-size limits, timeouts, and public-address validation;
- require the document's `client_id` to exactly equal its URL;
- validate exact redirect URIs and supported public-client authentication;
- cache according to bounded HTTP semantics;
- preserve S256 PKCE and exact MCP resource binding.

Retain DCR for clients that currently depend on it. Pre-register stable, verified public client IDs only where the host requires it. Do not weaken redirect validation to make an unknown client connect.

### P2 — Make tool schemas easier for different model adapters

The tools have good top-level descriptions and strict inputs, but most fields lack descriptions, no tool declares an `outputSchema`, and `rateloop_request_review` contains nested `oneOf`, `allOf`, and conditional requirements. Different hosts sanitize or convert JSON Schema before showing it to a model. For example, Gemini CLI documents schema sanitization, and the OpenAI Agents SDK offers best-effort strict-schema conversion.

Improvements:

- Add human-readable `title` values for tools.
- Add concise descriptions to opaque identifiers, hashes, commitments, cursors, timestamps, and nullable fields.
- Add `outputSchema` for every result that returns `structuredContent`; validate server output against it in tests.
- Continue returning the compact JSON text fallback.
- Keep schemas within the shared subset exercised by the target host adapters.
- Compile every tool through the OpenAI and Gemini schema adapters in CI and fail on dropped required fields, unsupported unions, or semantic changes.
- Test small and large tool-capable models for argument accuracy, but use deterministic server-side checks for correctness.

Do not split `rateloop_request_review` merely to satisfy a hypothetical model. First measure whether the tagged public/private union fails in a target adapter. If it does, prefer two shallow, clearly named tools over a permissive schema.

### P2 — Publish explicit support tiers instead of “all models”

Suggested language:

| Tier | Meaning |
| --- | --- |
| Verified | RateLoop runs automated install/auth/lifecycle/tool smoke tests against named client versions. |
| Protocol-compatible | The client implements Streamable HTTP and compatible OAuth, but RateLoop does not run a release smoke test. |
| Application-managed | The SDK or hosted API can call the server only after the embedding application obtains and supplies a token. |
| Public MCP only | The host cannot complete protected workspace OAuth but can use the separate unauthenticated browser-handoff server. |
| Unsupported | The host lacks remote HTTP MCP, OAuth, tool calling, or required policy controls. |

The model can then be described separately as “tested for tool-selection accuracy” without implying that the model implements OAuth or MCP transport.

### P2 — Add privacy-safe connection funnel telemetry

The server already records useful client name, version, capabilities, and protocol metadata. Add aggregate stage metrics for:

```text
401 challenge -> metadata fetched -> client registered -> authorization completed
-> initialize -> tools listed -> intent claimed -> context read -> verification succeeded
```

Record bounded error codes, client/version, protocol version, and elapsed stage time. Never record full authorization URLs, redirect query strings, connection URLs/fragments, bearer tokens, tool arguments, prompts, outputs, or private artifacts. This is the fastest way to distinguish model sequencing failures from host activation, OAuth, transport, session, and schema failures.

### P3 — Make initialization forward-compatible with the next protocol version

The HTTP route validates `MCP-Protocol-Version` before parsing the request. A future client that sends its proposed new version in the header on its initial `initialize` could receive `400` before JSON-level version negotiation can select the newest mutually supported version.

The specification requires the header on requests after initialization and defines negotiation in the initialize exchange. Parse enough of an initial request to permit negotiation, while retaining strict validation for all subsequent requests. Add a test where the initialize body proposes an unknown future version and the server returns its newest supported version.

### P3 — Keep strict Origin validation; allowlist browser hosts only when verified

The route rejects every cross-origin browser request and allows same-origin requests. This is secure and works for server-side/desktop clients that omit `Origin`, but a browser-native MCP host that connects directly will fail.

Do not use `Access-Control-Allow-Origin: *`. If a browser-native client becomes a supported target, add an explicit deployment-configured origin allowlist, bind it to reviewed host origins, include it in Vary/caching tests, and run a real browser smoke test. Otherwise retain the current policy and document that the client must use its trusted backend/desktop transport.

### P3 — Consider scope step-up after compatibility measurement

The initial challenge currently requests all four safe scopes, including review decision capability. The latest MCP authorization guidance favors minimal initial scopes and runtime step-up.

A future design could start with `connection:claim context:read`, then challenge for evaluation or review scopes when those tools are first used. This improves least privilege but will reduce compatibility with clients that do not implement step-up correctly. Measure target-client behavior first, keep server-side publishing/spending grants separate, and do not trade the current safe connection semantics for a nominally narrower but unreliable flow.

## Compatibility snapshot

This is a product-support assessment, not a claim that every listed client was exercised in this review.

| Host or integration | Protected workspace fit | Current assessment |
| --- | --- | --- |
| Codex desktop with RateLoop Workspace plugin | Host-native OAuth, bundled skill, Streamable HTTP | Primary path; local contracts are strong, but add installed-host release smoke tests. |
| Claude Code with RateLoop Workspace plugin | Remote HTTP OAuth and bundled skill | Strong candidate; generated Codex plugin message is not a universal Claude install path. |
| VS Code / Copilot Chat | Remote HTTP MCP and OAuth with DCR or configured client ID | Likely protocol-compatible; needs its own config shape and verified redirect behavior. |
| Gemini CLI | Remote HTTP MCP, OAuth discovery, DCR | Likely protocol-compatible; JSON uses `httpUrl`, not the current downloadable shape. |
| OpenAI Agents SDK, local Streamable HTTP client | Can call remote HTTP and pass headers | Application-managed OAuth unless an embedding app implements the flow. It can also be used with non-OpenAI models. |
| OpenAI hosted MCP tool | Public remote server plus caller-supplied authorization | Application-managed; not the same as the plugin connection flow. |
| Anthropic Messages API MCP connector | Caller supplies and refreshes authorization token | Application-managed; not interactive host-native OAuth. |
| GitHub Copilot cloud agent / code review | Remote OAuth MCP currently unsupported | Protected workspace unsupported; do not group it with local Copilot Chat. |
| Non-tool-capable chat model | No MCP agent loop | Unsupported regardless of model quality. |

## Acceptance criteria for a broad compatibility claim

RateLoop may claim a named host/model combination is verified when all of the following are automated or release-gated:

1. The host installs the exact protected workspace server without exposing a credential in chat or configuration.
2. OAuth discovery, registration or preregistration, PKCE, resource binding, refresh, and revocation succeed.
3. A new connection completes from one user-provided message without asking for the link again.
4. Initialize, initialized notification, tool listing, claim, context, verification, ping, and later tool calls follow one valid session lifecycle.
5. Repeated claim and verification are idempotent.
6. Revocation produces a new authorization challenge and cannot reuse the old token family.
7. Tool schemas survive the host's adapter without losing required constraints.
8. Tool success and error results remain usable when the host reads only text, only structured content, or both.
9. A client without elicitation uses the browser fallback; a client with negotiated elicitation cannot receive unsupported request modes.
10. The model completes the normal path across repeated trials, while security and policy checks remain deterministic server-side.
11. No prompt, output, hidden reasoning, credential, fragment, or private artifact appears in logs or connection telemetry.
12. Advisory hosts are described as advisory; only an adapter that owns the output boundary and verifies signed release evidence is described as enforced.

## Primary research sources

- [MCP 2025-11-25 Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP 2025-11-25 lifecycle and version negotiation](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)
- [MCP 2025-11-25 authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP 2025-11-25 tools and structured results](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [MCP 2025-11-25 elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)
- [Official MCP conformance framework](https://github.com/modelcontextprotocol/conformance)
- [Official MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector)
- [Claude Code remote MCP and OAuth](https://docs.anthropic.com/en/docs/claude-code/mcp)
- [Anthropic Messages API MCP connector](https://docs.anthropic.com/en/docs/agents-and-tools/mcp-connector)
- [OpenAI Agents SDK MCP guide](https://openai.github.io/openai-agents-js/guides/mcp/)
- [OpenAI Agents Python SDK MCP guide](https://openai.github.io/openai-agents-python/mcp/)
- [VS Code MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)
- [VS Code MCP developer authorization guidance](https://code.visualstudio.com/api/extension-guides/ai/mcp)
- [Gemini CLI MCP server and OAuth guidance](https://geminicli.com/docs/tools/mcp-server/)
- [GitHub Copilot cloud-agent MCP limitations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/mcp-and-cloud-agent)
