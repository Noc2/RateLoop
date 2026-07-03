# RateLoop Agent Journey Review — Second Pass (2026-07-03)

**Scope:** The full agent integration journey — agent-facing **docs** → **landing page / per-platform MCP integration** → **handoff link** create/lifecycle/UI → **using the information** (status polling, results, exports, and webhook callbacks).
**Method:** Independent second-pass multi-agent review (9 parallel reviewers across the journey → triage/dedupe → one adversarial verifier per finding, classifying each as net-new / overlaps-prior-pass / already-fixed). 46 agents, ~2.1M tokens. See [Methodology](#methodology).
**Relationship to the first pass:** This complements `docs/agent-process-review-2026-07-03.md` (AP‑1…AP‑10). All 11 prior findings that resurfaced were **re-verified as still present** in current code (none had been fixed); the other 23 are **net-new**.
**Result:** 47 raw → 36 after triage → **34 confirmed** (2 P1, 24 P2, 8 P3). None were refuted or judged intentional.

This is a defensive DX/consistency/correctness review of the author's own project, to make the agent path cleaner. No security issues here; these are correctness, drift, and clarity problems that make the integration harder than it needs to be.

---

## Cross-cutting themes

The 34 findings cluster into six themes — fixing these root causes closes most of the list:

1. **MCP output-schema ↔ runtime drift.** Tool `outputSchema`s declare fields the runtime never returns and omit fields it always returns: `AJ-01` (finality fields missing from pending/dry-run), `AJ-20` (status/prepare/complete omit create-only fields they share a schema with), `AJ-21` (`x402AuthorizationRequest` declared but never returned; `paymentModeDiagnostics` returned but undeclared), `AJ-27` (`protocolState.status` type flips number↔string), `AJ-15` (status vs result "next action" fields disjoint and one undocumented).
2. **Per-platform config inconsistency.** The same platform is configured three different ways across landing snippet / example JSON / `.md`, and some configs are wrong for their named client: `AJ-05`, `AJ-11`, `AJ-12`, `AJ-13`, `AJ-28`.
3. **Webhook channel is half-finished.** Undocumented signature scheme (`AJ-03`), a default event that never fires (`AJ-16`), the whole channel missing from machine-readable mirrors (`AJ-17`), and a third status vocabulary (`AJ-33`).
4. **Status / naming vocabulary drift.** Browser vs remote tool naming (`AJ-14`), noun labels for the same object (`AJ-32`), three different `status` meanings (`AJ-33`).
5. **Human-vs-agent UX inversion.** The agent gets a clean `nextAction`; the human approving the wallet payment sees raw snake_case tokens and, on the browser-signing surface, no terms/non-refundable notice at all: `AJ-23`, `AJ-09`.
6. **CLI ↔ docs drift.** Missing handoff-status command (`AJ-07`), inconsistent first-run defaulting (`AJ-08`), a help-only command name that isn't a real subcommand (`AJ-24`), undocumented functional flags (`AJ-25`), no "persist the token" guidance (`AJ-26`).

---

## Summary table

| ID | Pri | New? | Stage | Title |
|----|-----|------|-------|-------|
| AJ-03 | **P1** | new | webhooks | Callback signature scheme (HMAC preimage/headers/canonical body) is undocumented — consumers can't verify webhooks |
| AJ-04 | **P1** | new | handoff-lifecycle | Handoff can get permanently stuck in `uploading_images` with no recovery path |
| AJ-01 | P2 | new | using-results | `rateloop_get_result` pending & dry-run packages omit finality fields their own `outputSchema` marks required |
| AJ-05 | P2 | new | platform | MCP-config platform docs tell agents to poll `getQuestionStatus`/`getResult` (SDK names) that aren't MCP tool names |
| AJ-06 | P2 | AP-5 | docs | FAQ, OAuth resource metadata, and AgentSubmissionPanel link to non-existent `/docs/ai` anchors |
| AJ-07 | P2 | AP-1 | cli-sdk | CLI can create handoffs but has no `handoff-status` command — the documented poll step is uncallable |
| AJ-08 | P2 | AP-4 | cli-sdk | First run without `RATELOOP_API_BASE_URL` fails with a non-actionable message; only `handoff` silently defaults |
| AJ-09 | P2 | AP-10 | handoff-ui | Browser-signing page lacks the terms gate & non-refundable clarity the handoff page enforces |
| AJ-10 | P2 | AP-3 | handoff-lifecycle | GET/PATCH handoff status ships full base64 image dataUrls by default (unlike the MCP tool); SDK strips them every poll |
| AJ-11 | P2 | new | platform | Landing snippet and shipped example config disagree on endpoint/auth/headers for the same platform |
| AJ-12 | P2 | new | platform | Gemini CLI example uses `url`+`transport:streamable-http`, but Gemini's HTTP key is `httpUrl` (route 405s on SSE) |
| AJ-13 | P2 | new | platform | `X-Agent-Name` header is never read server-side and is absent from the CORS allowlist |
| AJ-14 | P2 | new | handoff-ui | Browser WebMCP tools are `noun_verb` (`rateloop_handoff_get_status`) vs the canonical `verb_noun` everywhere else |
| AJ-15 | P2 | new | using-results | Status vs result tools name the "next step" field differently with disjoint vocabularies; one is unschema'd |
| AJ-16 | P2 | new | webhooks | `question.failed` is a subscribable/default callback event that no producer ever emits |
| AJ-17 | P2 | AP-8 | webhooks | The webhook channel & its event vocabulary are absent from every markdown/skill/llms mirror |
| AJ-18 | P2 | AP-9 | docs | `skill.md`/`llms.txt` document a rating workflow but omit every rating tool from their tool lists |
| AJ-19 | P2 | AP-8 | docs | Rendered `/docs/ai` states voter-floor tiers as USDC-only, but the code floor is asset-neutral atomic units |
| AJ-20 | P2 | AP-3 | handoff-lifecycle | Status/prepare/complete omit self-contained `handoffUrl`/`handoffToken`/`statusTool`/`resultTool` yet share the create schema |
| AJ-21 | P2 | new | handoff-create | Shared handoff schema declares `x402AuthorizationRequest` (never returned) and omits `paymentModeDiagnostics` (always returned) |
| AJ-22 | P2 | new | handoff-lifecycle | Completing after a prepared handoff expires returns "Prepare this handoff first" even though wallet calls are on-chain |
| AJ-23 | P2 | AP-7 | handoff-ui | Handoff & signing UIs render raw snake_case status tokens to wallet holders; image-failure recovery is a dead-end |
| AJ-24 | P2 | new | cli-sdk | `usage()`/README document the lint command as `lint:questions` (a yarn-script alias), not the real `lint` subcommand |
| AJ-25 | P2 | new | cli-sdk | Functional CLI flags are undocumented, incl. the LREP-required `--payment-mode` and status/result recovery filters |
| AJ-26 | P2 | AP-2 | handoff-create | Nothing tells the agent to persist `handoffId`+`handoffToken` before sharing the URL (both required to poll) |
| AJ-27 | P2 | new | using-results | `protocolState.status` changes type (number vs string) between settled and pending/dry-run results of the same tool |
| AJ-28 | P3 | new | platform | Transport is declared four different ways across configs; the Codex plugin `.mcp.json` omits `MCP-Protocol-Version` |
| AJ-30 | P3 | new | using-results | Audit & export retrieval have no public (permissionless) path, unlike results/asks status |
| AJ-31 | P3 | new | platform | `AgentIcon` renders dead branches for "Kimi"/"And Others" not in the install-target list |
| AJ-32 | P3 | new | handoff-ui | Two approval surfaces use divergent nouns for the same object ("handoff" vs "signing intent"/"signing link") |
| AJ-33 | P3 | new | webhooks | Callback payload `status` vocabulary diverges from the polling API enum and delivery status, with no mapping |
| AJ-34 | P3 | new | using-results | Authenticated by-client-request routes forward `walletAddress` from the SDK but silently drop it before the tool call |
| AJ-35 | P3 | AP-8 | docs | `llms.txt` promises `ai.md` is a "clean mirror" but it drops the install quickstart and named fast preset |
| AJ-36 | P3 | new | handoff-create | Create-response `nextAction` override drops the builder's "poll before sharing" guidance for in-flight image handoffs |

---

## P1 — fix first

### AJ-03 · Callback signature scheme is undocumented (webhooks)
**Where:** `packages/nextjs/lib/agent-callbacks/signing.ts:21-71`; only mention at `app/(public)/docs/ai/page.tsx:492-493`.
Deliveries are HMAC-SHA256 over the preimage `v1.{callback-id}.{callback-timestamp}.{rawBody}` (canonical JSON), emitted as `x-rateloop-callback-signature: v1=<hex>` with `x-rateloop-callback-id` and `x-rateloop-callback-timestamp`. The docs name only the signature header — never the preimage layout, the algorithm, the other two required headers, or the "verify over the exact received bytes" rule. Grep of `ai.md`/`README`/`skill.md`/`llms.txt`/examples finds zero coverage.
**Impact:** An agent registering a webhook receiver cannot recompute the signature (`verifyCallbackSignature` returns false silently), so it either can't authenticate callbacks or skips verification — defeating the point of signing.
**Fix:** Add a "Verifying callback signatures" block to `docs/ai` and mirror it into `ai.md`/`llms.txt`/`skill.md`/`README`: the three headers, HMAC-SHA256 keyed by `webhookSecret` over the exact preimage, the raw-body requirement, and an ~8-line Node verify snippet mirroring `verifyCallbackSignature`.

### AJ-04 · Handoff can get permanently stuck in `uploading_images` (handoff-lifecycle)
**Where:** `app/api/agent/handoffs/[handoffId]/prepare/route.ts:236-240`; `lib/agent/handoffs.ts:1597` (`assertHandoffCanPrepare`).
`prepare` sets status `uploading_images`, then serially uploads images (up to 45s/image moderation wait). If the invocation is killed mid-loop the handoff stays `uploading_images` forever — no sweep clears it, and `assertHandoffCanPrepare`'s allow-list (`prepared`/`pending`/`awaiting_image_signatures`/`failed`) excludes `uploading_images`, so a retry 409s with *"Handoff cannot be prepared from status uploading_images."* Meanwhile the `uploading_images` `nextAction` tells the client to keep polling for a completion that never comes.
**Impact:** An interrupted prepare is dead-ended mid-funding: retry 409s, status polling loops forever, and the only escape is waiting out expiry and requesting a brand-new link.
**Fix:** Add `uploading_images` to the `assertHandoffCanPrepare` allow-list so a retry idempotently re-drives the upload loop (already-uploaded assets skip), **or** have the loader/sweep demote a stale `uploading_images` handoff to `failed` after a bound. Also make that state's `nextAction` acknowledge a possible stall and offer a concrete retry.

---

## P2

### Using the results / MCP schema conformance
- **AJ-01 · Pending & dry-run result packages omit required finality fields.** `resultPackageOutputSchema` marks `finalityStatus`, `blockedReason`, `estimatedReadyAt`, `includesVetoWindow`, `normalMaxDelaySeconds`, `stalled` (+`targetAudienceMatch`) as required (`lib/agent/schemas.ts:1288-1303`), and the settled builder emits them, but `buildPendingQuestionResultPackage` (`lib/mcp/tools.ts:3169`, the common still-settling poll) and `dryRunResultPackage` (`:2812`) emit none. Strict MCP hosts error on every not-ready poll and dry-run; agents reading `result.finalityStatus`/`stalled`/`estimatedReadyAt` to decide whether to keep polling get `undefined`. **Fix:** emit the fields from all three builders via one shared type, or relax `required[]`.
- **AJ-15 · Status vs result "next action" fields are disjoint.** `rateloop_get_question_status` returns `nextAction` (`call_rateloop_get_result` | `poll_…` | `manual_review`) that isn't in its `outputSchema`; `rateloop_get_result` returns `recommendedNextAction` with a different vocabulary. An agent building one dispatch table over "the next step" must special-case each tool. **Fix:** unify the field name + vocabulary, or at minimum add `nextAction` to the status schema and document the mapping.
- **AJ-27 · `protocolState.status` type flips.** Numeric content-lifecycle code when settled (`lib/agent/resultPackage.ts:745`) vs strings (`not_found`/`dry_run`) in pending/dry-run (`tools.ts:3225`, `:2901`); schema declares only `{ type: "object" }`. A `switch` written against one path silently fails on the other. **Fix:** one representation across packages (numeric status + a separate `operationStatus` string), documented.

### Platform integration configs
- **AJ-05 · MCP-config docs point agents at SDK method names.** `gemini-cli.md:32`, `openclaw.md:67`, `hermes-agent.md:32`, `examples/README.md:147` configure agents purely via `mcpServers` JSON but then say "poll `getQuestionStatus`/`getResult`" — bare SDK method names. Over MCP the tools are `rateloop_get_question_status`/`rateloop_get_result`; the bare names return "Unknown tool". **Fix:** use the `rateloop_`-prefixed names in MCP-config docs.
- **AJ-11 · Landing snippet vs example JSON disagree per platform.** The landing modal serves Gemini/OpenClaw the tokenless public config, but `gemini-cli.mcpServers.json` uses authenticated `/api/mcp` + `Authorization: Bearer` + `X-Agent-Name`, and `openclaw.mcpServers.json` uses public but adds `X-Agent-Name`. Three endpoint/auth combinations per platform. **Fix:** one canonical config per platform across landing modal, `.mcpServers.json`, and `.md`; extend the `examplesDocs` parity test to assert URL+headers.
- **AJ-12 · Gemini CLI example config is wrong for Gemini CLI.** It uses `"url"` + `"transport": "streamable-http"`; Gemini CLI reads `httpUrl` for streamable HTTP and treats `url` as SSE, which `/api/mcp` refuses with 405. **Fix:** use `"httpUrl"` (drop the unrecognized `transport`), verified against the current Gemini CLI schema.
- **AJ-13 · `X-Agent-Name` is a no-op and CORS-unsafe.** Present only in the example files; never read server-side and missing from `Access-Control-Allow-Headers` on both `/api/mcp` and `/api/mcp/public`, so CORS-strict clients fail preflight. **Fix:** implement + CORS-allow it, or remove it from all four example files.

### Handoff create / lifecycle
- **AJ-10 · Status route ships base64 images by default.** GET/PATCH hardcode `includeImageData: true` (`route.ts:53,103`), unlike the MCP tool (`tools.ts:745`), so every poll re-emits up to four ≤10MB base64 dataUrls that the SDK immediately strips. **Fix:** default to `includeImageData: false`, gate base64 behind an explicit opt-in; keep `imageUrl`/`sha256`/`attachmentId`.
- **AJ-20 · Lifecycle responses aren't self-describing.** Only the create response returns `handoffUrl`/`handoffToken`/`statusTool`/`resultTool`; status/prepare/complete return the bare builder output — yet `rateloop_get_handoff_status` shares the create `outputSchema` that declares those fields. An agent resuming from a status response can't reconstruct the share URL or know which tool fetches the result. **Fix:** re-emit `handoffUrl`/`statusTool`/`resultTool` on status/prepare/complete, or give status a status-specific schema.
- **AJ-21 · Handoff schema declares a field never returned and omits one always returned.** `agentAskHandoffOutputSchema` declares `x402AuthorizationRequest` (only the prepare route returns it) and omits `paymentModeDiagnostics` (the builder always returns it, and `awaitingX402Authorization` lives there). Agents trusting the schema to detect x402 look in the wrong place. **Fix:** move `x402AuthorizationRequest` to the prepare schema; add `paymentModeDiagnostics` (+`createdAt`/`completedAt`/`clientRequestId`/`payloadHash`/`transactionHashes`) to create/status.
- **AJ-22 · Expired-after-prepare completion returns misleading copy.** TTL is a fixed 30 min. A human who executes the on-chain calls but POSTs `/complete` after expiry gets *"Prepare this handoff before completing it."* even though the payment already happened (`complete/route.ts:44-49`). **Fix:** detect `expired` + non-null `operationKey`/in-flight tx hashes and return expiry-specific recovery guidance; consider allowing completion of an expired-but-prepared handoff (submitted handoffs are already exempt).
- **AJ-26 · No "persist the token" guidance.** The create tool returns `handoffToken` exactly once and `rateloop_get_handoff_status` requires `handoffId`+`handoffToken`; no doc/README/skill/`nextAction` tells the agent to save them before sharing the URL. An agent that drops the create response can't poll its own step 4. **Fix:** add an explicit persistence line to `ai.md`/`skill.md`/`README` and restate the token in the create `nextAction`.

### CLI / SDK
- **AJ-07 · No CLI `handoff-status` command.** `handoff` tells the agent to poll, but the CLI's `status`/`result` are keyed on `operationKey`/`clientRequestId` (which a fresh browser handoff lacks); the SDK already exposes `getAskHandoffStatus({handoffId, handoffToken})` (`sdk/src/agent.ts:1004`) with no subcommand. **Fix:** add `handoff-status --handoff-id --handoff-token`, document it, and have `handoff` name that CLI command.
- **AJ-08 · Inconsistent first-run defaulting.** Only `handoff` applies `withDefaultHandoffApiBaseUrl`; `quote`/`sandbox`/`status`/`result` throw an error naming the internal `apiBaseUrl` field, never the env var `RATELOOP_API_BASE_URL`. **Fix:** default all commands (or catch the case and print `export RATELOOP_API_BASE_URL=…`).
- **AJ-24 · Help teaches a non-subcommand.** `usage()`/README show `lint:questions` (a yarn-script alias); the real subcommand is `lint`. A published-package user copying `lint:questions` gets an unknown-command exit. **Fix:** print the real `lint` token; align README.
- **AJ-25 · Undocumented functional flags.** `--payment-mode` (needed for LREP bounties → `wallet_calls`), `--ttl-ms`, `--overwrite`, `--generated-image`, and the `--client-request-id`/`--chain-id`/`--wallet-address`/`--content-id` recovery filters appear in neither README nor `usage()`; the `--payment-mode` error also omits the accepted `eip3009_authorization` alias. **Fix:** document them and make the error enumerate all accepted values.

### Docs parity & correctness
- **AJ-06 · Broken `/docs/ai` anchors (AP-5).** `landingFaq.ts:22,64` (`#templates`, `#feedback-bonuses`), the OAuth resource metadata (`#mcp-adapter-shape`), and `AgentSubmissionPanel` (`#paths`, `#mcp`) all resolve to the top of the page. **Fix:** repoint to existing anchors (`#feedback-bonuses` lives on `/docs/tech-stack`), centralize anchor constants, add a test.
- **AJ-18 · skill/llms document rating but omit the rating tools (AP-9).** `skill.md`/`llms.txt` describe the rating workflow but list none of `rateloop_get_rating_context`/`_prepare_rating_transactions`/`_confirm_rating_transactions`/`_get_rating_status`. **Fix:** add a "Rating tools" group.
- **AJ-19 · Voter-floor tiers stated as USDC-only (AP-8).** Rendered `/docs/ai:392` says "1000 USDC / 10000 USDC", but the floor compares atomic units of the *selected* asset with no conversion, so a 1000-LREP bounty also trips the 5-voter tier. Agents building LREP asks under-set `requiredVoters` and get rejected. **Fix:** use asset-neutral atomic-units wording (as the other mirrors do); generate the standing-rule block from the shared constant.

### Handoff UI
- **AJ-09 · Browser-signing lacks the handoff's terms/payment clarity (AP-10).** `BrowserSigningPage.handleExecute` submits the same bounty-funding wallet calls with no terms gate, no `/legal/terms` link, and no non-refundable notice — unlike the handoff page's `requireAcceptance('submit')`. This is the higher-risk surface (straight to wallet execution). **Fix:** wrap `handleExecute`/`handlePrepare` with `requireAcceptance('submit')` and reuse `buildAgentLegalNotice()`.
- **AJ-14 · Browser WebMCP tools are misnamed.** `rateloop_handoff_get_status`/`_validate_draft`/`_summarize_next_action` (`lib/webmcp/handoffTools.ts:141,153,168`) invert the canonical `verb_noun` used by every remote tool and all docs (`rateloop_get_handoff_status`). Docs even list the canonical name in the browser flow. **Fix:** rename to canonical `verb_noun`, or document the browser names explicitly.
- **AJ-23 · Raw status tokens shown to humans; image-failure is a dead-end (AP-7).** The Status card renders `{handoff.status}` verbatim (e.g. `awaiting_image_signatures`) and the signing page renders `{intent.status}` raw — while the agent gets a friendly `nextAction` via `getHandoffWebMcpNextAction`. A single failed image forces a full restart. **Fix:** share one status-label/next-step helper across both pages; add in-place "Retry image" / "Remove and continue".

### Webhooks
- **AJ-16 · `question.failed` never fires.** It's in `AGENT_CALLBACK_EVENT_TYPES` and the default subscription set, but no path enqueues it. An agent subscribing to be woken on failure waits forever — in the exact case webhooks matter most. **Fix:** wire a producer on the failed/blocked transition, or remove it and mark unsupported.
- **AJ-17 · Webhook channel absent from all machine-readable mirrors (AP-8).** Only one paragraph in the rendered page; `ai.md`/`llms.txt`/`skill.md` have nothing on registration, events, `callbackDeliveries`, or signatures. **Fix:** mirror a compact "Callbacks / webhooks" section (with the AJ-03 verification recipe).

---

## P3 — polish

- **AJ-28 · Transport declared four ways** across `installSnippets` (generic `transport:streamable-http`, Cursor bare `url`, VS Code `type:http` under `servers`) and the Codex plugin `.mcp.json` (`type:http`, no `MCP-Protocol-Version`). **Fix:** document a per-client key matrix; add the header to the plugin config or confirm the host injects it.
- **AJ-30 · Audit/export are silently managed-only.** `results/*` and `asks/*` status serve a public permissionless path, but `asks/export` and the `audit` routes don't. **Fix:** add a scoped public audit/export path, or document the asymmetry.
- **AJ-31 · Dead `AgentIcon` branches** for "Kimi"/"And Others" not in `RATELOOP_AGENT_INSTALL_TARGETS`. **Fix:** remove them or add real install entries.
- **AJ-32 · Divergent nouns for one object** — the signing page alternates "signing handoff" / "signing intent" / "signing link". **Fix:** one human label per surface.
- **AJ-33 · Three different `status` vocabularies** (callback payload round-lifecycle words vs polling enum vs delivery transport state), no mapping. **Fix:** prefer `eventType` as canonical; add a mapping table; clarify `callbackDeliveries[].status` is transport state.
- **AJ-34 · `walletAddress` dropped on authenticated by-client-request** branches while forwarded on the public branch. **Fix:** make the branches symmetric or drop the SDK param on the managed path.
- **AJ-35 · `ai.md` isn't the "clean mirror" `llms.txt` claims (AP-8)** — it drops the npm-install/`npx sandbox` quickstart and the named `pure_agent_fast` preset. **Fix:** add them, or render both surfaces from one source.
- **AJ-36 · Create `nextAction` override discards "poll before sharing"** guidance for in-flight image handoffs, so a handoff with an asset still `uploading` is told to share immediately. **Fix:** only override when the builder value is wrong for the create moment.

---

## Methodology

Nine parallel reviewers, each scoped to one journey stage and cross-cutting concern: docs-parity/links, platform-integration configs, CLI/SDK DX, handoff-create, handoff-lifecycle, handoff-UI, using-results, webhooks/callbacks, and a cross-cutting naming/consistency sweep. Each reviewer was given the prior pass (AP‑1…AP‑10) and instructed to re-validate overlaps against *current* code and prioritize net-new issues. Triage deduped 47 → 36; then one adversarial verifier per finding re-checked it against current source and classified it `CONFIRMED_NEW` / `CONFIRMED_OVERLAP` / `FIXED` / `REFUTED` / `INTENTIONAL`. 34 confirmed; 0 refuted/intentional.

**Limitations.** Source/docs reading, not runtime exercise of every path; the earlier hosted-API live checks in the first-pass doc still apply. Two of 46 agents hit the structured-output retry cap and dropped out, so two triaged candidates (AJ‑02, AJ‑29) are absent from the confirmed set — the coverage above is otherwise complete. Priorities reflect reviewer judgment on integration impact.

**Preserved strengths (unchanged from the first pass):** the default human-wallet path prefers browser handoff over raw wallet-call instructions; the file-backed image path avoids base64 in chat; create responses carry strong agent glue (`nextAction`/`statusTool`/`resultTool`/`expiresAt`); the dry-run result package is safe and self-limiting.
