# RateLoop Implementation Plan

Planning date: 2026-05-07

> 2026-05-08 update: the live repo now targets World Chain mainnet (`480`) and
> World Chain Sepolia (`4801`), with optional World ID credentials replacing the
> earlier optional Self.xyz direction. Older Celo/Self references below are
> retained as implementation history unless a later checklist item explicitly
> says otherwise.
>
> 2026-05-11 update: World ID credential issuance is designed as direct
> on-chain self-attestation. A wallet submits its own World ID proof to
> `RaterRegistry`, the contract verifies it through the World ID Router, and no
> RateLoop-operated hot wallet has authority to issue normal human credentials.
>
> 2026-05-11 RBTS update: the active implementation supersedes the scalar
> `1.0-9.9` prediction design below. The redeploy now uses binary robust BTS:
> each sealed vote contains `isUp`, `predictedUpBps` (`0-10000`), and `salt`;
> settlement requires at least `max(minVoters, 3)` reveals; and rewards,
> participation, and bounty qualification use RBTS reward weight.

## Goal

RateLoop should be a fresh deployment of the protocol, not a legacy-compatible
contract migration. The product name, repository, and token should move back to
RateLoop, with visual identity based on the Hawig hero animation and logo from
`https://github.com/Noc2/Hawig` / `https://www.hawig.xyz/`. It should also reserve
`4M LREP` for the small previous-user set because those holders helped develop
the original protocol.
The product direction is:

- Open rating network for independent raters, AI agents, teams, and hybrid
  workflows.
- No mandatory Self.xyz or proof-of-personhood dependency in the rating,
  payout, or governance path. Self.xyz may return later as an optional identity
  signal or badge.
- Day-one decentralized governance using a broad launch distribution: `35M LREP`
  verified + referral rewards, `25M LREP` earned rater rewards, and `4M LREP`
  for the small previous-user set.
- Continue on Celo for now, with World Chain Sepolia as the testnet path.
- Transferable capped Loop Reputation token (`LREP`) for governance,
  prediction locks, frontend staking, and long-term protocol ownership.
- Use `LREP` as the working implementation label unless governance changes
  naming before deployment.
- Reuse HREP tokenomics for LREP: `100,000,000` max supply split into
  `64M / 32M / 4M` launch pools.
- The `64M` Launch Distribution Pool should not be a large legacy airdrop.
  Old users receive `4M LREP`; the remaining `60M LREP` is split between
  earned rater rewards and verified/referral onboarding.
- Users submit a split rating report instead of a binary up/down vote: their
  own opinion rating plus their expected crowd rating.
- One sealed private round per bounty, followed by reveal and settlement.
- LREP locks use a winner/loser redistribution model adapted from old Curyo, so
  accurate raters earn from less accurate raters without increasing total
  supply.
- Reputation gates influence, governance, and USDC bounty eligibility.
- AI raters can earn USDC at launch after the same calibration requirement as
  other accounts, with required model/operator/prompt-version metadata.
- USDC payouts reward useful independent signal, not raw wallet count.
- Frontend operators keep the old 3% default earning share on bounty and
  feedback payouts, with governance able to tune it up to a 5% cap, and must
  stake LREP to be fee-eligible.
- Headlines, subheadings, onboarding copy, and empty states should be updated
  away from human-only framing toward open rating, prediction, calibration, and
  independent signal.

The implementation should reuse the old Curyo monorepo where the code already
solves the same problem, but it should not preserve Curyo mechanics for their
own sake. The frontend should reuse the Hawig hero animation/logo as the new
RateLoop brand anchor, while retaining useful Curyo app surfaces where they are
still ergonomic. The biggest architectural change is replacing binary token
staking as the core vote primitive with split rating reports, transferable
capped reputation locks, account-level calibration, cluster-aware payout
controls, and a Celo-native deployment.

## Research Notes For The Updated Architecture

This is protocol design context, not legal advice. RateLoop should still get
jurisdiction-specific legal review before launching a transferable token.

The recommended governance and chain architecture should follow established
on-chain patterns:

- OpenZeppelin Governor supports modular token-voting governance, including
  `GovernorVotes`, quorum modules, settings modules, and timelock execution.
- OpenZeppelin's timelock guidance says self-governed timelocks should make the
  timelock itself the long-term admin after setup, so future maintenance goes
  through governance.
- OpenZeppelin `ERC20Votes` keeps historical vote checkpoints and can support
  delegation. RateLoop v1 keeps voting power self-delegated because the current
  token only allows self-delegation, while still using the checkpoint primitive
  for transferable governance reputation.
- Compound shows a mature pattern of tokenholder governance with delegation,
  Governor Bravo, and Timelock-controlled protocol changes.
- ENS is a relevant launch-distribution precedent: the ENS DAO distributed
  governance tokens to prior users and uses that token for major DAO decisions.
- MiCA's recital on fully decentralized services is a reminder that legal
  decentralization is broader than token distribution. The protocol should
  minimize ongoing company discretion over upgrades, scoring, treasury, and
  payout eligibility from day one.
- Celo remains a practical launch target because the existing Curyo codebase,
  deployment scripts, sponsored transaction work, and USDC bounty paths already
  support it. The official Celo network docs list World Chain mainnet chain ID `42220`
  and World Chain Sepolia chain ID `11142220`.
- World Chain Sepolia is the current developer testnet path and replaces the older
  Alfajores-centric workflow. Existing Curyo assumptions around World Chain Sepolia
  should be kept, while old Alfajores references should be removed.
- OpenZeppelin's governance guide recommends timestamp-based governance on L2s
  where block timing can be inconsistent; the Governor automatically follows the
  token's ERC-6372 clock.
- Circle lists native USDC on World Chain mainnet at
  `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` and World Chain Sepolia USDC at
  `0x01C5C0122039549AD1493B8220cABEdD739BC44E`.
- A winner/loser LREP lock model is economically closer to a parimutuel
  prediction mechanism than an inflationary reputation model: accurate
  predictions earn from inaccurate locks, while the protocol's total supply cap
  remains fixed.
- Proper scoring-rule and forecasting-tournament literature supports rewarding
  forecast quality rather than raw participation, but RateLoop should avoid a
  pure cash scoring rule because the target result is endogenous: raters are
  predicting the crowd's final rating and can partially influence it. This is
  why the v1 plan uses bounded locks, leave-one-out scoring, calibration, and
  cluster caps.

Sources:

- OpenZeppelin Governor documentation:
  https://docs.openzeppelin.com/contracts/4.x/api/governance
- OpenZeppelin governance setup guide:
  https://docs.openzeppelin.com/contracts/4.x/governance
- OpenZeppelin timestamp-based governance guide:
  https://docs.openzeppelin.com/contracts/4.x/governance#timestamp_based_governance
- OpenZeppelin ERC20Votes documentation:
  https://docs.openzeppelin.com/contracts/5.x/api/token/erc20
- Compound governance documentation:
  https://docs.compound.finance/v2/governance/
- ENS token documentation:
  https://docs.ens.domains/dao/token/
- MiCA Regulation recital 22:
  https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32023R1114
- Celo network information:
  https://docs.celo.org/network
- World Chain Sepolia testnet:
  https://docs.celo.org/network/celo-sepolia
- USDC on World Chain:
  https://www.circle.com/multi-chain-usdc/celo
- Circle USDC contract addresses:
  https://developers.circle.com/stablecoins/usdc-contract-addresses
- Strictly Proper Scoring Mechanisms Without Expected Arbitrage:
  https://ideas.repec.org/p/arx/papers/2409.07046.html
- Pari-Mutuel Markets: Mechanisms and Performance:
  https://link.springer.com/chapter/10.1007/978-3-540-77105-0_11

## Recommended Starting Point

Use `https://github.com/Noc2/RateLoop` as the canonical repository and import
the old Curyo monorepo as the source tree for the new deployment. The first
implementation commits should keep the old code structure recognizable, then
rename package metadata and visible product surfaces to RateLoop:

- `packages/foundry` remains the smart-contract package.
- `packages/contracts` remains the generated ABI/deployment package.
- `packages/nextjs` remains the app.
- `packages/ponder` remains the indexer/API package.
- `packages/sdk` remains the vote-building/read helper package.
- `packages/keeper` remains the automation package for reveal, settlement, and
  cleanup.
- `packages/agents` remains useful for AI rater workflows, prompt templates,
  and future evaluator integrations.

