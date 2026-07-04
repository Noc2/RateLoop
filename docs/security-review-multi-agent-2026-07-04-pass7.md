# RateLoop Smart Contract Security Review - Multi-Agent Pass 7

Date: 2026-07-04
Base revision reviewed: `b66530f2d` on `main` plus the RL5-01 fix (landed
during this review as `15a61c5cd`)
Scope: `packages/foundry/contracts`
Status: 0 high/critical findings; 4 low and 3 informational findings; the
RL5-01 remediation was independently verified as correct and complete

No code remediation is included in this report commit. This pass ran
concurrently with pass 6 (`d18e575de`); the finding sets are disjoint (pass 6
covers bundle pre-qualification skip pinning and recovered completer counts;
this pass covers identity, launch distribution, feedback bonus, and oracle
periphery).

## Methodology

- Ran four read-only reviewer passes in parallel:
  - `RoundVotingEngine`, RBTS settlement module, `ContentRegistry` rating
    pipeline, `ClusterPayoutOracle`, cursor/repoint/recovery machinery, and
    the RBTS/rating/reward math libraries
  - `QuestionRewardPoolEscrow` and all of its libraries,
    `X402QuestionSubmitter` / EIP-3009 binding, `TokenTransferLib`, plus an
    independent verification of the RL5-01 fix
  - `FeedbackBonusEscrow`, `FeedbackRegistry`, `LaunchDistributionPool`,
    `ConfidentialityEscrow`, `RoundRewardDistributor`,
    `SubmissionMediaValidator(Factory)`, `FrontendFeeDustLib`
  - `RaterRegistry` / World ID paths, `ProfileRegistry`, `CategoryRegistry`,
    `FrontendRegistry`, `LoopReputation`, `ProtocolConfig`,
    `AdvisoryVoteRecorder`, `RateLoopGovernor`, mock-vs-prod deploy wiring
- Performed parent review of returned leads against current source; every
  finding below was re-verified line-by-line before inclusion.
- Deduplicated against:
  - `docs/security-review-multi-agent-2026-07-03.md`
  - `docs/security-review-multi-agent-2026-07-04-pass2.md`
  - `docs/security-review-multi-agent-2026-07-04-pass3.md`
  - `docs/security-review-multi-agent-2026-07-04-pass4.md`
  - `docs/security-review-multi-agent-2026-07-04-pass5.md`
  - `docs/security-review-multi-agent-2026-07-04-pass6.md`
- Supplemented with external research on the protocol's primitives (see
  "Research Notes" below): RBTS/peer-prediction collusion literature, World ID
  on-chain verification guidance, and EIP-3009 integration pitfalls.
- Authorship verification (requested): `git shortlog -sne` shows 4,055 of
  4,102 commits authored by David Hawig / Noc2 (`davidhawig@gmail.com`), with
  the remainder from Cursor Agent and dependabot. The protocol is the
  repository owner's own work.

## RL5-01 Fix Verification

The change now committed as `15a61c5cd` to
`QuestionRewardPoolEscrowBundleRecoveryLib._hasRecoveredReplacementSnapshot`
was compared gate-by-gate against the single-question sibling
`QuestionRewardPoolEscrowPoolActionsLib._hasRecoveredReplacementSnapshot`
(lines 633-703): oracle pinning, try/catch snapshot load, status set
(`Proposed`/`Challenged`/`Finalized`), `proposedAt >= pinnedAt`, source-ready
gate, consumer binding, rejected digest/root/correlation-epoch exclusions,
in-flight blocker semantics, finalized-inside-veto blocker, and the
finalized-outside-veto delegation to the qualifiable-replacement check. All
gates match. The new regression tests cover exactly the three previously
unhandled states (Proposed, Challenged, Finalized-inside-veto) through the
real `ClusterPayoutOracle`. Verdict: correct and complete.

One benign divergence: the bundle variant wraps the correlation-epoch
rejection probe in try/catch (failing toward keeping funds), which is strictly
more robust than the sibling's direct call. Suggested follow-up test: assert
that a reopened round set still requires the 7-day post-reopen claim grace
before `refundRecoveredQuestionBundleReward` succeeds (the protection exists
in code via the reopen-time `claimDeadline` bump but is not directly pinned).

## Findings

