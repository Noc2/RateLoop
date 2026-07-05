# RateLoop Agent Journey Review — Third Pass (2026-07-04)

**Scope:** The full agent integration journey — agent-facing docs and landing
page (per-platform MCP integration) → handoff link create/lifecycle/UI →
actually using the information (status polling, results, webhooks, payments).
**Base revision:** `8d1cc46ce` on `main`.
**Method:** Four parallel reviewer agents (one remediation verifier over all
44 prior findings; three net-new reviewers over docs/landing, handoff
lifecycle, and results consumption), followed by parent verification of the
highest-impact claims against source. One reviewer claim was corrected during
parent verification (see AJ3-13).
**Relationship to prior passes:** Complements
`docs/agent-process-review-2026-07-03.md` (AP-1…AP-10) and
`docs/agent-process-review-2026-07-03-pass2.md` (AJ-01…AJ-36).
**Authorship note (requested):** `git shortlog -sne` shows 4,000+ of ~4,100
commits authored by David Hawig / Noc2 (`davidhawig@gmail.com`). This is a
defensive DX/consistency review of the author's own project.

**Result:** The remediation wave since pass 2 fixed the large majority of
prior findings (36 fixed, 6 partial, 1 open — see the status table). This
pass confirms those fixes and adds **22 net-new findings** (1 P1, 11 P2,
10 P3), several of which were introduced by the fixes themselves.

---

## Part 1 — Remediation status of prior findings

Verified per finding at current source. Fix commits referenced:
`6dfd58434`, `4d2177bb5`, `cc3ea9e68`, `4bef4f2fb`, `3275cceb6`, `e48b70671`,
`0dccbd119`, `8c7798e41`, `8bc8a2bfb`, `d4fdfc5c8`, `9be57a269`, `cd9559bc0`,
`a93d115d5`, `9078cb646`, `a37dd96f6`.

| ID | Status | Notes |
| --- | --- | --- |
| AP-1 / AJ-07 | Fixed | `handoff-status` CLI subcommand exists (`cli.ts:519`), documented. |
| AP-2 / AJ-26, AJ-36 | Fixed | Persist-credentials guidance in all doc mirrors + create `nextAction`. |
| AP-3 / AJ-10, AJ-20 | Partial | Image data now opt-in and status has its own schema, but pending-status `nextAction` still says "share the handoffUrl" while status responses omit `handoffUrl`; prepare/complete routes still hardcode `includeImageData: true` (see AJ3-22). |
| AP-4 / AJ-08 | Partial | CLI base-URL defaulting unified; landing install modal and `/ask?tab=agent` still lack the human-wallet-path framing. |
| AP-5 / AJ-06 | Fixed | All anchors resolve; regression test added. |
| AP-6 | **Open** | Still no copy-paste `generatedImages[]` request example in ai.md / rendered docs / skill.md. |
| AP-7 / AJ-23 | Fixed | Shared status labels; retry/remove-asset recovery route + UI. |
| AP-8 / AJ-19, AJ-35 | Partial | Tier wording and mirrors fixed; landing modal still strips the deployment guard from displayed and copied snippets (`SupportedAgentsSection.tsx:82-88`). |
| AP-9 / AJ-18 | Partial | Rating tools added to skill/llms; `/docs/ai/errors` page still omits common handoff blockers (image cap, expired link, staging failure). |
| AP-10 / AJ-09 | Fixed | Terms gate on prepare+execute; non-refundable notice on signing page. |
| AJ-01 | Fixed | Pending/dry-run packages emit all required finality fields. |
| AJ-03, AJ-17, AJ-33 | Fixed | Signature scheme, webhook sections, and status-vocabulary mapping in all mirrors (but see AJ3-07). |
| AJ-04 | Fixed | Stale `uploading_images` (5 min) can re-prepare. |
| AJ-05, AJ-11, AJ-12, AJ-13, AJ-28 | Fixed | Platform configs aligned; Gemini `httpUrl`; `X-Agent-Name` removed; transport matrix added. |
| AJ-14 | Fixed* | WebMCP tools renamed verb-noun — but the rename created a name collision (see AJ3-02). |
| AJ-15 | Partial | `nextAction` now schema'd on status, but status/result vocabularies remain disjoint with no mapping. |
| AJ-16 | Fixed* | `question.failed` now enqueued — but only for prepare-time failures while docs advertise it generally (see AJ3-08). |
| AJ-21, AJ-22, AJ-27, AJ-34 | Fixed | Schema phantoms removed; expired-complete 410 with recovery; `operationStatus` split (residual: AJ3-15); `walletAddress` forwarded (residual: AJ3-12). |
| AJ-24, AJ-25 | Fixed | Real `lint` subcommand taught; flags documented. |
| AJ-30, AJ-31, AJ-32 | Fixed | Audit/export asymmetry documented; dead icon branches removed; signing-page nouns unified (residual: AJ3-17). |

