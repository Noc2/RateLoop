# RateLoop repo-wide security audit — 2026-05-21

Adversarial review of the **non-smart-contract** surface on branch `claude-audit-5` (HEAD `f0c01fa1`). The smart-contract audit lives at `packages/foundry/audit-report-claude-2026-05-21.md`; this report covers everything else: Next.js API + frontend, Drizzle/Postgres data layer, the keeper service + signing primitives, the agent / SDK / Ponder packages, and CI/CD + supply chain.

**Method.** Six parallel scope-focused agents dispatched against the repo (Next.js API routes; DB/ORM; keeper + secrets; CI/CD + supply chain; frontend client + wallet; plus an independent web-research agent for 2025–2026 attack-pattern disclosures). Every candidate finding from the agents was manually re-read against source by the primary auditor — four were rejected as false positives and are recorded below so future passes don't re-flag the same paths.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 5 |
| Low | 4 |
| Informational (incl. positive verifications) | 7 |
| Verified false-positives recorded | 4 |

**Recommended top-3 fixes:**
1. **WS-1** — move signing-intent `token` out of the URL query string (HTTP-only cookie or POST body). Eliminates leakage via browser history, server logs, Referer, and analytics.
2. **WS-2** — decode and display calldata (function selector + decoded args) in the agent-signing UI; do not let the server-supplied `description` alone be what the user reads before signing.
3. **KEEPER-1** — keeper's RPC-failure fallback (`keeper.ts:409-417`) must use the last-known-good block timestamp, not the system clock; system-clock-trust enables NTP-spoof-induced reveal failures.

---

## Findings

### WS-1 — Signing-intent `token` is placed in the URL query string (browser-history / Referer / log leakage)

**Severity:** High

**Files / lines:**
- `packages/nextjs/components/agent/BrowserSigningPage.tsx:72-74` — `readToken(searchParams)` reads `?token=…`.
- `packages/nextjs/components/agent/BrowserSigningPage.tsx:190` — `fetch(\`/api/agent/signing-intents/${intentId}?token=${encodeURIComponent(token)}\`)`.
- `packages/nextjs/app/api/agent/signing-intents/[intentId]/route.ts` — accepts token via query.
- `packages/nextjs/lib/agent/signingIntents.ts:156-176` (`loadIntentByToken`) — confirms the token IS the bearer credential (lookup is by `id = ? AND token_hash = ?`).

**Attack scenario.** A signing link of the form `https://app/agent/sign/<intentId>?token=<secret>` leaks the token through every channel that captures URLs:
- Browser history (any device the link was opened on).
- Browser cache / extensions / autofill database.
- The Referer header on any cross-origin asset or outbound `<a target=_blank>` from the signing page (the current `Referrer-Policy: strict-origin-when-cross-origin` at `next.config.ts:133` sends the full URL when navigating same-scheme cross-origin).
- Server access logs / CDN logs / analytics buckets.
- Any third-party script allowed by CSP (e.g., `https://scripts.simpleanalyticscdn.com`, `https://vercel.live` on Vercel deploys) that observes `document.location.href` or auto-tracks SPA navigations.

A leaked `token` is sufficient to call `getAgentSigningIntent`, `prepareAgentSigningIntent`, and `completeAgentSigningIntent` against the victim's intent. The completion path submits `transactionHashes` and trusts whatever payment-authorization typed-data flowed into `prepareAgentSigningIntent`.

**Impact.** Theft of the agent-signing session: an attacker with the token can prepare an arbitrary x402 transaction plan in the victim's name; the user is then asked to sign typed-data that the user-facing UI shows only as a `description`, not the underlying calldata (see WS-2).

**Fix.**
- Move the token out of the URL. Two options:
  - (a) On first page load with `?token=…`, set a short-lived `HttpOnly; Secure; SameSite=Strict` cookie scoped to `/api/agent/signing-intents/<intentId>` and then call `history.replaceState` to strip the query string before the page renders any asset.
  - (b) Convert `getAgentSigningIntent` and all sibling endpoints to POST and pass the token in the JSON body (the React route already POSTs to `complete/`; the prepare/load paths can match).