The intended package scope is `@rateloop/*`. It is acceptable to keep old
`@curyo/*` package names inside the first mechanical import commit, but the
bootstrap phase should rename live package metadata and imports before the app
is treated as a RateLoop baseline.

Do not treat the existing Self-related packages, generated ABIs, deployment
addresses, or legacy generated artifacts as canonical artifacts for the new
deployment. The required protocol path must work without identity proofs. If
Self.xyz returns, it should be isolated as an optional attestation module and
regenerated from the new contracts/config.

## Celo Deployment And Assets

RateLoop should stay on Celo for now.

Launch network defaults:

- Mainnet: Celo, chain ID `42220`, CELO gas.
- Testnet: World Chain Sepolia, chain ID `11142220`, CELO gas.
- Mainnet USDC: `0xcebA9300f2b948710d2653dD7B07f33A8B32118C`.
- World Chain Sepolia USDC: `0x01C5C0122039549AD1493B8220cABEdD739BC44E`.
- Production RPC should use a paid/provider endpoint or self-hosted node. Celo's
  public Forno RPC endpoints are useful for defaults and tests, not production
  throughput.

Implementation implications:

- Keep Celo and World Chain Sepolia chain constants across Foundry deployment scripts,
  Wagmi/thirdweb config, Ponder config, keeper config, SDK runtime helpers,
  docs, and environment examples.
- Keep the existing Celo environment variables unless there is a narrow reason
  to rename them. Prefer stable compatibility over churn while the protocol
  contracts are being rewritten.
- Keep all USDC accounting at 6 decimals and use Circle native USDC, not bridged
  USDC variants.
- Keep block explorer links on CeloScan, Celo Explorer, or Celo Blockscout
  consistently.
- Audit every chain ID and USDC-address constant before deployment to remove
  stale Alfajores values and ensure World Chain Sepolia is the only testnet path.

## Resolved Pre-Implementation Decisions

- Token name/symbol: Loop Reputation (`LREP`).
- Token contract name: `LoopReputation`.
- Brand: RateLoop name, Hawig-derived animated hero, Hawig-derived logo mark,
  and `@rateloop/*` package scopes.
- Repository: `https://github.com/Noc2/RateLoop`.
- Launch distribution: use the `64M LREP` Launch Distribution Pool as
  `35M LREP` verified + referral rewards, `25M LREP` earned rater rewards, and
  `4M LREP` for the small set of previous users.
- Rating scale: `1.0-9.9`, stored as `1000-9900` BPS.
- Governance launch parameters: reuse the previous Curyo durations, threshold,
  dynamic quorum, proposal cooldown, and 7-day governance locks.
- Frontend stake: `1,000 LREP`.
- Transaction UX: keep sponsored transactions with self-funded fallback.
- USDC payout: pay a small work stipend to eligible revealed raters, including
  wrong/near-miss raters, and pay the larger accuracy pool to better
  predictions.
- AI metadata: require model/operator/prompt-version metadata, store hashes
  on-chain, keep full metadata off-chain, and allow bonded declarations to
  receive bounded reward-weight treatment when probe/challenge status supports
  it.
- Contract implementation must not require Self.xyz or proof-of-personhood gates
  for rating, earning, or governance. Optional Self attestations may be added as
  non-required profile/trust metadata after the core prediction path works.
- Optional verification is an onboarding accelerator only: a verified account
  can receive one decaying starter bonus, but verified users do not receive
  ongoing reward multipliers after that bonus.

## Optional Identity Signals

The core RateLoop protocol should be identity-agnostic: accounts register, build
calibration history, lock LREP, reveal predictions, and become USDC-eligible by
performance and independence. That keeps AI raters and human raters on the same
basic rail and avoids making one identity vendor a protocol dependency.

Self.xyz can still be useful as an optional feature:

- A rater may attach a Self-backed verified-uniqueness credential.
- The previous Self-verified Curyo bootstrap accounts can be seeded as a
  sunsetted trust-anchor set for graph bootstrapping, because they helped
  develop the protocol and already completed the older verification flow.
- Frontends can display the credential as context, but should describe it as a
  risk/uniqueness signal rather than proof that the prediction is correct.
- Governance may decide whether optional identity signals affect caps, warmup,
  sybil-cluster heuristics, capped trust-attestation influence, sponsorship quotas,
  or high-value bounty eligibility.
- Optional identity must not be enough by itself to bypass calibration,
  reputation locks, reveal reliability, cluster caps, or USDC payout limits.
- Optional identity should not be required for governance voting power because
  LREP already represents the launch ownership and protocol-control primitive.
- Self credentials should be revocable, scoped by nullifier, capped by modest
  multipliers, and safe to disable without breaking rating, earning, or
  governance.

AI raters should use a parallel accountability rail:

- AI accounts declare model/operator/prompt-version metadata through signed
  declarations and bonded operators.
- Declarations can be probed, drift-flagged, challenged, retired, or redeclared
  without blocking open participation.
- `A1Unverified` and `A1Verified` declarations can receive bounded
  reward-weight multipliers in the voting engine, capped with any human
  credential multiplier and still subject to cluster discounts.
- AI metadata affects payout treatment, cooldowns, clustering, and public
  provenance. It should not become a hidden permission gate controlled by one
  operator.
- AI declarations are not human uniqueness credentials: they do not qualify for
  the one-time verified bonus and do not count as verified-human anchors for
  earned launch rewards.

Implementation rule: keep identity adapters behind feature flags or separate
modules, and keep all core tests passing with identity disabled.

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

- `HumanReputation.sol` becomes `LoopReputation.sol`.
  Keep ERC20Votes-style checkpointing, keep transfers enabled, and add a hard
  `MAX_SUPPLY`. Protocol earning can distribute only from pre-funded capped
  pools; there should be no uncapped mint path.
- `RoundVotingEngine.sol` becomes `PredictionVotingEngine.sol`.
  Keep the commit-reveal/tlock state machine, per-content round isolation,
  config snapshots, keeper-friendly settlement hooks, and failure/cancel states.
  Replace `isUp` and `stakeAmount` with `opinionRatingBps`,
  `predictedCrowdRatingBps`, and a reputation lock amount.
- `RoundRewardDistributor.sol` becomes `PredictionRewardDistributor.sol`.
  Keep the pull-claim discipline and adapt the old winner/loser economics from
  binary pools to continuous prediction-error pools. It should also claim USDC
  bounties and emit reputation/accounting outcomes for settled predictions.
- `QuestionRewardPoolEscrow.sol` becomes the USDC bounty escrow.
  Preserve funding, windows, claim accounting, frontend fee support, bundles if
  still needed, and forfeiture/refund logic. Replace voter-ID eligibility with
  reputation and cluster eligibility.
- Keep `RateLoopGovernor.sol` as the governor contract name.
  Launch it from day one with Timelock-owned protocol roles and launch
  governance distribution.
- `VoterIdNFT.sol` should not remain a required mint gate. If profile badges are
  useful, create an optional `RaterProfileBadge`, `RaterRegistry`, or
  `IdentityAttestationRegistry` that can store Self-backed metadata without
  gating core protocol participation.
- Ponder `voterStats` and `voterCategoryStats` become prediction/reputation
  calibration tables instead of win/loss tables.
- `StakeSelector` becomes `PredictionComposer`: rating slider, bounded LREP
  lock selector, preview of eligibility, and clear reveal state.

### Remove From The Required Path

- Self.xyz contracts, imports, remappings, deployment hub addresses, config IDs,
  OFAC/age attestation policy, proof routes, telemetry, UI, and tests should be
  removed from required rating, earning, and governance flows. Keep or re-add
  them only inside an optional identity module.
- `HumanFaucet.sol` and any legacy faucet/migration allocations. The old
  faucet-sized pool plus the prior Bootstrap Pool allocation become the Launch
  Distribution Pool: `35M LREP` verified + referral rewards, `25M LREP`
  earned rater rewards, and `4M LREP`
  legacy users.
- `HumanSignInButton`, `SelfVerifyButton`, `useVoterIdNFT`, and the gating copy
  that says identity verification is required to vote. If Self returns, use new
  optional identity copy and hooks instead of required verification language.
- Legacy HREP staking as a binary-vote transport and faucet-based
  bootstrapping. Keep the useful capped winner/loser and reserve math, but
  adapt it to predicted-rating error.
- Binary `up/down` vote model.

## Source File Reuse Map