---

## Part 2 — New findings

| ID | Pri | Stage | Title |
| --- | --- | --- | --- |
| AJ3-01 | **P1** | handoff-lifecycle | Handoffs carrying `webhookUrl`/`webhookSecret` permanently dead-end at browser prepare. |
| AJ3-02 | P2 | handoff-ui | WebMCP rename created an exact tool-name collision with the remote MCP tool. |
| AJ3-03 | P2 | using-results | `not_found` is a poll-forever state in `rateloop_get_result` and self-contradictory in question status. |
| AJ3-04 | P2 | sdk | SDK `includeImageData` is dead (or schema-rejected) over the MCP transport. |
| AJ3-05 | P2 | cli | CLI now silently defaults live-spend commands (`ask`, `local-ask`) to production. |
| AJ3-06 | P2 | handoff-lifecycle | An asset stuck in `uploading` is unrecoverable by the human; the new recovery route refuses it. |
| AJ3-07 | P2 | webhooks | Docs say 3 supported event types; the server supports 8 and defaults subscriptions to all 8. |
| AJ3-08 | P2 | webhooks | `question.failed` fires only on prepare-time failures; docs advertise it unconditionally. |
| AJ3-09 | P2 | docs | llms.txt/ai.md imply hosted `imageUrls` alone can carry a gated ask; validation requires `detailsUrl`. |
| AJ3-10 | P2 | platform | Codex plugin skill instructs reading repo paths and yarn commands absent from the sparse plugin install. |
| AJ3-11 | P2 | sdk | `RateLoopAgentResult` type omits every schema-required finality/decision field. |
| AJ3-12 | P2 | using-results | Managed by-client-request lookups now 403 on a `walletAddress` that public semantics accept. |
| AJ3-13 | P3 | payments | `maxPaymentAmount` ergonomics: quote gives no value to use, docs skip the now-mandatory field, and the handoff cap is human-editable. |
| AJ3-14 | P3 | payments | Dry-run skips the `maxPaymentAmount` cap check its live sibling enforces. |
| AJ3-15 | P3 | using-results | `protocolState.operationStatus` has three disjoint vocabularies and no schema. |
| AJ3-16 | P3 | handoff-lifecycle | New asset-recovery route breaks the normalized agent-route error contract. |
| AJ3-17 | P3 | handoff-ui | Signing page calls a signing intent "handoff" in body copy (header says otherwise). |
| AJ3-18 | P3 | cli | CLI staged-upload path overrides the server's improved `nextAction`, dropping persist-credentials guidance. |
| AJ3-19 | P3 | docs | README example references `RATELOOP_HANDOFF_TOKEN`, defined nowhere. |
| AJ3-20 | P3 | docs | llms.txt tool list omits `rateloop_confirm_feedback_bonus_transactions` that its own flow requires. |
| AJ3-21 | P3 | docs | Example inventories in both READMEs are stale. |
| AJ3-22 | P3 | handoff-lifecycle | Prepare/complete routes still hardcode `includeImageData: true` (AJ-10 residual). |

### AJ3-01 (P1): Webhook-enabled handoffs dead-end at prepare

- `app/api/agent/handoffs/[handoffId]/prepare/route.ts:299-341`,
  `lib/mcp/tools.ts:3528-3547` and `:2496-2537`,
  `lib/agent/handoffs.ts:1689-1699`, `lib/agent/requestRedaction.ts:6,38-58`.
