# RateLoop Smart Contract Security Review - Multi-Agent Pass 5

Date: 2026-07-04
Base revision reviewed: `446b9d788` on `main`
Scope: `packages/foundry/contracts`
Status: 1 new confirmed finding, 0 high/critical findings

This pass reviewed the current smart-contract code after the pass4 findings
were fixed in:

- `723ba1f12 fix: delay rating skips after rejected roots`
- `446b9d788 fix: reopen skipped rating rounds on repoint`

No code remediation is included in this report commit.

## Methodology

- Ran three read-only reviewer passes in parallel:
  - public rating snapshots, `ClusterPayoutOracle`, RBTS settlement, cursor
    ordering, rejection/repoint/recovery flows, and the latest pass4 fixes
  - question reward pools, bundle rewards, feedback bonuses, launch
    distribution, confidentiality, treasury/refund/recovery/surplus flows, and
    snapshot consumer recovery
  - identity/delegation, advisory voting, `RaterRegistry`, `ProfileRegistry`,
    `FrontendRegistry`, `ProtocolConfig`, governance guardrails, access
    control, and storage assumptions
- Performed parent review of returned leads against current source.
- Deduplicated against:
  - `docs/security-review-multi-agent-2026-07-03.md`
  - `docs/security-review-multi-agent-2026-07-04-pass2.md`
  - `docs/security-review-multi-agent-2026-07-04-pass3.md`
  - `docs/security-review-multi-agent-2026-07-04-pass4.md`
- Ran static analysis:
  - `slither . --exclude-dependencies --filter-paths 'lib|node_modules|test|script|mocks'`
    from `packages/foundry`
    - Result: `0 result(s) found`
  - `yarn foundry:aderyn`
    - Result: 0 high issues; 23 broad low categories reviewed as triage input,
      with no additional confirmed issue promoted beyond the manual finding
      below
- Ran focused Foundry regression baselines:
  - `forge test --match-contract 'ContentRegistryRepointTest|SecondPassRatingSnapshotOrderingTest|SecondPassRbtsSettlementOracleTest|ClusterPayoutOracleTest' -vv`
    - Result: 120 passed, 0 failed
  - `forge test --match-contract QuestionRewardPoolEscrowTest --match-test 'testRecoveredBundle|testBundleRefund|legacyRecoveredBundle|testRecoveredBundleRefund|testPreQualificationRejected|testRecoveredSnapshotBundle' -vv`
    - Result: 24 passed, 0 failed
- Ran deployment safety gates from `packages/foundry`:
  - `make check-contract-sizes`
    - Result: all checked deployed bytecode sizes are within EIP-170
  - `make check-storage-layouts`
    - Result: all checked storage layouts match the pinned snapshots

## Findings

| ID | Severity | Area | Summary |
| --- | --- | --- | --- |
| RL5-01 | Medium | Recovered bundle reward refunds | Recovered bundle rewards can be forfeited while a replacement snapshot is still in flight. |

## RL5-01: Recovered Bundle Rewards Can Be Forfeited While A Replacement Snapshot Is Still In Flight

Severity: Medium

### Affected Code

- `packages/foundry/contracts/QuestionRewardPoolEscrow.sol`
  - `refundRecoveredQuestionBundleReward`, lines 835-857
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleRecoveryLib.sol`
  - `abandonRecoveredRoundSets`, lines 133-203
  - `_hasRecoveredReplacementSnapshot`, lines 409-427
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleActionsLib.sol`
  - `hasQualifiableRecoveredBundleReplacementSnapshot`, lines 696-748
  - `_finalizedBundlePayoutSnapshot`, lines 1733-1777
  - `refundQuestionBundleReward`, lines 823-837

### Description

`refundRecoveredQuestionBundleReward` first calls
`QuestionRewardPoolEscrowBundleRecoveryLib.abandonRecoveredRoundSets`, then
immediately calls the normal bundle refund path.