| ID | Severity | Area | Summary |
| --- | --- | --- | --- |
| RL7-01 | Low | Identity bans | Unban deletes the `lastRevokedOwner` pointer, so a later re-ban of the same nullifier silently loses its address-level reach. |
| RL7-02 | Low | World ID legacy attestation | The v3 attestation path has no single-use proof marker; a holder can replay one cached proof to keep refreshing the credential TTL. |
| RL7-03 | Low | Launch distribution rotation | Old `LaunchDistributionPool` bricks finalization of existing pending credits once `ProtocolConfig` is repointed, unlike the "reject new work only" pinning used elsewhere. |
| RL7-04 | Low | Feedback bonus forfeiture | Zero-reveal `RevealFailed` rounds forfeit the feedback bonus to treasury even though no award was ever possible, contradicting the documented refund policy. |
| RL7-05 | Info | Feedback bonus pausing | A pause spanning the award window converts awardable bonuses into forced forfeits; the deadline does not extend for paused time. |
| RL7-06 | Info | RBTS settlement oracle pinning | The pinned RBTS settlement oracle has no repoint path, unlike its public-rating sibling; one unguarded oracle call in the timeout path is the hardening point. |
| RL7-07 | Info | Correlation epoch root bans | `rejectedCorrelationEpochRoots` is keyed by `(epochId, root)` only, so a corrected source set that deterministically yields the same root cannot be re-proposed under the same epoch. |

## RL7-01: Unban Destroys `lastRevokedOwner`, Weakening Re-Bans

Severity: Low

Affected code: `packages/foundry/contracts/RaterRegistry.sol` —
`unbanIdentity` (679-690), `_clearDerivedIdentityBansForCredentialSlot`
(1353-1363), `_writeDerivedIdentityBansForCredentialSlot` (1339-1351).

Address-level identity bans exist only as derived bans. `banIdentity`
propagates to the holder's address key via the nullifier owner, falling back
to `_lastRevokedOwnerByProvider` when the credential slot was already revoked.
`unbanIdentity` clears the derived bans but its helper then unconditionally
executes `delete _lastRevokedOwnerByProvider[provider][nullifierHash]`
(line 1362). Nothing re-establishes that pointer except actions by the holder
themselves, and no entrypoint writes a direct ban on an `addressIdentityKey`.

Impact scenario: credential is revoked, then banned (derived ban lands on the
address via the fallback), then unbanned on appeal, then re-banned on new
evidence. The re-ban's `_writeDerivedIdentityBanForHolder(address(0), ...)`
no-ops, so the holder keeps participating from the same established address
while on-chain events claim the sanction re-applied. Secondary effect: after
any unban, `clearRevokedHumanNullifier`'s `HumanNullifierRevocationCleared`
alert emits `prevOwner = address(0)`, degrading the RR-6 monitoring path.

Recommendation: stop deleting `_lastRevokedOwnerByProvider` in
`_clearDerivedIdentityBansForCredentialSlot` (clearing the derived ban entries
is sufficient), or gate the deletion behind an explicit expunge action. Add a
ban → unban → re-ban regression test asserting the address-level ban
re-applies.

## RL7-02: Legacy World ID v3 Attestation Lacks a Proof-Replay Marker

Severity: Low

Affected code: `packages/foundry/contracts/RaterRegistry.sol` —
`attestHumanCredentialWithProof` (893-932); contrast with the v4 replay guard
`usedWorldCredentialProof` in `libraries/RaterRegistryWorldIdLib.sol`
(109-128).

The v3 path verifies `(root, proof)` against the router and sets
`expiresAt = block.timestamp + worldIdCredentialTtl` with no record that the
proof was consumed. The v4 path stores a `proofReplayKey` and rejects reuse,
showing single-use proofs are the intended model (this also matches World ID
integration guidance — on-chain proofs are meant to be short-lived). Signal
binding means only the original attester can replay, but they can refresh the
TTL forever from cached calldata while the submitted root remains accepted by
the router — relevant if the identity commitment was later removed from the
World ID set. No sybil amplification (same nullifier, same address).

Mitigations already present: `legacyWorldIdAttestationDisabled` (line 169,
settable at 456) can retire the path entirely.

Recommendation: mirror the v4 single-use marker in the v3 path (one mapping
write), or plan to flip `legacyWorldIdAttestationDisabled` once v4 adoption
allows.

## RL7-03: Old Launch Pool Bricks Completion Of Pending Credits After Rotation

Severity: Low (operational/design)

