# RateLoop Smart Contracts — Eighth-Pass Multi-Agent Design Review

**Date:** 2026-07-03
**Branch:** `main`
**Head reviewed:** `2d199b1e5` ("test(bundle): expect pending claim preview"); last smart-contract change at this head is `6a15330cb` ("fix(protocol): trim launch oracle bytecode").
**Requested by:** the repository owner, on his own work, to keep improving the contracts.

## Provenance & authorship

Git history re-confirmed single-author development: all substantive commits resolve to David Hawig (`davidhawig@gmail.com`, also committing as `Noc2`; remote `git@github.com:Noc2/RateLoop.git`), with only `Cursor Agent` (16) and `dependabot[bot]` (9) as other committers. Every finding below is about the owner's own design.

### Which model did what

The owner asked for this to be recorded explicitly.

- **All research and analysis in this pass was performed by Claude Fable 5**: the lead orchestrator, all three parallel review subagents (identity/ban + feedback/x402; RBTS weight + epoch machinery; oracle/launch/bundle/recovery), the lead's independent re-verification in source of the two most consequential fix claims (the RBTS timeout rejection-guard and the RaterRegistry ban-resolution rewrite) plus the Merkle payout-leaf construction, and the external web research (OpenZeppelin 5.x Governor/ERC20Votes advisories, Merkle second-preimage literature).
- **No fallback to Claude Opus 4.8 (or any other model) was needed or used at any point in this pass.** All three subagents completed and returned full reports; no transport or capability failures occurred.
- Tooling caveat, unrelated to model choice: `forge` is not available in the review sandbox, so the Foundry suite was not re-run here. The seventh-pass review recorded the internal eleventh-pass audit passing `forge test --offline` (1845 passed, 0 failed); the six contract commits since then ship their own regression tests but should be re-verified locally with `forge test`, `make check-contract-sizes`, and `make check-storage-layouts` before deployment.

## Scope and calibration

This is a verification-and-hunt pass. Between the owner-authored seventh-pass review (`docs/design-review-seventh-pass-2026-07-03.md`, findings 7P-1…7P-12) and this head, six contract commits landed that remediate that pass — `92ff53d09` (rater-registry ban fail-close), `f1af839b2` (feedback one-shot bind), `872bfb80b` (launch/oracle controls), `d8bca9753` (RBTS scoring weights), `1035ca504` (bundle claim preview), `6a15330cb` (launch/oracle bytecode trim) — alongside earlier commits (`f073d9919`, `01541baf3`, `51740f329`, `f6abfc797`, `22ff5e3c1`) that target my sixth-pass findings 6P-1…6P-4. The three subagents each verified a cluster of these fixes at the cited lines and then hunted for bugs the fixes might have introduced. The numbered `docs/security-audit-smart-contracts-post-fix-*.md` files were removed from the tree during this window; their findings are treated as accepted-as-fixed background.

Accepted-design constraints from `AGENTS.md` were honored and not re-litigated: optimistic `ClusterPayoutOracle` payout roots with 5-USDC anti-spam challenge bonds and governance arbitration; the 60-minute `revealGracePeriod`; fresh redeploy (storage-layout movement not treated as an upgrade finding); stale-engine fail-closed rotation; the 1-hour finality launch posture as a deliberate product decision; single-task RBTS truthfulness as BNE-only (accepted residual). Findings are flagged only where behavior is internally inconsistent with the protocol's own docs or where a fix is incomplete.

## Summary

**The contract layer has converged.** Every prior-pass finding checked in this pass is remediated at HEAD, each with a regression test, and the three subagents found **no new High/Medium/Low issue** introduced by the six remediation commits. This is the first pass in the series to surface no new actionable contract finding. The remaining items are one informational asymmetry in the ban-resolution fix, a fresh cryptographic non-finding worth recording, and a short list of previously-noted items that remain open **by design** and now warrant an explicit accept-or-fix decision rather than another code change.

## Fix-verification matrix

