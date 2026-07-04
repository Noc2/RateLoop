# RateLoop Smart Contract Security Review - Multi-Agent Pass 8

Date: 2026-07-04
Base revision reviewed: `9c53eb75b` on `main`
Scope: `packages/foundry/contracts`
Status: 0 critical/high findings; 1 new low finding

No code remediation is included in this report commit. This pass was run after
the pass 7 fixes landed through `9c53eb75b`.

## Methodology

- Ran three read-only reviewer passes in parallel:
  - identity, access-control, and credential surfaces:
    `RaterRegistry`, `RaterRegistryWorldIdLib`, `ProfileRegistry`,
    `ConfidentialityEscrow`, `FeedbackBonusEscrow` identity checks, and
    `ProtocolConfig` validation.
  - oracle, launch, feedback, and voting settlement surfaces:
    `ClusterPayoutOracle`, `LaunchDistributionPool`, `FeedbackBonusEscrow`,
    `RoundVotingEngine`, `RoundVotingEngineRbtsSettlementModule`,
    `AdvisoryVoteRecorder`, and `RoundRewardDistributor`.
  - `QuestionRewardPoolEscrow` plus all
    `QuestionRewardPoolEscrow*.sol` libraries.
- Rechecked the returned leads and false positives against current source
  before including or excluding them.
- Deduplicated against:
  - `docs/security-review-multi-agent-2026-07-03.md`
  - `docs/security-review-multi-agent-2026-07-04-pass2.md`
  - `docs/security-review-multi-agent-2026-07-04-pass3.md`
  - `docs/security-review-multi-agent-2026-07-04-pass4.md`
  - `docs/security-review-multi-agent-2026-07-04-pass5.md`
  - `docs/security-review-multi-agent-2026-07-04-pass6.md`
  - `docs/security-review-multi-agent-2026-07-04-pass7.md`
- Ran static-analysis triage:
  - `slither . --exclude-dependencies --filter-paths 'lib|node_modules|test|script|mocks'`
    from `packages/foundry`: 0 results.
  - `aderyn .` from `packages/foundry`: report generation completed with
    0 high issues and 23 low/static-hygiene buckets, then Aderyn 0.6.8
    crashed in its macOS system-configuration/network shutdown path. The
    generated low buckets were reviewed as checklist input and not promoted
    into findings.
  - `yarn foundry:aderyn` could not be used in this environment because the
    local Apple CLI wrapper returned the Xcode license prompt before Aderyn ran.

## Findings

| ID | Severity | Area | Summary |
| --- | --- | --- | --- |
| RL8-01 | Low | Feedback bonus deadlines | A later pause/unpause globally reopens already-expired feedback bonus pools. |

## RL8-01: Global Unpause Grace Reopens Already-Expired Feedback Bonus Pools

Severity: Low

Affected code:

- `packages/foundry/contracts/FeedbackBonusEscrow.sol`
  - `awardFeedbackBonus` checks the computed deadline at lines 272-282.
  - `forfeitExpiredFeedbackBonus` uses the same computed deadline at
    lines 345-353.
  - `unpause` records one global `feedbackBonusLastUnpausedAt` at lines
    420-422.
  - `_feedbackBonusAwardDeadline` applies the global unpause grace to every
    pool at lines 499-522.

The pass 7 pause fix reopens a minimum award window after unpause by storing a
single global `feedbackBonusLastUnpausedAt` and returning:

```solidity
max(originalPoolDeadline, feedbackBonusLastUnpausedAt + MIN_FEEDBACK_AWARD_DECISION_SECONDS)
```

This does not distinguish pools that were still awardable when the pause began
from pools that had already expired. As a result, any later administrative
pause/unpause extends the deadline for every un-forfeited pool, including old
pools whose award window had already closed before that pause.

Impact scenario:

1. A feedback bonus pool settles, publishes awardable feedback, and reaches its
   original award deadline.
2. Nobody calls `forfeitExpiredFeedbackBonus` immediately, so the expired pool
   remains in storage with a nonzero balance.
3. At any later date, governance pauses and unpauses `FeedbackBonusEscrow` for
   an unrelated operational reason.
4. `_feedbackBonusAwardDeadline` now returns
   `lastUnpausedAt + MIN_FEEDBACK_AWARD_DECISION_SECONDS` for the old pool.
   During that reopened hour, `forfeitExpiredFeedbackBonus` reverts with
   `"Not expired"` and the awarder can call `awardFeedbackBonus` even though
   the original deadline had passed.

No arbitrary caller can steal the funds: awards still require the configured
awarder, a timely published feedback hash, revealed/scoring-weighted commit
state, and identity-ban checks. The issue is deadline finality and custody
semantics: expired pools can be resurrected by unrelated future pauses,
delaying or changing the expected treasury/funder settlement of remaining
funds.

Recommendation:

- Track enough pause state to extend only pools whose award deadline had not
  already expired when the pause began. For example, store a `pausedAt`
  timestamp and only apply the unpause grace when `baseDeadline >= pausedAt`,
  or snapshot a per-pool deadline extension when a pool is encountered during
  a pause-sensitive action.
- Add a regression where a pool expires, a later unrelated pause/unpause
  occurs, `feedbackBonusAwardDeadline(poolId)` remains the original expired
  deadline, and `forfeitExpiredFeedbackBonus` can still settle it immediately.
- Keep the existing pass 7 regression where a pause that starts before expiry
  reopens a minimum post-unpause award window.

## False Positives And Non-Findings Checked

- RL7-01 and RL7-02 remain fixed: revoked-owner fallback survives unassigned
  unbans, and legacy World ID v3 proofs now record a replay key before
  credential finalization.
- RL7-03 remains fixed for pending launch-credit finalization after
  `ProtocolConfig` rotation. The completion path uses the pinned registry
  status without re-running the configured-stack guard, and the deploy-size
  guard remains under EIP-170 after the assembly helper.
- RL7-04 remains intentionally scoped: zero-reveal `RevealFailed` pools refund
  the funder. Reveal-present `RevealFailed` pools are still awardable because
  `rbtsCommitState.scoringWeight` is the reveal-time RBTS participation weight
  set in `RoundVotingEngine`, not only a post-settlement reward weight.
- RL7-06 remains fixed as defense-in-depth: the RBTS settlement timeout path
  wraps `roundPayoutSnapshotKey` and falls back to timeout when a nonconforming
  oracle reverts.
- RL7-07 remains fixed: `ClusterPayoutOracle` no longer prechecks rejected
  epoch roots by `(epochId, root)` and instead relies on the source-set/root
  rejection key.
- The question-reward bundle recovery fixes from passes 5 and 6 were rechecked:
  recovered bundle abandonment blocks in-flight replacements, bundle
  pre-qualification skips require live qualifiability, and recovered bundle
  reopen preserves the original raw completer count.
- Slither reported no findings. Aderyn's generated low buckets were generic
  static-hygiene categories (centralization, loop cost, style, unused items,
  generic ERC20 warnings, etc.) and did not produce an additional confirmed
  issue after source review.

## Limitations

This was a source review plus static-analysis triage and targeted manual
validation, not formal verification or exhaustive fuzzing. The single finding
above is confirmed against current source, but absence of additional findings
should not be read as a proof that no other issue exists.