The recovered-round-set abandonment guard only reverts when
`_hasRecoveredReplacementSnapshot` returns true. That helper delegates to
`QuestionRewardPoolEscrowBundleActionsLib.hasQualifiableRecoveredBundleReplacementSnapshot`.
For bundles, the qualifiable-replacement helper starts with
`_finalizedBundlePayoutSnapshot`, which only reports `snapshotReady = true`
when the replacement snapshot is finalized, outside its veto window, source
ready, pinned to the current consumer, and otherwise shape-valid.

As a result, a valid replacement bundle snapshot that is still `Proposed`,
`Challenged`, or `Finalized` but inside its veto window is treated as if no
replacement exists. The abandonment path can then delete the recovered
round-set state and clear `pendingRecoveredRoundSets`. The subsequent refund
path can mark the bundle refunded and, for non-refundable bundle rewards,
forfeit the remaining amount to treasury.

The sibling single-question reward-pool path uses a safer replacement predicate:
`QuestionRewardPoolEscrowPoolActionsLib._hasRecoveredReplacementSnapshot`
treats `Proposed`, `Challenged`, and `Finalized` snapshots inside veto as
replacement-available blockers before allowing recovered rounds to be
abandoned.

### Impact

Recovered bundle rewards can be permanently closed while a valid replacement
snapshot is actively progressing through the oracle lifecycle:

1. A bundle round set is qualified from a finalized bundle snapshot.
2. The snapshot is later rejected before any claim is paid.
3. The round set is recovered, restoring its allocation and setting
   `pendingRecoveredRoundSets`.
4. A corrected replacement snapshot is proposed, challenged, or finalized but
   still inside veto.
5. After the refund and claim grace gates are met, a caller invokes
   `refundRecoveredQuestionBundleReward`.
6. Because the replacement is not finalized outside veto yet, the recovered
   round set is abandoned and the bundle can be refunded or forfeited.

This does not let the caller directly steal funds, but it can permanently
forfeit or refund bundle reward value that should have remained claimable once
the in-flight replacement snapshot finished.

### Recommendation

Make recovered bundle round-set abandonment use the same in-flight replacement
predicate shape as single-question reward pools. In particular, block
abandonment when the replacement snapshot is:

- `Proposed` or `Challenged` and not rejected by payload/root/correlation epoch
- `Finalized` but still inside the effective veto window
- `Finalized` and outside veto with a qualifiable replacement

Add regression tests covering `refundRecoveredQuestionBundleReward` with
replacement snapshots in `Proposed`, `Challenged`, and finalized-inside-veto
states. The existing
`legacyRecoveredBundleRefundRevertsWhenReplacementFinalizedBeforeReopen` test
already covers the finalized/outside-veto case, but not the in-flight states.

## False Positives And Non-Findings Checked

- RL4-01 is fixed: public-rating skips now wait on the latest direct or parent
  rejection timestamp before allowing a rejected root to be skipped.
- RL4-02 is fixed: repointing a skipped public-rating round now either reopens
  the round by clearing `provisionallySkipped` and rewinding the cursor, or
  reverts once a later rating snapshot has already been applied.
- RBTS timeout and rejection handling matches the public-rating fix shape:
  direct and parent rejection timestamps both restart the timeout window.
- Single-question reward-pool recovered refunds do not share RL5-01; their
  recovered-round abandonment helper blocks in-flight replacement snapshots.
- Confidentiality escrow release, EIP-3009 nonce binding, and open-empty-round
  handling were rechecked; no new issue was found.
- Launch distribution surplus recovery and launch-credit snapshot gates were
  rechecked; no new issue was found.
- Feedback bonus award/refund paths were rechecked; no new issue was found.
- Identity delegation, advisory voting availability, frontend aliases/fee
  withdrawals, profile migration, `ProtocolConfig`, and governance guardrails
  were rechecked; no new issue was found.

## Limitations

- This was a source review plus focused static-analysis and Foundry regression
  pass, not formal verification or exhaustive fuzzing.
- No remediation patch is included in this report. RL5-01 should be fixed in a
  separate implementation commit with focused bundle recovery/refund
  regressions.
