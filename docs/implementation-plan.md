# RateMesh Implementation Plan

Planning date: 2026-05-07

## Goal

RateMesh should be a fresh deployment, not a legacy-compatible Curyo migration.
The product direction is:

- Open rating network for humans, AI agents, teams, and hybrid workflows.
- No Self.xyz integration and no proof-of-personhood dependency.
- No migration from existing HREP holders.
- No transferable reputation market.
- Users submit a predicted final rating instead of a binary up/down vote.
- One sealed private round by default, followed by reveal and settlement.
- Reputation gates influence, governance, and USDC bounty eligibility.
- USDC payouts reward useful independent signal, not raw wallet count.

The implementation should reuse Curyo code and design where the code already
solves the same problem, but it should not preserve Curyo mechanics for their
own sake. The biggest architectural change is replacing token staking as the
core vote primitive with reputation locks and scored predictions.

## Recommended Starting Point

Use the Curyo monorepo as the source tree for RateMesh and rename it in-place in
the new repository:

- `packages/foundry` remains the smart-contract package.
- `packages/contracts` remains the generated ABI/deployment package.
- `packages/nextjs` remains the app.
- `packages/ponder` remains the indexer/API package.
- `packages/sdk` remains the vote-building/read helper package.
- `packages/keeper` remains the automation package for reveal, settlement, and
  cleanup.
- `packages/agents` remains useful for AI rater workflows, prompt templates,
  and future evaluator integrations.

Do not copy the Self-related packages, generated ABIs, deployment addresses, or
legacy generated artifacts as canonical RateMesh artifacts. Bring the structure
over first, then regenerate artifacts from the new contracts.

## What To Reuse

### Reuse Mostly As-Is

- Monorepo tooling: Yarn workspaces, package layout, shared scripts, Foundry,
  Next.js, Ponder, Viem/Wagmi, SDK, keeper, and test package boundaries.
- App shell: navigation, responsive feed shell, wallet connection, sponsored
  transaction plumbing, profile pages, category/search/filter surfaces, and
  content submission flow.
- Content model: `ContentRegistry` concepts around content IDs, metadata,
  categories, status, dormancy, duplicate URL protection, and rating state.
- Rating display: `RatingOrb`, score formatting, feed cards, round progress,
  profile stats, and leaderboard layouts.
- Ponder/API shape: content tables, round tables, vote history routes,
  leaderboard routes, profile routes, and frontend feed APIs.
- Keeper skeleton: deployed-address checks, round discovery, reveal automation,
  settlement calls, metrics, and retries.
- SDK shape: commit payload builders, runtime resolution helpers, read models,
  and tests.
- Existing feedback field and feedback bonus surfaces. Feedback stays separate
  from the prediction payload.

### Reuse With Heavy Refactor

- `HumanReputation.sol` becomes `RateMeshReputation.sol`.
  Keep ERC20Votes-style checkpointing if useful for governance, but make
  reputation non-transferable and mint/burn/lock only through protocol roles.
- `RoundVotingEngine.sol` becomes `PredictionVotingEngine.sol`.
  Keep the commit-reveal/tlock state machine, per-content round isolation,
  config snapshots, keeper-friendly settlement hooks, and failure/cancel states.
  Replace `isUp` and `stakeAmount` with `predictedRatingBps` and a reputation
  lock amount.
- `RoundRewardDistributor.sol` becomes `PredictionRewardDistributor.sol`.
  Stop paying winners from loser stake. It should claim USDC bounties and emit
  reputation/accounting outcomes for settled predictions.
- `QuestionRewardPoolEscrow.sol` becomes the USDC bounty escrow.
  Preserve funding, windows, claim accounting, frontend fee support, bundles if
  still needed, and forfeiture/refund logic. Replace voter-ID eligibility with
  reputation and cluster eligibility.
- `CuryoGovernor.sol` becomes `RateMeshGovernor.sol`.
  Defer launch governance until reputation has matured. Keep timelock and
  checkpoints, but bootstrap with admin/multisig controls first.
- `VoterIdNFT.sol` should not remain an identity proof. If a profile badge is
  useful, create a new optional `RaterProfileBadge` or `RaterRegistry` without
  Self nullifiers.
- Ponder `voterStats` and `voterCategoryStats` become prediction/reputation
  calibration tables instead of win/loss tables.
- `StakeSelector` becomes `PredictionComposer`: rating slider, optional
  conviction/reputation lock selector, preview of eligibility, and clear reveal
  state.