| Prior finding | Verdict at `2d199b1e5` | Fix commit |
| --- | --- | --- |
| 7P-1 (ban resolution fail-closes only on address key; stale-canonical + provider-alias gaps) | **Fixed** — `_identityForHolder` now checks the aliased credential key, the canonical key, and the address key; derived bans propagate to address+canonical across both World-ID provider slots | `92ff53d09` |
| 7P-2 (delegate banned after activation keeps acting) | **Fixed** — `resolveRater` re-checks the delegate address-key ban at resolution and fails closed | `92ff53d09` |
| 7P-3 (feedback bonus on `Cancelled` rounds sweeps to treasury) | **Fixed** — `forfeitExpiredFeedbackBonus` refunds `pool.funder` for any non-awardable terminal state | `f1af839b2` |
| 7P-4 (`_isVerifiedAnchorBanned` short-returndata mis-decode / fail-open) | **Fixed** — requires `returndatasize()==32`, writes to free memory not scratch, reverts (fail-closed) on failure, polarity unified with `_isRaterBanned` | `872bfb80b` + `6a15330cb` |
| 7P-5 (`feedbackClosesAt` not covered by signed x402 nonce) | **Fixed** — `executeBy` added to `FeedbackBonusTerms`, bound into the one-shot nonce, enforced at execution; domain string bumped v6→v7 | `f1af839b2` |
| 7P-6 (forfeit on raw stake, reward on discounted weight) | **Fixed** — forfeit base is now the same `effectiveWeight`; symmetric discount; verified non-underflowing and budget-conserving | `d8bca9753` |
| 7P-7 (dead two-tier epoch machinery / inverted tiebreak advertised in NatSpec) | **Fixed** — 25% tier and inverted "smaller raw pool wins" tiebreak collapsed to constants, config bound retained, NatSpec re-fenced (dead code fenced, not deleted — accepted) | `d8bca9753` |
| 7P-8 (bundle claimable view returns 0 for auto-qualifiable claims; dead preview branch) | **Fixed** — view now simulates pending qualification and matches live claim math byte-for-byte; dead `reopened && unallocatedRefunded` branch deleted | `1035ca504` |
| 7P-9 (`minSlashEvidence` unvalidated) | **Fixed** — bounded `[1e6, 1_000_000e6]` in `_setSlashConfig` | `872bfb80b` |
| 7P-10 (oracle split-setter forces re-supplying `challengeWindow`) | **Fixed** — new `setOracleBondConfig(bond, recipient)` for bond-only rotation | `872bfb80b` |
| 7P-11 (legacy sweep event names recipient `treasury` but pays `governance`) | **Fixed** — event arg renamed `recipient` | `872bfb80b` |
| 7P-12 (`releaseBond` pausability asymmetry) | **Fixed** — `whenNotPaused` dropped from `releaseBond`; release/slash windows are time-complementary so no unconditional-release conversion remains | `872bfb80b` |
| 6P-1 (rating cursor wedges after engine rotation) | **Fixed** — the no-pending skip branch now reads `roundVotingEngine[roundId]` (per-round owning engine), falling back to the current engine only when unset | `01541baf3` |
| 6P-2 (repeated reopen re-bumps `claimDeadline`) | **Fixed** — `require(!reopenedRecoveredRound[...])` guard added on both single-pool and bundle reopen | `51740f329` |
| 6P-3 (RBTS timeout atomically unlocked by rejecting/invalidating a stalled snapshot) | **Fixed** — timeout branch now calls `_requireNoRecentRejectedRbtsSettlementSnapshot`, which takes the max of direct and parent-epoch rejection timestamps and requires `≥ rejectedAt + 1h`; re-verified in source by the lead | `f6abfc797` + `22ff5e3c1` |
| 6P-4 (reopen missed 3 qualifier preconditions; bundle inline hard-revert on drift) | **Fixed** — reopen now enforces drift/effective-floor/allocation via the shared preview predicate; bundle inline `require("Cluster snapshot mismatch")` replaced with a pending/false reset so refunds no longer revert on completer drift | `f073d9919` + `1035ca504` |

Lead spot-verification: I independently confirmed in source that (a) `RoundVotingEngineRbtsSettlementModule._requireNoRecentRejectedRbtsSettlementSnapshot` reads both `roundPayoutSnapshotRejectedAt` and `roundPayoutSnapshotCorrelationEpochRejectedAt` and both the direct-reject and `invalidateObjectivelyInvalidRoundPayoutSnapshot` paths record `rejectedAt`, so a same-block back-run sees `rejectedAt == now` and reverts (6P-3 genuinely closed); and (b) `RaterRegistry._identityForHolder` substitutes the banned key when any of the aliased credential key, the canonical key, or the address key is banned (7P-1 closed for the active-credential path — see the one caveat below).

## New findings

### 8P-1 (Informational, confidence Medium). The 7P-1 ban substitution is gated on `hasActiveCredential`; a verified-but-expired credential relies entirely on the downstream address-key backstop