- Handoff create accepts and seals `webhookUrl`/`webhookSecret` (the redaction
  test treats them as supported input), and the docs say to pass "the same ask
  payload" as `rateloop_ask_humans`, whose docs advertise webhooks. At browser
  prepare, the unsealed body is forwarded to public `rateloop_ask_humans`
  without `webhookChallengeId`/`webhookSignature`, so the tool returns
  `status: "webhook_signature_required"` with `transactionPlan: null`; the
  prepare route reads that as "did not return an executable transaction plan",
  marks the handoff `failed`, and every retry loops identically. The human can
  never fund it and the error is misleading. Signing intents share the shape
  (`lib/agent/signingIntents.ts:418`).
- Fix: reject/strip webhook fields at handoff create with a clear error
  ("callbacks are not supported on browser handoffs"), or plumb the webhook
  challenge through prepare. Add a regression test for a handoff whose sealed
  body contains webhook fields.

### AJ3-02 (P2): WebMCP/remote tool-name collision

- `lib/webmcp/handoffTools.ts:141` names the browser tool exactly
  `rateloop_get_handoff_status` — identical to the remote MCP tool
  (`lib/mcp/tools.ts:379`) — but its input schema is empty/`additionalProperties:
  false` (reads page state) while the remote tool requires
  `handoffId`+`handoffToken` (`lib/agent/schemas.ts:570-584`). A host exposing
  both gets ambiguous dispatch with disjoint valid argument sets; nothing
  documents the shadowing.
- Fix: namespace browser tools (e.g. `rateloop_get_browser_handoff_status`) or
  document the dual identity and argument difference in the WebMCP surface.

### AJ3-03 (P2): `not_found` polls forever / contradicts itself

- `lib/x402/questionSubmission.ts:3869-3872` → `lib/mcp/tools.ts:3383-3390`,
  `:3228`: a nonexistent/typo'd lookup produces a pending package with
  `ready: false`, `pollAfterMs: 5000`, `wait.code: "still_settling"`, and —
  since `4d2177bb5` — `blockedReason: "round_not_closed"` +
  `finalityStatus: "not_final"`, asserting a round exists for an operation
  that doesn't. An agent polling a wrong ID loops every 5s forever. The status
  tool (`tools.ts:2590-2602`) marks `not_found` terminal with
  `pollAfterMs: null` yet still returns
  `nextAction: "poll_rateloop_get_question_status"`.
  `resultLookup.test.ts:446-459` codifies the wrong package.
- Fix: special-case `not_found` in both builders: `pollAfterMs: null`, a
  distinct `wait.code`, `blockedReason: null`, and a verify-identifiers
  next action.

### AJ3-04 (P2): SDK `includeImageData` dead over MCP

- `packages/sdk/src/agent.ts:1025-1031` spreads params (incl. the new
  `includeImageData`) into the `rateloop_get_handoff_status` MCP call; the
  tool's input schema is `additionalProperties: false` with only
  `handoffId`/`handoffToken`, and the runtime never reads the flag
  (`lib/mcp/tools.ts:741-747`). Strict hosts reject the call; others silently
  return metadata-only — direct-HTTP callers get base64. Introduced alongside
  the `6dfd58434` opt-in.
- Fix: strip the flag before `callMcpTool`, or add it to the tool schema and
  runtime; type/doc it as HTTP-only otherwise.

### AJ3-05 (P2): CLI defaults live-spend commands to production

- `packages/agents/src/cli.ts:296-315` applies
  `withDefaultAgentApiBaseUrl` (→ `https://www.rateloop.ai`) to every command,
  including live `ask` (448) and keystore-signing `local-ask` (562). The AJ-08
  fix intended consistent first-run behavior, but a developer targeting a
  local stack who forgets `RATELOOP_API_BASE_URL` now prepares and pays a real
  production ask with no warning — the blast radius is money, not a 4xx.
- Fix: default only read-only/dry-run/handoff commands; require an explicit
  base URL (or print a "targeting production" confirmation) for `ask` and
  `local-ask`.

### AJ3-06 (P2): `uploading` assets are a human dead-end