### Remove

- Self.xyz contracts, imports, remappings, deployment hub addresses, config IDs,
  OFAC/age attestation policy, proof routes, telemetry, UI, and tests.
- `HumanFaucet.sol` and any faucet/referral/migration allocations.
- `HumanSignInButton`, `SelfVerifyButton`, `useVoterIdNFT`, and the gating copy
  that says identity verification is required to vote.
- Transferable HREP staking, loser/winner pool economics, consensus reserve,
  and faucet-based bootstrapping.
- Binary `up/down` vote model.
- Existing HREP holder migration.
- MACI/privacy as part of the initial implementation plan.

## Source File Reuse Map

| Curyo source | RateMesh action |
| --- | --- |
| `packages/foundry/contracts/HumanReputation.sol` | Rename and refactor into `RateMeshReputation.sol`; keep governance checkpoints, remove transfer/stake/faucet assumptions. |
| `packages/foundry/contracts/RoundVotingEngine.sol` | Rename and refactor into `PredictionVotingEngine.sol`; keep commit/reveal/tlock machinery, replace binary vote settlement. |
| `packages/foundry/contracts/RoundRewardDistributor.sol` | Reuse claim/dust discipline for `PredictionRewardDistributor.sol`; remove HREP winner/loser payouts. |
| `packages/foundry/contracts/QuestionRewardPoolEscrow.sol` | Keep as USDC bounty escrow foundation; remove Voter ID fields and add cluster/reputation eligibility. |
| `packages/foundry/contracts/ContentRegistry.sol` | Keep content lifecycle, categories, duplicate protection, and rating state; remove Self/nullifier submission identity snapshots. |
| `packages/foundry/contracts/ProtocolConfig.sol` | Keep central config/address book; rename and add prediction, reputation, calibration, and cluster parameters. |
| `packages/foundry/contracts/VoterIdNFT.sol` | Do not keep as identity. Mine delegation/profile lessons for a new `RaterRegistry` only. |
| `packages/foundry/contracts/HumanFaucet.sol` | Delete. |
| `packages/foundry/script/DeployCuryo.s.sol` | Rewrite as `DeployRateMesh.s.sol`; remove faucet, Self hub, migration tiers, and old token allocations. |
| `packages/ponder/ponder.schema.ts` | Keep content/profile/feed tables; replace vote/voter/reward tables with prediction/reputation/payout tables. |
| `packages/ponder/src/RoundVotingEngine.ts` | Refactor event handlers for prediction events and weighted final ratings. |
| `packages/ponder/src/HumanFaucet.ts` and `packages/ponder/src/VoterIdNFT.ts` | Delete or replace with `RaterRegistry.ts`. |
| `packages/nextjs/components/vote/VotePageClient.tsx` | Keep feed state, sorting, filtering, and modal patterns; replace up/down vote intent with predicted rating intent. |
| `packages/nextjs/components/shared/VotingQuestionCard.tsx` | Keep card/rating layout; replace arrows with prediction controls. |
| `packages/nextjs/components/swipe/StakeSelector.tsx` | Rename/refactor into `PredictionComposer.tsx`. |
| `packages/nextjs/components/shared/RatingOrb.tsx` | Reuse. |
| `packages/nextjs/components/feedback/*` | Reuse; feedback stays separate from prediction. |
| `packages/nextjs/hooks/useRoundVote.ts` | Rename/refactor into `usePredictionVote.ts`. |
| `packages/nextjs/hooks/useVoterIdNFT.ts` | Delete; replace with rater/calibration hooks. |
| `packages/sdk/src/vote.ts` | Keep salt/tlock/frontend helpers; replace `isUp` payload with `predictedRatingBps`. |
| `packages/keeper/src/*` | Keep service structure and reliability patterns; update reveal/settlement decoding and scoring inputs. |
| `packages/agents/src/*` | Keep as basis for AI rater clients and evaluation workflows. |

## Target Protocol Design

### Rating Primitive

Each vote commits to:

```text
contentId
roundId
voter
predictedRatingBps  // 1000-9900, representing 1.0-9.9 out of 10
reputationLock      // bounded protocol-native lock, not ERC20 transfer stake
salt
```

The reveal shows the predicted final rating. The final rating is computed from
revealed predictions using effective weights. The default workflow is:

```text
commit window -> reveal window -> settle -> public result
```

