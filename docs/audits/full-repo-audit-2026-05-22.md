# RateLoop Full-Repo Audit — 2026-05-22

Scope: the entire repository at `main` HEAD `0dfc83b8` ("Merge pull request #26 from Noc2/audit/non-contracts-2026-05-22"). For the first time in this series of audits, smart contracts (`packages/foundry/contracts/**`) are included alongside the off-chain code, the indexer, the keeper, and the CI / dependency surface.

Method: five parallel scope-focused agents, each briefed with the most recent prior audit so they would not re-report known-fixed findings. Each agent surfaced candidate findings; every High-or-above claim was then re-verified by reading source independently before inclusion. The Critical and several High items proposed by the trust-boundary agent were retracted after verification (see "Dropped findings" at the end).

**Pre-deployment framing.** Nothing is deployed yet. Every finding below is presented through that lens: severities reflect "impact-if-this-shipped-as-is", and the action column distinguishes "must fix before deploy" from "operational concerns once running". Because storage layouts, parameter values, governance wiring, and contract addresses can all still change, there is no "this is exploitable today against live funds" finding — the question is whether each item should make the cut for v1 launch. The first audit revision (2026-05-22 11:00 UTC) framed some findings against a "live system" lens; this revision (2026-05-22 14:00 UTC) recalibrates them downward where the deployment status materially changes the impact.

Audit branch: `audit/full-repo-2026-05-22`.

