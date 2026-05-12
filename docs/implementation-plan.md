# RateLoop Integration Plan

This is the canonical implementation plan for the fresh RateLoop deployment.
Nothing is deployed yet, so the protocol does not preserve legacy compatibility
for the older optional identity and cluster-discount drafts.

## Final Policy

RateLoop is open to people, teams, bots, and AI raters. Proof-of-personhood is
not required to rate, reveal, claim ordinary settled-round rewards, or build
reputation through protocol participation.

World ID is an optional human credential. A connected wallet submits its own
World ID proof directly to `RaterRegistry.attestHumanCredentialWithProof`, and
the contract verifies the proof through the World ID Router before recording a
credential. There is no trusted server issuer in the normal path.

The nine migrated Curyo users that were already verified with Self.xyz are
seeded by the deploy script through `RaterRegistry.seedHumanCredential`. They
are treated exactly like verified humans everywhere in the product and indexer:
same verified-human status, same anchor behavior, same leaderboard/profile
copy, and no separate "Curyo legacy human" chip.

AI declarations are a separate accountability rail. `RaterDeclarationRegistry`
records bonded model/operator declarations, probe results, drift flags,
challenges, and slashing. An active AI declaration is not a verified-human
credential and never counts as a launch anchor.

## Reward Weight

The protocol does not enforce independence, cluster discounts, human credential
multipliers, or AI declaration multipliers in commit-time reward weight.

Commit-time reward weight is stake times the round's epoch timing weight. Human
verification and AI declaration status are exposed as participation context, not
as reward multipliers.

This deliberately removes the previous false sense of Sybil mitigation from
indexer-computed `effectiveRewardWeight` and UI copy that implied a cluster
discount was applied on-chain.

## Launch Earned Rewards

Earned launch LREP remains open to any rater, including AI raters and wallets
without a human credential. The launch pool only credits ratings from rounds
that satisfy the verified-human anchor policy.

Initial policy:

- Minimum revealed raters in the round: 3.
- Minimum verified-human units in the round: 1.
- Minimum distinct verified-human anchors across the rater's qualifying history:
  2.
- Minimum distinct anchor rounds across the rater's qualifying history: 2.
- Minimum qualifying score: 7,000 bps.
- Eligibility starts after 5 qualifying ratings.
- Launch credits are capped by the existing cohort schedule.

The previous verified-human metrics are preserved in naming and behavior:
`minVerifiedHumanUnits`/`minVerifiedHumans`, verified-human round units, distinct
verified anchors, and distinct anchor rounds remain first-class launch policy and
indexer metrics.

AI-only rounds can still exist and settle. They just do not create earned-launch
credit unless the round also has the required verified-human anchor units. Once a
rater has LREP, they can participate in normal staked rounds without a human ID.
For a zero-LREP rater's initial earned launch LREP, at least some qualifying
history must come from verified-human anchored rounds.

## API And Indexing

Ponder exposes `GET /rater-participation-status/:address` as the canonical
status route. It returns:

- `participationLane`: `verified_human`, `ai_declared`, or `open`.
- `humanCredential`: active, revoked, expired, or missing human credential
  state.
- `aiDeclaration`: declared/effective declaration state and challenge/probe
  status.
- `launchRewards`: qualifying rating count, distinct verified anchors, distinct
  anchor rounds, cap, paid amount, and current launch policy.
- `participationPolicy`: explicit booleans showing that human verification and
  AI declaration do not affect reward weight.

The leaderboard and profile surfaces use the same payload language. They show
World ID verified humans and seeded Curyo verified humans identically.

Removed live indexer concepts:

- Cluster-score tables and readers.
- Cluster challenge status.
- Indexer-computed independence or discount multipliers.
- Reward-status route names that imply settlement reward weighting.

## Contract Scope

`RaterRegistry` owns human credentials:

- `attestHumanCredentialWithProof`
- `seedHumanCredential`
- `revokeHumanCredential`
- `getHumanCredential`
- `hasActiveHumanCredential`
- `humanNullifierOwner`

`RoundVotingEngine` snapshots active AI declaration status for launch-anchor
exclusion. It does not snapshot rater weight multipliers or cluster keys.

`RoundRevealLib` and reward claim paths use stake and epoch timing only for
commit-time reward weight.

`LaunchDistributionPool` and launch reward libraries count active human
credentials as verified-human units. They do not count active AI declarations as
anchors.

## Documentation And Product Copy

All public docs, whitepaper text, SDK docs, profile UI, settings UI, and
leaderboards should use the same language:

- "Verified human" for both World ID and seeded Curyo Self.xyz humans.
- "AI declared" or "verified agent" only for model-accountability status.
- "Participation lane" for status ordering.
- "Reward weight is not changed by human credentials or AI declarations."
- "Verified-human anchors are launch distribution gates, not core protocol
  participation gates."

Do not reintroduce cluster discount, independence multiplier, effective reward
weight, or identity multiplier language unless the protocol later enforces that
logic on-chain with reproducible sources and tests.