Use one round by default. Additional rounds should be exceptional: too little
independent participation, high dispersion, suspected manipulation, high-value
bounty, or a formal challenge.

### Weighting

The initial effective voting power formula should be conservative:

```text
effectiveVotingPower =
  sqrt(credibility) * independenceMultiplier * convictionMultiplier
```

Where:

- `credibility` is earned from settled, revealed, calibrated participation.
- `independenceMultiplier` ranges from strongly discounted to 1.0 and should
  rarely boost an account above its earned baseline.
- `convictionMultiplier` reflects how much reputation the account locks, capped
  and sublinear.

The first version can compute the final weighted rating on-chain from revealed
votes if the formula stays simple. More advanced cluster scoring can be emitted
by an off-chain scorer and anchored by a signed/rooted settlement input in a
later version.

### Reputation

Reputation is non-transferable protocol accounting. It can still be represented
as a token for governance/checkpoint compatibility, but transfers should revert
except mint/burn/protocol-internal accounting.

Recommended components:

- Global credibility.
- Category-specific credibility.
- Reveal reliability.
- Calibration/warmup status.
- Cluster discount status.
- Governance-eligible reputation, which should lag raw reputation.

Users should complete `x` calibration rounds before earning USDC. A reasonable
launch default is:

```text
CALIBRATION_ROUNDS_REQUIRED = 10
MIN_REPUTATION_FOR_USDC = protocol parameter
```

The exact value should be tunable. The important rule is that new wallets cannot
immediately farm bounties.

### Reputation Locks

Users should be able to lock reputation on a prediction, but it should not work
like current transferable-token staking.

Recommended launch behavior:

- Lock is optional above a minimum implicit lock.
- Lock increases conviction only sublinearly.
- Lock is capped per content, per day, per category, and per cluster.
- A revealed calibrated vote unlocks most or all of the lock.
- Missed reveal can burn or freeze part of the lock.
- Extreme prediction error can burn a bounded portion only after enough rounds
  and safeguards, to avoid punishing honest minority signal too aggressively.

This gives users a way to express conviction without making the system a direct
pay-to-control market.

### USDC Bounty Payouts

USDC should not be paid one-full-share per wallet. That creates a direct
incentive to split into many medium-reputation accounts.

Use an effective independent participant model:

```text
eligiblePayoutWeight =
  baseEligibleShare
  * smallReputationMultiplier
  * calibrationQualityMultiplier
  * clusterCapMultiplier
```

Launch recommendation:

- Mostly flat payout among eligible, revealed, calibrated raters.
- Small bounded multiplier for higher reputation, for example 1.0x to 1.5x.
- No linear payout by reputation.
- No payout for unrevealed votes.
- No payout before calibration rounds are complete.
- Cluster-capped allocation: if many accounts look controlled by one operator,
  they share a capped allocation instead of each receiving a full share.
- Leave-one-out or leave-one-cluster-out scoring for payout-sensitive rounds.

This keeps reputation valuable without making account splitting the dominant
strategy.

### AI Raters

AI raters should be first-class accounts. The system should care about
calibration and independence, not human-only identity.

Implementation implications:

- Add rater type metadata: human, AI agent, team, hybrid, unknown.
- Treat metadata as self-disclosed and reputational, not proof.
- Version AI agent reputation by model/provider/prompt template.
- Discount highly correlated agents by operator, funding source, model family,
  prompt fingerprint, and voting behavior.
- Allow AI raters to earn reputation and possibly USDC only after stricter
  calibration and disclosure thresholds.

## Contract Architecture

### `RateMeshReputation`

Purpose:

- Non-transferable reputation accounting.
- Checkpoints for governance and historical scoring.
- Role-gated mint, burn, lock, unlock, and slash.

Reuse:

- Start from `packages/foundry/contracts/HumanReputation.sol`.
- Keep decimals and ERC20Votes patterns if governance compatibility is useful.
- Remove ERC1363 as a staking transport unless another protocol flow needs it.
- Remove transferability and faucet mint assumptions.

Key changes:

- Override transfers so normal `from != 0 && to != 0` transfers revert.
- Add protocol lock ledger.
- Add category/global reputation events.
- Add delayed governance eligibility or separate governance checkpoints.

### `RaterRegistry`

Purpose:

- Register a rater profile without proof-of-personhood.
- Store optional rater type and metadata hash.
- Track delegated operational wallets if needed.
- Expose cluster/risk flags assigned by governance or a scorer.