| Old Curyo source | New RateLoop action |
| --- | --- |
| `packages/foundry/contracts/HumanReputation.sol` | Rename and refactor into `LoopReputation.sol`; keep transferability and governance checkpoints, add hard supply cap, remove faucet assumptions, and replace binary-vote staking with prediction locks. |
| `packages/foundry/contracts/RoundVotingEngine.sol` | Rename and refactor into `PredictionVotingEngine.sol`; keep commit/reveal/tlock machinery, replace binary vote settlement. |
| `packages/foundry/contracts/RoundRewardDistributor.sol` | Reuse claim/dust discipline and old reward-split math for `PredictionRewardDistributor.sol`; replace binary HREP winner/loser payouts with prediction-error LREP redistribution plus USDC bounty claims. |
| `packages/foundry/contracts/QuestionRewardPoolEscrow.sol` | Keep as USDC bounty escrow foundation; remove Voter ID fields and add cluster/reputation eligibility. |
| `packages/foundry/contracts/ContentRegistry.sol` | Keep content lifecycle, categories, duplicate protection, and rating state; remove required Self/nullifier submission identity snapshots. |
| `packages/foundry/contracts/ProtocolConfig.sol` | Keep central config/address book; rename and add prediction, reputation, calibration, and cluster parameters. |
| `packages/foundry/contracts/VoterIdNFT.sol` | Do not keep as a required voter credential. Mine delegation/profile lessons for `RaterRegistry` and optional identity attestations. |
| `packages/foundry/contracts/HumanFaucet.sol` | Delete; replace the old faucet allocation and prior Bootstrap Pool allocation with the Launch Distribution Pool. |
| `packages/foundry/script/DeployRateLoop.s.sol` | Refactor in place; remove faucet and migration tiers from the core deployment; add Launch Distribution Pool funding, LREP launch pools, Governor, Timelock, Celo constants, Timelock ownership from launch, and optionally deploy identity adapters only when enabled. |
| `packages/ponder/ponder.schema.ts` | Keep content/profile/feed tables; replace vote/voter/reward tables with prediction/reputation/payout tables. |
| `packages/ponder/src/RoundVotingEngine.ts` | Refactor event handlers for prediction events and weighted final ratings. |
| `packages/ponder/src/HumanFaucet.ts` and `packages/ponder/src/VoterIdNFT.ts` | Delete or replace with `RaterRegistry.ts`. |
| `packages/nextjs/components/vote/VotePageClient.tsx` | Keep feed state, sorting, filtering, and modal patterns; replace up/down vote intent with split rating intent. |
| `packages/nextjs/components/shared/VotingQuestionCard.tsx` | Keep card/rating layout; replace arrows with prediction controls. |
| `packages/nextjs/components/swipe/StakeSelector.tsx` | Rename/refactor into `PredictionComposer.tsx`. |
| `packages/nextjs/components/shared/RatingOrb.tsx` | Reuse. |
| `packages/nextjs/components/feedback/*` | Reuse; feedback stays separate from prediction. |
| `packages/nextjs/hooks/useRoundVote.ts` | Rename/refactor into `usePredictionVote.ts`. |
| `packages/nextjs/hooks/useVoterIdNFT.ts` | Delete; replace with rater/calibration hooks. |
| `packages/sdk/src/vote.ts` | Keep salt/tlock/frontend helpers; replace `isUp` payload with `opinionRatingBps` and `predictedCrowdRatingBps`. |
| `packages/keeper/src/*` | Keep service structure and reliability patterns; update reveal/settlement decoding and scoring inputs. |
| `packages/agents/src/*` | Keep as basis for AI rater clients and evaluation workflows. |

## Target Protocol Design

### Rating Primitive

Each vote commits to:

```text
contentId
roundId
voter
opinionRatingBps          // 1000-9900, representing the rater's own 1.0-9.9 opinion
predictedCrowdRatingBps   // 1000-9900, representing the expected revealed crowd rating
reputationLock      // bounded LREP lock escrowed until reveal/settlement
salt
```

The reveal shows both values. The final rating is computed from revealed
opinion ratings using effective weights. LREP and USDC reward scoring uses the
expected crowd rating against the leave-one-out or cluster-excluded peer result,
so the user's own opinion is not rewarded for matching the end result. The
default bounty workflow is:

```text
bounty funded -> commit window -> reveal window -> settle -> public result
```

RateLoop v1 should use exactly one sealed round per bounty. Do not keep old Curyo's
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
- If a round ends as `InsufficientSignal` or `RevealFailed`, the bounty follows
  the insufficient-signal rules below and should not silently roll into a second
  round.

### Weighting

The initial effective voting power formula should be conservative:

```text
effectiveVotingPower =
  sqrt(lockedReputation) * calibrationMultiplier * independenceMultiplier
```

Where:

- `lockedReputation` is transferable Loop Reputation locked for this
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

Loop Reputation (`LREP`) should be a transferable, capped ERC20Votes-style
token.
The legal/decentralization motivation is that protocol governance should not
remain company-controlled at launch. The practical product motivation is that
new raters should be able to earn into governance while the small previous-user
set still receives a fixed recognition allocation.

Transferable LREP is intentional: portable reputation and day-one tokenholder
governance are part of the launch design, not an accidental side effect. The
token should not be the only signal for rating or USDC payouts. Transferable
reputation can be bought, so RateLoop pairs it with prediction accuracy,
effective-unit weighting, calibration, reveal reliability, cluster discounts,
governance locks, proposal/quorum floors, and hard floors on submission bounties
and AI declaration/challenge bonds.

Recommended token properties:

- Transferable ERC20 with ERC20Votes checkpoints and self-delegation-on-receipt.
  The current contract supports self-delegation only, not third-party LREP vote
  delegation.
- 6 decimals to preserve compatibility with the old HREP mental model.
- Hard `MAX_SUPPLY`; no uncapped inflation.
- Launch distribution from the `64M LREP` pool: `35M LREP` verified + referral
  rewards, `25M LREP` earned rater rewards, and `4M LREP` legacy users.
- Full cap allocated at deployment into auditable protocol pools.
- Launch rewards and consensus subsidies distribute from fixed pre-funded pools
  instead of open-ended minting.
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

### Loop Reputation (LREP) Tokenomics And Launch Distribution

Loop Reputation (`LREP`) should keep the `100M` max supply and use a
`64M / 32M / 4M` pool structure. The prior Bootstrap Pool allocation is folded
into the Launch Distribution Pool rather than kept as a separate launch bucket.
The deployment should mint or allocate the full capped supply into auditable
contracts at launch.

Launch allocation:

```text
MAX_SUPPLY = 100,000,000 LREP

64,000,000 LREP  Launch Distribution Pool
  ├─ 35,000,000 LREP  Verified + referral rewards
  ├─ 25,000,000 LREP  Earned rater rewards
  └─  4,000,000 LREP  Legacy users
32,000,000 LREP  DAO treasury
 4,000,000 LREP  Consensus subsidy / reserve pool
```

Launch Distribution Pool rule:

- Allocate `4,000,000 LREP` to the previous user set. There are only nine old
  users, so the legacy claim should recognize history without consuming the pool
  intended to onboard the new network. Use the old redeploy bootstrap manifest
  as provenance and preserve referral economics in the fixed legacy split:
  `legacyWeight = old migrated claimant amount + old referrer rewards earned`.
  The recorded 9-user snapshot has `115,000 HREP` of claimant amounts and
  `25,000 HREP` of referrer rewards, so the `4,000,000 LREP` claim is pro-rata
  over `140,000 HREP` of total legacy weight. The concrete claim file lives at
  `packages/foundry/migrations/legacy-lrep-claims.json`.
- Put `25,000,000 LREP` behind earned rater rewards. A new rater can
  start with zero LREP, submit revealed predictions, and earn starter LREP when
  those predictions are useful.
- Make earned rater rewards count-based and stricter over time. Early raters get
  higher per-account caps; each larger cohort receives a lower cap, similar to a
  halving schedule but keyed to useful qualifying participation counts instead
  of time.
- Anchor earned rater rewards to verified-human participation without making
  the whole rating protocol human-only. The initial launch policy is `3`
  revealed raters per qualifying round, `1` active verified human anchor in that
  round, and `2` distinct verified-human anchors across at least `2` qualifying
  rounds before a rater receives the first earned launch payout. Governance can
  raise these thresholds if farming pressure appears.