- Set `Referrer-Policy: no-referrer` on the signing route specifically — even after fixing the query-string, the principle of "this page should never originate a Referer" applies.

**CWE.** CWE-598 (sensitive data in GET request) + CWE-200.

**Dedup.** Not flagged by any prior audit report (`packages/foundry/audit-report-*.md`); first repo-wide review.

---

### WS-2 — Agent signing UI displays server-supplied `description` only; the calldata is never decoded for the user

**Severity:** Medium

**Files / lines:** `packages/nextjs/components/agent/BrowserSigningPage.tsx:438-457` (in particular `:446` renders `call.description ?? call.phase ?? "Wallet call"` and `:451` renders `call.to`, but `call.data` is never decoded or displayed).

**Attack scenario.** The transaction plan rendered before the user clicks "Submit" displays a human-readable description (e.g., "Approve USDC for the question") and the target address — but not the function selector or decoded calldata. If `description` and `data` disagree (server bug, server compromise, or a poisoned MCP tool descriptor — see CVE-2025-54136 in the cross-cutting survey below), the user will sign one thing while believing another. The user's wallet does re-show the raw calldata before broadcast, but most users won't decode 4-byte selectors visually.

**Impact.** Transaction-substitution / blind-signing class. Worst case is approving an attacker-set spender, transferring rather than approving, calling a different contract than the one shown in the description, or sending native value where the description says zero.

**Fix.**
- Decode `call.data` client-side using `viem.decodeFunctionData` against a known ABI; render: function name, decoded args, and the raw hex below.
- Refuse to render the "Submit" button when decoding fails or when `to` is not on the allowlist of contracts derived from `scaffold.config.ts` deployments + the canonical thirdweb/USDC addresses for the chain.
- Cross-check: assert that the description string is consistent with the decoded function selector for the small set of supported function selectors (approve, mint, transfer, settle, claim, etc.).

**CWE.** CWE-451 (UI misrepresentation of critical info) / blind-signing pattern.

**Dedup.** New.

---

### KEEPER-1 — Keeper RPC-failure fallback trusts the local system clock; NTP spoofing → wrong reveal eligibility

**Severity:** Medium

**Files / lines:** `packages/keeper/src/keeper.ts:409-417` (in `resolveRounds()`):
```
try { const block = await publicClient.getBlock({ blockTag: "latest" }); now = block.timestamp; }
catch { console.warn("[Keeper] RPC block fetch failed, using local clock fallback");
        now = BigInt(Math.floor(Date.now() / 1000)) - 30n; }
```

