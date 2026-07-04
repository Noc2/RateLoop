# RateLoop Smart-Contract Review — Second Pass (2026-07-04)

**Scope:** `packages/foundry/contracts` (contracts, 42 libraries, interfaces, governance). Solidity 0.8.35, OpenZeppelin, transparent upgradeable proxies.
**Method:** Second-pass multi-agent + research review — 10 reviewers (incl. a dedicated fix-verification pass on the recent fix commits) → triage → adversarial verification. 18 agents, ~1.7M tokens. See [Methodology](#methodology).
**Result:** 37 raw → 7 after triage → **5 confirmed** (1 Medium, 4 Low). 2 candidates were refuted on verification.

This complements the first pass (`docs/security-review-multi-agent-2026-07-03.md`). Its focus was twofold: **verify the recent fixes** and **hunt net-new issues** in areas the first pass under-covered (library math, X402/EIP-3009, LaunchDistributionPool, AdvisoryVoteRecorder, ContentRegistry lifecycle, cross-contract invariants).

---

## Recent fixes — verified

All six confirmed first-pass findings have been remediated, and the fix-verification pass found **no regressions or adjacent gaps** in them:

| First-pass finding | Fix commit(s) | Verification |
|---|---|---|
| RL-01 stale delegate-auth eviction | `e0108b721`, `ad7e47a8d` | Complete — nonce now advances on all delegation transitions; active-delegate replacement rejected |
| RL-02 `releaseBond` not pausable | `fa5a6fd97` | Complete — `whenNotPaused` added |
| RL-03 `castVote` lockout | `1bc15eee3` | Complete — governance vote lock clamped |
| RL-05 cooldown propose/cancel bypass | `549fef0c5` | Complete — cooldown preserved across cancel |
| RL-08 equal-share BPS-vs-count divisor | `06447bff0` | Complete — fails closed on zero-weight snapshots |
| RL-09 empty-round bond release | `15408a24f` | Complete — terminal round required |

(`1b11bddd6` "preserve vote locks across proposal unlocks" also verified clean.) The higher-severity surface identified in pass 1 is closed — consistent with this pass finding only one Medium and four Low net-new issues.

---

## Summary

| ID | Severity | Conf. | Contract | Title |
|----|----------|-------|----------|-------|
| [RL2-01](#rl2-01--permissionless-replay-regresses-the-dormancy-anchor-backward) | Medium | High | ContentRegistry | Permissionless rating-settlement replay regresses `dormancyAnchorAt` backward (premature-dormancy griefing) |
| [RL2-03](#rl2-03--unlockfullearnedratercap-pays-without-counting-the-rater) | Low | High | LaunchDistributionPool | `unlockFullEarnedRaterCap` pays a rater without incrementing `eligibleRaterCount`, skewing the cap-tier curve |
| [RL2-04](#rl2-04--recoversurplus-omits-the-governance-handover-guard) | Low | High | LaunchDistributionPool | `recoverSurplus` omits the `owner()==governance` guard its sibling `withdrawRemaining` enforces |
| [RL2-06](#rl2-06--confidentiality-bond-authorization-nonce-is-not-payload-bound) | Low | High | ConfidentialityEscrow | Bond EIP-3009 authorization nonce is not payload-bound, unlike the X402 gateway's hardening |
| [RL2-07](#rl2-07--banned-last-claimant-strands-dust-in-the-rbts-voter-pool) | Low | Medium | RoundRewardDistributor | Banned last-claimant takes a truncated share instead of the pool remainder, stranding dust |

---

## Findings

### RL2-01 — Permissionless replay regresses the dormancy anchor backward
- **Severity:** Medium · **Confidence:** High · **Category:** logic-correctness
- **Location:** `libraries/ContentRegistryRatingSnapshotLib.sol:111-112`; reached via `RoundVotingEngine.sol:778-789` (`replayPendingRatingSettlement`, permissionless) and `ContentRegistry.sol:1411-1421` (`_pendingRatingSettlementReadyAt`).

**Issue.** `recordPendingRatingSettlement` unconditionally writes `content.lastActivityAt = readyAt` and `dormancyAnchorAt[contentId] = readyAt` with **no monotonic (max) guard** (`:111-112`). `readyAt` is the settling round's own `settledAt` — a fixed past timestamp for that specific round (`ContentRegistry.sol:1419`). When a round's initial settlement side-effect record reverts and is caught, `RoundRbtsSettlementCompletionLib` sets `pendingRatingSettlementReplay[contentId][roundId] = true`, and `RoundVotingEngine.replayPendingRatingSettlement` (`:778`) is **permissionless** and re-invokes the record with that old round's `settledAt`. Because the caller is `currentVotingEngine`, the out-of-order guard at `ContentRegistryRatingSnapshotLib.sol:96-103` (which only fires when `caller != currentVotingEngine && roundId > latestVotingRoundId`) is skipped for an old round, so the stale timestamp is written straight into `dormancyAnchorAt`. This contradicts the documented invariant (`ContentRegistry.sol:171-174`) that only submission, revival, and settlement move the dormancy window **forward**.

**Failure scenario.** Content C's round 1 settles at `T=10` but its `recordPendingRatingSettlement` reverts (transient engine-rotation / registry-pause window), arming the replay flag. Rounds 2..k settle over weeks, advancing `dormancyAnchorAt` to `~T=25d`. An attacker calls `replayPendingRatingSettlement(C, 1)`; the record runs with `readyAt = round 1 settledAt = T=10`, regressing `dormancyAnchorAt[C]` to `~T=10`. `markDormant` (requires `block.timestamp > dormancyAnchorAt + 30d`) now succeeds ~25 days early, forcing the submitter to burn a non-refundable 5 LREP `REVIVAL_STAKE` to revive (capped at `maxRevivals`) or lose the submission key to squatting via `releaseDormantSubmissionKey`.

**Recommendation.** Make the anchor/activity update monotonic — only advance when `readyAt` exceeds the current values:
```solidity
if (readyAt48 > content.lastActivityAt) content.lastActivityAt = readyAt48;
if (readyAt > dormancyAnchorAt[contentId]) dormancyAnchorAt[contentId] = readyAt;
```
A replay of an older round must never regress the dormancy window.

---

### RL2-03 — `unlockFullEarnedRaterCap` pays without counting the rater
- **Severity:** Low · **Confidence:** High · **Category:** accounting-precision
- **Location:** `LaunchDistributionPool.sol:504-525` (`unlockFullEarnedRaterCap` / `_payLaunchCapCatchUp`) vs `:807-814` (`eligibleRaterCount` increment) and `:914-924` (`currentRaterLaunchCap` tiers).

**Issue.** `eligibleRaterCount` — the sole input to `currentRaterLaunchCap()`'s tiering — is incremented in exactly one place (`:811-813`), guarded by `if (cap > 0)` at first assignment. When a rater's first cap assignment yields `activeCap == 0` (which happens when governance sets `unverifiedEarnedRaterCapBps == 0`, permitted by `_validateLaunchRewardPolicy`), they are marked `raterLaunchCapAssigned = true` but **not counted**. Those raters later verify and call `unlockFullEarnedRaterCap`, which sets `raterLaunchCap = fullCap` and pays real LREP via `_payLaunchCapCatchUp` (`:522`) but **never increments `eligibleRaterCount`**. So raters actively drawing from the 24M earned-rater pool are invisible to the tiering curve.

**Failure scenario.** Governance sets `unverifiedEarnedRaterCapBps = 0`. 200 unverified raters reach eligibility; each gets `activeCap = 0` and is not counted. All 200 later verify and call `unlockFullEarnedRaterCap`, drawing catch-up pay. `eligibleRaterCount` is still 0, so `currentRaterLaunchCap()` returns the top-tier `500e6` for the next rater instead of the tier the real 200+ population implies — over-allocating caps and depleting the pool faster than designed.

**Recommendation.** Increment `eligibleRaterCount` (and emit `RaterLaunchCapAssigned`) inside `unlockFullEarnedRaterCap` when a previously-uncounted assigned rater transitions to a positive drawable cap; or count every assigned rater regardless of `activeCap` and gate only the payout on `cap > 0`.

---

### RL2-04 — `recoverSurplus` omits the governance-handover guard
- **Severity:** Low · **Confidence:** High · **Category:** access-control
- **Location:** `LaunchDistributionPool.sol:409-417` (`recoverSurplus`) vs `:396-407` (`withdrawRemaining`, guard at `:398`).

**Issue.** `withdrawRemaining` requires `owner() == governance` (`:398`) before moving pool value, ensuring the valve is only usable after ownership converges to governance. `recoverSurplus` — which also transfers real LREP (the untracked surplus = `balanceOf − poolBalance`) — is `onlyOwner` but does **not** re-assert `owner() == governance`. The constructor sets `Ownable(msg.sender)` and only forces `owner → governance` in `transferOwnership`/`setGovernance`, so there is a deploy-time window where `owner == deployer != governance`.

**Failure scenario.** Immediately after construction (owner = deployer, governance = separate address), the deployer prefunds the pool via a raw ERC-20 transfer so `actualBalance > poolBalance`, then calls `recoverSurplus` to pull that surplus to an arbitrary address before the handover. `withdrawRemaining` would block this; `recoverSurplus` does not. Impact is limited to *untracked* surplus (not accounted pool funds), hence Low, but the asymmetry is a real gap.

**Recommendation.** Add `if (owner() != governance) revert InvalidAddress();` to `recoverSurplus` to match `withdrawRemaining`, or document why surplus recovery is intentionally allowed pre-handover.

---

### RL2-06 — Confidentiality bond authorization nonce is not payload-bound
- **Severity:** Low · **Confidence:** High · **Category:** consistency
- **Location:** `ConfidentialityEscrow.sol:263-295` (`postBondWithAuthorization`); contrast `X402QuestionSubmitter.sol:239-260,328-350`.

**Issue.** `X402QuestionSubmitter` requires the EIP-3009 `authorization.nonce` to **equal a deterministic hash of the entire submission payload**, making an authorization self-describing and valid only for exactly the submission the payer signed. `ConfidentialityEscrow.postBondWithAuthorization` instead accepts an **arbitrary caller-supplied nonce** and only checks `from == msg.sender`, `to == address(this)`, `value == config.bondAmount` — the `contentId` being bonded is not part of the signed authorization. This is **not third-party-exploitable** (`from == msg.sender` restricts to the payer, and USDC `_authorizationStates` prevents reuse), but it forgoes the defense-in-depth the sibling gateway relies on.

**Failure scenario.** A payer signs `(from=payer, to=escrow, value=bondAmount, nonce=N)` intending to bond content A. If two active gated contents share the same `bondAmount`, the same signed message is valid for either, so the payer's own wallet/relayer could apply it to content B by passing a different `contentId` argument. No third party can misdirect it and no double-spend occurs — the impact is caller-side parameter ambiguity, which the equivalent substitution is impossible for in `X402QuestionSubmitter`.

**Recommendation.** For parity, bind the confidentiality-bond authorization nonce to a deterministic hash including `contentId`, `bondAsset`, `bondAmount`, `chainid`, and `address(this)`, and require `authorization.nonce ==` that hash.

---

### RL2-07 — Banned last-claimant strands dust in the RBTS voter pool
- **Severity:** Low · **Confidence:** Medium · **Category:** accounting-precision
- **Location:** `RoundRewardDistributor.sol:270-284` (`_claimRbtsReward`: `surplusBlocked` branch vs last-claimant remainder at `:279-281`).

**Issue.** Voter-reward distribution uses a "last claimant gets `voterPool − claimedAmount`" remainder pattern (`:279-281`) to sweep integer-division dust. The banned-identity branch (`surplusBlocked`, `:270-277`) bypasses it: it always computes `reward = calculateVoterReward(scoreWeight, totalScoreWeight, voterPool)` (truncated) and increments the counters regardless of whether this is the last claimant. If the arithmetically-last claimant is a banned identity, they take the truncated value and the remainder dust is never routed by any claim — recoverable only via the separate permissionless `finalizeVoterRewardDust` call. No funds are lost (dust stays recoverable), so this is defense-in-depth.

**Failure scenario.** A round has 3 winning claimants; `voterPool = 100`, each `scoreWeight` 1/3 so `calculateVoterReward` truncates to 33. Two honest voters claim (66). The last claimant is banned: instead of the remainder `100 − 66 = 34` routed to protocol, the banned branch computes 33 and routes 33, leaving 1 wei stranded until `finalizeVoterRewardDust`.

**Recommendation.** In the `surplusBlocked` branch, apply the same last-claimant remainder before routing to protocol:
```solidity
reward = (claimedCount + 1 == totalRewardClaimants) ? voterPool - claimedAmount : calculateVoterReward(...);
```

---

## Appendix — raised but refuted on verification

- **Pending earned-rater launch credit permanently unfinalizable — REFUTED.** The scenario ignores the propose-time source-readiness gate: the launch-credit domain's snapshot consumer is `LaunchDistributionPool` itself, whose `roundPayoutSnapshotSourceReadyAt` (`LaunchDistributionPool.sol:990-999`) gates proposal against `creditReadyAt`, so a snapshot cannot be proposed before the credit is recorded. The permanent-revert state cannot be constructed.
- **Advisory scoring floor (`revealedLen >= 2`) below the RBTS floor (`MIN_RBTS_PARTICIPANTS = 3`) — REFUTED.** A third, stronger floor sits between the two the finding compares: `claimAdvisoryLaunchCredit` reaches the sampler only when `scored == true` and `rbtsScoreSeed != 0`, which the engine only sets after its own `>= 3` RBTS settlement floor. The 2-element collusion-determinable anchor set cannot occur.

---

## Methodology

Ten parallel reviewers: five subsystem passes (voting/settlement, oracle/payout, registries/reputation via cross-contract, ContentRegistry lifecycle, config/governance folded into cross-contract), a dedicated **library-math/precision** pass, an **X402/EIP-3009** pass, a **LaunchDistributionPool/AdvisoryVoteRecorder** pass, a **cross-contract-invariant** pass, and a **web-research** pass — plus a dedicated **fix-verification** reviewer that ran `git show` on each of the eight recent fix commits to check completeness/regressions. Triage deduped 37 → 7; one adversarial verifier per finding re-checked it against current source. 5 confirmed; 2 refuted; 0 flagged as intentional/already-fixed among survivors.

**Respected trust-model decisions (per `AGENTS.md`):** the optimistic `ClusterPayoutOracle` payout-root model; anti-spam (not payout-coverage) challenge bonds; the 60-minute `revealGracePeriod`. First-pass findings and their fixes were treated as known and excluded from re-reporting.

**Limitations.** Source-reading review, not fuzzing/formal verification; did not execute the Certora specs or Foundry suite. `RL2-01` (Medium) is the one worth prioritizing — a one-line monotonic guard closes it. The four Low items are cheap consistency/defense-in-depth hardening.