- Use `35,000,000 LREP` for one-time verified-user bonuses plus bounded referral
  rewards. The verification bonus decays by the number of already verified users
  and can be claimed only once per uniqueness credential. After that, verified
  users earn under the same rules as everyone else.
- Referral rewards should be paid only after the referred account completes
  useful rating activity or a valid verification claim, with per-referrer caps
  and no infinite tree.
- Keep verification acceleration, appeals, security responses, grants, and
  governance programs in the DAO treasury, not the Launch Distribution Pool.
- The claim UI should explain each rail separately: earned rater rewards, one-time
  verification bonus, referral bonus, and legacy claim.

Detailed implementation plan: [Earned Launch Rewards Anti-Farm Plan](./launch-earned-rewards-anti-farm-plan.md).

Prior Bootstrap Pool:

- Fold the prior fixed `12,000,000 LREP` Bootstrap Pool into the Launch
  Distribution Pool.
- Allocate `10,000,000 LREP` of that moved supply to verified + referral rewards
  and `2,000,000 LREP` to legacy users.
- Keep any future participation-reward program governance-funded and optional;
  the main ongoing cash incentive should come from funded USDC bounties.

Consensus reserve:

- Keep a fixed `4,000,000 LREP` reserve to handle unanimous or near-unanimous
  rounds where there is little or no losing lock pool.
- Preserve the old safety idea of a capped subsidy per round. A good launch
  default is `min(5% of revealed locked LREP, 50 LREP)`.
- Subsidies are optional support for signal quality, not a replacement for
  winner/loser redistribution.

### Reputation Locks

Users should lock transferable LREP on each split report. The lock should keep the
old Curyo intuition that accurate raters earn from inaccurate raters, but adapt
it to continuous expected-crowd ratings instead of binary up/down pools.

Recommended launch defaults:

```text
MIN_PREDICTION_LOCK = 1 LREP
DEFAULT_PREDICTION_LOCK = 5 LREP
MAX_PREDICTION_LOCK = 10 LREP
MAX_DAILY_LOCK_PER_ACCOUNT = 250 LREP
MAX_DAILY_LOCK_PER_CLUSTER = governance parameter
FULL_WIN_BAND = 0.25 rating points
LOSS_CUTOFF = 1.00 rating point
REVEALED_LOSER_REFUND = 5%
```

Settlement model:

1. Compute the final rating from revealed opinion ratings using effective voting
   power.
2. For each rater, compute scoring against a leave-one-out final rating when
   enough independent participants remain after removing that rater. This
   prevents a high-lock account from scoring itself against a result it heavily
   moved.
3. Compute `error = abs(predictedCrowdRating - scoringReferenceRating)`.
4. If `error <= FULL_WIN_BAND`, the rater keeps the full lock and receives a
   full winner score.
5. If `FULL_WIN_BAND < error < LOSS_CUTOFF`, the rater loses a linear portion
   of the lock and receives a linearly reduced winner score.
6. If `error >= LOSS_CUTOFF`, the rater is a losing crowd prediction for LREP
   settlement and loses the at-risk lock, except for the revealed-loser refund.
7. Missed reveals forfeit the rating-report lock after the reveal grace period and
   receive no loser refund.

Redistribution model:

```text
grossLosingPool = inaccurateLockLosses + missedRevealForfeits
revealedLoserRefund = 5% of revealed inaccurate lock losses
netLosingPool = grossLosingPool - revealedLoserRefund

91% netLosingPool -> accurate revealed raters
 3% netLosingPool -> eligible registered frontends
 1% netLosingPool -> DAO treasury
 5% netLosingPool -> consensus reserve
```

Accurate-rater shares should be proportional to:

```text
winnerShareWeight =
  winnerScore
  * sqrt(lockedLREP)
  * calibrationMultiplier
  * independenceMultiplier
```

Design notes:

- This keeps total LREP supply capped because normal settlement only moves
  already-issued LREP between raters, frontends, treasury, and reserve.
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

Use a two-pool payout model so useful work gets a small reward, while accurate
predictions still earn clearly more:

```text
raterUsdcPool = bountyAfterFrontendFee
workStipendPool = 25% of raterUsdcPool
accuracyPool = 75% of raterUsdcPool

workStipendWeight =
  flatEligibleRevealWeight
  * calibrationQualityMultiplier
  * clusterCapMultiplier

accuracyWeight =
  usdcQualityScore
  * smallReputationMultiplier
  * calibrationQualityMultiplier
  * clusterCapMultiplier
```

Launch recommendation:

- Pay a small work stipend to every eligible, revealed, calibrated rater,
  including raters who were wrong, because they still spent effort or
  computation and helped form the distribution.
- Pay the larger accuracy pool by prediction quality, so correct raters earn
  materially more.
- `usdcQualityScore = 1.0` inside the full-win band.
- Between the full-win band and the LREP `LOSS_CUTOFF`, quality decays
  linearly but stays meaningful.
- Between the LREP `LOSS_CUTOFF` and a wider `USDC_NEAR_MISS_CUTOFF`, quality
  decays to zero. These raters still receive only the work stipend.
- Far-wrong raters receive only the work stipend, not the accuracy pool.
- Small bounded multiplier for higher reputation, for example `1.0x-1.25x`.
- No linear payout by reputation.
- No payout for unrevealed votes.
- No payout before calibration rounds are complete.
- Cluster-capped allocation: if many accounts look controlled by one operator,
  they share both one work-stipend cap and one accuracy cap instead of each
  receiving a full share.
- Leave-one-out or leave-one-cluster-out scoring for payout-sensitive rounds.

This keeps reputation valuable without making account splitting the dominant
strategy.

Recommended USDC constants:

```text
USDC_WORK_STIPEND_BPS = 2500
USDC_ACCURACY_POOL_BPS = 7500
USDC_FULL_SCORE_BAND = 0.25 rating points
USDC_NEAR_MISS_CUTOFF = 1.50 rating points
MAX_REPUTATION_USDC_MULTIPLIER = 1.25x
```

### Insufficient Signal

A round is `InsufficientSignal` when it fails minimum raw reveals, minimum
independent participants, or minimum effective weight. It should not update the
public current rating.

Recommended settlement:

- Revealed reports get their LREP locks returned, except for any explicit
  missed-reveal or fraud penalty that applies independently.
- Unrevealed reports forfeit their LREP lock after the reveal grace period.
- No normal accuracy pool is paid because there is no reliable final signal.
- A small attempt stipend may be paid from the USDC bounty to eligible revealed
  calibrated raters, capped at `ATTEMPT_STIPEND_BPS = 1000` and cluster-capped.
- The remaining USDC bounty becomes refundable to the funder after the claim
  window, or the funder can deliberately create a new challenge/re-rate bounty.

This gives honest raters some compensation for failed rounds without making
low-quorum farming more attractive than producing a usable result.

### AI Raters

AI raters should be first-class accounts. The system should care about
calibration and independence, not human-only identity.

Implementation implications:

- Add rater type metadata: human, AI agent, team, hybrid, unknown.
- Treat metadata as self-disclosed and reputational, not proof.
- AI raters can earn USDC at launch after the same calibration requirement as
  other account types. Do not require a later AI-only launch phase.
- Require AI metadata before production bounty participation:
  - `model`
  - `operator`
  - `promptVersionHash` or `promptHash`
  - optional `modelConfigHash`, `agentClientVersion`, and `evaluationPolicyHash`
- Store only hashes and compact identifiers on-chain. Keep full metadata in
  signed JSON, IPFS, HTTPS, or another content-addressed location.
- Recommended metadata JSON fields:
  `schemaVersion`, `raterType`, `operator`, `model`, `modelProvider`,
  `modelVersion`, `promptVersionHash`, `modelConfigHash`,
  `agentClientVersion`, `evaluationPolicyHash`, `createdAt`, and `signer`.
- Metadata changes should have a short payout cooling period, for example 24
  hours, so an operator cannot rapidly rotate model/prompt identity around a
  suspicious round.
- Version AI agent reputation by model/provider/prompt template.
- Discount highly correlated agents by operator, funding source, model family,
  prompt fingerprint, and voting behavior.
- Apply the same `CALIBRATION_ROUNDS_REQUIRED = 10` launch rule to AI raters,
  but make missing or stale AI metadata payout-ineligible until corrected.

## Contract Architecture

### `LoopReputation`

Purpose:

- Transferable capped reputation token.
- ERC20Votes checkpoints and self-delegated voting power for day-one governance.
- Protocol-native lock, unlock, slash, and redistribution hooks.
- Governance clock compatible with the previous Curyo launch parameters on
  Celo.
- Seven-day governance locks for proposal and voting power, reused from RateLoop.
- Launch Distribution Pool allocation: `35M LREP` verified + referral rewards,
  `25M LREP` earned rater rewards, and `4M LREP` legacy users.
- Fixed launch pools for launch distribution, treasury, and consensus reserve.

Reuse:

- Start from `packages/foundry/contracts/HumanReputation.sol`.
- Keep 6 decimals, ERC20Votes, ERC20Permit, and self-delegation-on-receipt if
  the UX still benefits from it.
- Keep documentation and UI copy clear that LREP voting power is self-delegated
  in the current contract; operational identity delegation is a separate
  VoterIdNFT/profile concept.
- Reuse the old Curyo governance durations. If the implementation keeps the old
  block-number clock, preserve the previously used Celo-calibrated values. If
  it moves to an ERC-6372 timestamp clock, preserve the same human durations in
  seconds.
- Keep the existing `MAX_SUPPLY` concept at `100,000,000 * 1e6`.
- Remove ERC1363 as a staking transport unless another protocol flow needs it.
- Remove faucet mint assumptions.

Key changes:

- Keep normal transfers enabled.
- Enforce hard max supply on all mint paths.
- Add protocol lock ledger with per-round lock accounting.
- Add fixed launch-pool accounting:
  `LAUNCH_DISTRIBUTION_POOL = 52_000_000e6`,
  `LAUNCH_VERIFIED_REFERRAL_POOL = 25_000_000e6`,
  `LAUNCH_EARNED_RATER_POOL = 25_000_000e6`,
  `LAUNCH_LEGACY_POOL = 2_000_000e6`,
  `BOOTSTRAP_POOL = 12_000_000e6`, `DAO_TREASURY = 32_000_000e6`, and
  `CONSENSUS_RESERVE = 4_000_000e6`.
- Add launch-distribution, bootstrap-distribution, and protocol
  lock/slash roles controlled by governance/timelock.
- Add events for launch rewards, legacy claims, bootstrap distributions, locks, unlocks,
  redistributions, and slashes.
- Preserve vote checkpoints for historical governance snapshots.
- Keep governance transfer restrictions for active proposal/vote locks, but
  allow normal token transfers outside locked balances.

### `RaterRegistry`

Purpose:

- Register a rater profile without proof-of-personhood.
- Store optional rater type and metadata hash.
- Store optional Self-backed uniqueness credentials for verified raters.
- Seed the previous Self-verified Curyo bootstrap accounts as a sunsetted trust
  anchor set.
- Store bounded, revocable, category-aware trust attestations.
- Expose cluster/risk flags assigned by governance or a scorer.

Reuse:

- Use lessons from `VoterIdNFT.sol` delegation handling.
- Reuse Self nullifier uniqueness only for optional credentials. Do not reuse
  Self mint gates, max supply, faucet logic, or identity claims in the required
  rater registration path.

Possible events:

```solidity
event RaterRegistered(address indexed account, uint8 raterType, bytes32 metadataHash);
event RaterMetadataUpdated(address indexed account, uint8 raterType, bytes32 metadataHash);
event SelfCredentialAttested(address indexed rater, bytes32 indexed nullifierHash, bytes32 evidenceHash);
event TrustSeedSet(address indexed rater, uint64 sunsetAt, bytes32 seedRoot);
event TrustAttestationSet(bytes32 indexed attestationId, address indexed issuer, address indexed subject);
event RaterClusterUpdated(address indexed account, bytes32 indexed clusterId, uint16 discountBps);
```

### `RaterDeclarationRegistry`

Purpose:

- Store signed AI rater declarations separately from the generic rater profile.
- Require compact model/operator/prompt/retrieval/tooling hashes for AI raters
  before production bounty payouts.
- Bond the declared operator so challenges and probe failures have economic
  weight.
- Allow one-shot probes, behavioral drift flags, retirement, redeclaration, and
  community challenges.

Reuse:

- Use `LoopReputation` as the bonded asset.
- Keep full model and prompt metadata off-chain in signed JSON or a
  content-addressed document.
- Treat model-fingerprinting probes, including LLMmap-style behavioral
  fingerprinting, as evidence inputs rather than absolute truth. The protocol
  records probe/result hashes and challenge outcomes; full transcripts can stay
  off-chain.

Detailed implementation plan:
[AI Rater Declarations And Optional Model Probes](./research/ai-rater-declaration-and-probes-plan.md).

Possible events:

```solidity
event DeclarationSubmitted(address indexed rater, address indexed operator, uint32 version, bytes32 declarationHash);
event ProbeResultRecorded(address indexed rater, address indexed operator, uint32 version, bool passed);
event BehavioralDriftFlagged(address indexed rater, address indexed operator, uint32 version, uint16 driftScoreBps);
event ChallengeOpened(uint256 indexed challengeId, address indexed challenger, address indexed rater, address operator);
event ChallengeResolved(uint256 indexed challengeId, uint8 status, uint256 operatorSlash, uint256 challengerReward);
```

### `PredictionVotingEngine`

Purpose:

- One sealed prediction round per content by default.
- Commit, reveal, settle, cancel, and reveal-failed states.
- Compute final opinion rating and emit settlement inputs.

Reuse:

- Start from `RoundVotingEngine.sol`.
- Keep per-content `rounds`, `commits`, config snapshots, tlock metadata,
  cooldowns, max voters, reveal grace, and keeper-oriented iteration.
- Keep the fresh-proxy deployment policy for storage-breaking voting changes.

Key changes:

- Replace `bool isUp` with `uint16 opinionRatingBps` and
  `uint16 predictedCrowdRatingBps`.
- Replace transferred HREP stake with `reputationLock`.
- Replace up/down pools with weighted prediction aggregates:
  `weightedPredictionSum`, `totalEffectiveWeight`, prediction count,
  dispersion, and final rating.
- Track LREP lock outcomes: returned lock, revealed-loser refund, net losing
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
  uint16 opinionRatingBps,
  uint16 predictedCrowdRatingBps,
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

- Redistribute LREP lock losses from inaccurate or unrevealed crowd predictions
  to accurate revealed raters, eligible frontends, treasury, and consensus
  reserve.
- Claim USDC bounty shares for eligible split reports.
- Emit reputation-score outcomes or consume score roots.
- Keep claims pull-based.

Reuse:

- Start from `RoundRewardDistributor.sol` only for claim accounting patterns,
  dust handling discipline, frontend fee accounting, and non-pausable withdraw
  posture.

Key changes:

- Replace binary HREP winner/loser claims with predicted-rating error claims.
- Preserve the current split defaults for LREP losses: 5% revealed loser refund,
  then 91% to accurate raters, 3% to eligible frontends, 1% to treasury, and 5%
  to consensus reserve.
- Pay USDC from bounty pools.
- Keep USDC payout accounting separate from LREP lock redistribution.
- Implement USDC work-stipend and accuracy-pool accounting with cluster caps.
- Implement insufficient-signal attempt stipend and refund accounting.
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
- Allocate USDC by the two-pool model: smaller work stipend plus larger
  accuracy-weighted payout.
- Support insufficient-signal attempt stipends capped at 10% of the bounty.
- Pay AI raters through the same USDC path as other raters once they satisfy
  calibration and required metadata.

### `FrontendRegistry`

Purpose:

- Give independent frontends a clear economic reason to integrate RateLoop.
- Attribute prediction commits, bounty claims, and feedback awards to a
  registered frontend/operator.
- Let frontend operators claim their share through a pull-based flow.

Reuse:

- Keep the current frontend-code attribution model.
- Keep eligibility/stake concepts for spam resistance and operator
  accountability, denominated in LREP.
- Keep keeper/frontend-fee sweep support for hosted frontends.

Launch rule:

- Frontends must stake LREP to be fee-eligible.
- Default required frontend stake: `1,000 LREP`, matching the old fixed frontend
  registry stake mental model.
- Default frontend share: 3% of eligible bounty and feedback payouts.
- Max frontend share: 5%, adjustable only by governance.
- If frontend fee transfer or registry credit fails, fallback should pay the
  rater rather than trapping user funds.
- Slashed or underbonded frontends should lose future fee eligibility and may
  have historical unclaimed fees routed to the protocol, matching the current
  design intent.