- **Where:** `RaterRegistry._identityForHolder` (`RaterRegistry.sol:1495-1522`). The in-resolver ban substitution (check aliased credential key → canonical key → address key) executes only inside `if (hasActiveCredential)`, where `hasActiveCredential = credential.expiresAt > block.timestamp`. When a credential is `verified` but expired, the function still returns `identityKey = _canonicalHumanIdentityKey[holder]` (or the credential key) **without** any ban substitution.
- **Why it is not a clean evasion:** the downstream vote/claim gates do not trust the resolved key alone. `VotePreflightLib.validateCommittedRaterUnbanned` and `_resolveUnbannedRater` (`libraries/VotePreflightLib.sol:135-175`) each additionally check `isIdentityKeyBanned(addressIdentityKey(actor))` and `addressIdentityKey(resolved.holder)`, and the 7P-1 fix propagates derived bans to the holder's address key across both provider slots. So a banned holder with an expired credential is still caught by the address-key check — provided the derived-ban propagation recorded that holder as an owner.
- **Residual:** the defense-in-depth is asymmetric — the resolver substitutes for active credentials but delegates the expired case to a downstream address-key check that depends on the ban having been propagated to the right owner slot at ban time. That is exactly the revoke/re-attest ordering surface 7P-1 called "likely, not certain." No concrete clean evasion was constructed in this pass.
- **Fix (cheap, defense-in-depth):** run the same aliased-credential-key / canonical-key ban check unconditionally (outside the `hasActiveCredential` guard) and return the banned key if any is set, so resolution is self-consistent regardless of credential expiry. Add a regression for the verified-but-expired + banned-credential case.

## Fresh cryptographic review (Claude Fable 5, lead + web)

The `ClusterPayoutOracle` payout-root Merkle verification was reviewed against the known second-preimage / node-as-leaf attack class, since payout roots are the protocol's economic backbone. **It is implemented to best practice and is a clean non-finding:**

