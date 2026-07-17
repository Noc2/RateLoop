# Tokenless MCP cross-client compatibility review

Date: 2026-07-17

Reviewed base commit: `21a1b5563` on `tokenless`

Implementation follow-up: integrated on `tokenless` through `f684c53cb`; commit-level status is recorded below.

Scope: the public handoff MCP, OAuth-protected workspace MCP, connection message, Codex and Claude plugins, generic-client configuration, and the human-review tool loop.

## Executive conclusion

RateLoop has a sound MCP foundation, but the workspace connection should not yet be described as working with every AI model or every MCP client.

The important compatibility boundary is the **MCP host and agent loop**, not the model brand. A model that cannot call tools cannot use MCP. A tool-capable model can use RateLoop only when its host supports the required remote HTTP transport, OAuth behavior, tool-result handling, approval UI, and session lifecycle. Hosted model APIs add another boundary because several require the application to obtain and supply the OAuth token instead of running interactive MCP authorization themselves.

The implementation remains strongest for the bundled Codex and Claude Code paths. It is likely compatible with generic Streamable HTTP clients that implement OAuth discovery plus Dynamic Client Registration (DCR), but those paths are not yet covered by a named-host release matrix. The protected-server lifecycle defect found in this review has been fixed: an authenticated initialize now receives a pre-claim session that is bound exactly once when the connection is claimed.

Recommended order:

1. **Completed:** fix the mid-connection session transition, support `2025-11-25` form elicitation, and add the realistic lifecycle regression.
2. **Partially completed:** pin the official conformance runner in CI for public initialization and tool discovery; the authenticated local lifecycle is covered, while full OAuth and named-host CI remain open.
3. **Completed for documentation:** publish client-specific setup and support tiers behind an **Other MCP client** disclosure. No protected host is labeled Verified before an exact-version release smoke test exists.
4. **Completed:** add a preferred one-call, resumable, idempotent connection tool while retaining granular recovery tools.
5. **Deferred by security review:** add OAuth Client ID Metadata Document support only with the SSRF, redirect, timeout, size, and cache controls described below. Retain DCR.
6. **Partially completed:** public tools now have titles and risk annotations. Field descriptions, truthful output schemas, and provider-adapter compilation remain open.

### Integrated follow-up commits

| Commit | Change |
| --- | --- |
| `cebcc758e` | Replaced generic configuration claims with host-specific setup and explicit support tiers. |
| `dc4f61aa9` | Preserved one protected MCP session from pre-claim initialization through verified connection and enabled `2025-11-25` form elicitation. |
| `7d218b3d9` | Added public-tool titles and machine-readable behavior annotations. |
| `4e8e777dc` | Added pinned official public MCP initialization and tool-discovery conformance gates. |
| `c528247a8` | Applied strict Origin validation to disabled public GET requests as well as POST and OPTIONS. |
| `30cafb35a` | Added the preferred resumable `rateloop_connect_workspace` operation and skill fallback contract. |
| `a9a236456` | Rejected null JSON-RPC request IDs on both MCP servers. |
| `f684c53cb` | Published the preferred connector in the machine-readable handoff and public connection guide. |

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

Follow-up verification also passed:

- the uninterrupted authenticated lifecycle on one session: initialize, initialized notification, tools list, claim, context, verification, ping, and later tools list;
- a fresh one-call connection and its idempotent retry, with no returned URL or fragment and exactly one connected event;
- form-mode negotiation for both `2025-06-18` and capability-aware `2025-11-25` clients, while URL-only elicitation remains disabled;
- all 86 agent-package tests and the relevant OAuth, integration, migration, publishing, and MCP route regressions;
- the pinned `@modelcontextprotocol/conformance` 0.1.16 `server-initialize` and `tools-list` scenarios against a freshly migrated local PostgreSQL database and the real public HTTP route.

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

### P1 — Preserve one session through the claim transition — implemented

The reviewed route created an `MCP-Session-Id` only when an OAuth principal was already bound to a connected integration during `initialize`. A normal new connection therefore initialized without a session and later became session-required after verification.

This created a lifecycle discontinuity:

```text
initialize (unbound) -> no MCP-Session-Id
claim -> context -> verify (becomes connected)
next ping/tools/list/tool call -> 400 mcp_session_required
```

MCP permits a server to create a session in the initialize response. It does not define a server changing a previously sessionless initialized connection into a session-required connection after a tool call. A host may happen to reconnect between tasks, but connection correctness must not depend on that behavior.

