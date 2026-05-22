# RateLoop Non-Contracts Audit — 2026-05-22

Scope: everything outside `packages/foundry` (smart contracts excluded per request).
Method: four parallel read-only agents (API security, client/web3 security, bugs & inconsistencies, backend/infra & CI) sweeping their respective slices, plus aggregation and de-duplication.
Baseline: `main` at `e0b6523b` (Merge PR #23 from `claude-testnet-readiness`).
Audit branch: `audit/non-contracts-2026-05-22`.

> **How to read this report.** Findings are bucketed by severity and tagged with confidence. "High confidence" means the agent identified a concrete file/line with reasoning that holds on review. "Needs verification" means the pattern looks suspicious but a definitive call requires runtime testing or deeper context (mark with `?`). Every finding cites `file:line` so triage can start from the source. This was produced under time pressure with read-only tooling — treat it as a triage list, not a verdict.

---

## Executive summary

| Severity     | Count |
| ------------ | ----- |
| Critical     | 3     |
| High         | 9     |
| Medium       | 14    |
| Low          | 11    |
| Info / Nit   | 7     |
| **Total**    | **44** |

Top themes:

1. **Signing-intent / browser-signing UX has multiple sharp edges** (`packages/nextjs/components/agent/BrowserSigningPage.tsx`). Token-in-URL, server-trusted chain ID, server-supplied EIP-712 domain, and undecoded call-data are clustered in one critical surface. Worth a focused review pass.
2. **Keeper & Ponder runtime resiliency gaps** — missing fetch timeouts, unbounded in-memory caches/maps, in-memory rate limiter that resets on restart, RPC chain-id not validated at config load, block-timestamp cache extrapolation can drift past reveal deadlines.
3. **Drand / vote-reveal timing math** — `deriveVoteTlockRevealAvailableAtSeconds` uses `(targetRound - 1n) * period`, which appears one period off from the canonical drand availability formula. If correct, this weakens the tlock privacy window. Needs a fresh verification against drand spec **before** assuming a bug.
4. **Several sponsored-transaction / approval flows** lack atomicity guards (race conditions on nonces, allowances, optimistic UI), causing silent failures rather than clear errors.
5. **CI / tooling**: lint-staged covers only `packages/nextjs`, so backend packages can land un-linted. Several known-test-only secrets are inlined in workflow YAML — acceptable but worth documenting.

The codebase is generally well-structured (rate limiting helper, signed-action challenge, URL safety helper, structured config validation in keeper). The most consequential risk concentrates in the **agent signing flow** and **keeper liveness** — those deserve the next dedicated review pass.

---

## Critical

### C-1 — Bearer signing token leaks via URL (history + Referer)

- **File:** `packages/nextjs/components/agent/BrowserSigningPage.tsx:162-177`
- **Confidence:** High
- The signing intent's bearer token arrives as a `?token=` query parameter. `history.replaceState` is used to strip it, but only after React mounts — the first `postPrepare` fetch (lines 223-228) and any cross-origin sub-resource loads can leak the token via `Referer` or to analytics. Stored in browser history until the user navigates.
- **Impact:** Anyone with read access to the user's browser history (or a Referer-receiving third party) can replay the signing session and authorize transactions in the user's name.
- **Fix:** Use the URL fragment (`#token=…`, never sent in Referer), an httpOnly + SameSite=Strict cookie, or POST the token from the link-source page rather than encoding it in the URL.

### C-2 — Browser signing page does not decode call-data before signing

- **File:** `packages/nextjs/components/agent/BrowserSigningPage.tsx:311-327`
- **Confidence:** High
- The page validates that server-supplied call-data is hex and the target is a checksummed address, but never decodes the function selector or arguments. The user sees only the server-provided description. A compromised or malicious agent backend can show "Approve USDC" while sending `transfer(attacker, max)`.
- **Impact:** Phishing-grade transaction substitution.
- **Fix:** Decode the 4-byte selector and ABI-decode against a known allowlist of selectors; surface the decoded target/amount alongside the description so the human can compare.

### C-3 — Drand reveal-time math may release tlock ciphertext one period early

- **File:** `packages/contracts/src/voting.ts:162-173` (function `deriveVoteTlockRevealAvailableAtSeconds`)
- **Confidence:** Medium-High (needs spec re-check)
- Formula: `genesisTimeSeconds + (targetRound - 1n) * periodSeconds`. Canonical drand availability is `genesisTime + round * period` — round `N` becomes available *at the start of period `N+1` after genesis*, not at the end of period `N-1`. If the canonical formula applies here, the front-end exposes the "reveal allowed" badge one drand period (≈3-30s depending on chain) before drand actually publishes the signature.
- **Impact:** Slightly weakens the tlock privacy window; with frequent enough polling, a vote could be revealed before the network can have published its share.
- **Action:** Before changing, verify against the specific drand chain config in `packages/nextjs/lib/drand` and add a unit test that pins the boundary. If confirmed, the fix is `targetRound * periodSeconds`, *not* `(targetRound - 1n)`.

---

## High

### H-1 — Server-supplied chain ID accepted without binding to the signing link

- **File:** `packages/nextjs/components/agent/BrowserSigningPage.tsx:252-254, 307-309`
- The chain to switch to is read from the server-returned intent. A compromised backend can force the user onto mainnet for a signature crafted to look like a testnet preview. There is no client-side cross-check against the chain the agent told the user to expect.
- **Fix:** Bind chain ID into the signing token (signed by the backend so it cannot be tampered post-issuance), and require the rendered chain to match before `switchToChain`.

### H-2 — EIP-712 domain trusted from server response

- **File:** `packages/nextjs/components/agent/BrowserSigningPage.tsx:260-267`
- `domain.chainId` and `domain.verifyingContract` are taken from the fetched intent, cast through `as never`, and signed. A bad domain enables cross-contract or cross-chain signature reuse.
- **Fix:** Validate the domain with a zod schema; cross-check `verifyingContract` against the deployed-contracts manifest for the active chain.

### H-3 — Connected wallet not verified against signing intent owner

- **File:** `packages/nextjs/components/agent/BrowserSigningPage.tsx:205-208`
- After resolving the intent server-side, the page does not assert `intent.walletAddress === connectedAddress`. A user who clicks a shared link while connected to a different wallet sees the prompt as if it's theirs.
- **Fix:** Show a hard error (no sign button) when addresses differ, with an explicit "switch wallet" prompt.

### H-4 — Keeper has no timeout / retry on Ponder lookups inside the reveal loop

- **File:** `packages/keeper/src/keeper.ts:388-396`
- `fetch(url)` against Ponder runs without `AbortSignal.timeout` and without backoff; on Ponder slowness, each in-flight vote can hold the keeper loop indefinitely. The whole reveal pipeline stalls behind one slow query.
- **Fix:** Wrap with `AbortSignal.timeout(5_000)`; on 5xx/timeout, return a recoverable error and continue the loop with bounded exponential backoff.

### H-5 — Ponder artifact fetch reads response body without a size cap

- **File:** `packages/ponder/src/payout-proofs.ts:116-122`
- 5s connection timeout is set, but `.json()` is invoked on the full body. Slow-read or oversized artifact URIs can OOM the indexer process.
- **Fix:** Stream with a content-length cap (e.g., 10 MB) and bail with a structured error past the limit.

### H-6 — Ponder artifact cache grows without bound

- **File:** `packages/ponder/src/payout-proofs.ts:48`
- `artifactCache: Map<…>` is a process-lifetime Map with no eviction. At question scale this is a slow leak.
- **Fix:** Wrap with `lru-cache` (size or TTL bound) or use a `WeakMap` keyed on a short-lived owner.

### H-7 — Ponder rate-limiter is in-memory and per-instance

- **File:** `packages/ponder/src/api/rate-limit.ts:1-65`
- Counts reset on restart, and a multi-replica deployment effectively divides the limit by replica count. Burst attacks just after a deploy or behind a round-robin LB go undetected.
- **Fix:** Move to a Redis/Postgres-backed sliding window in production; keep the in-memory version as a single-instance dev fallback.

### H-8 — Keystore password retained on the long-lived keeper config object

- **File:** `packages/keeper/src/config.ts:422`
- `KEYSTORE_PASSWORD` is read into the `config` and lives for the lifetime of the process. Any future `JSON.stringify(config)` (diagnostics, telemetry, crash dump) leaks it.
- **Fix:** Pass the password to keystore decryption inside a narrow scope and zero / discard immediately. Never store on config.

### H-9 — World ID RP-context endpoint has no rate limit

- **File:** `packages/nextjs/app/api/world-id/rp-context/route.ts:7-36`
- Issues signed RP context tokens with no per-IP or per-session cap. Useful for nuisance attacks against the World ID app limits.
- **Fix:** Apply the existing `applyRateLimit` helper (`utils/rateLimit.ts`) with a tight budget (≤20/min/IP).

---

## Medium

### M-1 — Optimistic vote context can race-erase the newer of two rapid votes

- **File:** `packages/nextjs/contexts/OptimisticVoteContext.tsx:38-68`
- Unconditional timeout reset on each addOptimisticVote causes a failed earlier vote to wipe the newer pending one when timestamps collide.
- **Fix:** Key votes by submission timestamp + content ID; only clear entries whose own timestamp matches.

### M-2 — Free-transaction allowance hook becomes permanently sticky on first fetch failure

- **File:** `packages/nextjs/hooks/useFreeTransactionAllowance.ts:181-191, 195`
- `retry: false` on the React Query, no fallback after error. A single transient 5xx blocks sponsored-tx UX for the whole session.
- **Fix:** Allow at least one retry with backoff, or downgrade gracefully to self-funded after N seconds.

### M-3 — Dev faucet calls `transfer` on LREP where USDC uses `mint`

- **File:** `packages/nextjs/app/api/dev-faucet/route.ts:128` (vs. line 167 for USDC)
- If the faucet signer is not pre-funded with LREP, the LREP path fails on first request after deploy.
- **Fix:** Verify the LREP testnet contract surface; align both arms (either both `mint` or both `transfer` from a funded float).

### M-4 — Stale closure on permit deadline

- **File:** `packages/nextjs/hooks/useRoundVote.ts:416`
- `deadline = Date.now() + DEADLINE` is captured before the user-interactive sign step. Slow signers cause near-zero on-chain validity.
- **Fix:** Recompute deadline immediately before `signTypedDataAsync`.

### M-5 — Approval check / approve / spend is not atomic

- **File:** `packages/nextjs/components/reward-pool/FundQuestionModal.tsx:161-176` (mirrored in ContentSubmissionSection)
- TOCTOU between read-allowance and approve; if allowance shifts between, the follow-up `createRewardPool` reverts with poor error UX.
- **Fix:** Either use the existing sponsored-multicall path to bundle approve+spend, or reset allowance to 0 then approve exact-amount.

### M-6 — `bulkReveal` continues on per-vote failure without surfacing partial errors

- **File:** `packages/nextjs/hooks/useManualRevealVotes.ts:469-489`
- Outer try/catch hides which votes succeeded vs failed. Toast text is a single status string.
- **Fix:** Collect per-vote results and render a per-row error chip.

### M-7 — Block-timestamp cache extrapolation can drift past reveal deadlines

- **File:** `packages/keeper/src/keeper.ts:100-132` (`MAX_BLOCK_TIME_CACHE_AGE_S = 120`)
- Worst-case drift ~239 s; reveal deadline checks downstream (`:868`, `:1068`) can mis-classify still-revealable votes as expired.
- **Fix:** Tighten cap (≤30 s) and add an upper-bound jitter (over-estimate elapsed time when stale).

### M-8 — Cleanup queue Map is unbounded

- **File:** `packages/keeper/src/keeper.ts:69-71`
- `cleanupCompletedRounds` has eviction (lines 209-215); `cleanupQueue` does not.
- **Fix:** Mirror the existing eviction pattern with a cap (~1k entries).

### M-9 — Lint-staged covers only `packages/nextjs`

- **File:** `.lintstagedrc.js:10-15`
- Changes under `packages/keeper`, `packages/ponder`, `packages/agents`, `packages/sdk`, `packages/node-utils` are not type-checked or linted pre-commit. CI catches them but local feedback is slower.
- **Fix:** Add per-package globs.

### M-10 — IP-stable rate-limit fingerprint falls back to user-agent + cookies

- **File:** `packages/nextjs/utils/rateLimit.ts:158-162`
- Browser/OS updates rotate the fingerprint mid-session, allowing a low-cost reset of the counter behind a proxy that strips IP headers.
- **Fix:** Issue a long-lived signed client-id cookie on first hit and prefer it over fingerprint.

### M-11 — Image upload trusts client-claimed `mimeType` from signed metadata

- **File:** `packages/nextjs/app/api/attachments/images/upload/route.ts:37`
- Allow-list is enforced against the claimed MIME, but the actual bytes are not magic-sniffed. A stolen signed envelope (in the window before expiry) can swap content.
- **Fix:** Check magic bytes server-side and reject mismatches.

### M-12 — `dangerouslySetInnerHTML`-equivalent global window publish for WorldID URI

- **File:** `packages/nextjs/components/settings/WorldIdVerificationCard.tsx:62-66`
- Connector URI is placed on `window.__rateloopWorldIdConnectorURI` and broadcast via `CustomEvent`. Any third-party script on the page can read it.
- **Fix:** Pass via a module-local emitter and require the consumer to import it.

### M-13 — WalletConnect dev project ID hardcoded in repo

- **File:** `packages/nextjs/utils/env/public.ts:10`
- Only used outside production, but anyone who notices can register a competing dapp under it and observe pairing metadata in dev/staging.
- **Fix:** Move to env var; rotate.

### M-14 — Number()-converted BigInts in logs across keeper

- **File:** `packages/keeper/src/keeper.ts:374-375` (representative; pattern repeats)
- Beyond 2^53, `Number(contentId)` quietly mangles audit trail.
- **Fix:** `contentId.toString()` everywhere in log lines.

---

## Low

### L-1 — `parseInt` without explicit radix in `app/api/leaderboard/route.ts:47-50`
A JS-only nit (default base 10), but a consistent `Number.parseInt(x, 10)` policy reduces footguns elsewhere.

### L-2 — DNS-resolution TOCTOU in `utils/urlSafety.ts:102-107`
Resolved IP can change between SSRF check and actual fetch. Cache the resolution for ~60 s and reuse the same numeric IP for the outbound request.

### L-3 — Optimistic UI doesn't react to localStorage changes from other tabs (`hooks/useOnboarding.ts:68`)
Use `useSyncExternalStore` subscribing to the `storage` event already wired in the file.

### L-4 — `roundVoteErrors` only selector-matches for 2/12 errors (`lib/vote/roundVoteErrors.ts:30-31`)
Inconsistent matching; either match every selector or stop matching any.

### L-5 — `ciphertext` minimum-length constant never enforced (`packages/contracts/src/voting.ts:74-75`)
`MIN_ENCRYPTED_BODY_LENGTH` defined; add a guard at encrypt/decrypt entrypoints.

### L-6 — Decryption-failure cache uses FIFO eviction (`packages/keeper/src/keeper.ts:141-150`)
A permanently-broken oldest entry resets to zero on eviction, looping forever. Switch to LRU or timestamp-bound eviction.

### L-7 — Ponder config does not validate RPC connectivity (`packages/ponder/ponder.config.ts:96-124`)
Mirror keeper's `validateKeeperConnectivity` at boot to fail fast on misconfigured RPC.

### L-8 — Metrics endpoint does not explicitly 405 non-GET methods (`packages/keeper/src/metrics.ts:184-194`)
Currently returns 404; not exploitable, just sloppy.

### L-9 — USD formatting rounds fractional cents down (`packages/nextjs/lib/questionRewardPools.ts:158`)
`0.005` renders as `$0.00`. Add bankers-rounding or +0.5 cent before integer div.

### L-10 — BigInt-to-Number formatting precision loss for incentives (`packages/nextjs/lib/vote/voteIncentives.ts:59`)
Affects display only past ~9 M LREP, but trivial to fix with pure-bigint formatting.

### L-11 — Hardcoded Hardhat test private key in CI logs (`.github/workflows/e2e.yaml:175`)
Well-known key, in CI logs only. Document as acceptable test secret or rotate to a per-run ephemeral key.

---

## Info / Nit

### N-1 — `as never` cast for EIP-712 sign (`BrowserSigningPage.tsx:262-267`)
Schema-validate the domain/types rather than escaping the type system.

### N-2 — Config-validation warnings (`packages/keeper/src/config.ts:548-550`) are logs, not failures
Mismatched deployed-contract addresses should be a hard fail at boot, not a warning.

### N-3 — Vercel Live CSP scoped via `VERCEL_ENV` only (`packages/nextjs/next.config.ts:22-27`)
Confirm `VERCEL_ENV` is platform-set and unforgeable; document in `next.config.ts`.

### N-4 — Empty / unset `CURYO_MCP_ALLOWED_ORIGINS` allows missing-Origin requests (`app/api/mcp/public/route.ts:40-46`)
Default behavior should be deny when the list parses empty.

### N-5 — Unreachable branch in `hooks/useVoteFeedStage.ts:52-54`
Logically dead given the earlier early-return.

### N-6 — Inconsistent ABI sort: `Number(bigint_a - bigint_b)` in `hooks/contentFeed/shared.ts:669-717`
Use direct bigint comparison.

### N-7 — Simple Analytics loaded without SRI (`app/layout.tsx:37`)
Add an `integrity=` hash. CDN-supply-chain hedge.

---

## False positives / dropped during aggregation

The raw agent reports also surfaced several items that don't survive scrutiny — listed here so future passes don't re-discover them:

- **"Timing-safe comparison used incorrectly for bearer token"** in `attachments/images/upload/route.ts:72-74`. The agent itself notes the comparison *is* constant-time; the "header presence check" is not a credential check, just a fast-fail for malformed requests.
- **"No CSP set"** (claimed in WS-13). A CSP is configured in `packages/nextjs/next.config.ts` (the API-side audit references `:22-27` and `:170-178`); the client-side agent missed it.
- **"World ID proof verification done client-side only"** (WS-4). The proof is verified server-side via the `/api/world-id/*` routes; the client only hands the result to the backend.
- **`parseInt` without radix at `leaderboard/route.ts:47`** was flagged as **High**; this is a Low nit at most (and the same agent acknowledged the explicit-radix usage on the adjacent line).
- **"Lenient hex validation allows null bytes"** (WS-25). All-zero hex calldata is a legitimate value in many flows; not a vulnerability on its own.

---

## Recommended next actions

1. **Tighten the signing-intent flow** as a single PR: address C-1, C-2, H-1, H-2, H-3, M-12, N-1. These share the same code path and review context.
2. **Keeper / Ponder resiliency** as a second PR: H-4 through H-8, M-7, M-8, L-6, L-7, N-2. All are runtime correctness / liveness fixes touching the off-chain services.
3. **Drand timing (C-3)** deserves its own micro-PR with a test fixture pinning the boundary against a known drand chain. Do not change the formula until the test demonstrates the off-by-one.
4. **Hygiene pass** for the Low/Info bucket can ride along with whichever PR touches the file.

Smart-contract findings remain out of scope for this report; refer to `packages/foundry/audit-report-claude-2026-05-19.md` for the most recent contracts audit.
