# RateLoop / RateLoop Smart Contract Security Audit — 2026-05-16

**Scope:** ~17.2k lines of Solidity across 56 production files in `packages/foundry/contracts/`
**Method:** 4 parallel domain-focused review agents (funds-flow, voting/game-theory, identity/governance, integrations/oracles)
**Baseline:** May 4, 2026 audit at `packages/foundry/audit-report-2026-05-04.md` (0 H/C/M/L). Findings already covered there were excluded.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| **Medium** | **8** |
| Low | 12 |
| Informational | 16 |

No critical or high-severity issues. The Mediums cluster around three themes worth addressing before mainnet:

1. **Oracle finalization arbiter loses authority after first claim, and challenge-bond floor is missing** (M-Oracle-2, M-Oracle-3).
2. **RBTS sampler seed is biasable by the last committer / by selective reveal** (M-Vote-1, M-Vote-2) — sampler depends on `commitKey` derived from voter-controlled `salt`, and on the *revealed* (not committed) set. Both are fixable without ZK by binding the seed to commit-time data only.
3. **Engine/escrow rotation lacks deauthorization paths** (M-Identity-1, M-Vote-3) — old voting engine retains callback authority on ContentRegistry; bundle-observer notify failures are silently swallowed.

Plus M-Identity-2 (Governor excluded-holder cap of 16) and M-Funds-1 (frontend-fee accounting drift on USDC blocklist).

Note on the original M-Oracle-1 (optimistic snapshot griefing): downgraded to Low after author review confirmed `FrontendRegistry` requires a 1,000 LREP stake (`STAKE_AMOUNT`) that is slashable by `GOVERNANCE_ROLE` via `slashFrontend`. See L-Integrations-5 below.

---

## Medium findings

### M-Oracle-2 — Finalized snapshot can't be rejected once any one claimant has consumed it

**File:** `ClusterPayoutOracle.sol:407-426`; `QuestionRewardPoolEscrow.sol:989-1000`; `LaunchDistributionPool.sol:582-591`

`rejectFinalizedRoundPayoutSnapshot` reverts when `isRoundPayoutSnapshotConsumed` returns true. Both consumers flip the flag after the *first* paid claim. A proposer who lands one honest small claim can lock in an inflated merkle tree for the rest of the leaves — arbiter is powerless after that point.

**Fix:** per-leaf consumption tracking, or a post-finalization veto window that blocks future claims while honoring already-paid ones.

### M-Oracle-3 — `setOracleConfig` accepts `challengeBond = 0`

**File:** `ClusterPayoutOracle.sol:154-164`

No floor enforced. Combined with M-Oracle-1, a misconfiguration makes challenges free → service-level DoS.

**Fix:** enforce `newChallengeBond >= MIN_CHALLENGE_BOND`.

### M-Vote-1 — RBTS sampler seed is grindable via voter-controlled `salt` (commit-key bias)

**File:** `libraries/RoundRevealLib.sol:165-170, 333-341`; `libraries/VotePreflightLib.sol:175`; `libraries/TlockVoteLib.sol:50-77`

`commitKey = keccak256(voter, commitHash)`, and `commitHash` includes the user-chosen `salt`. The sampler seed is a chain over `commitKey`s. The last committer can off-chain grind `salt` to bias which other voters their `referenceKey`/`peerKey` resolve to. With 3-of-9 sybils, ~22k iterations yield a configuration where all attackers draw attacker peers and score 100%.

**Fix:** mix `block.prevrandao` of the last commit's block into the seed, or order `revealedKeys` by voter address (independent of salt).

### M-Vote-2 — Selective reveal of own commits re-rolls the sampler after grace

**File:** `RoundVotingEngine.sol:780-880`; `libraries/RoundRevealLib.sol:142-238`

`revealedSetHash` depends on which commits are revealed, not which are committed. An attacker controlling N sybil commits can selectively reveal a subset (forfeiting the rest) to engineer a favorable seed. `SelectiveRevelationTest` covers blocking, not seed-grinding.

**To clarify what is and is not fixable here:** the right of any voter to forfeit their stake by not revealing is fundamental and not addressable without ZK / forced-decryption schemes. That is not the issue. The issue is that this *act of selective non-reveal currently changes the sampler seed for everyone else in the round.* That coupling is incidental to the implementation, not required by the design — the seed only happens to depend on reveal-time data because `revealedSetHash` is currently chained over the revealed subset.

