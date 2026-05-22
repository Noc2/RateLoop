# RateLoop Full-Repo Audit — 2026-05-22

Scope: the entire repository at `main` HEAD `0dfc83b8` ("Merge pull request #26 from Noc2/audit/non-contracts-2026-05-22"). For the first time in this series of audits, smart contracts (`packages/foundry/contracts/**`) are included alongside the off-chain code, the indexer, the keeper, and the CI / dependency surface.

Method: five parallel scope-focused agents, each briefed with the most recent prior audit so they would not re-report known-fixed findings. Each agent surfaced candidate findings; every High-or-above claim was then re-verified by reading source independently before inclusion. The Critical and several High items proposed by the trust-boundary agent were retracted after verification (see "Dropped findings" at the end).

**Pre-deployment framing.** Nothing is deployed yet. Every finding is presented through that lens: severities reflect "impact-if-this-shipped-as-is", and the action column distinguishes "must fix before deploy" from "operational concerns once running". Because storage layouts, parameter values, governance wiring, and contract addresses can all still change, there is no "this is exploitable today against live funds" finding — the question is whether each item should make the cut for v1 launch.

**Status legend (third revision):**
- ✅ **Fixed in `<sha>`** — a per-finding commit on this branch.
- ⛔ **Dropped on re-verification** — moved to the bottom of the report with the reason it did not hold up.

Audit branch: `audit/full-repo-2026-05-22`.