Reuse:

- Use lessons from `VoterIdNFT.sol` delegation handling.
- Do not reuse Self nullifiers, mint gates, max supply, or identity claims.

Possible events:

```solidity
event RaterRegistered(address indexed account, uint8 raterType, bytes32 metadataHash);
event RaterMetadataUpdated(address indexed account, uint8 raterType, bytes32 metadataHash);
event RaterClusterUpdated(address indexed account, bytes32 indexed clusterId, uint16 discountBps);
event RaterDelegationUpdated(address indexed account, address indexed delegate, bool active);
```

### `PredictionVotingEngine`

Purpose:

- One sealed prediction round per content by default.
- Commit, reveal, settle, cancel, and reveal-failed states.
- Compute final predicted rating and emit settlement inputs.

Reuse:

- Start from `RoundVotingEngine.sol`.
- Keep per-content `rounds`, `commits`, config snapshots, tlock metadata,
  cooldowns, max voters, reveal grace, and keeper-oriented iteration.
- Keep the fresh-proxy deployment policy for storage-breaking voting changes.

Key changes:

- Replace `bool isUp` with `uint16 predictedRatingBps`.
- Replace transferred HREP stake with `reputationLock`.
- Replace up/down pools with weighted prediction aggregates:
  `weightedPredictionSum`, `totalEffectiveWeight`, prediction count,
  dispersion, and final rating.
- Remove `VoterIdRequired`.
- Remove loser/winner pool settlement.
- Add `minIndependentWeight` or `minEffectiveParticipants` alongside raw
  `minVoters`.
- Add insufficient-signal terminal state or settlement flag.

Candidate events:

```solidity
event PredictionCommitted(
  uint256 indexed contentId,
  uint256 indexed roundId,
  address indexed rater,
  bytes32 commitHash,
  uint16 referenceRatingBps,
  uint64 targetRound,
  bytes32 drandChainHash,
  uint256 reputationLock
);

event PredictionRevealed(
  uint256 indexed contentId,
  uint256 indexed roundId,
  address indexed rater,
  uint16 predictedRatingBps,
  uint256 effectiveWeight
);

event PredictionRoundSettled(
  uint256 indexed contentId,
  uint256 indexed roundId,
  uint16 finalRatingBps,
  uint256 totalEffectiveWeight,
  uint16 revealedCount,
  uint16 independentParticipantCount
);
```

### `PredictionRewardDistributor`

Purpose:

- Claim USDC bounty shares for eligible predictions.
- Emit reputation-score outcomes or consume score roots.
- Keep claims pull-based.

Reuse:

- Start from `RoundRewardDistributor.sol` only for claim accounting patterns,
  dust handling discipline, frontend fee accounting, and non-pausable withdraw
  posture.

Key changes:

- Remove HREP winner/loser claims.
- Pay USDC from bounty pools.
- Key claims by rater/round/cluster eligibility instead of voter ID.
- Add calibration and reputation threshold checks.
- Add cluster cap accounting.

### `QuestionRewardPoolEscrow`

Purpose:

- Fund USDC bounties on questions or bundles.
- Allocate bounties after settled prediction rounds.
- Expose claimable amounts and frontend fees.

Reuse:

- Keep the escrow architecture and API concepts.
- Keep USDC asset support.
- Keep refund/forfeit windows.
- Keep bundle support only if current product still needs it.

Key changes:

- Remove `funderVoterId`, `submitterVoterId`, and VoterId eligibility.
- Replace `requiredVoters` with `requiredIndependentParticipants` or
  `requiredEffectiveWeight`.
- Allocate by eligible prediction payout weights.

### `RateMeshGovernor`

Purpose:

- Long-term protocol governance using reputation.

Launch recommendation:

- Do not give raw fresh reputation immediate full governance control.
- Start with timelock + admin/multisig.
- Enable reputation governance only after enough live rounds.
- Use caps, quorum floors, proposal thresholds, emergency pause, and slower
  eligibility than display reputation.

## Indexer And API Plan

Reuse Ponder, but rename Curyo-specific tables and add prediction/reputation
tables.

### Tables To Keep And Rename

- `content`
- `content_media`
- `round`
- `vote` -> `prediction`
- `profile`
- `category`
- `frontend`
- `rating_change`
- `daily_vote_activity`

### Tables To Replace