The follow-up uses the implementable stateful design: issue a session on the initial authenticated `initialize`, bind it to the token family and OAuth subject, and atomically attach the exact workspace/integration inside the claim transaction. The database permits only an unbound-to-exact transition or an exact idempotent replay; it cannot switch the session to another workspace. Token-family state, subject, expiry, protocol version, and active integration are checked on reuse.

The regression uses the actual order a conforming host follows:

```text
initialize -> notifications/initialized -> tools/list -> claim -> context -> verify -> ping -> tools/list
```

The final two operations now succeed without an undocumented reconnect. The stateless alternative was removed from consideration because Streamable HTTP provides no connection-lifetime identifier with which the server could safely remember that exception.

### P1 — Replace the “common JSON” implication with host-specific setup — implemented for documentation

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

The public guide now keeps Codex as the short primary path, puts other clients behind progressive disclosure, and documents vendor-specific Claude Code, local VS Code/Copilot Chat, and Gemini CLI syntax. It distinguishes application-managed hosted connectors and GitHub cloud agents from local IDE hosts. All protected hosts remain below the Verified tier pending exact-version install, authorization, lifecycle, and tool smoke tests.

### P1 — Add official conformance and cross-client lifecycle tests to CI — partially implemented

The local tests are thorough about RateLoop policy and security, but the protocol implementation is handwritten and there is no official MCP SDK or conformance dependency in the workspace. That makes specification drift more likely.

The follow-up pins `@modelcontextprotocol/conformance` 0.1.16 in CI and runs the applicable `server-initialize` and `tools-list` scenarios against a freshly migrated local public server. The authenticated custom route test covers the full uninterrupted claim lifecycle. Remaining work:

- Expand to other applicable public scenarios using the scenario's supported specification version; do not blindly force every scenario across all three advertised versions.
- Expand the custom authenticated fixture through the complete HTTP OAuth and recovery lifecycle.
- Keep a reviewed expected-failures file only for intentionally unsupported optional features; fail when a new failure appears or an old expected failure unexpectedly passes.

Add an authenticated lifecycle harness that performs OAuth discovery, DCR, PKCE, token exchange, initialize, notification, tool discovery, claim, context, verification, session reuse, refresh rotation, revocation, and 401 recovery. The harness must create disposable test data and must never log access tokens, refresh tokens, connection fragments, or full authorization URLs.

Add release smoke tests for the current stable versions of:

- Codex with the installed RateLoop Workspace plugin;
- Claude Code with the Claude plugin;
- VS Code/Copilot Chat remote HTTP MCP;
- Gemini CLI remote HTTP MCP;
- the official TypeScript and Python MCP clients.

Treat hosted OpenAI/Anthropic MCP connectors and GitHub cloud agents as separate integration modes because their authentication capabilities differ from desktop clients.

### P1 — Reject null JSON-RPC request IDs — implemented

The reviewed dispatchers accepted `id: null` as a request ID. MCP requires a request ID to be a string or integer and not null; null remains appropriate only in an error response when no valid request ID can be recovered. Both public and protected dispatchers now return JSON-RPC `-32600` for a request containing `id: null`, with route regressions for each server.

### P1 — Offer one idempotent connection tool for model-robust onboarding — implemented

Before the follow-up, a model had to correctly sequence:

```text
rateloop_claim_connection_intent
-> rateloop_get_agent_context
-> rateloop_verify_connection
```

The bundled skill teaches this sequence, but generic hosts may not install the skill, may ignore server `instructions`, or may use a smaller model that is less reliable at multi-step tool orchestration. Prompt instructions are helpful but are not a protocol guarantee.

The preferred `rateloop_connect_workspace` tool now accepts the complete connection URL once and performs claim, principal rehydration, canonical context load, context-read recording, and verification as a resumable idempotent operation. Its result contains:

- `connected: true` only after the same verification performed today;
- the effective agent context needed for the next action;
- the machine-readable `nextAction: "follow_bound_policy"`;
- no reflected connection URL or OAuth material.

The existing tools remain available for inspection and recovery. Fresh and repeated one-call tests prove the first call connects, the retry is idempotent, only one connected event exists, and neither response reflects the URL or fragment. The operation retains the existing workspace, OAuth-family, OAuth-client, subject, resource, expiry, and non-evaluative verification checks. It gains no publishing, spending, private-artifact, or workspace-administration authority.

### P2 — Support Client ID Metadata Documents while retaining DCR — deferred

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

### P2 — Make tool schemas easier for different model adapters — partially implemented