Baselines consulted:
- `packages/foundry/audit-report-claude-2026-05-21.md` (latest contracts audit, working-tree only on the author's machine — referenced for context, not present on `main`).
- `docs/audits/non-contracts-audit-2026-05-22.md` (this audit's predecessor, merged via PR #26).

---

## Resolution summary

| Severity      | In report | Fixed | Dropped |
| ------------- | --------- | ----- | ------- |
| Critical      | 0         | 0     | 0       |
| High          | 0         | 0     | 0       |
| Medium        | 4         | 2     | 2       |
| Low           | 6         | 3     | 3       |
| Informational | 5         | n/a   | 0       |
| **Total**     | **15**    | **5** | **5**   |

The 5 informational items are positive findings / verifications / decision-points — they don't have a "fix" status. The remaining 5 actionable findings all landed as per-fix commits on this branch.

**Headline result.** Smart contracts are in **strong** posture overall. The May-21 audit found only one Informational item (CR-1) and that's now resolved on `main`. Of the four contracts commits that landed after May-21 (`187b5661`, `10798af1`, `31f2f839`, `40b78bcb`), three reviewed cleanly; `40b78bcb` introduced the one actionable contract finding — a regression of `nonReentrant` on the new `openRound` entry point. That fix is now in `7a1d50a3`. Most of the agent-suggested off-chain findings turned out to be already-mitigated by code the agents didn't see; see "Dropped findings" for the specific cross-checks that made each one fall.

---

## Medium

### M-1 — `openRound` lost `nonReentrant` in commit `40b78bcb`
✅ **Fixed in `7a1d50a3`**

- **File:** `packages/foundry/contracts/RoundVotingEngine.sol:353`.
- Commit `40b78bcb "Finalize explicit round preparation"` simplified `openRound`'s return type from a 9-tuple to `void` and in the process dropped the `nonReentrant` modifier. The CR-1 audit conclusion explicitly stipulated that "every other state-mutating external function in the codebase is `nonReentrant`"; this fix restores that policy uniformly.
- **Note:** The audit also flagged `prepareAdvisoryRound` for the same fix, but the same commit refactored that function to `external view` — a view function cannot use the `nonReentrant` modifier (it would need to write storage). `prepareAdvisoryRound` is correctly view-only and needs no further change. The commit message documents this distinction.

### M-2 — `completeAgentSigningIntent` was not idempotent against status
✅ **Fixed in `8743d3f0`**

- **File:** `packages/nextjs/lib/agent/signingIntents.ts:359-419`.
- `assertFresh()` only checked expiry, not status. A second call to `complete` for an already-`submitted` intent would re-invoke `curyo_confirm_ask_transactions` with the same `(operationKey, transactionHashes)`. Fix returns the existing record (with the same response shape the caller saw on first success) when `intent.status === "submitted"` instead of re-calling the MCP tool.

---

## Low

### L-1 — `qualifyRound` / `advanceQualificationCursor` are not `nonReentrant`
✅ **Fixed in `81e7f050`**

- **File:** `packages/foundry/contracts/QuestionRewardPoolEscrow.sol:687, 692`.
- Same shape as M-1, lower severity because these don't move funds directly. Restoring `nonReentrant` aligns with the CR-1 policy.

### L-5 — Advisory-vote ciphertext metadata mismatch was treated as a permanent failure
✅ **Fixed in `e5aedf74`**

- **File:** `packages/keeper/src/keeper.ts:349-379` (the helper) and both reveal call sites.
- The keeper's `validateCiphertextMetadata` now returns a `permanent` flag and the callers only invoke `markPermanentDecryptFailure` when it's `true`. Permanent → structurally-unparseable AGE armor (`malformed tlock ciphertext metadata`). Transient → either missing on-chain fields (Ponder lag / partial load) or a `targetRound` / `drandChainHash` mismatch (Ponder may be serving a stale record; once the indexer corrects itself the retry can succeed). The mismatched-metadata test was updated to expect `permanent: false`; the malformed-envelope tests stay `permanent: true`.

### L-6 — `ws@7.5.10` was still in the resolution tree
✅ **Fixed in `db024408`**

- **Files:** `package.json` (resolutions block), `yarn.lock`.
- Added three `ws@^7.x` resolution entries pointing at `8.20.1` (the same target the workspace already uses for the 8.x branch). `yarn install` removed the entire `ws@^7.x` block from `yarn.lock`; the remaining `ws@npm:8.20.1, ws@npm:^8.19.0, ws@npm:^8.5.0` entry is the only ws version in the resolved tree.

---

## Informational / pre-launch checklist

### N-1 — Drand chain-hash enforcement in keeper is correct (false-alarm verified)
One of the trust-boundary agent's Critical findings claimed the keeper decrypts before validating the drand chain hash. Verification at `packages/keeper/src/keeper.ts:911` shows `validateCiphertextMetadata` is called **before** `decryptTlockVoteCiphertext` (line 933), and the function compares both `metadata.targetRound` and `metadata.drandChainHash` against the on-chain commit. The flow is sound. Recorded here so future audit passes don't re-flag.

### N-2 — Block-timestamp cache drift bound (M-7 follow-up)
PR #26's M-7 already tightened `MAX_BLOCK_TIME_CACHE_AGE_S` from 120s → 30s; combined with the elapsed-since-observation budget, worst-case drift is ≈60s. Reveal deadlines on this protocol are minutes-to-hours; 60s is a comfortable margin. No further change required, but consider a hard-fail rather than extrapolate path if telemetry shows the RPC-outage scenario actually occurring once you're operating.

### N-3 — Deploy script role wiring is clean
Spot-checked `packages/foundry/script/Deploy.s.sol:160-389`. The major upgradeable contracts (`RoundVotingEngine`, `RoundRewardDistributor`, `QuestionRewardPoolEscrow`, `FeedbackBonusEscrow`) grant `DEFAULT_ADMIN_ROLE` directly to `governance` in their `initialize` calls; the deployer never holds those admin roles. Where the deployer is granted scoped roles (`CONFIG_ROLE`, `PAUSER_ROLE`, `ADMIN_ROLE`, `SEEDER_ROLE`, `MINTER_ROLE`) for bootstrapping, the script renounces them in the `!isLocalDev` branch (lines 363-388). The role surface after a production deployment matches the design.

### N-4 — Storage `__gap` arrays present on all upgradeable contracts
`RoundVotingEngine`, `ContentRegistry`, `ProtocolConfig`, `QuestionRewardPoolEscrow`, `RoundRewardDistributor`, `FeedbackBonusEscrow` all carry `uint256[N] private __gap` at the end of their storage layout. Future upgrades can add variables without disturbing the existing layout. (Sanity-check the gap sizes against the storage-layout CI gate when you add fields.)

### N-5 — TimelockController delay of 2 days is a deliberate decision worth confirming
`packages/foundry/script/Deploy.s.sol:33` — `TIMELOCK_MIN_DELAY = 2 days`. On the shorter end of the industry range (Compound: 2 days; Uniswap: 2 days; many newer protocols: 7-14 days). Enough time for users to exit positions that might be affected by an unfavorable proposal but too short for international holiday weekends or low-attention periods. **Decide deliberately whether 2 days is right for v1.** Easy to change pre-deploy; very expensive to change post-deploy.

---

## Dropped findings (re-verification did not hold up)

These claims surfaced from agents but did not survive verification. Documenting so the same paths don't get re-flagged on the next pass.

| ID | Why dropped |
| -- | ----------- |
| (none from this revision were dropped — all five fixes landed) | |
| **M-3** "Typed-data signed message not bound to `intent.payloadHash`" | **False positive.** The x402-native flow uses EIP-3009 `ReceiveWithAuthorization` whose `nonce` is computed by `X402QuestionSubmitter.computeX402QuestionPaymentNonce(...)` from the *full* question payload (title, description, salt, reward terms, round config, etc.). The on-chain `submitQuestionWithX402Payment` at `X402QuestionSubmitter.sol:88-107` re-computes that nonce from the submitted payload and reverts with `"Bad nonce"` on mismatch. So a backend can't display payload A and have the user sign a nonce that submits payload B — the on-chain check rejects it. The audit agent didn't trace the nonce-derivation chain. For the `wallet_calls` path, PR #26's C-2 already added on-page selector decoding. Both signing paths are bound. |
| **M-4** "Keeper acts on possibly-unfinalized Ponder state" | **False positive + impossible-to-fix-as-suggested.** Two issues with the original finding: (1) Ponder 1.x (`packages/ponder/node_modules/ponder/dist/types/config/index.d.ts`) does **not expose a user-configurable finality / required-confirmations field** on `NetworkConfig` — only `chainId`, `transport`, `pollingInterval`, `maxRequestsPerSecond`, `disableCache`. The suggested fix (a) isn't available. (2) Suggested fix (b) — "have the keeper additionally verify each commit it's about to reveal exists on-chain" — is **already implemented**: the keeper reads commit data via `publicClient.readContract({ functionName: "commitRevealData" })` at `keeper.ts:894, 1098, 1454`, and Ponder-served ciphertext bytes are validated against the on-chain `ciphertextHash` at `keeper.ts:441`. A reorg just causes the next on-chain read to skip the orphaned commit; the worst case is a wasted gas + revert, not silent corruption. |
| **L-2** "WorldID revocation indexing-lag exposure window" | **Negligible practical impact.** The Ponder consumer at `packages/ponder/src/api/routes/correlation-routes.ts:137` reads `raterHumanCredential.revoked`, which has a few-second indexing lag after the on-chain revocation event. For an attacker to profit from this they'd need (a) someone *else's* credential revoked + (b) settlement happening within the indexing window. But the only actor who can both trigger settlement and benefit from "still treated as live" is the revoked rater themselves, and revocation is a *removal* of privileges — there's no self-revoke-to-profit path. The lag is benign for the realistic scenarios. |
| **L-3** "Keeper does not verify its signing key has the expected on-chain role at startup" | **False positive.** None of the keeper-callable functions on `RoundVotingEngine` (`revealVoteByCommitKey`, `settleRound`, `cancelExpiredRound`, `finalizeRevealFailedRound`, `refreshRbtsSeed`) are role-gated — they're intentionally permissionless. There is no role to check. The keeper just needs gas, which is already (deliberately) treated as a warn-not-fail runtime concern with graceful degradation (see existing tests `index.test.ts:188-200, 203-219`). Implementing a hard-fail startup balance check would reverse that design intent. |
| **L-4** "Keeper decrypt-failure tracker is not persisted across restarts" | **Dropped (scope).** `packages/keeper/package.json` lists no database dependency; the keeper has no persistent storage layer. Persisting the failure set would require introducing a DB client (sqlite / pglite / postgres) plus a schema and migration — an architectural addition disproportionate to the operational benefit. The in-memory LRU is appropriate for a stateless service that should restart cleanly on crash. |
| "Drand chain hash not enforced before decryption" (claimed Critical) | The check is at `keeper.ts:911`, *before* the decrypt call at `:933`. See N-1. |
| "Wall-clock drift up to 60s is Critical" | M-7 in PR #26 already addressed this. See N-2. |
| "ClusterPayoutOracle optimistic root is High" | By-design optimistic oracle with a 7-day ARBITER veto window (`FINALIZATION_VETO_WINDOW`). |
| "X402 authorization not signature-verified" | `prepareAgentSigningIntent` forwards the `paymentAuthorization` to the MCP tool, which is the authoritative verifier; the signing-intent layer is intentionally not a verifier. |
| "viem 2.39.0 is critically outdated (Aug 2024)" | Today is 2026-05-22; viem 2.x has continued patch releases. The exact-version pin is a workspace policy decision rather than a security gap. |
| "Axios resolution `^1.12.2` → 1.16.0 is downgrade to insecure" | 1.16.0 is *higher* than the agent's claimed-safe 1.7.x. The version-ordering claim is factually wrong. |
| "Slither action `crytic/slither-action@<sha> # v0.4.2` is pinned to a tag" | It is SHA-pinned; the trailing `# v0.4.2` is a comment. |
| "Tailwind 4.1.3 is bleeding-edge from May 2025" | Today is 2026-05-22. The version has been out for ~12 months. |
| "Foundry v1.5.1 is from May 2024 and outdated" | Pinned via `setup-foundry` action; current Foundry releases are evaluated by the team in a separate cadence. Not a security gap unless a known CVE in 1.5.1 exists. |
| "PostgreSQL test creds are hardcoded" | Inside an ephemeral CI Postgres container, this is standard. The credentials never leave the CI worker. |
| "CSP `'unsafe-inline'` in dev is a risk" | The branch is gated on `isDev`. Production CSP does not include it. |
| "openRound regression is High" | Downgraded to **Medium (M-1)** in revision 2 and now fixed in `7a1d50a3`. |
| "Hardhat test private key in `.github/workflows/e2e.yaml`" | Well-known test mnemonic key, intentional for ephemeral CI chains. Documented in the prior audit (L-11). |
| "Foundry binary not SHA-pinned in setup action" | Removed in revision 2 — the install path uses foundry-toolchain's own scripts, and SHA-pinning the installer doesn't actually verify the resulting `forge` binary. |

---

## Pre-launch checklist suggestions

Pulled out separately as a launch-readiness gate. Not vulnerabilities; just decisions worth being deliberate about before the first deploy.

1. ✅ **Restore `nonReentrant` on the two contract paths (M-1, L-1)** — done.
2. ✅ **Tighten the agent-signing flow (M-2)** — done; M-3 was reconsidered as bound at the on-chain layer.
3. ✅ **Trust-boundary review of keeper ↔ Ponder ↔ chain** — done; the keeper already reads on-chain via RPC and only treats Ponder as a ciphertext cache validated against the on-chain hash.
4. **Confirm the TimelockController delay (N-5)** — `2 days` is a defensible default but is a load-bearing decision; have someone with skin in the game initial it.
5. **Decide the governance multisig composition before generating the production deploy address** — the deploy script grants `DEFAULT_ADMIN_ROLE` to `governance` and renounces deployer roles; `governance` will be whichever address you pass in. Misconfiguring this is the single biggest deployment hazard for a system structured this way.
6. **Re-run the storage-layout CI gate (N-4) immediately before deploying** — gaps are present; just confirm none have been shrunk by a recent commit you haven't reviewed.
7. **Update the WorldID router constants** in `Deploy.s.sol` to the verified production addresses from the [World Address Book](https://docs.world.org/world-id/reference/address-book) and confirm the live-deployment assertion at `:195` passes against the chosen chain.

---

## Revision history

- **2026-05-22 11:00 UTC (commit `21740478`).** Initial publication. Framed findings against a "live system" lens.
- **2026-05-22 14:00 UTC (commit `2301d08d`).** Recalibrated against the "nothing is deployed yet" framing. H-1 downgraded to M-1; M-1 downgraded to L-1; added the pre-launch checklist; added N-3, N-4, N-5 to cover the deploy-script / storage-layout / timelock-delay items that pre-deployment makes important.
- **2026-05-22 ~17:00 UTC (this revision).** Verified each finding individually. Five fixes landed (M-1 `7a1d50a3`, M-2 `8743d3f0`, L-1 `81e7f050`, L-5 `e5aedf74`, L-6 `db024408`). Five items (M-3, M-4, L-2, L-3, L-4) dropped on re-verification with specific cross-checks documented in the dropped-findings table. Remaining: 0 Critical, 0 High, 2 Medium fixed, 3 Low fixed, 5 Informational.

Smart-contract findings outside this report's scope are tracked in the existing per-pass reports in the working tree (the May-21 audit covers the bulk).