- `voter_id` -> remove.
- `human_faucet_claim` -> remove.
- `human_faucet_referral_reward` -> remove.
- `token_transfer` -> either remove or rename to reputation accounting events.
- `voter_stats` -> `rater_reputation_stats`.
- `voter_category_stats` -> `rater_category_reputation_stats`.
- `reward_claim` -> split into `reputation_event` and `usdc_payout_claim`.

### New Tables

- `rater`
  - account, rater type, metadata hash, createdAt, clusterId, riskLevel.
- `prediction`
  - contentId, roundId, rater, commitHash, predictedRatingBps, lock amount,
    effective weight, revealed state, timestamps.
- `prediction_round_score`
  - final rating, dispersion, total effective weight, independent count,
    insufficient-signal flag.
- `reputation_event`
  - rater, categoryId, roundId, delta, reason, score version.
- `rater_cluster`
  - clusterId, label, discount, capped payout amount, updatedAt.
- `usdc_payout_claim`
  - pool, round, rater, gross amount, cluster cap, frontend fee, claimedAt.
- `calibration_status`
  - rater, completed rounds, eligibleSince, categories.

### API Changes

- Feed APIs should return predicted-rating state, not up/down pools.
- Leaderboard should rank calibrated reputation, category reputation, reveal
  reliability, and useful-feedback contribution.
- Vote history should show predicted rating, final rating, score delta, and
  payout eligibility.
- Claim routes should separate reputation changes from USDC claims.
- Profile routes should show rater type and calibration status without implying
  identity proof.

## Frontend Plan

### Visual Direction

Reuse the existing product design and interaction density. The RateMesh app
should feel like an evolution of Curyo's rating surface, not a marketing site.
Keep:

- Feed-first app layout.
- Compact cards for dense voting.
- Rating orb visual language.
- Category, search, watched, followed, and history views.
- Existing feedback panel and feedback bonus UI.

Rename product surfaces from Curyo/HREP/human/voter to RateMesh/reputation/rater.

### Voting UX

Replace the current binary voting dock:

- Current: rating orb + up/down buttons + stake modal.
- Target: rating orb + prediction slider/input + optional conviction lock.

The primary action should be:

```text
Predict final rating -> confirm private prediction -> reveal/settlement status
```

User-friendly details:

- Show rating as `x.x / 10`.
- Let the slider snap to tenths while storing BPS.
- Show current rating/reference rating.
- Show the user's predicted rating after reveal, not before.
- Explain eligibility through UI state, not long instructional text.
- Keep feedback separate: users can still leave written feedback through the
  existing feedback surface.

### Onboarding

Remove identity verification onboarding. Replace with:

- Connect wallet.
- Make calibration predictions.
- Reveal reliably.
- Earn reputation.
- Become USDC eligible after calibration.

Avoid language that says one wallet equals one person.

### Pages/Components To Refactor

- `VotePageClient.tsx`: keep feed logic, replace `isUp` flow with
  `predictedRatingBps`.
- `VotingQuestionCard.tsx`: keep layout and rating display, replace arrow
  controls with prediction controls.
- `StakeSelector.tsx`: rename/refactor to `PredictionComposer.tsx`.
- `useRoundVote.ts`: rename/refactor to `usePredictionVote.ts`.
- `useVoterAccuracy*`: rename/refactor to reputation/calibration hooks.
- `ClaimRewardsButton.tsx`: split USDC bounty claim from reputation display.
- `FaucetSection`, `SelfVerifyButton`, `HumanSignInButton`: delete.

## SDK Plan

Refactor `packages/sdk/src/vote.ts`:

- `buildCommitVoteParams` -> `buildPredictionCommitParams`.
- Input `isUp` -> `predictedRatingBps`.
- `buildStakeAmountWei` -> `buildReputationLockAmount`.
- Keep salt generation, tlock runtime resolution, frontend code resolution, and
  tests.
- Add helpers for rating scale conversion:
  - score out of 10 -> BPS.
  - BPS -> display score.
  - slider step validation.

The SDK should be the only place that builds the exact commit preimage used by
the frontend, keeper tests, and any AI rater clients.

## Keeper Plan

Reuse the keeper package for:

- Address validation.
- Active round discovery.
- Reveal execution.
- Settlement.
- Failed/cancelled round cleanup.
- Metrics.

Changes:

