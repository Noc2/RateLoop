# Earned Launch Rewards Anti-Farm Plan

This plan fixes the earned-rater launch-pool farming risk while keeping the
core RateLoop rating path open to humans, AI raters, teams, and delegated
wallets.

The principle is simple: a rater does not need to be a verified human to earn
starter LREP, but the rounds that unlock earned launch rewards must have at
least one verified-human anchor. Before any payout starts, the rater's
qualifying history must also include at least two distinct verified-human
anchors across at least two distinct rounds.

## Current Problem

Today, `RoundRewardDistributor` calls `LaunchDistributionPool` after a
prediction reward claim. The launch pool receives only `(rater, scoreBps)`.
That means it cannot tell whether the scored prediction came from a public,
independently anchored round or from a cheap controlled round. A Sybil operator
can therefore split across wallets and farm the `25M LREP` earned-rater pool if
round creation and settlement are cheap enough.

## Target Policy

Initial governance defaults:

| Parameter | Initial value |
| --- | ---: |
| `minVotersForEarnedRewards` | `3` |
| `minVerifiedHumansPerRound` | `1` |
| `minDistinctVerifiedAnchorsPerRater` | `2` |
| `minDistinctAnchorRoundsPerRater` | `2` |
| `minQualifyingScoreBps` | `7_000` |
| `eligibilityRatingCount` | `5` |
| `rewardingRatingCount` | `10` |
| `requireNoPendingCleanup` | `true` |

A prediction creates a qualifying launch credit only when:

1. The round is settled.
2. The round has no pending unrevealed-vote cleanup when configured.
3. At least `minVotersForEarnedRewards` raters revealed.
4. At least `minVerifiedHumansPerRound` active, non-legacy verified humans
   revealed in the round.
5. At least one verified anchor is not the claimant and not the content
   submitter identity.
6. The claimant's prediction score is at least `minQualifyingScoreBps`.
7. The `(contentId, roundId, commitKey)` credit has not already been recorded.

Payout starts only after:

1. The rater has at least `eligibilityRatingCount` qualifying launch credits.
2. Those credits include at least `minDistinctVerifiedAnchorsPerRater` distinct
   verified-human nullifiers.
3. Those credits span at least `minDistinctAnchorRoundsPerRater` distinct
   anchored rounds.

Credits that arrive before the diversity gate is satisfied are not back-paid.
They count toward eligibility, and future qualifying credits pay the normal
per-credit slice once all gates are satisfied.

All policy values must be timelock-governance updateable so the network can
start permissive and become stricter if farming pressure appears.

## Contract Implementation

### Commit 1: Add Governance Policy And Interface Context

Files:

- `packages/foundry/contracts/LaunchDistributionPool.sol`
- `packages/foundry/contracts/interfaces/ILaunchDistributionPool.sol`
- `packages/foundry/test/LaunchDistributionPool.t.sol`

Changes:

- Add a `LaunchRewardPolicy` struct:

```solidity
struct LaunchRewardPolicy {
    uint16 minVoters;
    uint16 minVerifiedHumans;
    uint16 minDistinctVerifiedAnchors;
    uint16 minDistinctAnchorRounds;
    uint16 minQualifyingScoreBps;
    uint32 eligibilityRatingCount;
    uint32 rewardingRatingCount;
    bool requireNoPendingCleanup;
}
```

- Replace constants in reward logic with policy storage.
- Add `setLaunchRewardPolicy(LaunchRewardPolicy calldata policy)` behind
  governance ownership.
- Validate broad safety bounds so governance cannot accidentally set nonsensical
  values.
- Change `ILaunchDistributionPool.recordEarnedRaterReward` to include round
  context and anchor context:

```solidity
function recordEarnedRaterReward(
    address rater,
    uint256 contentId,
    uint256 roundId,
    bytes32 commitKey,
    uint16 scoreBps,
    uint16 revealedRaterCount,
    bool noPendingCleanup,
    bytes32[] calldata verifiedAnchorIds
) external returns (uint256 paidAmount);
```

The launch pool trusts only authorized callers to provide anchor IDs. In the
initial deployment, that caller is the configured `RoundRewardDistributor`.
Passing the revealed count and cleanup status lets the launch pool own the
governance policy instead of duplicating policy checks in the distributor.

### Commit 2: Add Credit, Anchor, And Payout Accounting

Files:

- `packages/foundry/contracts/LaunchDistributionPool.sol`
- `packages/foundry/test/LaunchDistributionPool.t.sol`

Changes:

- Add duplicate-credit protection:

```solidity
mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) public earnedCreditRecorded;
```

- Track anchor diversity per rater:

```solidity
mapping(address => mapping(bytes32 => bool)) public raterVerifiedAnchorSeen;
mapping(address => uint32) public raterDistinctVerifiedAnchorCount;
mapping(address => mapping(bytes32 => bool)) public raterAnchorRoundSeen;
mapping(address => uint32) public raterDistinctAnchorRoundCount;
```

- Use `keccak256(abi.encode(contentId, roundId))` as the anchor-round key.
- When recording a qualifying credit, record one unseen anchor if available.
- Increment `qualifyingRatingCount[rater]` only after the round and score gates
  pass.
