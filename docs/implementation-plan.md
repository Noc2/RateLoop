# RateMesh Implementation Plan

Planning date: 2026-05-07

## Goal

RateMesh should be a fresh deployment, not a legacy-compatible Curyo migration,
but it should reuse the existing CREP/HREP snapshot as the genesis community
distribution because those holders helped develop the protocol.
The product direction is:

- Open rating network for humans, AI agents, teams, and hybrid workflows.
- No Self.xyz integration and no proof-of-personhood dependency.
- Day-one decentralized governance using a genesis distribution to previous
  CREP/HREP snapshot participants.
- Deploy on Base mainnet, with Base Sepolia as the testnet path.
- Transferable capped Mesh Reputation token (`MREP`) for governance,
  prediction locks, frontend staking, and long-term protocol ownership.
- Use `MREP` as the working implementation label; the earlier `RREP` label is
  superseded unless governance changes naming before deployment.
- Reuse HREP tokenomics for MREP: `100,000,000` max supply split into the
  existing `52M / 12M / 32M / 4M` launch pools.
- Users submit a predicted final rating instead of a binary up/down vote.
- One sealed private round per bounty, followed by reveal and settlement.
- MREP locks use a winner/loser redistribution model adapted from Curyo, so
  accurate raters earn from less accurate raters without increasing total
  supply.
- Reputation gates influence, governance, and USDC bounty eligibility.
- AI raters can earn USDC at launch after the same calibration requirement as
  other accounts, with required model/operator/prompt-version metadata.
- USDC payouts reward useful independent signal, not raw wallet count.
- Frontend operators keep the old 3% default earning share on bounty and
  feedback payouts, with governance able to tune it up to a 5% cap, and must
  stake MREP to be fee-eligible.

The implementation should reuse Curyo code and design where the code already
solves the same problem, but it should not preserve Curyo mechanics for their
own sake. The biggest architectural change is replacing binary token staking as
the core vote primitive with predicted ratings, transferable capped reputation
locks, account-level calibration, cluster-aware payout controls, and a
Base-native deployment.

## Research Notes For The Updated Architecture

This is protocol design context, not legal advice. RateMesh should still get
jurisdiction-specific legal review before launching a transferable token.

The recommended governance and chain architecture should follow established
on-chain patterns:

- OpenZeppelin Governor supports modular token-voting governance, including
  `GovernorVotes`, quorum modules, settings modules, and timelock execution.
- OpenZeppelin's timelock guidance says self-governed timelocks should make the
  timelock itself the long-term admin after setup, so future maintenance goes
  through governance.
- OpenZeppelin `ERC20Votes` keeps historical vote checkpoints and supports
  delegation, which is the right primitive for transferable governance
  reputation.
- Compound shows a mature pattern of tokenholder governance with delegation,
  Governor Bravo, and Timelock-controlled protocol changes.
- ENS is a relevant launch-distribution precedent: the ENS DAO distributed
  governance tokens to prior users and uses that token for major DAO decisions.
- MiCA's recital on fully decentralized services is a reminder that legal
  decentralization is broader than token distribution. The protocol should
  minimize ongoing company discretion over upgrades, scoring, treasury, and
  payout eligibility from day one.
- Base mainnet is a good deployment target for this design because it is an
  EVM L2 with ETH as gas, broad wallet support, and native USDC. The official
  Base docs list mainnet chain ID `8453` and Base Sepolia chain ID `84532`.
