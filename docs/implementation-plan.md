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

The first deployment does not include AI-specific accountability rules. AI
raters use the same open participation path as everyone else unless a future
governance proposal adds a stronger, externally verifiable accountability
mechanism.

## Question Bounty Eligibility Scopes

Every question remains answerable by everyone. Bounty eligibility is a payout
scope, not an answering permission. The submitter can choose one of two bounty
scopes when funding a question or bundle:

- `0` everyone.
- `1` verified humans.

The selected scope is committed into the submission reveal hash, stored in
`QuestionRewardPoolEscrow`, emitted in reward-pool and bundle events, indexed by
Ponder, and exposed through the agent result package. Scoped bounties filter
which revealed voters can qualify for payout, but they do not stop other raters
from committing, revealing, affecting the open settlement result, or providing
public feedback.

Agent-facing results always include `answerScopes.allAnswers` for the open
public result and `answerScopes.bountyEligibleAnswers` for the payout-eligible
view. When the indexer can materialize the scoped voter set, the eligible view
includes its own distribution; otherwise it still includes the policy, reward
pool count, and qualified round count.

## Reward Weight And Payout Weight

The voting result path and the payout path are separate. Commit-time reward
weight remains stake times the round's epoch timing weight, and human
verification is exposed as participation context rather than as a settlement
multiplier.

## Binary RBTS Rating Policy

Fresh content is publicly shown as `N/A` until at least one round settles. The
protocol can still snapshot an internal 5.0 prior for the first round's rating
math, but the UI must not present that prior as a community rating.

Each revealed report has two separate fields:

- `isUp`: the absolute thumbs-up or thumbs-down signal for the question.
- `predictedUpBps`: the rater's forecast of the revealed crowd's thumbs-up
  share.

The public rating is updated from bounded binary signal evidence only. It does
not use the rater's forecast and it does not treat the current score as the
thing being voted up or down. LREP stake still matters, but only as a capped
confidence bonus on top of one base signal unit:

- Base signal evidence: `1.0` unit per revealed report.
- Stake evidence bonus: linear up to `+1.0` unit at `10 LREP`.
- Epoch timing: the same blind/open epoch weight discounts late evidence.
- Settlement rewards and stake return continue to use the existing
  stake-weighted RBTS reward weight.

This keeps the rating closer to binary Robust BTS: users report their own
binary signal plus their forecast of others, and the score is not a relative
"raise/lower the current number" vote. The internal reference score remains
relevant only as the prior rating state that the settlement math updates from.
For a first round this prior is hidden behind `N/A`; after settlement the
rating shown is the settled community rating.

Example:

1. A new question starts as `N/A`.
2. Alice votes thumbs up, forecasts `70%` up, and stakes `10 LREP`.
3. Bob votes thumbs up, forecasts `60%` up, and stakes `3 LREP`.
4. Carol votes thumbs down, forecasts `30%` up, and stakes `3 LREP`.
5. At reveal, Alice contributes `2.0` up evidence units, Bob contributes
   `1.3` up units, and Carol contributes `1.3` down units.
6. Settlement records `3.3` bounded up evidence versus `1.3` bounded down
   evidence, so the public rating appears above neutral after the first round.
   It does not jump straight to the maximum because one report is down and the
   rating model smooths limited evidence.
7. The RBTS reward score is computed separately from each rater's signal and
   crowd forecast. That score controls score-based stake return, ordinary LREP
   rater-pool rewards, and earned launch-credit quality.

USDC bounty payouts and earned launch LREP credits now use challengeable
Correlation Epoch Snapshots. A keeper or indexer computes a reproducible,
COCM-inspired payout artifact over multiple rounds, proposes the Merkle roots
on-chain, and waits through a challenge window before claims can use those
effective weights. This means cluster/correlation caps delay and size payouts;
they do not change the public rating result.

Continuing the example: the public rating and ordinary settled-round reward
state are readable immediately after settlement. If this question has a USDC
bounty or launch LREP rewards, the claimant must wait for the finalized
correlation payout snapshot. If Alice is fully independent she may keep
`10,000` independence bps. If Bob and Carol are partially correlated with a
larger cluster, their bounty or launch-credit claim weights might be multiplied
by `5,000` bps. That cap changes only how much USDC or launch LREP they can
claim; it does not erase their visible signal and it does not rewrite the
public rating.

## Launch Earned Rewards

Earned launch LREP remains open to any rater, including AI raters and wallets
without a human credential. The launch pool only credits ratings from rounds
that satisfy the verified-human anchor policy.

Earned-rater caps are assigned as a full cohort cap plus an active payable cap.
The default unverified cap share is `10,000` bps so the first deployment starts
with the same economic behavior as the full cap schedule. Governance can later
lower the unverified share without changing the rest of the anchor policy. If an
open-lane rater later attaches an active human credential to the same wallet,
the rater can unlock the full snapshotted cap and receive any catch-up payment
for already earned reward slots. Each human nullifier can unlock the full
earned-rater cap for only one rater address.

Initial policy:

- Minimum revealed raters in the round: 3.
- Minimum verified-human units in the round: 1.
- Minimum distinct verified-human anchors across the rater's qualifying history: 2.
- Minimum distinct anchor rounds across the rater's qualifying history: 2.
- Minimum qualifying score: 7,000 bps.
- Eligibility starts after 5 qualifying ratings.
- Launch credits are capped by the existing cohort schedule.
- Default unverified earned-rater cap share: 10,000 bps.

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

- `participationLane`: `verified_human` or `open`.
- `humanCredential`: active, revoked, expired, or missing human credential
  state.
- `launchRewards`: qualifying rating count, distinct verified anchors, distinct
  anchor rounds, cap, paid amount, and current launch policy.
- `participationPolicy`: explicit booleans showing that human verification and
  AI participation do not affect reward weight.

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

`RoundVotingEngine` does not snapshot rater weight multipliers, model
declarations, or cluster keys.

`RoundRevealLib` and reward claim paths use stake and epoch timing only for
commit-time reward weight.

`LaunchDistributionPool` and launch reward libraries count active human
credentials as verified-human units.

## Documentation And Product Copy

All public docs, whitepaper text, SDK docs, profile UI, settings UI, and
leaderboards should use the same language:

- "Verified human" for both World ID and seeded Curyo Self.xyz humans.
- "Participation lane" for status ordering.
- "Reward weight is not changed by human credentials or AI participation."
- "Verified-human anchors are launch distribution gates, not core protocol
  participation gates."
- "Bounty scopes affect reward qualification, not who can answer."
- "Agent result packages expose both all-answer and bounty-eligible answer
  scopes."

Cluster discounts, independence multipliers, and effective payout weights should
only be described when they refer to the enforced `ClusterPayoutOracle` snapshot
path. They are not commit-time voting weights, and verified-human status is an
anchor inside the scorer rather than an exemption from clustering.