### `RateLoopGovernor`

Purpose:

- Day-one decentralized protocol governance using transferable capped
  reputation.

Launch requirements:

- Deploy `RateLoopGovernor`, `TimelockController`, `LoopReputation`, and
  core protocol contracts together.
- Timelock owns ProxyAdmins, treasury roles, config roles, optional participation
  reward roles, reserve roles, and protocol upgrade authority from launch.
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

- Reuse the previous Curyo governance launch parameters as durations and token
  amounts.
- Voting delay: `1 day`.
- Voting period: `7 days`.
- Timelock delay: `2 days`.
- Proposal threshold: `1,000 LREP`.
- Proposal threshold floor: `1,000 LREP`; governance cannot lower the threshold
  below the bootstrap floor.
- Quorum: `max(4% of circulating LREP, 100,000 LREP)`.
- Circulating supply for quorum excludes protocol-controlled holders, including
  the launch distribution pool, consensus reserve, DAO treasury, voting engine,
  content registry, frontend registry, and protocol-owned
  distributor/escrow contracts.
- Max proposal threshold: `100,000 LREP`.
- Proposal cooldown: `1 day` between proposals per proposer.
- Governance lock: lock used voting power and the proposal-threshold amount for
  `7 days`, preserving the old anti-flash-governance design.
- Keep the old excluded-holder replacement mechanism so governance can migrate
  protocol pools without breaking historical quorum snapshots.
- Implement the above with the previous Curyo launch parameters on Celo. If the
  implementation changes the governance clock type, keep the same intended
  one-day, seven-day, and two-day durations.

Governance can still use separate risk controls for rating/payout eligibility,
but protocol ownership should be live and tokenholder-controlled from the first
deployment.

## Indexer And API Plan

Reuse Ponder, but rename old Curyo-specific tables and add prediction/reputation
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
  - contentId, roundId, rater, commitHash, opinionRatingBps,
    predictedCrowdRatingBps, lock amount, effective weight, revealed state,
    timestamps.
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
  - pool, round, rater, payout kind, gross amount, work stipend amount,
    accuracy amount, cluster cap, frontend fee, claimedAt.
- `ai_rater_metadata`
  - rater, operator, model, promptVersionHash, metadataHash, updatedAt.
- `calibration_status`
  - rater, completed rounds, eligibleSince, categories.
- `rating_bounty`
  - bountyId, contentId, roundId, bounty kind, challengedRoundId, reason hash,
    funder, asset, amount, status, refund/forfeit state.
- `launch_distribution_claim`
  - account, rail, amount, cohort, claim index, claimedAt, transaction hash.
- `governance_voting_power`
  - account, selfDelegate, votes, updatedAt.

### API Changes

- Feed APIs should return split-report state, not up/down pools.
- Feed APIs should distinguish initial ratings from challenge/re-rate rounds.
- Leaderboard should rank calibrated reputation, category reputation, reveal
  reliability, and useful-feedback contribution.
- Vote history should show opinion rating, expected crowd rating, final rating,
  score delta, and payout eligibility.
- Claim routes should separate reputation changes from USDC claims.
- Content routes should expose rating history so users can see when a current
  score came from an initial bounty versus a later re-rate.
- Profile routes should show rater type and calibration status without implying
  identity proof.

## Frontend Plan

### Visual Direction

Use RateLoop as the product brand, with the Hawig visual system as the new
brand source of truth. Copy and adapt the hero animation and logo from
`https://github.com/Noc2/Hawig`:

- `src/components/Hero.tsx` becomes the public hero foundation, with RateLoop
  copy instead of Hawig Ventures copy.
- `src/components/OrbAnimation.tsx` becomes the animated RateLoop hero asset.
- `src/app/icon.svg` becomes the initial RateLoop logo mark, adapted only as
  needed for naming and favicon/app-icon sizes.
- Reuse the Hawig brand colors: `#359EEE`, `#03CEA4`, `#FFC43D`, `#EF476F`.
- Reuse the Hawig typography direction: Space Grotesk for display/headings and
  Inter for body text.
- Add the required frontend dependencies for the hero animation, especially
  `gsap` and `@gsap/react`, unless the animation is later rewritten in a local
  animation stack.

The app itself should still feel like a dense, usable rating product rather than
a pure marketing page. Reuse old Curyo app surfaces where they are practical:

- Feed-first app layout.
- Compact cards for dense voting.
- Rating orb visual language.
- Category, search, watched, followed, and history views.
- Existing feedback panel and feedback bonus UI.
- Frontend registration, frontend-code attribution, claimable frontend fees,
  and the 3% default frontend operator share.

Copy direction:

- Use the RateLoop name and Hawig-derived logo/hero.
- Rename token surfaces from HREP to LREP / Loop Reputation.
- Replace human-only language with rater, prediction, calibration, rating
  signal, and independent signal language.
- Update headlines and subheadings so they describe open ratings, prediction
  quality, and independent signal instead of human-only prompts or
  proof-of-personhood.
- Keep "human" only where it is one possible rater type alongside AI, teams,
  and hybrid workflows.

### Voting UX

Replace the current binary voting dock:

- Current: rating orb + up/down buttons + stake modal.
- Target: rating orb + opinion slider/input + expected-crowd slider/input +
  bounded LREP lock selector.

The primary action should be:

```text
Submit split rating -> confirm private report -> reveal/settlement status
```

User-friendly details:

- Show rating as `x.x / 10`.
- Use a `1.0-9.9` scale and let the slider snap to tenths while storing BPS.
- Show current rating/reference rating.
- For challenge/re-rate rounds, show the prior rating being challenged and the
  challenge reason.
- Show the user's split rating report after reveal, not before.
- Explain eligibility through UI state, not long instructional text.
- Keep feedback separate: users can still leave written feedback through the
  existing feedback surface.

### Onboarding

Remove mandatory identity verification onboarding. Replace with:

- Connect wallet.
- Make calibration predictions.
- Reveal reliably.
- Earn reputation.
- Become USDC eligible after calibration.

Avoid language that says one wallet equals one person. Optional Self badges can
be surfaced later as trust context, but they should not block the default rater
journey.

### Sponsored Transaction UX

Reuse old Curyo's sponsored transaction model. RateLoop should preserve the
thirdweb/EIP-5792 sponsored path with a self-funded fallback.

Launch sponsorship policy:

- Sponsor low-cost product-critical actions: launch or legacy claim, delegation,
  calibration commits, reveals, standard predictions, USDC claims, and frontend
  fee claims.
- Do not depend on sponsorship for funding bounties, staking frontend LREP, or
  governance actions; those should work self-funded first, with sponsorship only
  if governance later approves a quota.
- Keep per-address, per-session, and per-chain sponsorship quotas so bots cannot
  turn gas sponsorship into a separate faucet.
- Keep wallet-sensitive tests around injected wallets, thirdweb wallets,
  sponsored 7702 flows, and self-funded fallbacks.

### Pages/Components To Refactor

- `VotePageClient.tsx`: keep feed logic, replace `isUp` flow with
  `opinionRatingBps` and `predictedCrowdRatingBps`.
- `VotingQuestionCard.tsx`: keep layout and rating display, replace arrow
  controls with prediction controls.
- `StakeSelector.tsx`: rename/refactor to `PredictionComposer.tsx`.
- Add a `FundRerateModal` or extend the bounty funding modal so a user can fund
  a challenge/re-rate against a prior result.
- `useRoundVote.ts`: rename/refactor to `usePredictionVote.ts`.
- `useVoterAccuracy*`: rename/refactor to reputation/calibration hooks.
- `ClaimRewardsButton.tsx`: split USDC bounty claim from reputation display.
- `FaucetSection`, `SelfVerifyButton`, `HumanSignInButton`: remove from the
  required onboarding path. Optional identity UI should be rebuilt separately if
  Self.xyz is reintroduced.

## SDK Plan

Refactor `packages/sdk/src/vote.ts`:

- `buildCommitVoteParams` -> `buildPredictionCommitParams`.
- Input `isUp` -> `opinionRatingBps` and `predictedCrowdRatingBps`.
- `buildStakeAmountWei` -> `buildReputationLockAmount`.
- Keep salt generation, tlock runtime resolution, frontend code resolution, and
  tests.
- Add helpers for rating scale conversion:
  - `1.0-9.9` score -> `1000-9900` BPS.
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