- Circle lists native USDC on Base mainnet at
  `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` and Base Sepolia USDC at
  `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
- A winner/loser MREP lock model is economically closer to a parimutuel
  prediction mechanism than an inflationary reputation model: accurate
  predictions earn from inaccurate locks, while the protocol's total supply cap
  remains fixed.
- Proper scoring-rule and forecasting-tournament literature supports rewarding
  forecast quality rather than raw participation, but RateMesh should avoid a
  pure cash scoring rule because the target result is endogenous: raters are
  predicting the crowd's final rating and can partially influence it. This is
  why the v1 plan uses bounded locks, leave-one-out scoring, calibration, and
  cluster caps.

Sources:

- OpenZeppelin Governor documentation:
  https://docs.openzeppelin.com/contracts/4.x/api/governance
- OpenZeppelin governance setup guide:
  https://docs.openzeppelin.com/contracts/4.x/governance
- OpenZeppelin ERC20Votes documentation:
  https://docs.openzeppelin.com/contracts/5.x/api/token/erc20
- Compound governance documentation:
  https://docs.compound.finance/v2/governance/
- ENS token documentation:
  https://docs.ens.domains/dao/token/
- MiCA Regulation recital 22:
  https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32023R1114
- Base network information:
  https://docs.base.org/base-chain/quickstart/connecting-to-base
- Circle USDC contract addresses:
  https://developers.circle.com/stablecoins/usdc-contract-addresses
- Strictly Proper Scoring Mechanisms Without Expected Arbitrage:
  https://ideas.repec.org/p/arx/papers/2409.07046.html
- Pari-Mutuel Markets: Mechanisms and Performance:
  https://link.springer.com/chapter/10.1007/978-3-540-77105-0_11

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

## Base Deployment And Assets

RateMesh should target Base instead of Celo.

Launch network defaults:

- Mainnet: Base, chain ID `8453`, ETH gas.
- Testnet: Base Sepolia, chain ID `84532`, ETH gas.
- Mainnet USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
- Production RPC should use a paid/provider endpoint or self-hosted node. Base's
  public RPC endpoints are useful for defaults and tests, not production
  throughput.

Implementation implications:

- Replace Celo and Celo Sepolia chain constants across Foundry deployment
  scripts, Wagmi/thirdweb config, Ponder config, keeper config, SDK runtime
  helpers, docs, and environment examples.
- Rename environment variables toward Base, for example `BASE_RPC_URL`,
  `BASE_SEPOLIA_RPC_URL`, `BASESCAN_API_KEY`, and `NEXT_PUBLIC_CHAIN_ID`.
- Keep all USDC accounting at 6 decimals and use Circle native USDC, not bridged
  USDC variants.
- Update block explorer links to BaseScan or Base Blockscout consistently.
- Audit every old `CELO`, `Celo`, `celo`, `chainId`, and USDC-address constant
  before deployment.

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

- `HumanReputation.sol` becomes `MeshReputation.sol`.
  Keep ERC20Votes-style checkpointing, keep transfers enabled, and add a hard
  `MAX_SUPPLY`. Protocol earning can distribute only from pre-funded capped
  pools; there should be no uncapped mint path.
- `RoundVotingEngine.sol` becomes `PredictionVotingEngine.sol`.
  Keep the commit-reveal/tlock state machine, per-content round isolation,
  config snapshots, keeper-friendly settlement hooks, and failure/cancel states.
  Replace `isUp` and `stakeAmount` with `predictedRatingBps` and a reputation
  lock amount.
- `RoundRewardDistributor.sol` becomes `PredictionRewardDistributor.sol`.
  Keep the pull-claim discipline and adapt the old winner/loser economics from
  binary pools to continuous prediction-error pools. It should also claim USDC
  bounties and emit reputation/accounting outcomes for settled predictions.
- `QuestionRewardPoolEscrow.sol` becomes the USDC bounty escrow.
  Preserve funding, windows, claim accounting, frontend fee support, bundles if
  still needed, and forfeiture/refund logic. Replace voter-ID eligibility with
  reputation and cluster eligibility.
- `CuryoGovernor.sol` becomes `RateMeshGovernor.sol`.
  Launch it from day one with Timelock-owned protocol roles and genesis
  governance distribution.
- `VoterIdNFT.sol` should not remain an identity proof. If a profile badge is
  useful, create a new optional `RaterProfileBadge` or `RaterRegistry` without
  Self nullifiers.
- Ponder `voterStats` and `voterCategoryStats` become prediction/reputation
  calibration tables instead of win/loss tables.
- `StakeSelector` becomes `PredictionComposer`: rating slider, bounded MREP
  lock selector, preview of eligibility, and clear reveal state.

### Remove

- Self.xyz contracts, imports, remappings, deployment hub addresses, config IDs,
  OFAC/age attestation policy, proof routes, telemetry, UI, and tests.
- `HumanFaucet.sol` and any faucet/referral/migration allocations. The old
  52M faucet-sized pool becomes the existing CREP/HREP snapshot claim pool.
- `HumanSignInButton`, `SelfVerifyButton`, `useVoterIdNFT`, and the gating copy
  that says identity verification is required to vote.
- Legacy HREP staking as a binary-vote transport and faucet-based
  bootstrapping. Keep the useful capped winner/loser and reserve math, but
  adapt it to predicted-rating error.
- Binary `up/down` vote model.

## Source File Reuse Map

| Curyo source | RateMesh action |
| --- | --- |
| `packages/foundry/contracts/HumanReputation.sol` | Rename and refactor into `MeshReputation.sol`; keep transferability and governance checkpoints, add hard supply cap, remove faucet assumptions, and replace binary-vote staking with prediction locks. |
| `packages/foundry/contracts/RoundVotingEngine.sol` | Rename and refactor into `PredictionVotingEngine.sol`; keep commit/reveal/tlock machinery, replace binary vote settlement. |
| `packages/foundry/contracts/RoundRewardDistributor.sol` | Reuse claim/dust discipline and old reward-split math for `PredictionRewardDistributor.sol`; replace binary HREP winner/loser payouts with prediction-error MREP redistribution plus USDC bounty claims. |
| `packages/foundry/contracts/QuestionRewardPoolEscrow.sol` | Keep as USDC bounty escrow foundation; remove Voter ID fields and add cluster/reputation eligibility. |
| `packages/foundry/contracts/ContentRegistry.sol` | Keep content lifecycle, categories, duplicate protection, and rating state; remove Self/nullifier submission identity snapshots. |
| `packages/foundry/contracts/ProtocolConfig.sol` | Keep central config/address book; rename and add prediction, reputation, calibration, and cluster parameters. |
| `packages/foundry/contracts/VoterIdNFT.sol` | Do not keep as identity. Mine delegation/profile lessons for a new `RaterRegistry` only. |
| `packages/foundry/contracts/HumanFaucet.sol` | Delete; replace the old 52M faucet allocation with the existing CREP/HREP snapshot claim pool. |
| `packages/foundry/script/DeployCuryo.s.sol` | Rewrite as `DeployRateMesh.s.sol`; remove faucet, Self hub, and migration tiers; add the existing CREP/HREP snapshot Merkle distribution, HREP-style MREP launch pools, Governor, Timelock, Base constants, and Timelock ownership from launch. |
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
reputationLock      // bounded MREP lock escrowed until reveal/settlement
salt
```

The reveal shows the predicted final rating. The final rating is computed from
revealed predictions using effective weights. The default bounty workflow is:

```text
bounty funded -> commit window -> reveal window -> settle -> public result
```

RateMesh v1 should use exactly one sealed round per bounty. Do not keep Curyo's
multi-round bounty model where one bounty waits for several settled rounds.
After a round reveals, later votes are no longer independent predictions of the
same hidden result; they are reactions to an already-public rating.

### Challenge And Re-rate Flow

Keep `roundId` per content, but define each round as a separate funded
evaluation. A challenge or re-rate is a new bounty, not a continuation of the
old bounty.