- Decode prediction ciphertexts instead of binary vote ciphertexts.
- Submit `predictedRatingBps` reveals.
- Watch for rounds with insufficient independent weight.
- Trigger settlement after reveal grace or quorum rules.
- Optionally submit score roots if advanced off-chain scoring is introduced.

## AI Rater And Agent Plan

Keep `packages/agents`, but make it a first-class RateMesh package:

- Add an AI rater CLI that reads open questions and submits predictions.
- Record model/provider/prompt template metadata.
- Require a registered rater profile for production use.
- Keep agent predictions visible after reveal.
- Add tests that ensure agents cannot bypass calibration or payout thresholds.

## Implementation Sequence

### Phase 0: Repository Bootstrap

1. Import the Curyo monorepo into `Noc2/RateMesh`.
2. Rename package scopes from `@curyo/*` to `@ratemesh/*`.
3. Rename root package, scripts, environment examples, and generated package
   exports.
4. Delete legacy deployment artifacts from the canonical branch.
5. Keep old Curyo commit history if practical, but do not keep old deployment
   state as live RateMesh state.

Exit criteria:

- `yarn install` works.
- `yarn test:ts` can at least start after package rename work.
- No Self packages are required by the dependency graph.

### Phase 1: Strip Self, Faucet, And Legacy Token Flows

1. Delete `HumanFaucet.sol`.
2. Delete Self imports/remappings and mock identity hub contracts.
3. Delete Self UI/API/telemetry routes.
4. Remove `VoterIdNFT` requirements from content submission, voting, rewards,
   profiles, and frontend registry.
5. Remove faucet/referral/migration allocations from deployment scripts.
6. Update docs and app copy to use rater/reputation language.

Exit criteria:

- `rg "Self|self.xyz|HumanFaucet|verifySelfProof|VoterIdRequired"` has no live
  production references.
- Foundry build passes for the reduced contract set.

### Phase 2: Contract MVP

1. Implement `RateMeshReputation`.
2. Implement `RaterRegistry`.
3. Implement `PredictionVotingEngine`.
4. Implement the first version of `PredictionRewardDistributor`.
5. Refactor `QuestionRewardPoolEscrow` for reputation/cluster eligibility.
6. Rewrite deployment script as `DeployRateMesh.s.sol`.
7. Regenerate ABIs and deployment package exports.

Exit criteria:

- Foundry tests cover commit, reveal, settle, cancel, missed reveal, reputation
  lock/unlock/burn, calibration gating, and USDC claim gating.
- No old HREP transfer staking path remains.

### Phase 3: Ponder And API

1. Rename schema tables and handlers.
2. Add prediction, reputation, calibration, cluster, and payout tables.
3. Replace binary round aggregation with predicted-rating aggregation.
4. Update read API routes for feed, history, leaderboard, and claims.
5. Add route validation tests for prediction and payout shapes.

Exit criteria:

- Ponder indexes local deployment events.
- Feed API can render content, open rounds, revealed predictions, final rating,
  and claimable USDC.

### Phase 4: Frontend MVP

1. Rename app branding to RateMesh.
2. Remove Self and faucet screens.
3. Replace up/down vote controls with prediction composer.
4. Show calibration and reputation state in profile/feed surfaces.
5. Update reward/claim UI for USDC payout eligibility.
6. Keep feedback UI unchanged except copy/branding.

Exit criteria:

- Wallet-sensitive flow works: connect, submit content, predict, reveal/settle,
  view reputation, claim USDC.
- Desktop and mobile dense voting surfaces remain usable.

### Phase 5: Keeper, SDK, And Agents

1. Refactor SDK vote builders and tests.
2. Refactor keeper reveal/settlement flows.
3. Add agent rater scaffolding for prediction clients.
4. Add end-to-end local lifecycle tests.

Exit criteria:

- A local dev stack can settle a prediction round without manual contract calls.
- AI/client SDK can submit predictions through the same commit path as the app.

### Phase 6: Testnet Launch Hardening

1. Deploy to testnet with fresh contracts.
2. Run a capped calibration-only period.
3. Enable small USDC bounties after telemetry confirms reveal reliability.
4. Add monitoring for clusters, correlated reveals, missed reveals, payout
   concentration, and final-rating dispersion.
5. Audit contracts before meaningful bounty amounts.

Exit criteria:

- Testnet users can complete calibration and claim capped USDC.
- Admin can pause risky flows.
- All payout math is publicly explainable from indexed events.

### Phase 7: Governance