**Fix:** build `revealedSetHash` over the *committed* set (every `commitKey`, revealed or not, in commit order). Sampler indices then map positionally into the revealed subset (or skip + advance to next revealed commit on a miss). Net effect:

- Whether voter X reveals or not has zero effect on the seed voter Y observes.
- Non-revealing voters still forfeit their stake (the fundamental property is preserved).
- Selective reveal as a seed-grinding technique disappears.

Combines well with the M-Vote-1 fix: mixing `block.prevrandao` of the last commit's block into the seed makes the seed both unguessable at commit time and reveal-independent.

### M-Vote-3 — `_notifyBundleRoundTerminal` silently swallows escrow reverts

**File:** `RoundVotingEngine.sol:715-721`

`try ... catch { }` with no event, no retry, no admin backfill. If the bundle escrow reverts (gas exhaustion, future bug, adversarial replacement), the engine moves on but the escrow's `qualifiedRounds` accounting is permanently desynced — bundle reward funds become unreachable.

**Fix:** emit a `BundleObserverNotifyFailed` event in the catch, make `recordBundleQuestionTerminal` idempotent, add an admin backfill.

### M-Identity-1 — Old voting engine retains callback authority on `ContentRegistry`

**File:** `ContentRegistry.sol:329-341, 1027-1031, 1035-1054, 1056-1102`

`setVotingEngine` only adds authorization; the prior engine's `votingEngineCallbackGeneration` slot is never cleared. The "stale" check uses `contentSettlementEngineGeneration[contentId]`, which is `0` for any content the new engine hasn't yet settled. After a rotation, the deauthorized engine can still write arbitrary `RatingState`, refresh dormancy, and overwrite tracking on every fresh content.

**Fix:** add `revokeVotingEngine(address)` that zeros the callback grant; or use the canonical `votingEngineGeneration` global rather than per-content.

### M-Identity-2 — Governor `excludedHolders` permanently saturates at 16

**File:** `governance/RateLoopGovernor.sol:58, 115-126`

`replaceExcludedHolder` only appends. With ~5–8 initial entries (participation, launch, treasury, governor pools), only ~8–11 lifetime rotations remain. Once exhausted, future protocol-pool migrations cannot be quorum-excluded — circulating supply inflates and quorum becomes unmeetable.

**Fix:** raise cap to 64–128, or add a sunset-block prune that retires very old entries from the cap.

### M-Funds-1 — `frontendFeeClaimedAmount` increments even when frontend transfer falls back to voter

**File:** `QuestionRewardPoolEscrow.sol:730-738`; `libraries/QuestionRewardPoolEscrowTransferLib.sol:24-45`

Snapshot accounting writes `reservedFrontendFee` *before* the transfer. When `tryTransfer` fails (USDC blocklist, contract revert) and the helper redirects the fee to `rewardRecipient`, the snapshot still records the fee as "claimed" — over-stating the bucket. Last claimant of the round receives a smaller-than-correct share; residue gets stranded until refund. Pool stays solvent; voters absorb the loss until the funder/treasury sweeps via refund grace.

**Fix:** have `settleClaimPayout` return both reserved-and-actually-paid; subtract the unpaid portion from `frontendFeeClaimedAmount`. Same fix needed in the bundle path.

---

## Low findings

### Funds flow

- **L-Funds-1** — No surplus-rescue on `QuestionRewardPoolEscrow` / `FeedbackBonusEscrow`. Direct ERC-20 donations are stranded forever. Add `recoverSurplus*` matching the patterns already in `RoundVotingEngine`, `RoundRewardDistributor`, `ParticipationPool`, `LaunchDistributionPool`.
- **L-Funds-2** — `FeedbackBonusEscrow.forfeitExpiredFeedbackBonus` reverts hard when `treasury == address(0)` with no funder fallback. Defense-in-depth gap; treasury is operationally always set.
- **L-Funds-3** — `bundleQuestionRecordedRounds` slot not cleared on `resetRoundSet`; the `&lt;= prev` predicate in `_recordBundleQuestionTerminal` makes the invariant fragile under future refactors.

### Voting