Recommended flow:

```text
public result -> fund challenge/re-rate -> new sealed round -> new public result
```

Use cases:

- The original round had insufficient independent signal.
- The rating is stale because the content, model, or context changed.
- A funder suspects manipulation or correlated voting.
- A high-value decision wants a second independent read.
- A community member simply wants to pay for an updated rating.

Implementation rules:

- A bounty funds one and only one prediction round.
- USDC payout applies only to that bounty's round.
- Challenge/re-rate bounties reference the prior `roundId` or rating they are
  challenging.
- Challenge/re-rate rounds should show their reason, funder, and relationship
  to the prior result in the UI and indexer.
- A new result appends to rating history and may become the current rating; it
  should not automatically slash or invalidate the prior round.
- Add cooldowns or minimum bounty thresholds to prevent cheap re-rate spam.
- If a round ends as `InsufficientSignal` or `RevealFailed`, the bounty should
  follow explicit refund/forfeit rules and should not silently roll into a
  second round.

### Weighting

The initial effective voting power formula should be conservative:

```text
effectiveVotingPower =
  sqrt(lockedReputation) * calibrationMultiplier * independenceMultiplier
```

Where:

- `lockedReputation` is transferable Mesh Reputation locked for this
  prediction.
- `calibrationMultiplier` is earned from settled, revealed, calibrated
  participation and is account/category-specific.
- `independenceMultiplier` ranges from strongly discounted to 1.0 and should
  rarely boost an account above its earned baseline.

The first version can compute the final weighted rating on-chain from revealed
votes if the formula stays simple. More advanced cluster scoring can be emitted
by an off-chain scorer and anchored by a signed/rooted settlement input in a
later version.

### Reputation

Mesh Reputation (`MREP`) should be a transferable, capped ERC20Votes-style
token.
The legal/decentralization motivation is that protocol governance should not
remain company-controlled at launch. The practical product motivation is that
the existing CREP/HREP snapshot already represents the community that helped
build the protocol and should be the initial governance and ownership base.

The token should not be the only signal for rating or USDC payouts. Transferable
reputation can be bought, so RateMesh should pair it with account-level
calibration and cluster discounts.

Recommended token properties:

- Transferable ERC20 with ERC20Votes checkpoints and delegation.
- 6 decimals to preserve compatibility with the old HREP mental model.
- Hard `MAX_SUPPLY`; no uncapped inflation.
- Genesis distribution from the existing CREP/HREP snapshot, mapped 1:1 into
  MREP claim amounts unless the already-approved snapshot artifact says
  otherwise.
- HREP tokenomics reused for launch pools, with the full cap allocated at
  deployment.
- Bootstrap rewards and consensus subsidies distribute from fixed pre-funded
  pools instead of open-ended minting.
- Governance/timelock controls pool parameters and treasury usage, not
  discretionary uncapped supply creation.
- Rating influence uses locked token balance through a square-root curve.

Recommended non-token scoring components:

- Calibration rounds completed.
- Global prediction calibration.
- Category-specific calibration.
- Reveal reliability.
- Cluster discount status.
- Payout eligibility status.

Users should complete `x` calibration rounds before earning USDC. A reasonable
launch default is:

```text
CALIBRATION_ROUNDS_REQUIRED = 10
MIN_REPUTATION_FOR_USDC = protocol parameter
```

The exact value should be tunable. The important rule is that new wallets cannot
immediately farm bounties.

### Mesh Reputation (MREP) Tokenomics And Genesis Snapshot

Mesh Reputation (`MREP`) should reuse HREP tokenomics rather than inventing a
new launch split.
The deployment should mint or allocate the full capped supply into auditable
contracts at launch.

Launch allocation:

```text
MAX_SUPPLY = 100,000,000 MREP

52,000,000 MREP  Genesis snapshot claim pool
12,000,000 MREP  Bootstrap / calibrated participation pool
32,000,000 MREP  DAO treasury
 4,000,000 MREP  Consensus subsidy / reserve pool
```

Snapshot rule:

- Reuse the existing CREP/HREP snapshot artifact as the canonical genesis claim
  list. Do not regenerate a new snapshot formula from current balances unless
  governance explicitly rejects the existing artifact before deployment.
- Import the snapshot artifact into the RateMesh repo with the claim index,
  account, amount, snapshot provenance, and Merkle root.
- If the existing artifact uses the old `CREP` name, treat the claim amount as
  `MREP` 1:1.
- If the snapshot total is below `52,000,000 MREP`, the remainder stays in the
  Merkle distributor until the claim window ends, then moves to the DAO treasury
  or another governance-controlled reserve by the published claim rules.
- If the snapshot total exceeds `52,000,000 MREP`, deployment must stop; do not
  silently scale claims down.
- The claim UI should show the snapshot source and Merkle proof; it should not
  imply a Self.xyz or proof-of-personhood requirement.

Bootstrap pool:

- Reuse the old HREP bootstrap mental model: a fixed `12,000,000 MREP` pool
  used for calibrated participation rewards.
- Bootstrap rewards are not automatic faucet claims. They are paid only after
  valid, revealed, calibrated participation or governance-approved programs.
- Because MREP is transferable and capped, bootstrap rewards should be
  conservative after USDC payouts launch; the main ongoing cash incentive should
  come from funded USDC bounties.

Consensus reserve:

- Keep a fixed `4,000,000 MREP` reserve to handle unanimous or near-unanimous
  rounds where there is little or no losing lock pool.
- Preserve the old safety idea of a capped subsidy per round. A good launch
  default is `min(5% of revealed locked MREP, 50 MREP)`.