**Attack scenario.** While the keeper's RPC is unavailable, the keeper falls back to its system clock minus 30s. An attacker who can shift the keeper host's clock (NTP-spoofing on the keeper's network, or compromised time source on a self-hosted box) can:
- Force the keeper to compute `now > revealableAfter` while the chain itself has not yet reached the reveal window → keeper submits a reveal that reverts on-chain (gas wasted, stake forfeited if logic depends on revealableAfter).
- Skew the keeper's per-round scheduling so that it stalls (clock-back) or fires early (clock-forward).

Exploitation requires both an RPC outage AND a clock-control primitive, but the cascade is non-obvious and reduces the keeper to less than what its on-chain peers see.

**Impact.** Wasted gas on revert; stuck pending state; in pathological cases, missed-reveal forfeit on rounds the keeper is responsible for.

**Fix.** Cache the most recent successful `block.timestamp` and use that (plus a bounded extrapolation by wall-clock delta, capped at e.g. 30s) instead of `Date.now()` from scratch. If the cache is empty (first call), surface the RPC error and refuse to operate until RPC recovers.

**CWE.** CWE-754 (improper check for unusual or exceptional conditions).

**Dedup.** New.

---

### KEEPER-2 — Keeper metrics endpoint can expose wallet balance + operational counters if `METRICS_BIND_ADDRESS` is set to `0.0.0.0`

**Severity:** Medium

**Files / lines:** `packages/keeper/src/metrics.ts:165-169` (`startMetricsServer(port, bindAddress)`); `packages/keeper/src/config.ts:454` (`metricsBindAddress: readEnv("METRICS_BIND_ADDRESS") || "127.0.0.1"`); `packages/keeper/src/metrics.ts:28, 141` (`keeper_wallet_balance_wei` is part of the gauge set served by `/metrics`).

**Attack scenario.** A misconfigured deployment that sets `METRICS_BIND_ADDRESS=0.0.0.0` (a common pattern for "make Prometheus see this from a sibling container") binds the metrics server to all interfaces with **no authentication**. Anyone on the network can scrape `/metrics` and observe:
- `keeper_wallet_balance_wei` — current hot-wallet balance.
- Counters like `keeper_votes_revealed_total` and `keeper_errors_total` (reveal cadence + failure signal).

These together let an external observer:
- Time front-runs against the keeper's known activity windows.
- Detect when the keeper is degraded (high errors, low balance) and schedule griefing or competing reveals.

**Impact.** Operational-intelligence leak. The current default (`127.0.0.1`) is safe; this is a misconfiguration-amplification finding.

**Fix.**
- Refuse to start the metrics server on a non-loopback bind address unless an explicit env-gated `METRICS_AUTH_TOKEN` is also set and bearer-checked on `/metrics`.
- Or: split sensitive gauges (wallet balance) into a separate authenticated endpoint and keep `/metrics` to coarse uptime/error counts.
- Document the requirement in `packages/keeper/.env.example`.

**CWE.** CWE-200 (information exposure) + CWE-1188 (insecure default initialization of resource — when overridden).

**Dedup.** New.

---

### WS-3 — CSP `script-src 'unsafe-inline'` is included in production (defense-in-depth gap)

**Severity:** Medium

**Files / lines:** `packages/nextjs/next.config.ts:71-76`:
```
"script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'",
"https://scripts.simpleanalyticscdn.com",
...(isDev ? ["'unsafe-eval'"] : []),
...vercelLiveScriptSources,
```

**Observation.** `'unsafe-inline'` defeats the inline-script defense that CSP otherwise provides. The accompanying comment at `:70` documents this as deliberate ("Next's production app shell" requires inline bootstrap scripts) — and Next.js 15.5+ does support nonce-based CSP via the `experimental.cspNonce` / response-header approach, so this is solvable without breaking hydration.

**Impact.** No standalone exploit. If a stored-XSS / reflected-XSS / DOM-XSS vulnerability is ever introduced into a user-content surface (profile bios, question titles, content URLs), `'unsafe-inline'` will let injected `<img onerror=…>` or `<script>` execute. Removing it shifts XSS from "definitely executes" to "blocked by browser even if present."

**Fix.** Migrate to a nonce-based CSP:
- Generate a per-request nonce in middleware (`middleware.ts` — see WS-4 cross-cut on absence of middleware today).
- Echo the nonce on every `<script>` Next.js emits via `_document` / app shell.
- Drop `'unsafe-inline'`, retain only `'wasm-unsafe-eval'` if the WASM is required.

**CWE.** CWE-693 (protection-mechanism failure) — defense-in-depth, not a current vulnerability.

**Dedup.** New.

---

### WS-4 — Unvalidated `requestBody` is spread into the MCP tool call after intent preparation

**Severity:** Medium

**Files / lines:**
- `packages/nextjs/lib/agent/signingIntents.ts:201` — `parseX402QuestionRequest(requestBody)` extracts known fields but does NOT reject unknown ones.
- `packages/nextjs/lib/agent/signingIntents.ts:242` — entire `JSON.stringify(requestBody)` is persisted to `agent_signing_intents.request_body`.
- `packages/nextjs/lib/agent/signingIntents.ts:299-307` — `prepareAgentSigningIntent` calls:
```
callPublicRateLoopMcpTool({
  arguments: { ...intent.requestBody,
               paymentAuthorization, paymentMode, walletAddress },
  name: "curyo_ask_humans",
})
```

**Attack scenario.** The original POST to `/api/agent/signing-intents` accepts a `requestBody` whose unknown fields persist unchanged and later get spread into the MCP tool's argument object. If the MCP tool implementation reads any unexpected field (today or after a future tool refactor) that overrides a security-relevant default, the original POSTer can smuggle that field through the intent lifecycle. The MCP server is internal and presumably re-validates — but no contract enforces that; this is the "outer guard depends on inner guard" pattern.

**Impact.** No exploit today (verified by reading `parseX402QuestionRequest`; the MCP tool's authoritative validator was not in scope of this pass). The risk is that any future MCP-tool field added without strict allowlisting in `parseX402QuestionRequest` becomes attacker-controllable through this latent channel.

**Fix.** Make `parseX402QuestionRequest` either:
- (a) Reject any unknown top-level field (strict schema); OR
- (b) Return a sanitized payload that omits unknown fields, and use the sanitized payload instead of the raw `requestBody` when storing and spreading.

Either fix breaks the "unknown fields persist invisibly" property and removes the latent channel.

**CWE.** CWE-915 (mass-assignment) — defense-in-depth.

**Dedup.** New.

---

### WS-5 — CSP allows `https://vercel.live` and `wss://*.pusher.com` on every Vercel deployment (including production)

**Severity:** Low

**Files / lines:** `packages/nextjs/next.config.ts:22` (`isVercelDeployment = VERCEL === "1" || Boolean(VERCEL_ENV)`); `:61-67` (Vercel Live origins included whenever `isVercelDeployment` is true — which is true on production deploys, not only previews).

**Observation.** Vercel Live is a preview-deployment-only feature in practice; production deploys don't load it. But the CSP allows it regardless, widening the trusted-script surface for production users.

**Fix.** Narrow the gate: `const isVercelLiveEnabled = process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "development"`. Apply only `isVercelLiveEnabled` to the `vercelLive*Sources` arrays.

**CWE.** CWE-693 (overly permissive trust).

**Dedup.** New.

---

### WS-6 — Rate-limit fail-open via `allowOnStoreUnavailable: true` on challenge issuance

**Severity:** Low

**Files / lines:** `packages/nextjs/app/api/feedback/challenge/route.ts:34-38` — `await checkRateLimit(request, RATE_LIMIT, { allowOnStoreUnavailable: true, ... })`. Same pattern is reachable in other challenge / session endpoints.

**Observation.** When the rate-limit store (DB) is unavailable, the gate allows the request through. For challenge issuance the downstream operation is `issueSignedActionChallenge` — cheap CPU + a DB insert (which is ALSO going to fail if the store is down). The effective damage is bounded: an attacker can spam challenge requests during an outage but cannot proceed to the actual gated action (feedback submission) which requires a signed challenge. The fail-open posture is therefore "fail-open on a step that can't proceed alone."

**Fix.** Either accept the fail-open posture (with a comment explaining the downstream gating) or change to fail-closed (return 503) so the symptom is loud rather than silent.

**CWE.** CWE-696 (incorrect behavior order — minor).

**Dedup.** New, but a documented design choice.

---

### WS-7 — Bare `Number(...)` coercion of `limit` query parameter (NaN/Infinity injection)

**Severity:** Low

**Files / lines:** `packages/nextjs/app/api/agent/policies/recent/route.ts:38`:
```
const limit = Number(request.nextUrl.searchParams.get("limit") ?? 10);
```

**Observation.** All sibling routes use `Math.min(Math.max(parseInt(..., 10) || default, 1), MAX_LIMIT)` (verified across `frontend/claimable-fees/route.ts:35-36`, `leaderboard/route.ts:47`, `agent-callbacks/*/route.ts`). This single route is inconsistent. `?limit=Infinity` → `Number("Infinity") === Infinity`; `?limit=NaN` → `NaN`. Downstream `listAgentAskSummaries` then receives the bad value. The Postgres driver typically rejects `LIMIT NaN`, so the symptom is a 500 — not a data-corruption or SQL-injection issue.

**Fix.** Match the convention used elsewhere in the codebase:
```
const raw = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "10", 10);
const limit = Math.min(Math.max(Number.isFinite(raw) && raw > 0 ? raw : 10, 1), 100);
```

**CWE.** CWE-20 (improper input validation).

**Dedup.** New.

---

### WS-8 — Email PII stored in plaintext in `notificationEmailSubscriptions` (defense-in-depth)

**Severity:** Low

**Files / lines:** `packages/nextjs/lib/db/schema.ts:133-156` — `notificationEmailSubscriptions` with `email` as a `text` column and `UNIQUE` index (`:150`).

**Observation.** Stored plaintext emails are the lowest-trust PII the DB holds. A database compromise (SQLi, backup exposure, replica leak, malicious admin) yields a list of verified emails tied to wallet addresses. This is standard practice in most apps but worth calling out:

**Fix.** Either:
- (a) Hash the email with a server-side pepper (`sha256(SERVER_PEPPER || lower(email))`) and store only the hash + last-4-chars-of-local-part for UX. Backend matches on the hash; outbound mail is sent via a separate vault.
- (b) Field-level-encrypt the email column with a KMS-managed key. Lookups via deterministic encryption.

Acceptable if (a) the encryption-at-rest of the underlying Postgres covers your threat model, and (b) the user pool is small enough that the linkage to wallet addresses isn't independently sensitive.

**CWE.** CWE-312 (cleartext storage of sensitive info).

**Dedup.** New.

---

## Informational (positive verifications + observations)

### INFO-1 — Pinned versions are clean against the 2025-2026 disclosure landscape

Cross-checked against the web-research agent's 2025–2026 advisory survey:

| CVE / advisory | Affected | Status in this repo |
|---|---|---|
| **CVE-2025-29927** — Next.js middleware bypass via `x-middleware-subrequest` | Next.js `<14.2.25` / `<15.2.3` | **N/A** — no `middleware.ts` is present (verified by `find packages/nextjs -maxdepth 2 -name middleware.ts`). Even if one is added, `next@~15.5.18` is patched. |
| **CVE-2025-55182 / CVE-2025-66478** — Server-Components RCE via crafted `Next-Action` header | Next `<15.5.7` / `<16.0.7`, React `<19.0.1/19.1.2/19.2.1` | **Patched** — `next@~15.5.18` ≥ 15.5.7; `react@~19.2.3` ≥ 19.2.1. |
| **CVE-2025-57822** — middleware SSRF via header forwarding | older 15.x | **Patched** by the same Next.js bump. |
| **CVE-2025-49005 / CVE-2025-49826** — RSC + 204 cache poisoning | older 15.x | **Patched** by the same Next.js bump. |
| **CVE-2026-39356** — Drizzle ORM SQLi via `sql.identifier` | `drizzle-orm < 0.45.2` (or `< 1.0.0-beta.20`) | **Patched** — `yarn.lock` resolves to `drizzle-orm@0.45.2` exactly. |
| **Shai-Hulud npm worm + Sept 2025 chalk/debug compromise** | `chalk@5.6.1`, `debug@4.4.2`, `@ctrl/tinycolor` (compromised), `@nx/*` | **Clean** — `yarn.lock` resolves `chalk@5.6.2` and `debug@4.4.3` (post-incident republishes); `@ctrl/tinycolor` and `nx`/`@nx/*` are not in the lockfile at all. |

The version pinning posture is good. Worth setting up Dependabot / Renovate to keep this status.

### INFO-2 — Verified false-positives (recorded so future audit passes don't re-flag the same paths)

- **"API signing-intent hijacking via `[intentId]/complete`"** — The `token` parameter IS the bearer credential and is matched in DB via `WHERE id = ? AND token_hash = ?` (`signingIntents.ts:162`). Standard bearer-token model.
- **"Critical SQL injection via dynamic table name in `signedSessionStore.ts`"** — `tableName` is a code-controlled config field set by `signedReadSessions.ts:31` (`"signed_read_sessions"`) and `signedWriteSessions.ts:17` (`"signed_write_sessions"`). Both literal strings; no user input reaches them.
- **"upsertAgentPolicy authorization bypass via user-supplied policyId"** — The existence lookup at `policies.ts:251` always gates by `owner_wallet_address = ?` with the trusted caller address; an attacker supplying a victim's policyId simply gets `existing == null` and then either gets the row blocked by the table's PK (if `id` is PK) or gets a per-owner clone. Not an authorization bypass.
- **"X402 typed-data not validated against canonical address list in `localSigner.ts`"** — `localSigner.ts` is a low-level signing primitive that faithfully signs whatever typed-data the caller passes. Same architecture as MetaMask's signer. Validation belongs in the dApp UI (which currently does not show calldata — see **WS-2**) and at the server that consumes the signature.

### INFO-3 — Other observations

- **CODEOWNERS bottleneck.** `.github/CODEOWNERS` has a single line `* @Noc2` — a single individual is the sole approver for every path. Operationally fragile; consider team handles once the team grows.
- **Dockerfile base-image pinning.** `packages/keeper/Dockerfile:1` uses `FROM node:24-alpine` (tag, not digest). Tag floats; reproducibility-only concern.
- **Postinstall in `packages/foundry/package.json`.** `"postinstall": "shx cp -n .env.example .env"` is benign but is a yarn `enableScripts` consumer. Consider auditing whether `enableScripts: false` is feasible repo-wide (most TypeScript packages don't need scripts); a notable hardening against the Shai-Hulud-class worms.
- **PR-trigger secret exposure.** `.github/workflows/e2e.yaml` triggers on `pull_request:` (not the unsafe `pull_request_target:`) and references `secrets.ETHERSCAN_API_KEY` (`:115, :274`). GitHub does NOT pass secrets to PRs from forks under the `pull_request:` trigger, so this is safe for external contributors. Internal-team PRs do see the secret; rotate if a contributor account is suspected of compromise.
- **Foundry `.env` is present in working tree** but git-ignored (`packages/foundry/.gitignore:13`). Verified not tracked. Same for `packages/ponder/.env.local`.
- **`packages/nextjs/.env.production` IS tracked** by git. Worth re-reading to confirm no secrets — `git ls-files` shows it as committed.

---

## Cross-cutting 2025–2026 attack-pattern survey

(From the web-research agent; reproduced here verbatim because it is the single most useful artifact in this pass — every item is a thing to grep for going forward.)

| # | Pattern | CVE / advisory | Why it matters for this repo | Grep / review hint |
|---|---|---|---|---|
| 1 | Next.js middleware auth bypass | CVE-2025-29927 (GHSA-f82v-jwr5-mffw) | If `middleware.ts` is added later, ensure `next ≥ 15.2.3` (we have 15.5.18) and that proxies strip `x-middleware-subrequest`. | `middleware.ts`, matcher, `x-middleware-subrequest`. |
| 2 | RSC RCE via `Next-Action` | CVE-2025-55182 / CVE-2025-66478 | Patched in this repo. Audit `'use server'` functions for explicit auth on every entry — dead-code elimination is NOT auth. | grep `"use server"` across `packages/nextjs/**`. |
| 3 | Next.js middleware SSRF | CVE-2025-57822 | Patched, but on any future middleware: never spread raw `req.headers` into `NextResponse.next({ headers })`. | `NextResponse.next(`, `request.headers`. |
| 4 | Drizzle SQLi via identifier escaping | CVE-2026-39356 | Patched. Avoid `sql.identifier(userInput)` and dynamic `orderBy(userInput)` regardless. | `sql.identifier(`, `.as(userInput`, dynamic `orderBy(`. |
| 5 | EIP-7702 delegation phishing | arXiv 2512.12174; Halborn / Fireblocks 2025 | We don't construct 7702 authorizations on-chain today, but the agent-signing UI **could** be tricked into presenting one. Audit `localSigner.ts` and `BrowserSigningPage.tsx` for any `type: 0x04` / `SetCode` authorization. | `type: 0x04`, `SetCode`, `delegateAddress`. |
| 6 | npm supply-chain worms (Shai-Hulud, chalk/debug/nx) | Sysdig, Unit42, Semgrep — Sept 2025 | Lockfile is currently clean. Hardening: `enableScripts: false` in `.yarnrc.yml`, require provenance attestation on bumps. | `yarn.lock` quarterly review; pin Renovate to `:disablePeerDependencies`. |
| 7 | MCP tool poisoning + indirect prompt injection | CVE-2025-54135 (CurXecute), CVE-2025-54136 (MCPoison) | Direct hit on this repo's MCP server endpoint (`packages/nextjs/app/api/mcp/route.ts`) and the agent template flow. Hash-pin tool descriptors; refuse to auto-write `mcp.json`. | grep `tools.list`, `tools/list`, any code that writes MCP config. |
| 8 | MCP SSE session-ID hijack | CVE-2025-6515 | Verify SSE/MCP session IDs are 128-bit CSPRNG, bound to an auth principal, and not reusable. | `EventSource`, `text/event-stream`, custom `sessionId`. |
| 9 | SIWE / WorldID nullifier replay | login.xyz security considerations; Semaphore guidance | Verify the WorldID verify endpoint persists `nullifier_hash` with a `UNIQUE(nullifier_hash, action_id)` constraint and inserts BEFORE the protected action, in the same transaction. | grep `verifyCloudProof`, `verifyProof`, `world-id-router`. |
| 10 | thirdweb legacy Bridge contract | thirdweb security blog, Dec 10 2025 | If we integrate thirdweb Pay / Bridge, verify addresses are current (April 2025 fix left a legacy contract exploitable through December). | grep hardcoded thirdweb contract addresses; compare to current thirdweb allowlist. |

---

## Recommended remediation order

1. **WS-1 (High)** — token out of URL. Affects every published signing link going forward; not retroactive.
2. **WS-2 (Medium)** — calldata decode + allowlist in the signing UI. Companion to WS-1.
3. **KEEPER-1 (Medium)** — cache last-known block timestamp; refuse to fall back to system clock.
4. **KEEPER-2 (Medium)** — refuse non-loopback metrics bind without auth token; document in `.env.example`.
5. **WS-3 (Medium)** — nonce-based CSP, drop `'unsafe-inline'`.
6. **WS-4 (Medium)** — strict schema on `parseX402QuestionRequest` (reject unknown fields).
7. **WS-5 / WS-6 / WS-7 (Low)** — small consistency fixes.
8. **WS-8 (Low)** — email hashing / encryption if the threat model warrants it.
9. **INFO-3** — CODEOWNERS team handles, Dockerfile digest pin, audit `.env.production`.

## Suggested test additions

- `packages/nextjs/app/api/agent/signing-intents/...` — regression: a GET that includes `token` in URL should set the cookie + 302 to a tokenless URL (after WS-1 fix).
- `packages/nextjs/components/agent/BrowserSigningPage.test.tsx` — when `call.data` decoded function selector does not match `call.description`'s declared action, render the discrepancy + disable Submit (after WS-2 fix).
- `packages/keeper/src/__tests__/keeper.fallback.test.ts` — RPC outage path must use cached block, not `Date.now()` (after KEEPER-1 fix).
- `packages/keeper/src/__tests__/metrics.bind.test.ts` — refusal to start metrics on `0.0.0.0` without token (after KEEPER-2 fix).
- `packages/nextjs/lib/agent/signingIntents.test.ts` — reject `createAgentSigningIntent` with an unknown top-level field (after WS-4 fix).

---

## Method note

Six parallel agents on `claude-audit-5` source, plus one web-research agent for 2025–2026 CVE/advisory disclosures. Each candidate finding was re-verified against current source before inclusion. Four agent claims were rejected as false positives and documented above. No source modifications made on this branch. The smart-contract audit for the same date is at `packages/foundry/audit-report-claude-2026-05-21.md`; this report is repo-wide and excludes those contracts.