- **L-Vote-1** — `revealRbtsVote` reads `commit.revealableAfter` two lines after `revealed = true`. Current code happens to work, but it violates the documented "always check `revealed` first" convention. Read into a local before flipping.
- **L-Vote-2** — `processUnrevealedVotes` cleanup pays no incentive on refunds (only forfeits). Tied/cancelled rounds with current-epoch unrevealed commits never get cleaned by economically rational keepers.
- **L-Vote-3** — Advisory commits to a future round can desync drand chain hash if governance changes config between commit and round creation. Functional only — the voter can self-reveal, but tlock keepers cannot.
- **L-Vote-4** — 3-of-3 sybil min-stake commits can grief `cancelExpiredRound` and force a `RevealFailed` cycle (~80 min) at ~3 HREP per cycle (~54 HREP/day per content). Pre-deadline content (e.g. bundle settlement) is the highest-value target.
- **L-Vote-5** — Advisory-recorder rotation empties cooldown mappings, letting voters double-vote within 24 h on one cycle.

### Identity / Governance

- **L-Identity-1** — `RaterRegistry.seedHumanCredential` lets `SEEDER_ROLE` permanently squat any 32-byte nullifier across providers (WorldID + Self share `humanNullifierOwner`). Namespace per provider.
- **L-Identity-2** — `ProfileRegistry.releaseName` is `ADMIN_ROLE`-only with no rate limit / no reason field. The temp deploy admin window is the particular concern; move to a dedicated `MODERATOR_ROLE` granted only by governance.
- **L-Identity-3** — `setRaterRegistry` / `setLaunchDistributionPool` / `setClusterPayoutOracle` skip the interface-validation pattern used by `setAdvisoryVoteRecorder`.
- **L-Identity-4** — `replaceExcludedHolder` doesn't require `code.length != 0`, so an EOA could be excluded.

### Integrations / Oracles

- **L-Integrations-1** — Bond credit not clawed back on post-finalization rejection. Mooted today by `bond: 0` proposals; matters once M-Oracle-1 introduces proposer bonds.
- **L-Integrations-2** — `X402QuestionSubmitter` has no token-rescue and no owner. Accidentally-sent USDC is permanently stuck. Add a governance-gated `rescueToken`.
- **L-Integrations-3** — `ClusterPayoutOracle.challengeCorrelationEpoch` / `challengeRoundPayoutSnapshot` lack `nonReentrant`. Safe with USDC; fragile with future bond tokens.
- **L-Integrations-4** — `SubmissionMediaValidator` accepts loopback / private-IP / single-character host URLs. Frontend SSRF risk, not contract risk.
- **L-Integrations-5** *(downgraded from M-Oracle-1)* — Optimistic snapshot griefing by an eligible frontend.
  **File:** `ClusterPayoutOracle.sol:177-215`, `:274-331`
  Any address satisfying `frontendRegistry.isEligible(msg.sender)` can be first to propose for any `(epochId)` or `(domain, rewardPoolId, contentId, roundId)`. Proposals carry `bond: 0`, so per-proposal cost is just gas; defenders pay `DEFAULT_CHALLENGE_BOND` (5 USDC) per griefed snapshot to challenge.
  The deterrent is the 1,000 LREP `STAKE_AMOUNT` posted at registration (`FrontendRegistry.sol:32, 177-188`), which `GOVERNANCE_ROLE` can take partially or fully via `slashFrontend` (`FrontendRegistry.sol:296`). Once slashed, `_isEligible` returns false and the frontend can no longer propose.
  Sustained griefing is therefore firmly deterred — expected loss = 1,000 LREP. The remaining concern is **one-shot griefing**: delaying a single high-value payout by one challenge window (12 h default) where `value-of-delay > P(slash) × 1000 LREP`. Slashing is a manual governance action, so during the bootstrap period the cost-of-action on the social side is real.
  **Recommended hardening (any of):** (a) document a slashing playbook for oracle griefing and ensure governance monitoring is in place pre-mainnet; (b) add an automated suspension — if frontend X has had ≥N proposals successfully challenged in M days, auto-revoke proposing rights pending governance review; (c) require a small per-proposal USDC bond on top of the global LREP stake (closes the one-shot window without changing the stake model).

---

## Informational

### Funds flow