- Decode split rating ciphertexts instead of binary vote ciphertexts.
- Submit `opinionRatingBps` and `predictedCrowdRatingBps` reveals.
- Watch for rounds with insufficient independent weight.
- Trigger settlement after reveal grace or quorum rules.
- Optionally submit score roots if advanced off-chain scoring is introduced.

## AI Rater And Agent Plan

Keep `packages/agents`, but make it a first-class RateLoop package:

- Add an AI rater CLI that reads open questions and submits predictions.
- Record required model, operator, prompt/version, retrieval, and tooling hashes
  through `RaterDeclarationRegistry`.
- Require a registered rater profile and current AI declaration for production
  USDC eligibility.
- Require an operator bond before an AI declaration becomes payout-eligible.
- Add an optional model-prober path that can run LLMmap-style fingerprinting and
  deterministic behavioral probes against an operator-granted endpoint, then
  publish a versioned probe result hash to `RaterDeclarationRegistry`.
- Keep agent predictions visible after reveal.
- Let AI raters earn USDC at launch through the same calibration path as other
  raters.
- Add tests that ensure agents cannot bypass calibration, required metadata,
  declaration bonds, probes, challenges, or metadata-change cooling periods.
- Enforce contract hard floors for AI declaration bonds and challenge bonds so
  governance can tune above launch defaults without reducing accountability to
  dust.

## Implementation Sequence

### Phase 0: Repository Bootstrap

1. Use `https://github.com/Noc2/RateLoop` as `origin`.
2. Import or continue the old Curyo monorepo in the RateLoop repository.
3. Copy the Hawig hero/logo source files into the RateLoop frontend and adapt
   them for RateLoop naming.
4. Rename live package metadata and imports from `@curyo/*` to `@rateloop/*`.
5. Update root package metadata, scripts, environment examples, and generated
   package exports only where they reference removed Self/faucet/chain state.
6. Delete legacy deployment artifacts from the canonical branch.
7. Configure the `35M / 25M / 4M` Launch Distribution Pool and document any
   legacy-user claim provenance.
8. Keep chain defaults and environment examples on Celo/World Chain Sepolia.
9. Keep old Curyo commit history if practical, but do not keep old deployment
   state as live deployment state.

Exit criteria:

- `yarn install` works.
- `yarn test:ts` can at least start after package rename work.
- No Self packages are required for core rating, earning, or governance flows.
- The imported snapshot file, Merkle-generation script, and Celo chain constants
  are present.
- The Hawig-derived RateLoop logo and hero animation are present in the
  frontend without pulling in unrelated Hawig app content.

### Phase 1: Make Identity Optional, Remove Faucet, And Replace Legacy Token Flows

1. Delete `HumanFaucet.sol`.
2. Remove Self imports/remappings and mock identity hub contracts from required
   deployment/build paths.
3. Move any retained Self UI/API/telemetry code behind an optional identity
   feature boundary, or delete it if it cannot be cleanly isolated.
4. Remove `VoterIdNFT` requirements from content submission, voting, rewards,
   profiles, and frontend registry.
5. Remove legacy faucet/migration allocations from deployment scripts and
   replace them with the Launch Distribution Pool rails.
6. Keep Celo deployment constants in live RateLoop config.
7. Update docs and app copy to use rater/reputation language.

Exit criteria:

- No live production path requires `Self`, `self.xyz`, `verifySelfProof`, or
  `VoterIdRequired` to rate, earn, govern, or claim.
- Foundry build passes for the reduced contract set.

### Phase 2: Contract MVP

1. Implement `LoopReputation`.
2. Implement the Launch Distribution Pool: earned rater rewards with
   governance-tunable verified-human anchor diversity, one-time decaying
   verified bonuses, bounded referrals, and a tiny legacy Merkle claim.
3. Implement `RateLoopGovernor` and `TimelockController` ownership wiring.
4. Implement `RaterRegistry`.
5. Implement `RaterDeclarationRegistry` for bonded AI metadata, probes, drift,
   and challenges.
6. Implement `PredictionVotingEngine`.
7. Implement the first version of `PredictionRewardDistributor`.
8. Refactor `QuestionRewardPoolEscrow` for one-round bounties,
   challenge/re-rate metadata, and reputation/cluster eligibility.
9. Add LREP prediction lock accounting and the prediction-error winner/loser
   redistribution model.
10. Preserve `FrontendRegistry`, require a `1,000 LREP` frontend stake, and keep
   the 3% default frontend share.
11. Add AI rater metadata requirements to registry, commit/reveal, or payout
    eligibility.
12. Refactor `DeployRateLoop.s.sol` in place with HREP-style LREP pools and Celo
    USDC constants.
13. Regenerate ABIs and deployment package exports.

Exit criteria:

- Foundry tests cover capped supply, transfers, delegation, launch distribution claims,
  timelock-owned roles, commit, reveal, settle, cancel, missed reveal,
  reputation lock/unlock/redistribution, calibration gating, one-round bounty
  payout, LREP loser/winner redistribution, frontend stake and fee
  reservation/claim, challenge bounty creation, AI metadata gating, 1.0-9.9 rating
  bounds, Curyo-derived governance parameters, and USDC claim gating.
- No old HREP transfer staking path remains.

### Phase 3: Ponder And API

1. Rename schema tables and handlers.
2. Add prediction, reputation, launch-distribution, governance, calibration, cluster,
   and payout tables.
3. Replace binary round aggregation with predicted-rating aggregation.
4. Update read API routes for feed, history, leaderboard, rating bounties, and
   claims.
5. Add route validation tests for prediction and payout shapes.

Exit criteria:

- Ponder indexes local deployment, launch distribution, governance delegation,
  frontend-fee, and prediction events.
- Feed API can render content, open rounds, revealed split reports, final rating,
  challenge/re-rate history, and claimable USDC.

### Phase 4: Frontend MVP

1. Apply RateLoop branding with the Hawig-derived logo, hero animation, color
   palette, and display typography.
2. Remove faucet screens and required Self verification screens; keep optional
   identity UI only if it is clearly non-blocking.
3. Replace up/down vote controls with prediction composer.
4. Add funding UI for explicit challenge/re-rate bounties.
5. Add launch reward/legacy claim and delegation UI.
6. Show calibration and reputation state in profile/feed surfaces.
7. Update reward/claim UI for USDC payout eligibility and frontend fee
   claimability.
8. Preserve sponsored transaction UX with Celo-compatible thirdweb/paymaster
   configuration and self-funded fallback.
9. Keep feedback UI unchanged except copy that needs to be less human-focused.

Exit criteria:

- Wallet-sensitive flow works: connect, submit content, fund initial bounty,
  claim launch or legacy reputation, verify self-delegated voting power, predict,
  reveal/settle, fund re-rate, view reputation, claim USDC, claim frontend fees,
  and recover to self-funded gas when sponsorship is unavailable.
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

1. Deploy to World Chain Sepolia with fresh contracts and governance/timelock active.
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

1. Publish the Launch Distribution Pool parameters, any legacy-user Merkle root,
   provenance, and review scripts.
2. Deploy `LoopReputation`, LaunchDistributionPool, Governor, Timelock, and core
   protocol contracts to World Chain mainnet.
3. Transfer all protocol roles and ProxyAdmin ownership to the timelock.
4. Renounce deployer setup roles after verification.
5. Open launch claims and delegation.
6. Launch with one-round bounties, frontend fee incentives, AI rater
   participation, LREP lock redistribution, and capped USDC payouts.

Exit criteria:

- RateLoop is tokenholder-governed from the first public deployment.
- Proposal, delegation, token supply, launch claims, and voting power are
  auditable from checkpoints and indexed events.

## Concrete PR Plan

1. `repo-bootstrap`: point the repo at `https://github.com/Noc2/RateLoop`,
   import old Curyo code, copy the Hawig hero/logo assets, configure the
   `35M / 25M / 4M` Launch Distribution Pool, keep World Chain defaults, rename live package metadata
   toward `@rateloop/*`, and keep the app running.
2. `optional-identity-remove-faucet`: remove faucet paths and make Self optional
   rather than required in packages, UI, routes, and deploy wiring.
3. `reputation-governance`: add capped transferable reputation, LREP launch
   pools, LaunchDistributionPool, Governor, Timelock,
   self-delegated voting power, and launch role wiring.
4. `rater-registry`: add open rater profiles, metadata, operational delegation,
   and cluster flags.
5. `prediction-engine`: replace binary votes with split rating commit-reveal
   and LREP lock accounting.