- `payoutWeightLeaf` (`ClusterPayoutOracle.sol:942-964`) is **double-hashed** — `keccak256(bytes.concat(keccak256(abi.encode(...))))` — the OpenZeppelin-recommended construction that makes it impossible to present a 64-byte internal node as a leaf (OZ issue #3091). The inner leaf uses `abi.encode` (not `encodePacked`), so there is no ambiguous-concatenation preimage, and it is domain-separated with `PAYOUT_WEIGHT_DOMAIN`, `block.chainid`, and `address(this)` — defeating cross-chain and cross-contract proof replay. `verifyPayoutWeight` (`:926-940`) additionally gates on consumer identity, `Finalized` status, current correlation epoch, non-zero root/weight, and the per-leaf `independenceBps ≤ BPS_DENOMINATOR` and `effectiveWeight ≤ baseWeight` bounds before calling `MerkleProof.verifyCalldata`. The epoch coverage/source-set digests (`:1200-1205`) are likewise domain-tagged.
- No OpenZeppelin Contracts 5.x Governor or ERC20Votes security advisory was found that applies to the way RateLoop uses them; RateLoop's governor customizations (forced self-delegation, disabled `delegateBySig`, dynamic quorum excluding protocol balances, proposer-suffix binding) are additive hardening over the standard base.
- Sources: [OZ MerkleProof issue #3091 (intermediate nodes reinterpreted as leaves)](https://github.com/OpenZeppelin/openzeppelin-contracts/issues/3091), [RareSkills — Merkle second-preimage in Solidity](https://rareskills.io/post/merkle-tree-second-preimage-attack), [OZ Contracts security advisories](https://github.com/OpenZeppelin/openzeppelin-contracts/security), [OZ 5.x Governance docs](https://docs.openzeppelin.com/contracts/5.x/api/governance).

## Items that remain open by design — decision requested, not another patch

None of these is a new bug; each was surfaced in a prior pass, is consistent with the current code, and is a product/documentation decision the owner should ratify explicitly before deployment.

1. **6P-5 — 1-hour frontend fee withdrawal vs. multi-day slash latency.** `FEE_WITHDRAWAL_DELAY = 1 hour` while the only slash path is the ~2-day governance timelock, so earned fees can be withdrawn days before any slash for a fresh bad-root offense executes. The README/oracle NatSpec claim that "earned-but-undelivered fees back the operator's payout-root accountability" overstates what the 1-hour posture delivers; only the 14-day stake genuinely backs fresh offenses. **Decision:** soften the doc, or freeze `completeFeeWithdrawal` while the operator has a live `Challenged` proposal.
2. **6P-6 — seed v4 residuals.** The future-block-entropy seed is grindable by a colluding Base sequencer (BLOCKHASH is a recognized weak randomness source on OP-Stack), and a coalition that can stall settlement past the EIP-2935 window (~4.5 h at Base's ~2 s blocks, not the ~27 h quoted for L1) can force a re-roll. Affects only peer/reference pairings, never the verdict or a payout forge. **Decision:** document as named trust assumptions, and/or derive re-armed blocks deterministically to remove the timing lever; drand/VRF is the clean long-term removal.
3. **7P-6 mechanism note (now code-fixed).** The forfeit/reward base asymmetry is fixed in code, but the whitepaper/SDK should still surface that independence-discounted voters carry proportionally discounted downside, so raters and frontends can reason about expected value.
4. **7P-7 dead code (now fenced).** The two-tier epoch machinery, 25% tier, inverted tiebreak, `scoringClosed` branch, and multi-epoch cleanup loop remain in the tree as fenced no-ops under the `maxDuration == epochDuration` bound. **Decision:** add the explicit `computeEpochIndex == 0`-for-all-valid-configs regression the seventh pass recommended before any future relaxation of that bound, or delete the dead paths.
5. **Governor lock cliff (fifth-pass, still open).** `castVote` reverts if the current balance is below the snapshot weight; the `min(weight, balance)` suggestion stands as either a fix or a documented behavior.
6. **Mechanism addendum (seventh pass).** The bounded leave-one-out report externality on the benchmark (largest at n = 3–10) and the exactly-costless herding equilibrium (zero spread → zero forfeits/rewards) are accepted residuals of the single-task tournament transform; worth stating in the whitepaper alongside the independence-oracle and ≥8-effective-units controls that compensate for them.

## Notable non-findings (checked, no issue)

The six remediation commits each reused existing qualifier/preview/predicate helpers rather than re-deriving math, which is what kept them from introducing drift. Specifically re-confirmed clean: the EIP-3009 one-shot nonce now binds every user-supplied and execution-time-derived field including `executeBy` (v7 domain prevents cross-version replay); the RaterRegistry ban write/clear paths are symmetric (every `_write*` has a matching `_clear*` across address key, canonical key, and both provider slots); the RBTS forfeit retains two independent ≥8-effective-unit gates and cannot underflow `stakeReturned`; per-round budget conservation holds after the base swap (Σ returns + forfeit pool = Σ stake); the bundle claimable preview matches live claim allocation byte-for-byte (cluster-oracle bundles conservatively return 0, a documented view-side limitation); the launch-oracle bytecode trim removed only visibility modifiers and refactored the anchor-ban helper, dropping no `require`/guard; `setOracleBondConfig`/`setOracleConfig`/`setOracleTimingConfig` are all CONFIG_ROLE-gated with zero-value rejection; `ConfidentialityEscrow` release/slash windows are time-complementary; and the FeedbackBonusEscrow Cancelled-round refund is single-shot and reentrancy-guarded.

## Priorities

1. **8P-1** — make the RaterRegistry ban check credential-expiry-independent (cheap defense-in-depth; the one new item this pass surfaced).
2. **6P-5 / 6P-6 / 7P-7 / governor-lock / mechanism-addendum** — ratify each as an explicit accept-or-fix decision and reconcile the docs; these are the last substantive open items and none requires a large code change.
3. Re-run `forge test`, `make check-contract-sizes`, and `make check-storage-layouts` locally at HEAD (not possible in the review sandbox) to confirm the six remediation commits' regression tests pass on a clean checkout.

---

*Prepared 2026-07-03 by a Claude Fable 5 multi-agent review at HEAD `2d199b1e5`: lead orchestrator + three parallel read-only subagents (identity/ban + feedback/x402; RBTS weight + epoch machinery; oracle/launch/bundle/recovery), all on Claude Fable 5, with lead source re-verification of the 6P-3 RBTS-timeout rejection guard, the 7P-1 ban-resolution rewrite, and the Merkle payout-leaf construction, plus Fable 5 web research on OpenZeppelin 5.x Governor/ERC20Votes advisories and the Merkle second-preimage literature. No fallback to Claude Opus 4.8 (or any other model) occurred at any point.*