- **I-Funds-1** — USDC blocklist of a single voter forfeits their reward to the funder via the refund path; no per-claimant redirect mechanism (same on bundle path).
- **I-Funds-2** — Bundle `_qualifyBundleRoundSet` reset path is currently dead code, but assumes `contentRoundConfig.maxVoters` is immutable. A future `setMaxVoters` would create a permanent stuck state.
- **I-Funds-3** — `LaunchDistributionPool` pending credits pin to the oracle address at record time. Oracle replacement permanently locks the credit; idempotency flags prevent re-record.
- **I-Funds-4** — `claimParticipationReward` accumulates against the distributor's global `reservedRewards` bucket in `ParticipationPool` — invariant holds today but is implicit.
- **I-Funds-5** — Bundle `_isBundleExcludedVoter` mixes snapshot-time and current-time submitter identity; a content-owner change between qualification and claim can shrink the eligible-claimant set.

### Voting

- **I-Vote-1** — Advisory reveal blocks on first real reveal (`revealedCount != 0`). Predictably front-run by the fastest keeper, devaluing honest advisory voters' launch credit.
- **I-Vote-2** — Consensus subsidy "drain by sybil 3-of-3 unanimous round" is bounded per round (50 HREP cap) but rotating across N contents at 24 h cooldown can extract ~150 HREP/day until the reserve is empty.

### Identity / Governance

- **I-Identity-1** — `HumanReputation.votingEngine` and `HumanReputation.contentRegistry` are write-only dead state.
- **I-Identity-2** — `HumanReputation.lockForGovernance` else-branch math has a dead `max(currentBalance, amount)` ternary; `amount &lt;= currentBalance` is already enforced.
- **I-Identity-3** — `seedHumanCredential` / `revokeHumanCredential` events lack a `provider` field; off-chain attribution is harder.
- **I-Identity-4** — `FrontendRegistry.FEE_CREDITOR_ROLE` admin defaults to `DEFAULT_ADMIN_ROLE`. The `creditFees` double-check (`msg.sender == feeCreditor && authorizedFeeCreditors[msg.sender]`) makes this defense-in-depth rather than exploitable. Set `_setRoleAdmin(FEE_CREDITOR_ROLE, GOVERNANCE_ROLE)` to harden intent.
- **I-Identity-5** — `_setConfig` doesn't re-clamp `revealGracePeriod` against `roundConfigBounds.maxRoundDuration + 1 day`. Consistent today, but no invariant assert protects future maintainers.

### Integrations

- **I-Integrations-1** — `roundPayoutSnapshotKey` doesn't bind `block.chainid` or `address(this)`. Cross-chain replay is blocked by leaf hashing; document for future readers.
- **I-Integrations-2** — `verifyPayoutWeight` silently returns `false` for invariant violations (`independenceBps > BPS_DENOMINATOR`, `effectiveWeight > baseWeight`), making the leaf unredeemable. A clearer revert in the consumer-side preflight would help debugging.
- **I-Integrations-3** — `epochId` in `proposeCorrelationEpoch` is fully proposer-controlled; gap-fills allowed. Verify downstream consumers don't assume monotonicity.
- **I-Integrations-4** — Libraries in scope contain no `delegatecall`. Only `using SafeERC20` and `using SafeCast` directives.

---

## Recommended remediation order

1. **Before mainnet** — M-Oracle-2, M-Oracle-3 (oracle finalization rejection + bond floor); M-Vote-1, M-Vote-2 (sampler seed bias); M-Identity-1 (engine deauthorization). Plus L-Integrations-5: have a documented slashing playbook for oracle griefing before opening the proposer set.
2. **Before first engine rotation** — M-Identity-1 fix is a hard precondition.
3. **Before first governance pool migration** — M-Identity-2 cap raise.
4. **Anytime** — M-Funds-1 fee accounting; M-Vote-3 observer event; all Lows where they apply.

## Suggested test additions

- Salt-grinding fuzz on RBTS sampler distribution (M-Vote-1)
- Subset-of-own-sybils selective-reveal differential (M-Vote-2)
- Bundle observer revert recovery (M-Vote-3)
- 3-sybil RevealFailed cycle drain bound (L-Vote-4)
- Advisory recorder rotation cooldown bypass (L-Vote-5)
- Old-engine callback after `setVotingEngine` rotation (M-Identity-1)
- `frontendFee` accounting under `tryTransfer` redirect (M-Funds-1)