- Subsidies are optional support for signal quality, not a replacement for
  winner/loser redistribution.

### Reputation Locks

Users should lock transferable MREP on each prediction. The lock should keep the
old Curyo intuition that accurate raters earn from inaccurate raters, but adapt
it to continuous predicted ratings instead of binary up/down pools.

Recommended launch defaults:

```text
MIN_PREDICTION_LOCK = 1 MREP
DEFAULT_PREDICTION_LOCK = 5 MREP
MAX_PREDICTION_LOCK = 100 MREP
MAX_DAILY_LOCK_PER_ACCOUNT = 250 MREP
MAX_DAILY_LOCK_PER_CLUSTER = governance parameter
FULL_WIN_BAND = 0.25 rating points
LOSS_CUTOFF = 1.00 rating point
REVEALED_LOSER_REFUND = 5%
```

Settlement model:

1. Compute the final rating from revealed predictions using effective voting
   power.
2. For each rater, compute scoring against a leave-one-out final rating when
   enough independent participants remain after removing that rater. This
   prevents a high-lock account from scoring itself against a result it heavily
   moved.
3. Compute `error = abs(predictedRating - scoringReferenceRating)`.
4. If `error <= FULL_WIN_BAND`, the rater keeps the full lock and receives a
   full winner score.
5. If `FULL_WIN_BAND < error < LOSS_CUTOFF`, the rater loses a linear portion
   of the lock and receives a linearly reduced winner score.
6. If `error >= LOSS_CUTOFF`, the rater is a losing prediction for MREP
   settlement and loses the at-risk lock, except for the revealed-loser refund.
7. Missed reveals forfeit the prediction lock after the reveal grace period and
   receive no loser refund.

Redistribution model:

```text
grossLosingPool = inaccurateLockLosses + missedRevealForfeits
revealedLoserRefund = 5% of revealed inaccurate lock losses
netLosingPool = grossLosingPool - revealedLoserRefund

90% netLosingPool -> accurate revealed raters
 4% netLosingPool -> eligible registered frontends
 1% netLosingPool -> DAO treasury
 5% netLosingPool -> consensus reserve
```

Accurate-rater shares should be proportional to:

```text
winnerShareWeight =
  winnerScore
  * sqrt(lockedMREP)
  * calibrationMultiplier
  * independenceMultiplier
```

Design notes:

- This keeps total MREP supply capped because normal settlement only moves
  already-issued MREP between raters, frontends, treasury, and reserve.
- The square-root lock curve prevents large holders from getting linear rating
  control.
- The error band avoids punishing honest near-misses too harshly.
- The losing cutoff gives the protocol an understandable "you were materially
  wrong" threshold.
- The missed-reveal penalty should be harsher than a revealed wrong prediction
  because commit-reveal only works if raters reveal.
- Governance can tune bands, lock caps, split percentages, and reserve subsidy,
  but v1 should keep the old Curyo defaults unless testnet data gives a strong
  reason to change them.

### USDC Bounty Payouts

USDC should not be paid one-full-share per wallet. That creates a direct
incentive to split into many medium-reputation accounts.

Use an effective independent participant model:

```text
eligiblePayoutWeight =
  baseEligibleShare
  * predictionQualityMultiplier
  * smallReputationMultiplier
  * calibrationQualityMultiplier
  * clusterCapMultiplier
```

Launch recommendation:

- Mostly flat payout among eligible, revealed, calibrated raters.
- No USDC for missed reveals or materially losing predictions at or beyond the
  MREP `LOSS_CUTOFF`.
- Small bounded prediction-quality multiplier for better calibrated forecasts,
  for example `0.75x-1.5x` inside the winning/near-winning band.
- Small bounded multiplier for higher reputation, for example `1.0x-1.25x`.
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
- AI raters can earn USDC at launch after the same calibration requirement as
  human/team accounts. Do not require a later AI-only launch phase.
- Require AI metadata before production bounty participation:
  - `model`
  - `operator`
  - `promptVersionHash` or `promptHash`
  - optional `modelConfigHash`, `agentClientVersion`, and `evaluationPolicyHash`
- Version AI agent reputation by model/provider/prompt template.
- Discount highly correlated agents by operator, funding source, model family,
  prompt fingerprint, and voting behavior.
- Apply the same `CALIBRATION_ROUNDS_REQUIRED = 10` launch rule to AI raters,
  but make missing or stale AI metadata payout-ineligible until corrected.

## Contract Architecture

### `MeshReputation`

Purpose:

- Transferable capped reputation token.
- ERC20Votes checkpoints and delegation for day-one governance.
- Protocol-native lock, unlock, slash, and redistribution hooks.
- Merkle-claimable genesis allocation from the existing CREP/HREP snapshot.
- Fixed HREP-style launch pools for snapshot claims, bootstrap rewards,
  treasury, and consensus reserve.

Reuse:

- Start from `packages/foundry/contracts/HumanReputation.sol`.
- Keep 6 decimals, ERC20Votes, ERC20Permit, and self-delegation-on-receipt if
  the UX still benefits from it.
- Keep the existing `MAX_SUPPLY` concept at `100,000,000 * 1e6`.
- Remove ERC1363 as a staking transport unless another protocol flow needs it.
- Remove faucet mint assumptions.

Key changes:

- Keep normal transfers enabled.
- Enforce hard max supply on all mint paths.
- Add protocol lock ledger with per-round lock accounting.
- Add fixed launch-pool accounting:
  `GENESIS_SNAPSHOT_POOL = 52_000_000e6`,
  `BOOTSTRAP_POOL = 12_000_000e6`, `DAO_TREASURY = 32_000_000e6`, and
  `CONSENSUS_RESERVE = 4_000_000e6`.