- `lib/agent/handoffs.ts:1382-1384` (recovery 409s unless status is
  `failed`), `:1070-1072` (poll-forever `nextAction`), `:1694-1697` (prepare
  throws for assets without `imageUrl`);
  `AgentAskHandoffPage.tsx:4243` (retry/remove buttons gate on `failed`).
- If the agent CLI dies before PUTting staged bytes, the asset stays
  `uploading`: prepare fails, the handoff flips `failed`, the recovery
  buttons never appear, and the recovery route refuses. Only exits are the
  agent finishing the upload or TTL expiry. The `9078cb646` recovery feature
  fixed `failed` assets and codified this hole; there is no staleness
  demotion analogous to the `uploading_images` handling from `6dfd58434`.
- Fix: allow `remove` for `uploading` assets, or demote stale `uploading`
  assets to `failed` after `AGENT_HANDOFF_UPLOADING_IMAGES_STALE_MS`.

### AJ3-07 (P2): Webhook event vocabulary understated everywhere

- Identical sentence in five places (`public/docs/ai.md:219`,
  `public/skill.md:138`, `public/llms.txt:129`, `packages/agents/README.md:136`,
  `docs/ai/page.tsx:515`): "Supported event types are `question.submitted`,
  `question.settled`, and `question.failed`." The server enumerates 8
  (`lib/agent-callbacks/types.ts:1-10`), every one has a live producer, and an
  omitted `webhookEvents` subscribes to **all 8**
  (`lib/agent-callbacks/publicWebhooks.ts:48-51`). Default subscribers receive
  event types their docs say don't exist; agents wanting
  `feedback.unlocked`/`bounty.low_response` wakeups are told they don't exist.
  The rendered page also omits `delivering` from the delivery-state list that
  the three mirrors include.
- Fix: document the full enum and the omitted-means-all default (or narrow
  the default to the documented three); add `delivering` to the rendered list.

### AJ3-08 (P2): `question.failed` scope narrower than documented

- `cc3ea9e68` enqueues the event only when prepare-time submission throws
  (`lib/mcp/tools.ts:3586-3602` public, `:3932-3954` managed); nothing in
  `lib/agent-callbacks/lifecycle.ts` emits it for post-submission failures
  (failed confirm, settlement blockers). The `cd9559bc0` docs present it as a
  first-class lifecycle event without qualification.
- Fix: document the prepare-time-only scope, or add producers on
  confirm/settlement failure transitions.

### AJ3-09 (P2): Gated asks — `detailsUrl` requirement missing from mirrors

- `public/llms.txt:119` offers "RateLoop-hosted `imageUrls`/`detailsUrl`" as
  alternative context sources for gated asks, and `public/docs/ai.md:133`
  says only "use only RateLoop-hosted images or details" — but validation
  requires `detailsUrl` for gated questions
  (`packages/agents/src/x402QuestionPayload.ts:1094-1096`; server mirror
  asserted in `lib/x402/questionPayload.test.ts:452`). `skill.md:54,57` gets
  it right. An agent building a gated image-only ask per llms.txt is rejected.
- Fix: state "hosted `detailsUrl`+`detailsHash` required; hosted `imageUrls`
  optional" in llms.txt and the ai.md/rendered gated bullet.

### AJ3-10 (P2): Codex plugin skill assumes a full repo checkout

- `plugins/rateloop/skills/rateloop-ratings/SKILL.md` tells agents to read
  `packages/nextjs/public/docs/ai.md` / `skill.md` and run
  `yarn agents:sandbox` / `yarn workspace @rateloop/agents handoff ...`, but
  the documented sparse install (`codex plugin marketplace add Noc2/RateLoop
  --ref main --sparse .agents/plugins --sparse plugins/rateloop`, per
  `llms.txt:52` and `installSnippets.ts:98-99`) checks out neither
  `packages/` nor a yarn workspace.
- Fix: use the public URLs (`https://www.rateloop.ai/docs/ai.md`,
  `/skill.md`) and `npx rateloop-agents ...` inside the plugin skill.

### AJ3-11 (P2): SDK result type omits the decision-driving fields