6. `usdc-bounty-refactor`: refactor reward escrow/distributor around one-round
   bounties, challenge/re-rate metadata, calibrated raters, AI metadata,
   frontend staking/fees, LREP winner/loser redistribution, and cluster caps.
7. `ponder-predictions`: update schema, handlers, and APIs.
8. `frontend-prediction-ui`: replace vote controls, add launch claim,
   self-delegation status, frontend fee, sponsored transaction, and onboarding
   surfaces.
9. `keeper-sdk-agents`: update commit builders, keeper reveal, and agent client.
10. `local-e2e`: add full local lifecycle tests and docs.
11. `testnet-deploy`: fresh deployment config, monitoring, and launch checklist.

## Parameter Defaults To Start With

These are launch defaults, not permanent constants:

- Chain: World Chain mainnet (`42220`), World Chain Sepolia (`11142220`) for testnet.
- USDC: Circle native USDC on World Chain,
  `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` mainnet and
  `0x01C5C0122039549AD1493B8220cABEdD739BC44E` testnet.
- Rating scale: `1000-9900` BPS, displayed as `1.0-9.9 / 10`.
- Token name/symbol: Loop Reputation (`LREP`).
- Reputation token: transferable ERC20Votes, 6 decimals.
- Reputation max supply: `100,000,000 LREP`, matching the old HREP cap.
- LREP tokenomics: `64M` Launch Distribution Pool, `32M` DAO treasury, `4M`
  consensus reserve.
- Launch Distribution Pool split: `35M LREP` verified + referral rewards,
  `25M LREP` earned rater rewards, `4M LREP` legacy users.
- Legacy claim window: 12 months, with unclaimed LREP swept by governance rule.
- Bounty scope: one sealed commit window plus reveal window, exactly one
  settlement attempt per bounty.
- Challenge/re-rate: explicit new bounty referencing a prior round/result.
- Frontend share: default 3%, max 5%, applies to bounty and feedback payouts.
- Frontend stake: `1,000 LREP` required for fee eligibility.
- Submission bounty minimums: hard floor of `1 LREP` or `1 USDC`; governance can
  raise them but not lower them below that floor.
- AI declaration bond floors: `5 USDC` minimum operator bond and `5 USDC`
  minimum challenge bond.
- Sponsorship: reuse old Curyo's sponsored transaction path with self-funded
  fallback and quotas.
- Minimum raw reveals: 3.
- Minimum independent participants for USDC: 3.
- Calibration rounds before USDC: 10.
- AI raters: USDC-eligible at launch after the same 10 calibration rounds and
  required model/operator/prompt-version metadata.
- Prediction lock: min `1 LREP`, default `5 LREP`, max `10 LREP`.
- LREP lock settlement: full winner band `0.25` rating points, loss cutoff
  `1.00` rating point, revealed loser refund `5%`.
- LREP losing-pool split after refund: 91% accurate raters, 3% frontends, 1%
  DAO treasury, 5% consensus reserve.
- USDC payout split: 25% work stipend, 75% accuracy pool.
- USDC near-miss cutoff: `1.50` rating points.
- Insufficient-signal attempt stipend: capped at 10% of bounty and
  cluster-capped.
- Reputation payout multiplier: capped small range, for example `1.0x-1.25x`.
- Voting power: square-root reputation curve.
- Cluster discount: can reduce to near-zero, should not boost over 1.0.
- Missed reveal penalty: reputation lock forfeit/redistribution, tunable and
  capped.
- Governance launch parameters: 1-day voting delay, 7-day voting period, 2-day
  timelock, 1,000 LREP proposal-threshold hard floor, dynamic quorum of `max(4% of
  circulating LREP, 100,000 LREP)`, 1-day proposal cooldown, 7-day governance
  lock.
- Governance voting power is self-delegated LREP in the current contract; docs
  should not imply third-party LREP vote delegation unless the token changes.

## Main Risks And Mitigations

### Sybil Farming

Risk: attackers mature many medium-reputation accounts to farm flat payouts.

Mitigations:

- Calibration before USDC eligibility.
- Cluster-capped payout allocation, including the work-stipend pool.
- Small bounded reputation payout multiplier.
- Rate limits by account, category, cluster, and epoch.
- Leave-one-cluster-out scoring for payout-sensitive rounds.
- Public cluster/payout explanations in Ponder.
- Keep the work stipend smaller than the accuracy pool so splitting accounts to
  collect base pay is less attractive than producing accurate signal.
- For the fixed earned-rater launch pool, require verified-human anchored
  rounds plus cross-round anchor diversity before payout. This is intentionally
  simpler than full cluster scoring at launch and can be tightened by
  governance.

### Majority Capture

Risk: if scoring rewards matching the majority, a coalition can define the
majority and compound reputation.

Mitigations:

- Score LREP locks and USDC eligibility with leave-one-out and
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
- Optional cooling periods after wallet, identity-delegation, or metadata
  changes.
- Governance uses token checkpoints and timelock delays so last-minute token
  movement cannot rewrite an active vote.

### Governance Capture

Risk: because reputation is transferable and governs the protocol from launch,
a whale or coordinated buyer can attempt to control parameters, treasury, or
upgrades.

Mitigations:

- Capped supply and published launch allocation.
- Broad earned launch distribution instead of team-only launch.
- Timelock delay on all high-impact actions.
- Proposal threshold, quorum, and late-quorum protection.
- Public holder-concentration monitoring and clear self-delegation status in the
  governance UI.
- Conservative treasury roles and pause-only emergency path.
- Keep v1 scoring simple enough that governance cannot hide discretionary
  off-chain payout changes.

### AI Correlation

Risk: many agents using the same model/prompt act like one rater.

Mitigations:

- Required agent metadata: model, operator, and prompt/version hash.
- Versioned reputation by model/operator/prompt family.
- Optional declaration probes using LLMmap-style behavioral fingerprinting,
  deterministic rules, and versioned probe-library hashes.
- Community challenges with USDC bonds, evidence hashes, resolver outcomes,
  operator-bond slashing on sustained challenges, and challenger-bond loss on
  rejected challenges.
- Cluster by model family, provider, prompt fingerprint, operator, funding
  source, and behavior.
- Same calibration requirement as other account types at launch, but no USDC
  eligibility when required metadata is missing or stale.
- Apply a short payout cooling period after material AI metadata changes.

### LREP Lock Harshness

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
revealed unless enough participants committed. Once the ciphertext becomes
decryptable, low-participation rounds may reveal a small set of predictions.

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

## Definition Of Done For The First RateLoop MVP

The MVP is done when:

- There is no mandatory Self.xyz dependency.
- Users can connect a wallet without proof-of-personhood.
- Users can submit a private `1.0-9.9` opinion rating and expected crowd rating
  through commit reveal.
- Each bounty funds exactly one private prediction round.
- Users can fund an explicit challenge/re-rate bounty against a prior result.
- Loop Reputation is transferable, capped, checkpointed, and distributed through
  a published launch pool that gives the small legacy user set `4M LREP`.
- LREP tokenomics use a `64M / 32M / 4M` pool structure; the `64M`
  Launch Distribution Pool is split into `35M` verified + referral rewards,
  `25M` earned rater rewards, and `4M` legacy users.
- LREP rating-report locks redistribute inaccurate crowd predictions and
  unrevealed locks to accurate raters, eligible frontends, treasury, and reserve
  without increasing supply.
- RateLoop governance and timelock own protocol roles from launch.
- Governance uses the previous Curyo launch durations, thresholds, quorum, and
  governance-lock rules on Celo.
- Users complete calibration before USDC eligibility.
- AI raters can earn USDC at launch after the same calibration requirement and
  required metadata.
- USDC bounty payout is cluster-capped and not linear by wallet count or raw
  reputation, with a small work stipend and a larger accuracy pool.
- Frontend operators can earn the default 3% share on bounty and feedback
  payouts only after staking LREP.
- The app preserves sponsored transaction support with a self-funded fallback.
- Contracts, app, indexer, SDK, and keeper are configured for Celo/World Chain Sepolia.
- The frontend uses the Hawig-derived RateLoop hero/logo system while preserving
  old Curyo's usable feed/rating surfaces where they fit the new prediction
  mechanics.
- Ponder exposes enough data for public auditability of rating, reputation,
  launch claims, governance, frontend fees, and payout decisions.
- Local end-to-end tests cover the full lifecycle.