The tools have good top-level descriptions and strict inputs, but most fields lack descriptions, no tool declares an `outputSchema`, and `rateloop_request_review` contains nested `oneOf`, `allOf`, and conditional requirements. Different hosts sanitize or convert JSON Schema before showing it to a model. For example, Gemini CLI documents schema sanitization, and the OpenAI Agents SDK offers best-effort strict-schema conversion.

Public tools now have concise titles and truthful read-only, idempotent, destructive, and open-world annotations; workspace tools already had risk annotations. Remaining improvements:

- Add human-readable `title` values to the remaining workspace tools.
- Add concise descriptions to opaque identifiers, hashes, commitments, cursors, timestamps, and nullable fields.
- Add `outputSchema` for every result that returns `structuredContent`; validate server output against it in tests.
- Continue returning the compact JSON text fallback.
- Keep schemas within the shared subset exercised by the target host adapters.
- Compile every tool through the OpenAI and Gemini schema adapters in CI and fail on dropped required fields, unsupported unions, or semantic changes.
- Test small and large tool-capable models for argument accuracy, but use deterministic server-side checks for correctness.

Do not split `rateloop_request_review` merely to satisfy a hypothetical model. First measure whether the tagged public/private union fails in a target adapter. If it does, prefer two shallow, clearly named tools over a permissive schema.

### P2 — Publish explicit support tiers instead of “all models” — implemented for documentation

Suggested language:

| Tier | Meaning |
| --- | --- |
| Verified | RateLoop runs automated install/auth/lifecycle/tool smoke tests against named client versions. |
| Protocol-compatible | The client implements Streamable HTTP and compatible OAuth, but RateLoop does not run a release smoke test. |
| Application-managed | The SDK or hosted API can call the server only after the embedding application obtains and supplies a token. |
| Public MCP only | The host cannot complete protected workspace OAuth but can use the separate unauthenticated browser-handoff server. |
| Unsupported | The host lacks remote HTTP MCP, OAuth, tool calling, or required policy controls. |

The public guide now uses these tiers and keeps the model separate from the host. No protected host is marked Verified yet. The model can be described separately as “tested for tool-selection accuracy” without implying that the model implements OAuth or MCP transport.

### P2 — Add privacy-safe connection funnel telemetry — not implemented

The server already records useful client name, version, capabilities, and protocol metadata. Add aggregate stage metrics for:

```text
401 challenge -> metadata fetched -> client registered -> authorization completed
-> initialize -> tools listed -> intent claimed -> context read -> verification succeeded
```

Record bounded error codes, client/version, protocol version, and elapsed stage time. RateLoop-controlled telemetry must never record full authorization URLs, redirect query strings, connection URLs/fragments, bearer tokens, tool arguments, prompts, outputs, or private artifacts. This is the fastest way to distinguish model sequencing failures from host activation, OAuth, transport, session, and schema failures. Verification of a named host must separately assess that host's retention and tool-argument handling; RateLoop cannot prove what an arbitrary host records.

### P3 — Keep strict protocol-version header validation — reviewed, no change required

The original recommendation to accept an unknown `MCP-Protocol-Version` header during initialize was incorrect. MCP requires a received invalid or unsupported protocol-version header to return `400`. An initial initialize request need not send that header; negotiation occurs through `params.protocolVersion` in the JSON body.

The routes therefore retain strict header validation. Existing tests also cover an initialize body that proposes an unknown version and receives the server's newest supported version. No permissive-header change was made.

### P3 — Keep strict Origin validation; allowlist browser hosts only when verified — hardened

The route rejects every cross-origin browser request and allows same-origin requests. This is secure and works for server-side/desktop clients that omit `Origin`, but a browser-native MCP host that connects directly will fail.

Strict validation now also applies to disabled public GET requests, not only POST and OPTIONS. Do not use `Access-Control-Allow-Origin: *`. If a browser-native client becomes a supported target, add an explicit deployment-configured origin allowlist, bind it to reviewed host origins, include it in Vary/caching tests, and run a real browser smoke test. Otherwise retain the current policy and document that the client must use its trusted backend/desktop transport.

### P3 — Consider scope step-up after compatibility measurement — deferred

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
| OpenAI hosted MCP tool | Internet-reachable remote server plus caller-supplied authorization | Application-managed; not the same as the plugin connection flow. |
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
11. No prompt, output, hidden reasoning, credential, fragment, or private artifact appears in RateLoop-controlled logs or connection telemetry; named-host verification separately assesses host retention and tool-argument handling.
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