Affected code: `packages/foundry/contracts/LaunchDistributionPool.sol` —
`_requireConfiguredRaterRegistry` (1498-1517), reached from `_isRaterBanned`
(1493-1496), which sits on `finalizeEarnedRaterRewardCredit` (724),
`claimVerifiedBonus` / `unlockFullEarnedRaterCap` via
`_activeHumanCredential` (1477), and the view paths (567, 650).

Once `roundClusterReadyAtSource` is wired, every ban lookup reverts with
`InvalidAddress` unless the engine's `ProtocolConfig` still reports this exact
pool and rater registry. The accepted rotation model elsewhere is that pinned
escrows reject **new** work (`StaleEngine`) while existing work completes;
here the same guard also sits on the **completion** paths. The moment
governance repoints `ProtocolConfig.launchDistributionPool` (or the registry)
to a successor, every finalization and claim on the old pool reverts. Pending
credits are one-shot tickets (`earnedRewardCreditRecorded` /
`raterRoundCreditRecorded` already set), and neither rescue nor cancel
bypasses the check, so in-flight credits strand unless governance repoints
back or destroys entitlements via `withdrawRemaining`.

Recommendation: either relax the completion-path guard to creation-only
(matching the `StaleEngine` shape), or document a hard rotation-runbook
constraint in `AGENTS.md`: drain all pending launch credits before repointing
`ProtocolConfig`. If freezing completions is intentional, a regression test
pinning the intended behavior would prevent accidental relaxation later.

## RL7-04: Zero-Reveal `RevealFailed` Rounds Forfeit The Feedback Bonus

Severity: Low

Affected code: `packages/foundry/contracts/FeedbackBonusEscrow.sol` —
`forfeitExpiredFeedbackBonus` (344-376), `_expiredFeedbackBonusRefundRecipient`
(514-523), `_requireRevealedIndependentRater` (529-553).

The refund-vs-forfeit split treats `Settled | Tied | RevealFailed` as
awardable-terminal (remainder → treasury). Awarding requires a revealed
commit with nonzero scoring weight, but `RevealFailed` (commit quorum reached,
reveal quorum never reached) can terminate with zero reveals — then no rater
can ever satisfy the award predicate, yet the remainder still routes to
treasury instead of refunding the funder. This contradicts the function's own
documented rationale that rounds where no useful feedback award was possible
refund the funder. No attacker profit; funder value is lost to treasury.

Recommendation: in `_expiredFeedbackBonusRefundRecipient`, treat
`RevealFailed` with zero revealed votes (or zero scored votes) as a
funder-refund terminal. While there, confirm the reveals-present
`RevealFailed` case has at least one commit with nonzero scoring weight in
practice; if RBTS scoring never runs for such rounds, the forfeit branch is
wrong for all `RevealFailed` rounds, not just zero-reveal ones.

## RL7-05: Pause Spanning The Award Window Forces Forfeiture (Info)

`FeedbackBonusEscrow.awardFeedbackBonus` is `whenNotPaused` (271-274) and the
award deadline (`_feedbackBonusAwardDeadline`, 497-512; minimum window
`settledAt + 1 hours`) is wall-clock. A pause spanning the window means the
first permissionless action after unpause can be `forfeitExpiredFeedbackBonus`.
Consider excluding paused time or reopening a grace window on unpause.

## RL7-06: Pinned RBTS Settlement Oracle Has No Repoint (Info)

`RoundVotingEngine.sol:925` pins `roundRbtsSettlementOracle` once at
`settleRound` with no rewrite path, unlike the rating sibling's
`repointPendingRatingClusterPayoutOracle` (`ContentRegistry.sol:1466`). The
timeout path settles with full stake return after `readyAt + 1 hours`, and the
dispute lifecycle was verified unable to hold a snapshot in `Challenged`
indefinitely, so no loss path exists with a conforming oracle — the residual
risk is a governance deployment error installing a non-conforming oracle. The
one hard call in the timeout path not wrapped in try/catch is
`oracle.roundPayoutSnapshotKey(...)`
(`RoundVotingEngineRbtsSettlementModule.sol:179`); wrapping it would be cheap
defense-in-depth.

## RL7-07: Epoch-Keyed Root Ban Blocks Corrected Same-Root Re-Proposals (Info)