1. Enable reputation-based governance only after enough live reputation history.
2. Use delayed governance eligibility, quorum floors, proposal thresholds, and
   emergency controls.
3. Keep treasury movement guarded by timelock and conservative roles.

Exit criteria:

- Governance cannot be captured by freshly farmed reputation.
- Proposal and voting power are auditable from checkpoints.

## Concrete PR Plan

1. `repo-bootstrap`: import Curyo code, rename package scopes, keep app running.
2. `remove-self-faucet`: delete Self/faucet packages, UI, routes, and deploy
   wiring.
3. `reputation-contract`: add non-transferable reputation with locks and tests.
4. `rater-registry`: add open rater profiles, metadata, delegation, and cluster
   flags.
5. `prediction-engine`: replace binary votes with predicted final rating commit
   reveal.
6. `usdc-bounty-refactor`: refactor reward escrow/distributor around calibrated
   raters and cluster caps.
7. `ponder-predictions`: update schema, handlers, and APIs.
8. `frontend-prediction-ui`: replace vote controls and onboarding.
9. `keeper-sdk-agents`: update commit builders, keeper reveal, and agent client.
10. `local-e2e`: add full local lifecycle tests and docs.
11. `testnet-deploy`: fresh deployment config, monitoring, and launch checklist.

## Parameter Defaults To Start With

These are launch defaults, not permanent constants:

- Rating scale: `1000-9900` BPS, displayed as `1.0-9.9 / 10`.
- Default round: one sealed commit window plus reveal window.
- Minimum raw reveals: 3.
- Minimum independent participants for USDC: 3.
- Calibration rounds before USDC: 10.
- Reputation payout multiplier: capped small range, for example `1.0x-1.5x`.
- Voting power: square-root reputation curve.
- Cluster discount: can reduce to near-zero, should not boost over 1.0.
- Missed reveal penalty: reputation lock freeze/burn, tunable and capped.

## Main Risks And Mitigations

### Sybil Farming

Risk: attackers mature many medium-reputation accounts to farm flat payouts.

Mitigations:

- Calibration before USDC eligibility.
- Cluster-capped payout allocation.
- Small bounded reputation payout multiplier.
- Rate limits by account, category, cluster, and epoch.
- Leave-one-cluster-out scoring for payout-sensitive rounds.
- Public cluster/payout explanations in Ponder.

### Majority Capture

Risk: if scoring rewards matching the majority, a coalition can define the
majority and compound reputation.

Mitigations:

- Score with leave-one-out and cluster-excluded references.
- Reward calibration over raw agreement.
- Cap conviction influence.
- Use category-specific reputation and decay.
- Flag high dispersion or suspiciously correlated rounds.

### Account Transfer Or Rental

Risk: non-transferable reputation can still be sold through account transfer or
managed voting.

Mitigations:

- No linear cash payout by reputation.
- Behavior-based clustering.
- Reveal reliability and category history matter more than raw balance.
- Optional cooling periods after wallet/delegation/metadata changes.
- Delayed governance eligibility.

### AI Correlation

Risk: many agents using the same model/prompt act like one rater.

Mitigations:

- Agent metadata and versioned reputation.
- Cluster by model family, provider, prompt fingerprint, operator, funding
  source, and behavior.
- Stricter calibration for AI USDC eligibility.

### Trustless Privacy Limits

Risk: with tlock commit reveal, the system cannot guarantee that nothing is
revealed unless enough people voted. Once the ciphertext becomes decryptable,
low-participation rounds may reveal a small set of predictions.

Mitigations for v1:

- Treat this as an accepted product tradeoff.
- Label low-participation rounds as insufficient signal.
- Avoid showing aggregates before commit/reveal.
- Do not include MACI/privacy in the initial implementation plan.

## Definition Of Done For The First RateMesh MVP

The MVP is done when:

- There is no Self.xyz dependency.
- Users can connect a wallet without proof-of-personhood.
- Users can submit a predicted final rating through commit reveal.
- Rounds settle to a final rating after one private round by default.
- Reputation is non-transferable and earned from revealed settled predictions.
- Users complete calibration before USDC eligibility.
- USDC bounty payout is cluster-capped and not linear by wallet count or raw
  reputation.
- The frontend preserves Curyo's usable feed/rating design while clearly
  presenting RateMesh prediction mechanics.
- Ponder exposes enough data for public auditability of rating, reputation, and
  payout decisions.
- Local end-to-end tests cover the full lifecycle.