- Pay only when the rater has enough qualifying credits and anchor diversity.
- Preserve the existing cap schedule and pool-depletion behavior.
- Emit a richer event:

```solidity
event EarnedRaterRewardPaid(
    address indexed rater,
    uint256 indexed contentId,
    uint256 indexed roundId,
    bytes32 commitKey,
    uint256 amount,
    uint16 scoreBps,
    uint32 qualifyingRatingCount,
    uint32 rewardedRatingCount,
    uint32 distinctVerifiedAnchorCount,
    uint32 distinctAnchorRoundCount
);
```

### Commit 3: Finalize Round Anchor Eligibility In Reward Claims

Files:

- `packages/foundry/contracts/RoundRewardDistributor.sol`
- `packages/foundry/contracts/interfaces/ILaunchDistributionPool.sol`
- `packages/foundry/test/RoundRewardDistributorBranches.t.sol`

Changes:

- Keep normal reward claims non-blocking. Launch-pool failures should stay
  inside `try/catch`.
- Before calling the launch pool, scan the settled round commits and collect
  active verified-human anchor IDs from `RaterRegistry`.
- Use the reward recipient identity for delegated voting. A delegate can recover
  stake, but earned launch rewards belong to the rater identity that owns the
  claim.
- Do not count an anchor when:
  - the credential is missing, revoked, legacy, expired, or has an empty
    nullifier hash;
  - the anchor is the reward recipient for the current claim;
  - the anchor is the content submitter identity.
- Read pending cleanup from the voting engine and pass `noPendingCleanup` to
  the launch pool. The launch pool enforces `requireNoPendingCleanup`.
- Pass the revealed count, cleanup status, and anchor IDs into
  `recordEarnedRaterReward`.

Implementation note: the first version can scan at claim time because the
existing round cap is bounded. If this becomes too expensive, add a later cache
function such as `finalizeLaunchRoundEligibility(contentId, roundId)`.

### Commit 4: Add Integration And Regression Tests

Files:

- `packages/foundry/test/LaunchDistributionPool.t.sol`
- `packages/foundry/test/RoundRewardDistributorBranches.t.sol`
- Any shared voting test helpers that need anchor setup helpers.

Required tests:

- Low-score predictions do not count.
- A settled round with three raters and no verified anchor does not count.
- A round with three raters and one verified-human anchor creates a qualifying
  credit.
- Five qualifying credits with the same verified anchor do not pay yet.
- A later qualifying credit with a second verified anchor in another round
  unlocks the first payout slice.
- Reusing the same `(contentId, roundId, commitKey)` cannot increment counts or
  pay twice.
- The claimant's own verified credential does not anchor that claimant's credit.
- The content submitter's verified credential does not anchor rewards for that
  content.
- Governance can raise `minVoters` or `minDistinctVerifiedAnchors` and later
  credits obey the new values.
- Launch reward call failures do not block normal prediction reward claims.

### Commit 5: Update ABIs, Indexer, And SDK Surfaces

Files:

- `packages/contracts/src/abis/LaunchDistributionPoolAbi.ts`
- `packages/contracts/src/abis/index.ts` if generation changes it
- `packages/contracts/src/deployedContracts.ts`
- `packages/ponder/src/LaunchDistributionPool.ts`
- Any generated deployment metadata touched by the ABI generator.

Changes:

- Regenerate TypeScript ABIs after the Solidity interface/event update.
- Update the Ponder handler for `EarnedRaterRewardPaid` so `contentId` and
  `roundId` are recorded instead of the current placeholder zeros.
- If the UI reads policy values, expose them through generated contract hooks.

### Commit 6: Update Product Copy And Operator Docs

Files:

- `README.md`
- `packages/foundry/README.md`
- `docs/implementation-plan.md`
- `packages/nextjs/app/(app)/docs/tokenomics/page.tsx`
- `packages/nextjs/app/(app)/docs/how-it-works/page.tsx`
- `packages/nextjs/app/(app)/docs/smart-contracts/page.tsx`
- `packages/nextjs/lib/docs/tokenomics.ts`
- `packages/nextjs/scripts/whitepaper/sections.ts`
- `packages/nextjs/scripts/whitepaper/summary.ts`
- `packages/nextjs/lib/docs/whitepaperContent.test.ts` if exact copy
  assertions change.

Changes:

- Explain that earned rater rewards are open to any rater but require
  verified-human anchored rounds.
- Explain the initial defaults: `3` revealed raters, `1` verified human per
  round, and `2` distinct verified-human anchors across a rater's qualifying
  history before payout.
- Emphasize that governance can tune these parameters over time.

## Rollout

If `LaunchDistributionPool` is already deployed with funds, deploy a
`LaunchDistributionPoolV2`, transfer remaining launch funds through governance,
update `ProtocolConfig.launchDistributionPool`, and authorize the current
reward distributor. If it is not deployed yet, patch the current contract before
launch.

As an immediate pre-patch mitigation, governance can remove
`RoundRewardDistributor` from `LaunchDistributionPool.authorizedCallers` so
earned launch payouts pause while normal round rewards remain claimable.