- Add `GENESIS_DISTRIBUTOR_ROLE`, `BOOTSTRAP_DISTRIBUTOR_ROLE`, and protocol
  lock/slash roles controlled by governance/timelock.
- Add events for genesis claims, bootstrap distributions, locks, unlocks,
  redistributions, and slashes.
- Preserve vote checkpoints for historical governance snapshots.

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
event AIRaterMetadataUpdated(
  address indexed account,
  bytes32 indexed operatorHash,
  bytes32 modelHash,
  bytes32 promptVersionHash,
  bytes32 metadataHash
);
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
- Track MREP lock outcomes: returned lock, revealed-loser refund, net losing
  pool, winner pool, frontend share, treasury share, and reserve share.
- Treat each funded bounty as one sealed prediction round.
- Allow later `roundId`s for challenge/re-rate bounties, but do not continue the
  old bounty across multiple rounds.
- Remove `VoterIdRequired`.
- Remove binary loser/winner pool settlement, but keep the old split constants
  adapted to prediction error.
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
  bytes32 raterMetadataHash,
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

event PredictionLockSettled(
  uint256 indexed contentId,
  uint256 indexed roundId,
  address indexed rater,
  uint256 returnedLock,
  uint256 refundedLoss,
  uint256 redistributedLoss,
  uint16 errorBps,
  uint16 winnerScoreBps
);