---

## Items checked and confirmed sound

A non-exhaustive list of areas the agents specifically validated and found no issue with:

- Reentrancy across the multi-library call graph (`ReentrancyGuardTransient` holds across delegatecalled libraries; CEI ordering correct in claim paths).
- Insolvency / double-claim across bundle vs. pool vs. voter paths (`rewardClaimed` and `bundleRoundSetRewardClaimed` are independent keys; identity → commitKey resolution blocks two-EOA-one-identity).
- Allocation arithmetic / dust accumulation (residue routes correctly to last claimant; `fundedAmount` fully distributable).
- Fee-on-transfer detection (`pullExactToken` enforces exact balance delta).
- All four upgradeable contracts (`ProtocolConfig`, `ProfileRegistry`, `FrontendRegistry`, `ContentRegistry`) call `_disableInitializers()` and use OZ `initializer`.
- No contract retains `DEFAULT_ADMIN_ROLE` for the deployer post-`Deploy.s.sol`.
- WorldID `attestHumanCredentialWithProof` correctly binds proof to `msg.sender` via `worldIdSignalHash`; nullifier reuse blocked across providers (modulo L-Identity-1).
- Governor `BySig` paths route through the overridden `_castVote` so lock and excluded-holder checks apply.
- EIP-712 chainId binding is correct (OZ `EIP712` rebuilds domain on chainid change).
- Self-delegation enforced in HREP and LREP `_delegate`.
- Profile name normalization restricts to `[A-Za-z0-9_]` and lowercases for hashing — case-folding squatting and unicode confusables not possible.
- `ContentRegistry` submitter-identity binding falls back consistently across credential lifecycle changes.
- X402 gateway cannot redirect a submission to a different submitter (reservation key namespaced by submitter).
- X402 EIP-3009 nonce binding is comprehensive (chainid, registry, escrow, gateway, payer, payee, value, validAfter, validBefore, full payload hash).
- All commit/reveal state preconditions enforce strict round-state machine (settle/cancel/finalize cannot interleave).
- Tlock metadata bound to round; replay across rounds structurally impossible.
- `accountedHrepBalance` invariant maintained across commit, reveal, claim, refund, processUnrevealedVotes paths.

---

## File path reference

All paths relative to `packages/foundry/contracts/`:

**Funds flow:** `QuestionRewardPoolEscrow.sol`, `FeedbackBonusEscrow.sol`, `ParticipationPool.sol`, `LaunchDistributionPool.sol`, `RoundRewardDistributor.sol`, `libraries/QuestionRewardPoolEscrow*Lib.sol` (8 files), `libraries/RoundSettlement*Lib.sol` (2 files), `libraries/TokenTransferLib.sol`, `libraries/FrontendFee*Lib.sol` (2 files), `libraries/RewardMath.sol`, `libraries/LaunchRaterRewardLib.sol`.

**Voting:** `RoundVotingEngine.sol`, `AdvisoryVoteRecorder.sol`, `libraries/RoundLib.sol`, `libraries/VotePreflightLib.sol`, `libraries/TlockVoteLib.sol`, `libraries/RoundRevealLib.sol`, `libraries/RoundCleanupLib.sol`, `libraries/RatingLib.sol`, `libraries/RatingMath.sol`, `libraries/RobustBtsMath.sol`.

**Identity / Governance:** `governance/RateLoopGovernor.sol`, `HumanReputation.sol`, `LoopReputation.sol`, `RaterRegistry.sol`, `ProfileRegistry.sol`, `FrontendRegistry.sol`, `ContentRegistry.sol`, `CategoryRegistry.sol`, `ProtocolConfig.sol`, `interfaces/IFrontendRegistry.sol`, `interfaces/IRaterRegistryStatus.sol`, `interfaces/IProfileRegistry.sol`, `interfaces/IWorldIDRouter.sol`.

**Integrations:** `X402QuestionSubmitter.sol`, `ClusterPayoutOracle.sol`, `SubmissionMediaValidator.sol`, `interfaces/IClusterPayoutOracle.sol`, `interfaces/IRoundVotingEngine.sol`, `interfaces/IAdvisoryVoteRecorder.sol`, `interfaces/IRoundRewardDistributor.sol`.