`ClusterPayoutOracle.sol:317` refuses any re-proposal whose `clusterRoot`
matches a rejected root under the same `epochId`, while the canonical
blacklist (line 332) correctly scopes bans to `(sourceSetDigest, root)`. A
corrected source set that deterministically yields the same root is refused
under the same epoch even though it was never adjudicated. Operators can work
around it with a fresh `epochId`; operational quirk only.

## Research Notes

- RBTS / peer prediction: the literature (Witkowski & Parkes' robust BTS for
  small populations; peer-truth-serum follow-ups) confirms RBTS is strictly
  incentive-compatible for n >= 3 without a known common prior, but remains
  vulnerable to peer collusion on a pre-agreed uninformative report. The
  protocol's layered defenses (stake, identity verification, correlation
  clusters discounting coordinated raters, optimistic payout audits) are the
  right mitigation shape; no additional on-chain fix is indicated beyond what
  exists. Collusion resistance should stay an explicit monitoring concern for
  the off-chain artifact pipeline.
- World ID: current guidance treats on-chain proofs as short-lived (roots
  accepted for a bounded window) and single-use per action; the v4 path
  follows this, motivating RL7-02 on the v3 path.
- EIP-3009: known integration pitfalls are authorization front-running of
  `transferWithAuthorization` (avoided — the gateway uses
  `receiveWithAuthorization`, which binds `msg.sender` to the payee) and
  nonce-less replay in wrapper protocols (avoided — the X402 nonce commits to
  chain id, registry, escrows, gateway, payer/payee/value/window, and the full
  submission payload). This pass re-verified both properties in
  `X402QuestionSubmitter`.

## False Positives And Non-Findings Checked

- RL5-01 is fixed by `15a61c5cd` (see verification section); direct
  `refundQuestionBundleReward` cannot bypass the recovered-set guard, and
  pre-qualification bundle refunds already block on in-flight snapshots via
  `BundleClusterPayoutSnapshotPending`.
- Bundle recovery accounting conserves allocations across
  recover → requalify → re-reject loops; claimant marks are cleared per commit
  key on recovery and digest-keyed for single questions — no double-claim.
- RBTS division-by-zero, forfeit underflow, and the zero-weight
  strand-the-pool branch are all unreachable given the `minParticipants >= 3`
  and forfeit-gating invariants (verified in `RoundRevealLib`, `RewardMath`,
  `RoundSettlementDistributionLib`).
- Snapshot full-coverage checks on both consumers enforce strictly increasing
  commit keys and exact reveal coverage; snapshot keys are domain-separated
  with fixed-width encodings — no collisions.
- Cursor/repoint monotonicity holds in every interleaving tried, including
  two-skipped-rounds plus repoint; the RL4-01/RL4-02 fix shapes are present on
  both the rating and RBTS siblings.
- Commit-stake refund paths (`claimCancelledRoundRefund` vs
  `processUnrevealedVotes`) are provably disjoint and both zero stake before
  transfer; `accountedLrepBalance` deltas match transfers everywhere checked.
- EIP-3009/X402 binding, `TokenTransferLib` behavior on no-code/false-return
  tokens, participant floor tiers, and bounty-window boundary comparisons all
  check out.
- Feedback bonus award/refund races, identity-aliased double-awards,
  confidentiality bond lifecycle (post RL-02/RL-09/RL2-06 fixes), distributor
  dust interleavings, launch catch-up pay accounting, and legacy contributor
  vesting were rechecked; no new issue beyond RL7-03/RL7-04/RL7-05.
- World ID signal/external-nullifier binding (v3 and v4), delegation
  lifecycle nonces (RL-01 fix intact), soulbound LREP enforcement, Governor
  quorum/threshold/lock mechanics (RL-03/RL-05 fixes intact), ProtocolConfig
  parameter validation, FrontendRegistry alias/bond lifecycle, and
  AdvisoryVoteRecorder sampling/ban checks were rechecked; no new issue
  beyond RL7-01/RL7-02.
- Mock contracts are only instantiated under `isLocalDev` in `Deploy.s.sol`;
  no production path depends on permissive mock behavior.

## Limitations

- This was a source review plus external research pass. Foundry, Slither, and
  Aderyn were not available in this session's sandbox, so no tests or static
  analysis were executed here; pass 6 ran the full gate set at `15a61c5cd`
  with clean results, and the RL5-01 fix and its regression tests were
  verified statically by an independent reviewer agent.
- No remediation patch is included in this report. RL7-01 through RL7-04 are
  each small, independent fixes suitable for separate implementation commits
  with focused regression tests.