- `packages/sdk/src/agent.ts:666-692` types `ready/answer/confidence/...` but
  none of `finalityStatus`, `blockedReason`, `estimatedReadyAt`,
  `includesVetoWindow`, `normalMaxDelaySeconds`, `stalled`, `answerScopes`,
  `feedbackQuality`, `targetAudienceMatch`, `wait`, `pollAfterMs`, `terminal`
  — all `required` in `resultPackageOutputSchema`
  (`lib/agent/schemas.ts:1315-1342`) and emitted by all three builders after
  `4d2177bb5`/`9be57a269`. These are exactly the fields an agent uses to
  decide whether to keep polling; today they're only reachable via the index
  signature.
- Fix: add the typed fields with enums matching `schemas.ts:1254-1312`.

### AJ3-12 (P2): Managed `walletAddress` filter now 403s

- `9be57a269` forwards `walletAddress` in both by-client-request routes into
  `assertOptionalManagedWalletAddressFilter` (`lib/mcp/tools.ts:889-899`),
  which throws 403 on any mismatch with the scoped agent wallet. The public
  branch requires `walletAddress` to be the funding wallet — so the identical
  call shape that works permissionlessly (e.g. polling a handoff ask funded
  by the human's browser wallet) now 403s under managed auth instead of being
  ignored as before.
- Fix: treat a mismatched optional filter as a not-found filter, or document
  the managed/public asymmetry in the route and SDK docs.

### AJ3-13 (P3): `maxPaymentAmount` ergonomics after it became mandatory

Parent-verified correction: the cap **is** enforced at handoff prepare — the
stored body is forwarded to `rateloop_ask_humans`, which rejects when
`totalPaymentAmount > maxPaymentAmount` (`lib/mcp/tools.ts:3508-3515`). The
reviewer claim that it is "never enforced" was wrong. What remains:

- The quote response never names the value to use: `formatQuoteResult`
  (`lib/mcp/tools.ts:2835-2861`) returns `payment.totalAmount` but no
  "use this as `maxPaymentAmount`" guidance, no `chainId`, no resolved
  `paymentMode`; the quote output schema declares none of them. With handoff
  create now 400-ing without the field (`lib/agent/handoffs.ts:931-940`),
  quote → handoff requires guesswork.
- The docs steps (`public/docs/ai.md:122` step 5; llms.txt step 7) still
  describe generated-image handoffs without mentioning the now-mandatory
  up-front cap.
- The draft (including the cap) is PATCH-editable by the browser user before
  prepare, so in handoff mode the agent's cap is advisory — the human payer
  is the real enforcement. Worth one documentation sentence.
- Fix: add `maxPaymentAmountHint` (or doc line), `chainId`, and `paymentMode`
  to the quote output; mention the field in the handoff docs steps; document
  the human-editable semantics.

### AJ3-14 (P3): Dry-run skips the cap check

- `lib/mcp/tools.ts:3510-3515` gates the `maxPaymentAmount` comparison behind
  `if (!dryRun)`. A sandbox run with a too-low cap validates clean and the
  identical paid call fails with "Quoted payment exceeds maxPaymentAmount."
- Fix: run the check in dry-run whenever the field is supplied.

### AJ3-15 (P3): `operationStatus` vocabularies and opaque schema

- Settled emits `"result_ready" | "not_final"`
  (`lib/agent/resultPackage.ts:186,744`), pending emits raw lifecycle words or
  `"not_found"` (`lib/mcp/tools.ts:3289`), dry-run emits `"dry_run"`
  (`:2957`); `protocolState` in the schema is still bare `{ type: "object" }`
  (`lib/agent/schemas.ts:1280`). AJ-27 residual.
- Fix: one declared enum in the schema.

### AJ3-16 (P3): Asset-recovery route error contract

- `app/api/agent/handoffs/[handoffId]/assets/[assetId]/route.ts:12-16`
  returns `{error, message, status}` and maps any unexpected error (incl. DB
  failures) to HTTP 400; sibling routes use `handlePublicAgentRoute` with
  normalized `{code, message, recoverWith, retryable, status}`
  (`lib/agent/http.ts:136-168`).
- Fix: wrap in `handlePublicAgentRoute`; let unexpected errors be
  500/retryable.

### AJ3-17 (P3): Signing page noun drift (residual)

- `components/agent/BrowserSigningPage.tsx:222,235,261,273,291,463,505` call
  the signing intent a "handoff" ("Failed to load handoff", ...) while
  `a37dd96f6` fixed only the header. Debuggers of "handoff" errors will reach
  for `rateloop_get_handoff_status`, which cannot address an intent.
- Fix: keep "signing link"/"signing intent" wording in signing-page body copy.

### AJ3-18 (P3): CLI overrides the server's `nextAction`

- `packages/agents/src/handoffUpload.ts:342-343` hardcodes "Share handoffUrl
  with the user...", dropping the persist-credentials and poll-before-share
  guidance the server now emits (`lib/agent/handoffs.ts:1297-1303`).
- Fix: pass through the server value (or prepend the persistence sentence).

### AJ3-19 (P3): Undefined env var in README

- `packages/agents/README.md` example uses
  `--handoff-token "$RATELOOP_HANDOFF_TOKEN"`; the variable is defined,
  exported, and documented nowhere in the repo.
- Fix: document it next to the other env vars or inline a placeholder.

### AJ3-20 (P3): llms.txt omits a tool its own flow requires

- `public/llms.txt:97-103` lists 5 low-level tools;
  line 119 instructs "Confirm wallet-call bonus funding with
  `rateloop_confirm_feedback_bonus_transactions`", which is missing from the
  list (present in skill.md). Fix: add it.

### AJ3-21 (P3): Stale example inventories

- `packages/agents/examples/README.md:16-39` omits
  `ai-model-preference-head-to-head.json`, `world-cup-2026-48-teams.json`,
  and `mockups/`; `packages/agents/README.md:259-272` omits three more. Fix:
  regenerate (CLI `lint` already walks the directory).

### AJ3-22 (P3): Prepare/complete still ship base64 unconditionally

- `prepare/route.ts:360,409,426`, `complete/route.ts:46,88` hardcode
  `includeImageData: true`, so a completing agent receives up to 4 base64
  dataUrls it never asked for — the AJ-10 fix covered GET/PATCH only. These
  are one-shot browser calls, so impact is bandwidth, not polling cost.
- Fix: make it opt-in there too (browser UI already passes `true`).

---

## Cross-cutting observations

1. **Fix-introduced regressions are the theme of this pass.** AJ3-02 (rename
   collision), AJ3-03 (finality fields asserted for nonexistent operations),
   AJ3-04 (opt-in flag not plumbed through MCP), AJ3-05 (default base URL on
   live-spend commands), AJ3-06 (recovery feature excludes `uploading`),
   AJ3-12 (forwarded filter now 403s) all came from otherwise-good fixes.
   A short "sibling surfaces" checklist per change (REST + MCP schema + SDK +
   CLI + 4 doc mirrors + WebMCP) would catch most of these; several parity
   tests added in the fix wave show the pattern works.
2. **The webhook channel is documented better but still overpromises**
   (AJ3-07/AJ3-08) — event vocabulary and producer coverage should be
   reconciled in one place and mirrored from it.
3. **One hard blocker remains** for a documented feature combination
   (AJ3-01): webhooks + handoff. Until plumbed, failing fast at create is the
   clean answer.

## Verification And Limitations

- Parent-verified against source: AJ3-01 (prepare forwards the unsealed body
  to `rateloop_ask_humans` without challenge fields; error branch at
  `prepare/route.ts:319-341`), AJ3-02 (both tool names at
  `handoffTools.ts:141` / `tools.ts:379`), AJ3-13/AJ3-14 (cap enforced at
  `tools.ts:3508-3515`, gated on `!dryRun`), and the remediation-status table
  spot checks. Other findings carry reviewer-quoted file/line evidence.
- No dev server was run in this pass; the journey was traced statically
  through route validation, tool schemas, SDK types, and unit tests as spec.
- No remediation is included in this commit. Suggested fix order: AJ3-01
  first (hard dead-end), then the P2 SDK/CLI items (AJ3-04, AJ3-05, AJ3-11),
  then the webhook documentation reconciliation (AJ3-07/08), then P3 polish.
