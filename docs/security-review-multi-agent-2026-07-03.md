# RateLoop Smart-Contract Review — Multi-Agent Pass (2026-07-03)

**Scope:** `packages/foundry/contracts` (21 contracts, 42 libraries, 18 interfaces; ~17.8k LoC). Solidity 0.8.35, OpenZeppelin, transparent upgradeable proxies.
**Method:** Multi-agent review + web research + adversarial verification (see [Methodology](#methodology)).
**Result:** 35 raw observations → 10 after triage/dedupe → **6 confirmed** (3 Medium, 3 Low) after adversarial verification. 4 were dismissed on verification (2 factually wrong, 2 intentional-by-design) and are listed in the [appendix](#appendix-a--raised-but-dismissed-on-verification) for transparency.

This is a defensive review of the author's own protocol, intended to harden the contracts. Nothing here indicates wrongdoing; these are latent weaknesses and consistency hazards worth closing.

---

## Summary

| ID | Severity | Conf. | Contract | Title |
|----|----------|-------|----------|-------|
| [RL-01](#rl-01--stale-delegate-authorization-can-silently-evict-an-active-delegate) | Medium | High | RaterRegistry | Stale delegate-authorization signature can silently evict an active delegate |
| [RL-02](#rl-02--releasebond-is-not-pausable) | Medium | High | ConfidentialityEscrow | `releaseBond` lacks `whenNotPaused`; a poster can escape a pending slash while paused |
| [RL-03](#rl-03--voter-lockout-when-snapshot-weight-exceeds-current-balance) | Medium | High | RateLoopGovernor / LoopReputation | `castVote` reverts (voter lockout) when snapshot weight exceeds current balance |
| [RL-05](#rl-05--proposal-cooldown-bypassable-via-propose-then-cancel) | Low | High | RateLoopGovernor | Proposal cooldown fully bypassable via propose-then-cancel while `Pending` |
| [RL-08](#rl-08--equal-share-divisor-conflates-bps-scaled-units-with-a-raw-count) | Low | Medium | QuestionRewardPoolEscrow | Equal-share divisor conflates BPS-scaled units with a raw count (latent + diverges from bundle path) |
| [RL-09](#rl-09--empty-open-round-treated-as-terminal-for-bond-release) | Low | Medium | ConfidentialityEscrow | Empty `Open` round treated as terminal, letting a poster reclaim the bond while content is still gated |

Themes: **RaterRegistry delegation nonce hygiene**, **ConfidentialityEscrow bond-release lifecycle** (two independent issues), and **governance lock/cooldown accounting**. No Critical or High issues survived verification; no direct theft-of-third-party-funds path was found.

---

## Findings

### RL-01 — Stale delegate-authorization can silently evict an active delegate
- **Severity:** Medium · **Confidence:** High · **Category:** logic-correctness
- **Location:** `packages/foundry/contracts/RaterRegistry.sol:822-831`, `:1533-1546`, `:1548-1560`

**Issue.** `acceptDelegateWithSig` authenticates a `DelegateAuthorization(holder, delegate, nonce, deadline)` and advances `delegateAuthorizationNonces[holder]` **only** on that path (`:828`). No other delegation transition advances the nonce — the on-chain `setDelegate`→`acceptDelegate` flow and `removeDelegate`/`_clearInboundDelegation` all leave it untouched, and there is no explicit nonce-cancel. Separately, `_validateDelegateActivation` (`:1533`) inspects `delegateOf[delegate]`, `pendingDelegate*`, and `delegateOf[holder]` but **never `delegateTo[holder]`**, so activation is allowed even when the holder already has an active delegate, and `_activateDelegate` (`:1548`) then silently `delete`s the current delegate.

**Failure scenario.** Holder `H` signs `DelegateAuthorization(H, D, nonce=0, deadline=T)` and hands it to `D`. `H` changes their mind and delegates on-chain to `E` (`setDelegate(E)`; `E` calls `acceptDelegate`), so `delegateTo[H]=E` and `delegateAuthorizationNonces[H]` is still `0`. Before `T`, `D` submits the old signature via `acceptDelegateWithSig(H, T, sig)`: the nonce still matches, `recover()` returns `H`, `_validateDelegateActivation` passes (it never checks `delegateTo[H]`), and `_activateDelegate` evicts `E` and sets `delegateTo[H]=D`, `delegateOf[D]=H`. `resolveRater(D)` (`:1197`) now resolves to `H`'s identity, so `D` controls `H`'s rater identity (voting, reward routing, launch-credit recipient) against `H`'s current on-chain intent.

**Code evidence (verified).** `delegateAuthorizationNonces[holder]` is mutated only in `acceptDelegateWithSig` (`:824`, `:828`). `_validateDelegateActivation` never reads `delegateTo[holder]`. `_activateDelegate`: `address oldDelegate = delegateTo[holder]; if (oldDelegate != address(0)) { delete delegateOf[oldDelegate]; ... }` (`:1548-1553`).

**Recommendation.** Advance `delegateAuthorizationNonces[holder]` on **every** delegation state transition that establishes, changes, or removes a delegate (in `_activateDelegate` and `removeDelegate`/`_clearInboundDelegation`), invalidating any outstanding signed authorization once state changes. Additionally, reject activation in `_validateDelegateActivation` when `delegateTo[holder] != address(0)`, requiring an explicit `removeDelegate` first so a signature can never silently evict an active delegate.

---

### RL-02 — `releaseBond` is not pausable
- **Severity:** Medium · **Confidence:** High · **Category:** access-control
- **Location:** `packages/foundry/contracts/ConfidentialityEscrow.sol:297`

**Issue.** Every other state-mutating entrypoint is `whenNotPaused`-gated — `configure` (`:221`), `postBond*` (`:239/249/266`), `recordConfidentialityNexusForRegistry` (`:310`), `recordAccessNexus` (`:318`), `publishLogRoot` (`:329`), and `slashBond` (`:387`). `releaseBond` (`:297`) is the sole exception (only `nonReentrant`). Pause is the documented incident lever (`setPaused` is `PAUSER_ROLE`-only), so pausing to coordinate a governance slash is counterproductive: `slashBond` reverts while paused, but a poster whose bond is already releasable (`_isBondReleasable`, `:525-531`) can still withdraw.

**Failure scenario.** `evidenceWindow=21d`. A rater posts a 100 USDC bond, then leaks gated context. The round settles and >21d elapse, so `_isBondReleasable` returns true. Governance pauses to coordinate `slashBond`; `slashBond` reverts (`whenNotPaused`), but the poster calls `releaseBond` → succeeds → withdraws the full 100 USDC (`:304`), escaping the slash so the reporter bounty (`REPORTER_BOUNTY_BPS=5000`) and confiscation never occur. There is no independent slash-hold/freeze mechanism.

**Recommendation.** Add `whenNotPaused` to `releaseBond` so the pause lever uniformly freezes all bond movement during an incident. If unconditional self-release is intended as a liveness guarantee, instead add a governance-settable slash-hold that blocks release once a slash is signaled.

---

### RL-03 — Voter lockout when snapshot weight exceeds current balance
- **Severity:** Medium · **Confidence:** High · **Category:** logic-correctness
- **Location:** `packages/foundry/contracts/governance/RateLoopGovernor.sol:289-294`; `packages/foundry/contracts/LoopReputation.sol:121`

**Issue.** `RateLoopGovernor._castVote` sets `weight = super._castVote(...)` (the ERC20Votes checkpoint at the proposal **snapshot** block) and then calls `reputationToken.lockForGovernance(account, weight)` whenever `weight > 0` (`:292-293`). `lockForGovernance` → `_lockForGovernanceUntil` hard-requires `balanceOf(account) >= amount` against the voter's **current** balance (`LoopReputation.sol:121`), with no clamp on the fresh-lock path (`:125-127`). Because not-yet-locked LREP is freely transferable (`_update` only blocks amounts exceeding `getTransferableBalance`, `:181-184`) and delegation is self-only (`:194`), a voter who moves LREP out after the snapshot has `current balance < snapshot weight`, so the `require` reverts and the **entire `castVote` reverts**. Standard OZ Governor lets any snapshot-eligible holder vote regardless of later balance changes.

**Failure scenario.** Alice holds 1,000 unlocked LREP at proposal `P`'s snapshot (`getPastVotes=1,000`). During the voting window she transfers 400 away (permitted). `castVote(P)`: `super._castVote` records weight 1,000, then `lockForGovernance(Alice,1000)` reverts because `balanceOf(Alice)=600 < 1,000`. Alice is fully disenfranchised for `P`. At scale, post-snapshot rebalancing can suppress turnout or block quorum.

**Recommendation.** Cap the lock at the currently-lockable balance instead of reverting — e.g. lock `min(weight, balanceOf(account))`, clamp inside `lockForGovernance`, or make the lock best-effort (try/catch) so a failed lock does not deny the vote. This preserves the skin-in-the-game deterrent without disenfranchising snapshot-eligible voters.

---

### RL-05 — Proposal cooldown bypassable via propose-then-cancel
- **Severity:** Low · **Confidence:** High · **Category:** logic-correctness
- **Location:** `packages/foundry/contracts/governance/RateLoopGovernor.sol:252-263`, `:308-321`

**Issue.** `propose()` sets `nextProposalBlock[msg.sender] = block.number + PROPOSAL_COOLDOWN_BLOCKS` (43,200 ≈ 1 day) and locks a threshold stake to throttle spam. But `_cancel` (`:252-263`) unconditionally resets `nextProposalBlock[proposer] = 0` (`:259`) and releases the lock whenever the caller is the proposer and the proposal is still `Pending`. OZ's `_validateCancel` permits proposer self-cancel throughout the entire `votingDelay` (43,200 blocks ≈ 1 day) `Pending` window, so a proposer can propose → self-cancel while `Pending` (cooldown zeroed, stake refunded) → immediately re-propose, in a loop, for only per-tx gas. The cooldown never rate-limits a determined proposer.

**Impact.** Governance event/proposal spam only — no funds lost, stolen, or locked (hence Low). Note this is orthogonal to the recently-added `#proposer` suffix front-run defense.

**Recommendation.** Do not reset `nextProposalBlock` to `0` on cancel; keep the cooldown counting from the original propose block. Refunding the *stake* on `Pending` self-cancel is fine — the *cooldown* must not be refunded.

---

### RL-08 — Equal-share divisor conflates BPS-scaled units with a raw count
- **Severity:** Low · **Confidence:** Medium · **Category:** accounting-precision / consistency
- **Location:** `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol:245`, `:389`; consumer `QuestionRewardPoolEscrow.sol:686-703`

**Issue.** The question qualification paths write `RoundSnapshot.eligibleVoters = effectiveParticipantUnits.toUint32()`, which is **BPS-scaled** (each eligible voter contributes `BPS_SCALE = 10_000`; `:632`). The equal-share consumer `_resolveClaimSplit` (`QuestionRewardPoolEscrow.sol:686-703`) treats the same field as a **raw claimant count**: `baseShare = allocation / eligibleVoters` and the last-claimant remainder fires on `claimedCount + 1 == eligibleVoters`. The sibling **bundle** path stores a raw `completerCount` in its divisor field (`QuestionRewardPoolEscrowBundleActionsLib.sol:1136`, `:1241`) — so the two equal-share paths encode **divergent semantics** for the same concept.

**Reachability.** Latent today: the question equal-share branch is guarded by `snapshot.totalClaimWeight == 0` (`:686`), but both question qualification writers require `totalClaimWeight > 0` before qualifying (`:92-93`, `:353-356`), and `totalClaimWeight` is strictly positive whenever `eligibleVoters` is — so the branch is provably dead for questions. It is a **footgun for any future path/refactor** that qualifies a `RoundSnapshot` with `totalClaimWeight == 0`.

**Would-be impact if reached.** With `eligibleVoters = 30_000` (3 voters) and `allocation = 300 USDC`, the first claimant would receive `300/30000 = 0.01 USDC` and the last-claimant remainder (`claimedCount+1 == 30000`) would never fire, stranding ~all of the allocation.

**Recommendation.** Store a **raw** eligible-voter count in `RoundSnapshot.eligibleVoters` (mirroring bundle's `eligibleCompleters`) and keep BPS-scaled units only in `totalClaimWeight`/floor math; or add `require(snapshot.totalClaimWeight != 0)` on qualification and delete the now-provably-dead question equal-share branch.

---

### RL-09 — Empty `Open` round treated as terminal for bond release
- **Severity:** Low · **Confidence:** Medium · **Category:** logic-correctness
- **Location:** `packages/foundry/contracts/ConfidentialityEscrow.sol:554`

**Issue.** `_engineRoundTerminal` returns true when `state == Open && voteCount == 0 && totalStake == 0` (`:554`), and `_isBondReleasable` uses `_currentRoundTerminal` as a release condition once past `evidenceWindow` (`:525-531`). A freshly activated round is exactly `Open / 0 / 0` (`RoundCreationLib.sol:95-98`), and empty rounds are only cancelled lazily. So while content is still active and gated, a live vote-accepting empty round is classified as terminal, permitting bond release before the confidentiality obligation actually ends. Once released the bond can no longer be slashed (`slashBond` reverts on released bonds, `:396`).

**Failure scenario.** Content is gated and active with an empty first round (or a fresh inter-round round) that receives no votes for `> evidenceWindow` (≥21d). The poster calls `releaseBond` and succeeds because `_engineRoundTerminal` reports the live empty round as terminal — recovering the bond even though the round still accepts votes on the still-gated content. A subsequent leak cannot be slashed.

**Impact.** Erodes the confidentiality deterrent (defense-in-depth); no direct fund loss, and it requires an untouched empty round persisting past the window plus governance not slashing beforehand (hence Low).

**Recommendation.** Do not treat an `Open` round (even zero-vote) as terminal for bond release while the content is still active/gated; require an actually settled/cancelled/tied/reveal-failed state (or content inactivity / max lock) as the release trigger, matching the confidentiality obligation's real end.

---

## Appendix A — Raised but dismissed on verification

The adversarial-verification pass reproduced each candidate against current source and **rejected** the following. Recorded for transparency so they are not re-investigated.

- **RL-04 — Zero-winning-stake round permanently locks the redirected forfeited pool — REFUTED.** The premise (`forfeitedPool > 0` while `weightedWinningStake == 0`) is mathematically impossible: per-commit forfeiture is gated on `positiveSpreadWeight` (`RoundRevealLib.sol:376-378`), computed from the *same* leave-one-out benchmark as the reward weight, so `weightedWinningStake == 0 ⟹ positiveSpreadWeight == 0 ⟹ forfeitedPool == 0`. The treasury-failure redirect branch never triggers.
- **RL-06 — Referral bonus paid without checking the referrer's identity-ban state — REFUTED.** Misreads `_hasActiveHumanCredential` → `_activeHumanCredential` (`FeedbackBonusEscrow` `:1473-1492`), which already performs both ban checks — `_isRaterBanned(rater)` (`:1478/1496`, governance identity ban) and `isIdentityKeyBanned(credentialKey)` (`:1488`, nullifier-derived ban). A banned referrer earns nothing.
- **RL-07 — Finalized cluster snapshot un-qualifiable if a participant's ban status changes — INTENTIONAL.** The live-registry ban recheck (`QuestionRewardPoolEscrowQualificationLib.sol:695-699`) was added deliberately (commit `e1634cad0`, "Check current rater registry bans for rewards"). The revert-on-divergence is the safety guard doing its job; pinning to only the snapshot would reintroduce paying banned identities. Recovery flows through the sanctioned reject/re-propose/recover cycle. At most an operational keeper-alert note.
- **RL-10 — Second-proposal vote hold not extended for already-fully-locked LREP — INTENTIONAL.** Documented anti-re-anchoring tradeoff (`LoopReputation.sol:133-136`). Voting is snapshot-based and re-voting is blocked by `hasVoted`, so a shortened post-vote hold cannot change any proposal's outcome, quorum, or cause fund loss.

---

## Methodology

This review was produced by a deterministic multi-agent workflow, not a single pass:

1. **Fan-out review (13 agents, in parallel).** Five subsystem reviewers (voting/settlement, oracle/payout, registries/reputation, escrows/distribution, config/governance), six cross-cutting reviewers (access-control, economic/griefing, accounting/precision, upgradeability/storage, reentrancy/CEI, and a dedicated **consistency** pass), and two **web-research** agents (cryptographic/economic primitives — drand/tlock, RBTS peer-prediction, optimistic oracles, EIP-3009/x402; and dependency/standards hygiene). Each read the actual source and returned structured findings.
2. **Triage & dedupe (1 agent).** Merged duplicates across reviewers, dropped items covered by the trust model or already fixed, and ranked survivors. 35 raw → 10.
3. **Adversarial verification (1 agent per finding, in parallel).** Each finding was independently re-checked against current source with instructions to *refute* it — confirming a concrete, currently-present code path or rejecting it. 10 → 6 confirmed; 4 rejected (above).

Total: 24 agents, ~2.5M tokens, ~726 tool calls.

**Respected trust-model decisions (per `AGENTS.md`), intentionally not flagged:** the optimistic `ClusterPayoutOracle` payout-root model; anti-spam (not payout-coverage) challenge bonds; and the 60-minute `revealGracePeriod` parameter.

**Limitations.** This is a source-reading review, not a formal-verification or fuzzing campaign; it did not execute the Certora specs or Foundry suite. Findings are ranked by confidence, but severities (especially the Medium/Low boundary) reflect reviewer judgment on likelihood and blast radius. The two `Medium` governance/escrow items (RL-02, RL-03) and RL-01 are the highest-value fixes; RL-08 is a cheap consistency hardening that removes a latent footgun.