Baselines consulted:
- `packages/foundry/audit-report-claude-2026-05-21.md` (latest contracts audit, working-tree only on the author's machine — referenced for context, not present on `main`).
- `docs/audits/non-contracts-audit-2026-05-22.md` (this audit's predecessor, merged via PR #26).

---

## Resolution summary

| Severity      | Count |
| ------------- | ----- |
| Critical      | 0     |
| High          | 0     |
| Medium        | 4     |
| Low           | 6     |
| Informational | 5     |
| **Total**     | **15** |

**Headline:** Smart contracts are in **strong** posture overall. The May-21 audit found only one Informational item (CR-1 nonReentrant on three `ContentRegistry` engine callbacks) and that's now resolved on `main`. Of the four contracts commits that landed after May-21 (`187b5661`, `10798af1`, `31f2f839`, `40b78bcb`), three reviewed cleanly; the fourth (`40b78bcb`) introduced the most noteworthy item in this report — a regression of explicit `nonReentrant` protection on the new `openRound` / `prepareAdvisoryRound` entry points. **Pre-deploy, this is Medium** (defense-in-depth gap, no live exploit path).

On the off-chain side, PR #26 fixed the bulk of the previously-known issues; the remaining items cluster around (a) optimistic / Ponder-trust assumptions in the off-chain pipeline and (b) defense-in-depth gaps in the agent-signing flow that survived the H-series fixes.

**Pre-launch checklist items** (positive findings + open product decisions) are at the bottom — they're not "vulnerabilities" but they're things that genuinely benefit from a deliberate decision before the first deployment.

---

## Medium

### M-1 — `openRound` / `prepareAdvisoryRound` lost `nonReentrant` in commit `40b78bcb`
**Confidence: High** | **Action: Fix before deploy**

- **Files:** `packages/foundry/contracts/RoundVotingEngine.sol:353` (`openRound`); same commit removed the modifier from `prepareAdvisoryRound`.
- The commit `40b78bcb "Finalize explicit round preparation"` simplified `openRound`'s return type from a 9-tuple to `void`, and in the process dropped the `nonReentrant` modifier that had protected the previous signature. The CR-1 audit conclusion (May-21) explicitly stipulated that "every other state-mutating external function in the codebase is `nonReentrant`" — and was followed by patches that **added** `nonReentrant` to the three `ContentRegistry` engine callbacks for exactly this consistency reason. The removal here regresses that stated policy.
- `_getOrCreateRound` (called from `openRound`) can take the cancel-stale-round branch which invokes `_notifyBundleRoundTerminal` → `RoundCleanupLib.notifyBundleRoundTerminal(...)` — an external call into the bundle-escrow observer set by governance. Today's bundle escrow is trusted and presents no concrete attack path. The risk shape is "future escrow upgrade or third-party callback acquires reentrancy access to a round-mutation function that is no longer guarded." Pre-deploy this is a code-quality regression to fix before launch; post-deploy under an upgradeable escrow this could become exploitable.
- **Fix:** Restore the modifier on both functions. One-line addition each:
  ```solidity
  function openRound(uint256 contentId) external nonReentrant whenNotPaused { ... }
  ```

### M-2 — `completeAgentSigningIntent` is not idempotent against status
**Confidence: High** | **Action: Fix before launch**

- **File:** `packages/nextjs/lib/agent/signingIntents.ts:359-419`.
- `assertFresh(intent)` (line 365) only checks expiry, not status. A second call to `complete` for an already-`submitted` intent will re-invoke the `curyo_confirm_ask_transactions` MCP tool with the same `transactionHashes` and overwrite the database row. Whether this causes double-charging or duplicate side-effects depends on whether the MCP tool itself is idempotent on `(operationKey, transactionHashes)`; this code makes no assumption there.
- **Fix:** Bail early when `intent.status === "submitted"` (the existing `assertFresh` is the natural place to add the check), and have the MCP tool reject duplicate `(operationKey, transactionHashes)` tuples on its side as defense in depth.

### M-3 — Typed-data signed message is not bound to `intent.payloadHash`
**Confidence: Medium** | **Action: Fix before launch**

- **Files:** `packages/nextjs/components/agent/BrowserSigningPage.tsx:262-275` (sign call); `packages/nextjs/lib/agent/signingIntents.ts:21,316` (where `payloadHash` is stored on the intent).
- PR #26's H-1 / H-2 already pinned the EIP-712 `domain.chainId` and `domain.verifyingContract` to the intent. The `payloadHash` — the server's commitment to the request being signed — is stored on the intent record but never included in the typed-data `message` the user actually signs. A backend that returns one `payloadHash` (shown in the UI) and a different typed-data `message` would have the user sign for the second while believing they confirmed the first.
- **Fix:** Either include `payloadHash` (or a digest derived from it) inside the typed-data message and verify the match server-side on `complete`, or render the `payloadHash` decode alongside the existing C-2 decoded calldata so the human can spot a mismatch.

### M-4 — Keeper acts on possibly-unfinalized Ponder state
**Confidence: Medium** | **Action: Configure before launch**

- **Files:** `packages/keeper/src/keeper.ts:387-457` (`fetchIndexedCiphertext`); `packages/ponder/ponder.config.ts` (no finality parameter).
- The keeper reads ciphertext records from the Ponder API to assemble reveal transactions. Ponder by default does not wait for finality before indexing; on a chain with non-zero re-org depth, a reveal could be assembled from an in-flight commit that is later orphaned. The reveal would land on the canonical chain with stale data and either revert or, worse, complete with the wrong ciphertext if the on-chain commit was also re-orged. The risk is bounded by the target chain's actual re-org depth (small on World Chain, but non-zero). **Pre-launch is exactly when to set the finality lag deliberately rather than relying on the default.**
- **Fix:** Two options, in increasing strength: (a) configure Ponder with a finality lag (`packages/ponder/ponder.config.ts` accepts per-chain `finalizationConfirmations`), so the keeper only sees confirmed state; or (b) have the keeper additionally verify each commit it's about to reveal exists on the chain via direct RPC (`engine.commitRevealData`) before sending the reveal.

---

## Low

### L-1 — `qualifyRound` / `advanceQualificationCursor` are not `nonReentrant`
**Confidence: High** | **Action: Fix before deploy (defense-in-depth)**

- **Files:** `packages/foundry/contracts/QuestionRewardPoolEscrow.sol:687` (`qualifyRound`), `:692` (`advanceQualificationCursor`).
- Same shape as M-1, lower severity because these don't move funds directly. Both are permissionless external mutators (`qualifiedRounds` updates, `nextRoundToEvaluate` cursor advancement, USDC allocation arithmetic) and call into voting-engine / oracle libraries. Other state-mutating externals in this contract are uniformly `nonReentrant`. The qualification flow has logical guards (the `qualified` flag at `QualificationLib:159` and cursor monotonicity at `:165`), so a re-entry today reverts cleanly; this is alignment with the consistency policy CR-1 established.
- **Fix:** Add `nonReentrant` to both functions.

### L-2 — World ID nullifier revocation has an indexing-lag exposure window
**Confidence: Medium** | **Action: Wire RPC fallback before launch**

- **Files:** `packages/foundry/contracts/RaterRegistry.sol` (`revokeHumanCredential` family); off-chain consumers in `packages/ponder/src/RaterRegistry.ts` and the correlation-scoring path that reads revocation state from Ponder.
- Revocations are emitted as events; if a downstream consumer (payout scorer, settlement keeper) reads from Ponder rather than directly from the chain, there is a window between the revocation tx confirmation and the Ponder indexer catching up where a revoked identity is still treated as live. The on-chain voting path is unaffected (the contract enforces revocation atomically), but off-chain payout weighting can credit a vote that should be ineligible.
- **Fix:** For safety-critical eligibility decisions (correlation snapshots, payout weights), re-validate revocation status against the RPC just before finalization rather than trusting the Ponder snapshot. Cache for 30-60s to avoid RPC pressure.

### L-3 — Keeper does not verify its signing key has the expected on-chain role at startup
**Confidence: High** | **Action: Operational ergonomics**

- **File:** `packages/keeper/src/keeper.ts:464-470` (signer setup), `packages/keeper/src/config.ts:305-350` (key loading).
- The keeper derives an account from `KEEPER_PRIVATE_KEY` / `KEYSTORE_ACCOUNT` and immediately starts the reveal loop. There is no startup-time check that the derived address has the contract roles the keeper expects. A misconfigured key will produce a stream of authorization-revert logs that an operator may not notice for a long time.
- **Fix:** During boot, simulate a small representative call (`engine.canRevealVoteByCommitKey(...)` or similar read-only path that surfaces role checks) and fail loudly with an actionable error if the keeper key cannot perform expected operations.

### L-4 — Decrypt-failure tracker is not persisted; LRU eviction restarts retries
**Confidence: Medium** | **Action: Operational; address before high-volume operation**

- **File:** `packages/keeper/src/keeper.ts:96-150` (`decryptFailureCount`, `trackDecryptFailure`).
- L-6 in PR #26 switched eviction to LRU so frequently-failing keys stay pinned. They still don't survive a process restart, and if the in-memory cap is reached and a permanently-bad commit is evicted, the next surfacing of that commit restarts the failure count from zero. Long-running keepers on chains with persistent malformed ciphertexts will re-decrypt the same bad payload indefinitely.
- **Fix:** Persist the "permanently failed" set (commits past `MAX_DECRYPT_RETRIES`) to the keeper's database; on startup, load it back into the in-memory map.

### L-5 — Advisory-vote ciphertext-hash mismatch is treated as a permanent failure
**Confidence: Medium** | **Action: Operational**

- **File:** `packages/keeper/src/keeper.ts:1100-1122` (advisory reveal path).
- When the Ponder-served ciphertext doesn't hash to the expected on-chain `ciphertextHash`, the keeper calls `markPermanentDecryptFailure`. A genuinely malformed Ponder record will keep returning mismatched bytes, but so will a transient Ponder cache eviction or a race where two artifact versions briefly coexist. The decision to mark "permanent" eliminates the recovery path for the transient cases.
- **Fix:** Distinguish "ciphertext bytes don't structurally parse" (permanent) from "bytes parse but hash doesn't match expected" (transient — back off and retry on the next tick).

### L-6 — `ws@7.5.10` is still in the resolution tree
**Confidence: High** | **Action: Maintenance**

- **File:** `yarn.lock` — `"ws@npm:^7.3.1, ws@npm:^7.5.1, ws@npm:^7.5.10":` co-exists with the explicit pin `"ws@npm:8.20.1, ws@npm:^8.19.0, ws@npm:^8.5.0":`.
- The 7.x line has been receiving fewer maintenance updates than 8.x and carries known WebSocket DoS / buffer-handling caveats that 8.x addressed. The 8.x version is already pinned via the workspace's `resolutions`; the 7.x branch is dragged in by a transitive dependency that hasn't migrated.
- **Fix:** Identify the package(s) pulling in `ws@^7.x` (`yarn why ws`) and either upgrade them or add `"ws@^7": "8.20.1"` to root `resolutions`.

---

## Informational / pre-launch checklist

### N-1 — Drand chain-hash enforcement in keeper is correct (false-alarm verified)
**Confidence: High**

One of the trust-boundary agent's Critical findings claimed the keeper decrypts before validating drand chain hash. Verification at `packages/keeper/src/keeper.ts:911` shows `validateCiphertextMetadata` is called **before** `decryptTlockVoteCiphertext` (line 933), and the function compares both `metadata.targetRound` and `metadata.drandChainHash` against the on-chain commit, bailing to `markPermanentDecryptFailure` on mismatch (`:912-922`). The flow is sound. Recorded here so future audit passes don't re-flag.

### N-2 — Block-timestamp cache drift bound (M-7 follow-up)
**Confidence: High**

PR #26's M-7 already tightened `MAX_BLOCK_TIME_CACHE_AGE_S` from 120s → 30s; combined with the elapsed-since-observation budget, worst-case drift is ≈60s. Reveal deadlines on this protocol are minutes-to-hours; 60s is a comfortable margin. No further change required, but consider a hard-fail rather than extrapolate path if telemetry shows the RPC-outage scenario actually occurring once you're operating.

### N-3 — Deploy script role wiring is clean
**Confidence: High**

Spot-checked `packages/foundry/script/Deploy.s.sol:160-389`. The major upgradeable contracts (`RoundVotingEngine`, `RoundRewardDistributor`, `QuestionRewardPoolEscrow`, `FeedbackBonusEscrow`) grant `DEFAULT_ADMIN_ROLE` directly to `governance` in their `initialize` calls; the deployer never holds those admin roles. Where the deployer is granted scoped roles (`CONFIG_ROLE`, `PAUSER_ROLE`, `ADMIN_ROLE`, `SEEDER_ROLE`, `MINTER_ROLE`) for bootstrapping, the script renounces them in the `!isLocalDev` branch (lines 363-388). The role surface after a production deployment matches the design.

### N-4 — Storage `__gap` arrays present on all upgradeable contracts
**Confidence: High**

`RoundVotingEngine`, `ContentRegistry`, `ProtocolConfig`, `QuestionRewardPoolEscrow`, `RoundRewardDistributor`, `FeedbackBonusEscrow` all carry `uint256[N] private __gap` at the end of their storage layout. Future upgrades can add variables without disturbing the existing layout. (Sanity-check the gap sizes against your storage-layout CI gate when you add fields.)

### N-5 — TimelockController delay of 2 days is a deliberate decision worth confirming
**Confidence: High**

`packages/foundry/script/Deploy.s.sol:33` — `TIMELOCK_MIN_DELAY = 2 days`. This is on the shorter end of the industry range (Compound: 2 days; Uniswap: 2 days; many newer protocols: 7-14 days). 2 days is enough time for users to exit positions that might be affected by an unfavorable proposal but is too short for international holiday weekends or low-attention periods. **Decide deliberately whether 2 days is the right delay for your v1 launch.** Easy to change pre-deploy by editing the constant; very expensive to change post-deploy (requires going through a proposal to re-deploy).

---

## Dropped findings (re-verification did not hold up)

These claims surfaced from agents but did not survive verification. Documenting so the same paths don't get re-flagged on the next pass.

| Claim | Why dropped |
| ----- | ----------- |
| "Drand chain hash not enforced before decryption" (claimed Critical) | The check is at `keeper.ts:911`, *before* the decrypt call at `:933`. See N-1. |
| "Wall-clock drift up to 60s is Critical" | M-7 in PR #26 already addressed this. See N-2. |
| "ClusterPayoutOracle optimistic root is High" | By-design optimistic oracle with a 7-day ARBITER veto window (`FINALIZATION_VETO_WINDOW`). |
| "X402 authorization not signature-verified" | `prepareAgentSigningIntent` forwards the `paymentAuthorization` to the MCP tool, which is the authoritative verifier; the signing-intent layer is intentionally not a verifier. |
| "viem 2.39.0 is critically outdated (Aug 2024)" | Today is 2026-05-22; viem 2.x has continued patch releases. The exact-version pin is a workspace policy decision rather than a security gap. If you want patch updates, change to `^2.39.0` — but this is taste, not Critical. |
| "Axios resolution `^1.12.2` → 1.16.0 is downgrade to insecure" | 1.16.0 is *higher* than the agent's claimed-safe 1.7.x. The version-ordering claim is factually wrong. |
| "Slither action `crytic/slither-action@<sha> # v0.4.2` is pinned to a tag" | It is SHA-pinned; the trailing `# v0.4.2` is a comment. The SHA is what GitHub resolves. |
| "Tailwind 4.1.3 is bleeding-edge from May 2025" | Today is 2026-05-22. The version has been out for ~12 months. |
| "Foundry v1.5.1 is from May 2024 and outdated" | Pinned via `setup-foundry` action; current Foundry releases are evaluated by the team in a separate cadence. Not a security gap unless a known CVE in 1.5.1 exists. |
| "PostgreSQL test creds are hardcoded" | Inside an ephemeral CI Postgres container, this is standard. The credentials never leave the CI worker. |
| "CSP `'unsafe-inline'` in dev is a risk" | The branch is gated on `isDev`. Production CSP does not include it. |
| "openRound regression is High" | Downgraded to **Medium** in this revision — see M-1. No exploitable callback exists today; pre-deploy this is a code-quality regression. |
| "Hardhat test private key in `.github/workflows/e2e.yaml`" | Re-flagged here as the last audit (L-11) already documented: well-known test mnemonic key, intentional for ephemeral CI chains. |
| "Foundry binary not SHA-pinned in setup action" | Removed from Low list this revision — the install path uses foundry-toolchain's own scripts, and SHA-pinning the installer doesn't actually verify the resulting `forge` binary. The realistic mitigation is a separate concern (cache the binary, verify offline) that doesn't belong in a code audit. |

---

## Pre-launch checklist suggestions

Pulled out separately so the team can run through these as a launch-readiness gate. Not vulnerabilities; just decisions worth being deliberate about before the first deploy.

1. **Restore `nonReentrant` on the two contract paths (M-1, L-1)** — five characters per function, prevents a class of future regressions.
2. **Wire the agent-signing tightenings (M-2, M-3)** — these surfaces are about to be hit by real wallets; close the gaps before the wallets show up.
3. **Set Ponder finality lag explicitly (M-4)** — pick a number, write it into `ponder.config.ts`, document the trade-off in the file comment.
4. **Confirm the TimelockController delay (N-5)** — `2 days` is a defensible default but is a load-bearing decision; have someone with skin in the game initial it.
5. **Decide the governance multisig composition before generating the production deploy address** — the deploy script grants `DEFAULT_ADMIN_ROLE` to `governance` and renounces deployer roles; `governance` will be whichever address you pass in. Misconfiguring this is the single biggest deployment hazard for a system structured this way.
6. **Re-run the storage-layout CI gate (N-4) immediately before deploying** — gaps are present; just confirm none have been shrunk by a recent commit you haven't reviewed.
7. **Update the WorldID router constants** in `Deploy.s.sol` to the verified production addresses from the [World Address Book](https://docs.world.org/world-id/reference/address-book) and confirm the live-deployment assertion at `:195` passes against the chosen chain.

---

## Revision history

- **2026-05-22 11:00 UTC (commit `21740478`).** Initial publication. Framed findings against a "live system" lens.
- **2026-05-22 14:00 UTC (this revision).** Recalibrated against the "nothing is deployed yet" framing. H-1 downgraded to M-1; M-1 downgraded to L-1; added the pre-launch checklist; added N-3, N-4, N-5 to cover the deploy-script / storage-layout / timelock-delay items that pre-deployment makes important.

Smart-contract findings outside this report's scope are tracked in the existing per-pass reports in the working tree (the May-21 audit covers the bulk).