event PredictionRoundLinkedToBounty(
  uint256 indexed contentId,
  uint256 indexed roundId,
  uint256 indexed bountyId,
  uint8 bountyKind,
  uint256 challengedRoundId,
  bytes32 reasonHash
);
```

### `PredictionRewardDistributor`

Purpose:

- Redistribute MREP lock losses from inaccurate or unrevealed predictions to
  accurate revealed raters, eligible frontends, treasury, and consensus reserve.
- Claim USDC bounty shares for eligible predictions.
- Emit reputation-score outcomes or consume score roots.
- Keep claims pull-based.

Reuse:

- Start from `RoundRewardDistributor.sol` only for claim accounting patterns,
  dust handling discipline, frontend fee accounting, and non-pausable withdraw
  posture.

Key changes:

- Replace binary HREP winner/loser claims with predicted-rating error claims.
- Preserve the old split defaults for MREP losses: 5% revealed loser refund,
  then 90% to accurate raters, 4% to eligible frontends, 1% to treasury, and 5%
  to consensus reserve.
- Pay USDC from bounty pools.
- Keep USDC payout accounting separate from MREP lock redistribution.
- Key claims by rater/round/cluster eligibility instead of voter ID.
- Add calibration and reputation threshold checks.
- Add cluster cap accounting.

### `QuestionRewardPoolEscrow`

Purpose:

- Fund USDC bounties on initial ratings, challenges, or re-rates.
- Allocate each bounty after its single settled prediction round.
- Expose claimable amounts and frontend fees.

Reuse:

- Keep the escrow architecture and API concepts.
- Keep USDC asset support.
- Keep refund/forfeit windows.
- Keep bundle support only if current product still needs it, but do not let one
  bounty depend on multiple follow-up rounds for the same content.

Key changes:

- Remove `funderVoterId`, `submitterVoterId`, and VoterId eligibility.
- Replace `requiredVoters` with `requiredIndependentParticipants` or
  `requiredEffectiveWeight`.
- Remove `requiredSettledRounds` from the normal bounty model.
- Add a bounty kind such as `Initial`, `Challenge`, or `Rerate`.
- For challenge/re-rate bounties, store the challenged `roundId` and optional
  reason/spec hash.
- Preserve the old frontend earning model: default `frontendFeeBps = 300`
  (3%), governance-tunable up to `MAX_FRONTEND_FEE_BPS = 500` (5%).
- Allocate by eligible prediction payout weights.
- Pay AI raters through the same USDC path as other raters once they satisfy
  calibration and required metadata.

### `FrontendRegistry`

Purpose:

- Give independent frontends a clear economic reason to integrate RateMesh.
- Attribute prediction commits, bounty claims, and feedback awards to a
  registered frontend/operator.
- Let frontend operators claim their share through a pull-based flow.

Reuse:

- Keep the current frontend-code attribution model.
- Keep eligibility/stake concepts for spam resistance and operator
  accountability, denominated in MREP.
- Keep keeper/frontend-fee sweep support for hosted frontends.

Launch rule:

- Frontends must stake MREP to be fee-eligible.
- Default required frontend stake: `1,000 MREP`, matching the old fixed frontend
  registry stake mental model.
- Default frontend share: 3% of eligible bounty and feedback payouts.
- Max frontend share: 5%, adjustable only by governance.
- If frontend fee transfer or registry credit fails, fallback should pay the
  rater rather than trapping user funds.
- Slashed or underbonded frontends should lose future fee eligibility and may
  have historical unclaimed fees routed to the protocol, matching the current
  design intent.

### `RateMeshGovernor`

Purpose:

- Day-one decentralized protocol governance using transferable capped
  reputation.

Launch requirements:

- Deploy `RateMeshGovernor`, `TimelockController`, `MeshReputation`, and
  core protocol contracts together.
- Timelock owns ProxyAdmins, treasury roles, config roles, bootstrap pool roles,
  reserve roles, and protocol upgrade authority from launch.
- Governor is the timelock proposer/canceller.
- Executor should be open to `address(0)` after setup so anyone can execute
  queued successful proposals.
- Deployer receives only temporary setup roles and must renounce them after
  deployment verification.
- Protocol contracts should not depend on company-administered off-chain scoring
  for v1 settlement.
- Emergency authority, if any, should be a narrow pause-only security council
  with a public sunset or governance-ratified membership.

Recommended initial parameters:

- Voting delay: long enough for delegates to inspect proposals, for example
  1-2 days.
- Voting period: 5-7 days.
- Timelock delay: at least 2 days.
- Proposal threshold: high enough to prevent spam but not so high that genesis
  governance is symbolic.
- Quorum: percentage of delegated circulating supply, using
  `GovernorVotesQuorumFraction`.
- Late-quorum extension: use a prevent-late-quorum style extension if included.

Governance can still use separate risk controls for rating/payout eligibility,
but protocol ownership should be live and tokenholder-controlled from the first
deployment.

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
- `token_holder`
- `token_transfer`
- `rating_change`
- `daily_vote_activity`

### Tables To Replace

- `voter_id` -> remove.
- `human_faucet_claim` -> remove.
- `human_faucet_referral_reward` -> remove.
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
- `reputation_lock_settlement`
  - rater, roundId, lock amount, returned amount, refund amount,
    redistributed amount, error, winner score, claimedAt.
- `rater_cluster`
  - clusterId, label, discount, capped payout amount, updatedAt.
- `usdc_payout_claim`
  - pool, round, rater, gross amount, cluster cap, frontend fee, claimedAt.
- `ai_rater_metadata`
  - rater, operator, model, promptVersionHash, metadataHash, updatedAt.
- `calibration_status`
  - rater, completed rounds, eligibleSince, categories.
- `rating_bounty`
  - bountyId, contentId, roundId, bounty kind, challengedRoundId, reason hash,
    funder, asset, amount, status, refund/forfeit state.
- `genesis_claim`
  - account, amount, claim index, claimedAt, transaction hash.
- `governance_delegate`
  - delegator, delegate, votes, updatedAt.

### API Changes

- Feed APIs should return predicted-rating state, not up/down pools.
- Feed APIs should distinguish initial ratings from challenge/re-rate rounds.
- Leaderboard should rank calibrated reputation, category reputation, reveal
  reliability, and useful-feedback contribution.
- Vote history should show predicted rating, final rating, score delta, and
  payout eligibility.
- Claim routes should separate reputation changes from USDC claims.
- Content routes should expose rating history so users can see when a current
  score came from an initial bounty versus a later re-rate.
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
- Frontend registration, frontend-code attribution, claimable frontend fees,
  and the 3% default frontend operator share.

Rename product surfaces from Curyo/HREP/human/voter to
RateMesh/MREP/reputation/rater.

### Voting UX

Replace the current binary voting dock:

- Current: rating orb + up/down buttons + stake modal.
- Target: rating orb + prediction slider/input + bounded MREP lock selector.

The primary action should be:

```text
Predict final rating -> confirm private prediction -> reveal/settlement status
```

User-friendly details:

- Show rating as `x.x / 10`.
- Let the slider snap to tenths while storing BPS.
- Show current rating/reference rating.
- For challenge/re-rate rounds, show the prior rating being challenged and the
  challenge reason.
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
- Add a `FundRerateModal` or extend the bounty funding modal so a user can fund
  a challenge/re-rate against a prior result.
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
- Record required model, operator, and prompt/version hash metadata.
- Require a registered rater profile for production use.
- Keep agent predictions visible after reveal.
- Let AI raters earn USDC at launch through the same calibration path as other
  raters.
- Add tests that ensure agents cannot bypass calibration, required metadata, or
  payout thresholds.

## Implementation Sequence

### Phase 0: Repository Bootstrap

1. Import the Curyo monorepo into `Noc2/RateMesh`.
2. Rename package scopes from `@curyo/*` to `@ratemesh/*`.
3. Rename root package, scripts, environment examples, and generated package
   exports.
4. Delete legacy deployment artifacts from the canonical branch.
5. Import the existing CREP/HREP snapshot artifact and document its provenance.
6. Switch chain defaults and environment examples from Celo to Base/Base
   Sepolia.
7. Keep old Curyo commit history if practical, but do not keep old deployment
   state as live RateMesh state.

Exit criteria:

- `yarn install` works.
- `yarn test:ts` can at least start after package rename work.
- No Self packages are required by the dependency graph.
- The imported snapshot file, Merkle-generation script, and Base chain constants
  are present.

### Phase 1: Strip Self, Faucet, And Legacy Token Flows

1. Delete `HumanFaucet.sol`.
2. Delete Self imports/remappings and mock identity hub contracts.
3. Delete Self UI/API/telemetry routes.
4. Remove `VoterIdNFT` requirements from content submission, voting, rewards,
   profiles, and frontend registry.
5. Remove faucet/referral/migration allocations from deployment scripts.
6. Remove Celo deployment constants from live RateMesh config.
7. Update docs and app copy to use rater/reputation language.

Exit criteria:

- `rg "Self|self.xyz|HumanFaucet|verifySelfProof|VoterIdRequired"` has no live
  production references.
- Foundry build passes for the reduced contract set.

### Phase 2: Contract MVP

1. Implement `MeshReputation`.
2. Implement a genesis Merkle distributor from the existing CREP/HREP snapshot.
3. Implement `RateMeshGovernor` and `TimelockController` ownership wiring.
4. Implement `RaterRegistry`.
5. Implement `PredictionVotingEngine`.
6. Implement the first version of `PredictionRewardDistributor`.
7. Refactor `QuestionRewardPoolEscrow` for one-round bounties,
   challenge/re-rate metadata, and reputation/cluster eligibility.
8. Add MREP prediction lock accounting and the prediction-error winner/loser
   redistribution model.
9. Preserve `FrontendRegistry`, require a `1,000 MREP` frontend stake, and keep
   the 3% default frontend share.
10. Add AI rater metadata requirements to registry, commit/reveal, or payout
    eligibility.
11. Rewrite deployment script as `DeployRateMesh.s.sol` with HREP-style MREP
    pools and Base USDC constants.
12. Regenerate ABIs and deployment package exports.

Exit criteria:

- Foundry tests cover capped supply, transfers, delegation, genesis claims,
  timelock-owned roles, commit, reveal, settle, cancel, missed reveal,
  reputation lock/unlock/redistribution, calibration gating, one-round bounty
  payout, MREP loser/winner redistribution, frontend stake and fee
  reservation/claim, challenge bounty creation, AI metadata gating, and USDC
  claim gating.
- No old HREP transfer staking path remains.

### Phase 3: Ponder And API

1. Rename schema tables and handlers.
2. Add prediction, reputation, genesis-claim, governance, calibration, cluster,
   and payout tables.
3. Replace binary round aggregation with predicted-rating aggregation.
4. Update read API routes for feed, history, leaderboard, rating bounties, and
   claims.
5. Add route validation tests for prediction and payout shapes.

Exit criteria:

- Ponder indexes local deployment, genesis claim, governance delegation,
  frontend-fee, and prediction events.
- Feed API can render content, open rounds, revealed predictions, final rating,
  challenge/re-rate history, and claimable USDC.

### Phase 4: Frontend MVP

1. Rename app branding to RateMesh.
2. Remove Self and faucet screens.
3. Replace up/down vote controls with prediction composer.
4. Add funding UI for explicit challenge/re-rate bounties.
5. Add genesis reputation claim and delegation UI.
6. Show calibration and reputation state in profile/feed surfaces.
7. Update reward/claim UI for USDC payout eligibility and frontend fee
   claimability.
8. Keep feedback UI unchanged except copy/branding.

Exit criteria:

- Wallet-sensitive flow works: connect, submit content, fund initial bounty,
  claim/delegate genesis reputation, predict, reveal/settle, fund re-rate,
  view reputation, claim USDC, claim frontend fees.
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

1. Deploy to Base Sepolia with fresh contracts and governance/timelock active.
2. Run a capped calibration-only period.
3. Enable small USDC bounties after telemetry confirms reveal reliability.
4. Add monitoring for clusters, correlated reveals, missed reveals, payout
   concentration, and final-rating dispersion.
5. Add monitoring for token delegation concentration and governance proposal
   risk.
6. Audit contracts before meaningful bounty amounts.

Exit criteria:

- Testnet users can complete calibration and claim capped USDC.
- Governance can tune parameters through timelock, and any pause-only emergency
  council is narrow and publicly scoped.
- All payout math is publicly explainable from indexed events.

### Phase 7: Mainnet Launch

1. Publish the imported CREP/HREP snapshot, Merkle root, provenance, and review
   scripts.
2. Deploy `MeshReputation`, Merkle distributor, Governor, Timelock, and core
   protocol contracts to Base mainnet.
3. Transfer all protocol roles and ProxyAdmin ownership to the timelock.
4. Renounce deployer setup roles after verification.
5. Open genesis claims and delegation.
6. Launch with one-round bounties, frontend fee incentives, AI rater
   participation, MREP lock redistribution, and capped USDC payouts.

Exit criteria:

- RateMesh is tokenholder-governed from the first public deployment.
- Proposal, delegation, token supply, genesis claims, and voting power are
  auditable from checkpoints and indexed events.

## Concrete PR Plan

1. `repo-bootstrap`: import Curyo code, existing CREP/HREP snapshot, Base
   defaults, rename package scopes, keep app running.
2. `remove-self-faucet`: delete Self/faucet packages, UI, routes, and deploy
   wiring.
3. `reputation-governance`: add capped transferable reputation, HREP-style MREP
   launch pools, genesis Merkle distributor, Governor, Timelock, delegation,
   and launch role wiring.
4. `rater-registry`: add open rater profiles, metadata, operational delegation,
   and cluster flags.
5. `prediction-engine`: replace binary votes with predicted final rating commit
   reveal and MREP lock accounting.
6. `usdc-bounty-refactor`: refactor reward escrow/distributor around one-round
   bounties, challenge/re-rate metadata, calibrated raters, AI metadata,
   frontend staking/fees, MREP winner/loser redistribution, and cluster caps.
7. `ponder-predictions`: update schema, handlers, and APIs.
8. `frontend-prediction-ui`: replace vote controls, add genesis claim/delegate,
   frontend fee, and onboarding surfaces.
9. `keeper-sdk-agents`: update commit builders, keeper reveal, and agent client.
10. `local-e2e`: add full local lifecycle tests and docs.
11. `testnet-deploy`: fresh deployment config, monitoring, and launch checklist.

## Parameter Defaults To Start With

These are launch defaults, not permanent constants:

- Chain: Base mainnet (`8453`), Base Sepolia (`84532`) for testnet.
- USDC: Circle native USDC on Base, `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
  mainnet and `0x036CbD53842c5426634e7929541eC2318f3dCF7e` testnet.
- Rating scale: `1000-9900` BPS, displayed as `1.0-9.9 / 10`.
- Token name/symbol: Mesh Reputation (`MREP`).
- Reputation token: transferable ERC20Votes, 6 decimals.
- Reputation max supply: `100,000,000 MREP`, matching the old HREP cap.
- MREP tokenomics: `52M` snapshot claim pool, `12M` bootstrap pool, `32M` DAO
  treasury, `4M` consensus reserve.
- Genesis allocation: one-time Merkle claim using the existing CREP/HREP
  snapshot artifact.
- Bounty scope: one sealed commit window plus reveal window, exactly one
  settlement attempt per bounty.
- Challenge/re-rate: explicit new bounty referencing a prior round/result.
- Frontend share: default 3%, max 5%, applies to bounty and feedback payouts.
- Frontend stake: `1,000 MREP` required for fee eligibility.
- Minimum raw reveals: 3.
- Minimum independent participants for USDC: 3.
- Calibration rounds before USDC: 10.
- AI raters: USDC-eligible at launch after the same 10 calibration rounds and
  required model/operator/prompt-version metadata.
- Prediction lock: min `1 MREP`, default `5 MREP`, max `100 MREP`.
- MREP lock settlement: full winner band `0.25` rating points, loss cutoff
  `1.00` rating point, revealed loser refund `5%`.
- MREP losing-pool split after refund: 90% accurate raters, 4% frontends, 1%
  DAO treasury, 5% consensus reserve.
- Reputation payout multiplier: capped small range, for example `1.0x-1.25x`.
- Voting power: square-root reputation curve.
- Cluster discount: can reduce to near-zero, should not boost over 1.0.
- Missed reveal penalty: reputation lock forfeit/redistribution, tunable and
  capped.

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

- Score MREP locks and USDC eligibility with leave-one-out and
  cluster-excluded references where practical.
- Reward calibration over raw agreement.
- Cap conviction influence.
- Use category-specific reputation and decay.
- Flag high dispersion or suspiciously correlated rounds.

### Account Transfer Or Rental

Risk: transferable reputation makes secondary markets explicit, and accounts can
still be rented or managed to farm calibration/payout status.

Mitigations:

- No linear cash payout by reputation.
- Token balance alone is not enough for USDC eligibility; calibration and reveal
  reliability remain account-specific.
- Behavior-based clustering.
- Reveal reliability and category history matter more than raw balance.
- Optional cooling periods after wallet/delegation/metadata changes.
- Governance uses token checkpoints and timelock delays so last-minute token
  movement cannot rewrite an active vote.

### Governance Capture

Risk: because reputation is transferable and governs the protocol from launch,
a whale or coordinated buyer can attempt to control parameters, treasury, or
upgrades.

Mitigations:

- Capped supply and published genesis allocation.
- Broad CREP/HREP snapshot genesis distribution instead of team-only launch.
- Timelock delay on all high-impact actions.
- Proposal threshold, quorum, and late-quorum protection.
- Public delegation UI and monitoring for delegation concentration.
- Conservative treasury roles and pause-only emergency path.
- Keep v1 scoring simple enough that governance cannot hide discretionary
  off-chain payout changes.

### AI Correlation

Risk: many agents using the same model/prompt act like one rater.

Mitigations:

- Required agent metadata: model, operator, and prompt/version hash.
- Versioned reputation by model/operator/prompt family.
- Cluster by model family, provider, prompt fingerprint, operator, funding
  source, and behavior.
- Same calibration requirement as human/team accounts at launch, but no USDC
  eligibility when required metadata is missing or stale.

### MREP Lock Harshness

Risk: if prediction-error slashing is too harsh, honest raters may avoid hard
questions and only rate obvious content.

Mitigations:

- Use a full-win band and a linear loss ramp before the loss cutoff.
- Keep per-round locks bounded.
- Publish scoring parameters in the UI before commit.
- Treat high-dispersion rounds as weaker signal and let governance tune
  penalties down through timelock if testnet data shows excessive churn.

### Trustless Privacy Limits

Risk: with tlock commit reveal, the system cannot guarantee that nothing is
revealed unless enough people voted. Once the ciphertext becomes decryptable,
low-participation rounds may reveal a small set of predictions.

Mitigations for v1:

- Treat this as an accepted product tradeoff.
- Label low-participation rounds as insufficient signal.
- Avoid showing aggregates before commit/reveal.

### Follow-up Round Complexity

Risk: automatic multi-round bounties make later predictions less independent,
increase payout complexity, and reward strategic waiting.

Mitigations:

- One bounty funds one sealed round.
- Re-rates and challenges are explicit new bounties with separate funding.
- UI should show challenge context instead of pretending the second round is the
  same independent judgment as the first.
- Contract state should never carry unspent bounty allocation into an implicit
  second round unless a funder deliberately creates a new bounty.

## Definition Of Done For The First RateMesh MVP

The MVP is done when:

- There is no Self.xyz dependency.
- Users can connect a wallet without proof-of-personhood.
- Users can submit a predicted final rating through commit reveal.
- Each bounty funds exactly one private prediction round.
- Users can fund an explicit challenge/re-rate bounty against a prior result.
- Mesh Reputation is transferable, capped, checkpointed, and claimable by
  previous CREP/HREP snapshot participants through a published genesis
  distribution.
- MREP tokenomics reuse the old HREP `52M / 12M / 32M / 4M` pool structure.
- MREP prediction locks redistribute inaccurate and unrevealed locks to accurate
  raters, eligible frontends, treasury, and reserve without increasing supply.
- RateMesh governance and timelock own protocol roles from launch.
- Users complete calibration before USDC eligibility.
- AI raters can earn USDC at launch after the same calibration requirement and
  required metadata.
- USDC bounty payout is cluster-capped and not linear by wallet count or raw
  reputation.
- Frontend operators can earn the default 3% share on bounty and feedback
  payouts only after staking MREP.
- Contracts, app, indexer, SDK, and keeper are configured for Base/Base Sepolia.
- The frontend preserves Curyo's usable feed/rating design while clearly
  presenting RateMesh prediction mechanics.
- Ponder exposes enough data for public auditability of rating, reputation,
  genesis claims, governance, frontend fees, and payout decisions.
- Local end-to-end tests cover the full lifecycle.
