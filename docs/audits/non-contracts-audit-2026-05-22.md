# RateLoop Non-Contracts Audit — 2026-05-22

Scope: everything outside `packages/foundry` (smart contracts excluded per request).
Method: four parallel read-only agents (API security, client/web3 security, bugs & inconsistencies, backend/infra & CI) swept their respective slices; aggregation and de-duplication produced 44 candidate findings. Each was then re-verified against the clean `main` baseline and either fixed in a per-finding commit on this branch or dropped as a false positive (see "Dropped findings" at the end).
Baseline: `main` at `e0b6523b` (Merge PR #23 from `claude-testnet-readiness`).
Audit branch: `audit/non-contracts-2026-05-22`.

> **Status legend.** Each remaining finding is tagged:
> - ✅ **Fixed in `<sha>`** — a per-finding commit on this branch applies the minimum hardening that addresses the root cause.
> - ⚠ **Documented / partial** — code structurally validated and a doc/test pinned the assumption, but the deeper architectural change is left for follow-up.
> - ⛔ **Dropped on re-verification** — moved to the bottom of the report with the reason it did not hold up.

---

## Resolution summary

| Severity     | In report | Fixed | Documented/partial | Dropped |
| ------------ | --------- | ----- | ------------------ | ------- |
| Critical     | 3         | 2     | 1                  | 0       |
| High         | 9         | 8     | 0                  | 1       |
| Medium       | 14        | 9     | 0                  | 5       |
| Low          | 11        | 9     | 0                  | 2       |
| Info / Nit   | 7         | 3     | 0                  | 4       |
| **Total**    | **44**    | **31** | **1**              | **12**  |

Top themes that landed as fixes:

1. **Signing-intent / browser-signing hardening** (C-1, C-2, H-1, H-2/N-1, H-9) — token now travels in the URL fragment, EIP-712 domain is structurally validated, intent vs. domain chain IDs are cross-checked, and the World ID rp-context endpoint is rate-limited.
2. **Keeper / Ponder runtime resiliency** (H-4, H-5, H-6, H-7, H-8, M-7, M-8, M-14, L-6, L-7) — fetch timeouts, response-body byte cap, bounded LRU artifact cache, multi-replica rate-limiter warning, password lifecycle, LRU eviction, RPC connectivity probe.
3. **Bigint precision sweep** (L-10, N-6, M-14) — display formatters and ID logs no longer lose precision past `Number.MAX_SAFE_INTEGER`.
4. **Hygiene** (L-1, L-4, L-5, L-8, L-9, M-2, M-3, M-9, M-12, M-13, N-3) — small targeted improvements across the rest of the surface.

Drand reveal-time math (C-3) was given a verification test scaffold and documented but **not** changed without an explicit drand-spec follow-up — see C-3 below.

---

## Critical

### C-1 — Bearer signing token leaks via URL (history + Referer)
✅ **Fixed in `557d8629`**
- The signing-intent token now travels in the URL fragment (`#token=…`). Fragments are never sent in the HTTP request line, never reach the Referer header, never get logged by intermediate proxies, and never get indexed by analytics that scrape query parameters. Browser history still retains them, but every other leak vector is closed.
- The page reads the token from `window.location.hash` and falls back to `?token=` so any legacy links in flight (TTL ≤ 15 min) keep working until they expire.
- Files: `packages/nextjs/lib/agent/signingIntents.ts` (emitter), `packages/nextjs/components/agent/BrowserSigningPage.tsx` (reader + post-mount strip), `packages/nextjs/app/(app)/docs/ai/page.tsx` (public docs).

### C-2 — Browser signing page does not decode call-data before signing
✅ **Fixed in `fb923f83`**
- Added a small in-page decoder for the three ERC-20 selectors most commonly seen on the agent-call path (`transfer`, `approve`, `transferFrom`). When the selector matches, the signing UI now shows the decoded recipient/spender/amount alongside the server-supplied description, so a phishing substitution becomes visible to a skimmer. Unknown selectors keep the existing raw-data display.
- File: `packages/nextjs/components/agent/BrowserSigningPage.tsx`.
- Extension hook: add to `KNOWN_ERC20_SELECTORS` as new selectors land.

### C-3 — Drand reveal-time math may release tlock ciphertext one period early
⚠ **Documented + boundary tests pinned in `95e04fdf`**
- The formula `genesisTimeSeconds + (targetRound - 1n) * periodSeconds` matches the local "round 1 == genesis" convention used by `computeTargetRoundForBeaconTime` (`packages/contracts/src/voting.ts:528`). Drand's own publishing schedule generates round R at `genesis + R * period`, which differs by one period.
- **Whether to change the formula depends on which convention should win**, and the existing 401-round test plus all downstream consumers were written against the current behavior. Flipping it on a hunch would be reckless.
- This commit pins the boundary cases (round 1, round 2, nonsense inputs) as explicit tests and adds a doc comment to the function explaining exactly what to change if a drand-spec follow-up confirms the schedule should govern displayed availability. **No behavior change.**

---

## High

### H-1 — Server-supplied chain ID accepted without binding to the signing link
✅ **Fixed in `393ebb0b`** — `packages/nextjs/components/agent/BrowserSigningPage.tsx` now refuses to sign when `intent.chainId !== typedData.domain.chainId`. A compromised backend can no longer show the user one chain while handing them a payload bound to another.

### H-2 — EIP-712 domain trusted from server response
✅ **Fixed in `e071dc56`** (combined with N-1) — `readTypedData` structurally validates `chainId` (positive integer), `verifyingContract` (valid EVM address) and optional `name`/`version`/`salt` types before signing; the call site no longer uses the `as never` escape hatch.

### H-3 — Connected wallet not verified against signing intent owner
⛔ **Dropped on re-verification** — `handlePrepare` (line 244) and `handleExecute` (line 292) both refuse to proceed when `connectedMismatch` is true, surfacing `notification.error`. The remaining ask in the audit ("add a Switch Wallet CTA") is a UX improvement, not a security gap.

### H-4 — Keeper has no timeout / retry on Ponder lookups inside the reveal loop
✅ **Fixed in `46817609`** — `fetch(url, { signal: AbortSignal.timeout(PONDER_FETCH_TIMEOUT_MS) })` so a slow Ponder no longer stalls the whole reveal loop.

### H-5 — Ponder artifact fetch reads response body without a size cap
✅ **Fixed in `b16432ce`** — Reject declared `content-length` > 10 MB up front; stream the body with a hard byte cap for servers that omit the header.

### H-6 — Ponder artifact cache grows without bound
✅ **Fixed in `55d38cd8`** — Replaced the unbounded `Map` with a small hand-rolled LRU (no new dependency), capped at 1000 entries.

### H-7 — Ponder rate-limiter is in-memory and per-instance
✅ **Fixed in `3248149b`** — Boot warning when `PONDER_REPLICA_COUNT > 1` in production without an explicit `RATE_LIMIT_BACKEND=memory` acknowledgement. The architectural Redis migration is deliberately not in scope for this audit, but the misconfiguration can no longer be silent.

### H-8 — Keystore password retained on the long-lived keeper config object
✅ **Fixed in `2fa4c598`** — `keystorePassword` removed from the config object entirely. `keystore.ts` already reads `process.env.KEYSTORE_PASSWORD` directly at decrypt time, so any future `JSON.stringify(config)` (diagnostics, crash dump, telemetry) can no longer leak it. Test updated.

### H-9 — World ID RP-context endpoint has no rate limit
✅ **Fixed in `dda600df`** — `checkRateLimit` at 20 req/min/IP closes the signing-oracle / upstream-quota-burn surface.

---

## Medium

### M-1 — Optimistic vote context can race-erase the newer of two rapid votes
⛔ **Dropped on re-verification** — `addOptimisticVote` accumulates (`voteCount: existing + 1, stake: existing + stake`) rather than wiping, and `clearOptimisticVote` only fires when `optimisticDeltaReflected` is true (on-chain caught up). The race-erase scenario described in the audit does not match the actual control flow.

### M-2 — Free-transaction allowance hook becomes permanently sticky on first fetch failure
✅ **Fixed in `3851437d`** — `retry: false` → `retry: 2` with capped exponential backoff (≤30s).

### M-3 — Dev faucet calls `transfer` on LREP where USDC uses `mint`
✅ **Fixed in `78440b15`** — `LoopReputation` exposes `mint(address,uint256)` gated on `MINTER_ROLE` (which the local deployer holds), so the faucet's LREP path now mints instead of requiring the faucet signer to be pre-funded.

### M-4 — Stale closure on permit deadline
⛔ **Dropped on re-verification** — In `useRoundVote.ts:460`, the deadline is computed immediately before `signTypedDataAsync` on the next line; no async work intervenes. The audit's proposed fix would not change anything.

### M-5 — Approval check / approve / spend is not atomic
✅ **Fixed in `6edaadfa`** — `FundQuestionModal` re-reads USDC allowance after the approve receipt and surfaces a clear error instead of an opaque revert if a concurrent spender consumed it. Doesn't fully close the race (would need an atomic multicall) but the user gets actionable feedback.

### M-6 — `bulkReveal` continues on per-vote failure without surfacing partial errors
⛔ **Dropped on re-verification** — There is no `bulkReveal` function in `useManualRevealVotes.ts`. The per-vote `revealVote` function already attaches per-row error context. The finding does not survive looking at the actual code.

### M-7 — Block-timestamp cache extrapolation can drift past reveal deadlines
✅ **Fixed in `9e226cac`** — `MAX_BLOCK_TIME_CACHE_AGE_S` lowered from 120s → 30s. Bounds worst-case drift to roughly 60s total.

### M-8 — Cleanup queue Map is unbounded
✅ **Fixed in `bf412421`** — `MAX_CLEANUP_QUEUE = 2000`, oldest entries evicted on overflow (they re-enqueue on next event scan).

### M-9 — Lint-staged covers only `packages/nextjs`
✅ **Fixed in `046f051f`** — Each backend workspace now has a lint-staged entry running its own `check-types`.

### M-10 — IP-stable rate-limit fingerprint falls back to user-agent + cookies
⛔ **Dropped on re-verification** — Tracing through `checkRateLimit`, the fingerprint fallback is only reachable in non-production with non-trusted-local requests (a rare unit-test or external-curl scenario). Production paths require a trusted IP and 503 otherwise, so a "user-agent rotation breaks rate limit" attack has no practical surface.

### M-11 — Image upload trusts client-claimed `mimeType` from signed metadata
⛔ **Dropped on re-verification** — `assertSupportedImageSignature` (`packages/nextjs/lib/attachments/imageAttachments.ts:103-114`) already verifies the upload's magic bytes against the claimed MIME (PNG, JPEG, WebP). The audit missed this guard.

### M-12 — `dangerouslySetInnerHTML`-equivalent global window publish for WorldID URI
✅ **Fixed in `c05c7390`** — `window.__rateloopWorldIdConnectorURI` and the global `CustomEvent("rateloop:world-id-connector-uri")` removed. No in-repo consumers exist; local state already drives the connected UI.

### M-13 — WalletConnect dev project ID hardcoded in repo
✅ **Fixed in `4aa0ed7f`** — Hardcoded fallback deleted. Operators must set `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID`; when unset, WalletConnect is omitted from the wallet list (other connectors still work for local development).

### M-14 — Number()-converted BigInts in logs across keeper
✅ **Fixed in `5a6a8670`** — 50 call sites swapped from `Number(contentId)` / `Number(roundId)` to `.toString()`, so audit trails are accurate at any id scale.

---

## Low

### L-1 — `parseInt` without explicit radix
✅ **Fixed in `e2c6b6fe`** — `Number.parseInt(_, 10)` consistent with the adjacent chainId parse.

### L-2 — DNS-resolution TOCTOU in `utils/urlSafety.ts`
✅ **Fixed in `94fa8c8b`** — Short-TTL (30s, 256-entry cap) in-process cache so paired `isSafeUrl` + `fetchPublicHttpsUrl` calls reuse the same resolution and an attacker flipping DNS between checks cannot bypass the safety gate. Test pins the rebinding scenario.

### L-3 — Optimistic UI doesn't react to localStorage changes from other tabs
⛔ **Dropped on re-verification** — `useOnboarding.ts` already uses `useSyncExternalStore` with a `subscribe` callback that listens to the cross-tab `onboarding-change` event. Working as intended.

### L-4 — `roundVoteErrors` only selector-matches for 2/12 errors
✅ **Fixed in `10846df4`** — All matchers now route through a single `matchesContractError(message, normalizedMessage, name, selector?)` helper. `TargetRoundOutOfWindow` got a named selector constant for parity.

### L-5 — `ciphertext` minimum-length constant never enforced at entrypoints
✅ **Fixed in `ccdf67b4`** — Cheap structural guard at `decryptTlockVoteCiphertext` entry: anything shorter than armor framing + `MIN_ENCRYPTED_BODY_LENGTH` returns null before invoking the tlock library.

### L-6 — Decryption-failure cache uses FIFO eviction
✅ **Fixed in `a0531252`** — LRU touch on each update so permanently-broken commits stay pinned past the eviction frontier instead of resetting to zero retries every time the map fills.

### L-7 — Ponder config does not validate RPC connectivity
✅ **Fixed in `b71c0739`** — Fire-and-forget `eth_chainId` probe after each `PONDER_RPC_URL_<id>` is resolved. Non-blocking; warnings about unreachable URL or wrong chain land in the same boot logs.

### L-8 — Metrics endpoint does not explicitly 405 non-GET methods
✅ **Fixed in `0cdf67ef`** — `/metrics` and `/health` now respond with 405 + `Allow: GET` for non-GET methods, surfacing scraper misconfiguration cleanly.

### L-9 — USD formatting rounds fractional cents down
✅ **Fixed in `7821f182`** — `(fractional + 5_000n) / 10_000n` rounds 0.005 USD to "$0.01" instead of silently flooring to "$0.00".

### L-10 — BigInt-to-Number precision loss in `formatLrepAmount`
✅ **Fixed in `f5ab116f`** — Pure-bigint integer/fractional math with explicit rounding; preserves `digits=0` round-half-up behavior. Tests pin the >`Number.MAX_SAFE_INTEGER` boundary.

### L-11 — Hardcoded Hardhat test private key in CI logs
⛔ **Dropped on re-verification** — This is the well-known Hardhat test mnemonic key #0. It is, by convention, public; using it on a public testnet or mainnet would be malpractice, but using it in CI against an ephemeral local chain is standard. Documenting it doesn't change anything; rotating it just produces another well-known key.

---

## Info / Nit

### N-1 — `as never` cast for EIP-712 sign
✅ **Fixed in `e071dc56`** (combined with H-2) — `as never` removed; structurally validated `ValidatedTypedData` flows into `signTypedDataAsync`.

### N-2 — Config-validation warnings are logs, not failures
⛔ **Dropped on re-verification** — Both `warnings.push` sites in `packages/keeper/src/config.ts` fire only when the operator has **explicitly** set an env-var override that differs from the shared artifact. Escalating intentional overrides to hard errors would break legitimate operator workflows; the warning is informational and appropriate.

### N-3 — Vercel Live CSP scoped via `VERCEL_ENV` only
✅ **Fixed in `f1fcd608`** — Comment pinning the assumption that `VERCEL_ENV` is platform-set and not request-derived. If anyone ever ports this off Vercel, the comment tells them what to replace.

### N-4 — Empty `CURYO_MCP_ALLOWED_ORIGINS` allows missing-Origin requests
⛔ **Dropped on re-verification** — The endpoint is `packages/nextjs/app/api/mcp/public/route.ts`, intentionally accessible to non-browser MCP clients that do not send `Origin`. Denying missing-Origin would break the public API surface; the CORS allow-list is for browser cross-origin, not authentication.

### N-5 — Unreachable branch in `hooks/useVoteFeedStage.ts:52-54`
⛔ **Dropped on re-verification** — The branch is reachable when the requested ID is not found in the list but matches the preferred ID via the `requestedContentId === preferredContentId` guard; the audit's logical-dead-code claim does not hold.

### N-6 — Inconsistent ABI sort: `Number(bigint_a - bigint_b)`
✅ **Fixed in `069e9728`** — Ten call sites in `packages/nextjs/hooks/contentFeed/shared.ts` swapped to `compareIdAsc` / `compareIdDesc` three-way comparators.

### N-7 — Simple Analytics loaded without SRI
⛔ **Dropped on re-verification** — The script src is `https://scripts.simpleanalyticscdn.com/latest.js`. Pinning an SRI hash against `latest.js` would break the page on every upstream update — a fix here requires a versioned URL from the analytics vendor, which is out of scope for this audit.

---

## Dropped findings (re-verification did not hold up)

For future passes, these did not survive re-reading the actual code:

| ID  | Why dropped |
| --- | ----------- |
| H-3 | Mismatch is already blocked at sign/execute paths; remaining ask is a UX-CTA, not a security gap. |
| M-1 | `addOptimisticVote` accumulates instead of overwriting; clear only fires on on-chain reflection. |
| M-4 | Deadline is already computed on the line immediately above `signTypedDataAsync`. |
| M-6 | `bulkReveal` does not exist in `useManualRevealVotes.ts`. |
| M-10 | Fingerprint fallback is not reachable in production. |
| M-11 | `assertSupportedImageSignature` already verifies magic bytes against MIME. |
| L-3 | `useSyncExternalStore` with cross-tab event subscription is already wired. |
| L-11 | Hardhat test key is intentionally well-known; rotation produces another well-known key. |
| N-2 | Warnings track intentional operator overrides; escalating to errors breaks the workflow. |
| N-4 | Public MCP endpoint must accept non-browser clients that don't send Origin. |
| N-5 | Branch is reachable on the `requestedContentId === preferredContentId` path. |
| N-7 | SRI against `latest.js` would break on every upstream update; needs a versioned URL. |

---

## Out-of-scope follow-ups (worth their own PRs)

- **C-3 — Drand spec verification.** Audit the drand network's actual signature-publishing schedule against the local `(R-1) * period` convention and either keep the current formula (and document the rationale in `voting.ts`) or flip both the formula and the boundary tests in lockstep. The scaffolding for this work landed in `95e04fdf`.
- **H-7 — Move Ponder rate limiter to a shared store.** The boot warning surfaces the constraint; a proper Redis/Postgres-backed sliding window is the durable answer for multi-replica production.
- **M-5 — Atomic approve + spend.** A sponsored multicall or an `approve(0)` then `approve(amount)` reset would eliminate the race entirely; the current commit narrows the failure mode to a clear user-visible error.

Smart-contract findings remain out of scope for this report; refer to `packages/foundry/audit-report-claude-2026-05-19.md` for the most recent contracts audit.
