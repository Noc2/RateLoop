# RateLoop Smart Contracts Audit Report - 2026-05-22

Audited commit: `e0b6523b1a00a28048c06fbee74b12e0e49a4282`

Auditor: Codex, with three read-only parallel side reviews covering voting/round lifecycle, reward/oracle/fund movement, and registry/governance/config surfaces. Follow-up pass: Codex with three additional read-only side reviews and an OWASP/SCSVS-style checklist sweep.

## Summary

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 1 |
| Informational / notes | 6 |

No confirmed direct fund-theft exploit was found in this pass. I did find two Medium liveness/configuration issues and one Low advisory-path availability issue that are worth fixing or consciously accepting before deployment:

1. A quorum-revealed round can become permanently un-settleable if every capped RBTS seed refresh ages out.
2. `ProtocolConfig` can allow/default round voter caps that downstream mandatory bounty submission code rejects, letting governance misconfiguration halt submission paths.
3. Gas-only fresh-address sybils can fill a round's zero-stake advisory vote cap, censoring honest advisory launch-credit participation for that round.

## Scope

Primary contract scope:

- `packages/foundry/contracts/RoundVotingEngine.sol`
- `packages/foundry/contracts/libraries/Round*.sol`, `TlockVoteLib.sol`, `VotePreflightLib.sol`, `TokenTransferLib.sol`
- `packages/foundry/contracts/ContentRegistry.sol`
- `packages/foundry/contracts/ProtocolConfig.sol`
- `packages/foundry/contracts/QuestionRewardPoolEscrow.sol` and related escrow libraries
- `packages/foundry/contracts/FeedbackBonusEscrow.sol`
- `packages/foundry/contracts/RoundRewardDistributor.sol`
- `packages/foundry/contracts/ClusterPayoutOracle.sol`
- `packages/foundry/contracts/FrontendRegistry.sol`
- `packages/foundry/contracts/LaunchDistributionPool.sol`
- `packages/foundry/contracts/RaterRegistry.sol`, `ProfileRegistry.sol`, `LoopReputation.sol`
- `packages/foundry/contracts/X402QuestionSubmitter.sol`
- `packages/foundry/contracts/governance/RateLoopGovernor.sol`

This pass focused on exploitable or deployment-blocking issues: stuck funds, double claims, liveness griefing, unsafe oracle/settlement assumptions, access-control mistakes, identity replay, ERC-20 transfer edge cases, upgrade/storage hazards, and governance/config parameter footguns.

## Verification Performed

Commands run locally:

```sh
cd packages/foundry
forge test --offline
make check-contract-sizes
make check-storage-layouts
```

Results:

- `forge test --offline`: passed twice during the initial and follow-up passes; latest run passed `1308` tests, `0` failed.
- `make check-contract-sizes`: passed; all checked contracts are below the EIP-170 deployed bytecode limit. Closest contracts: `RoundVotingEngine` at `24457` bytes, `ContentRegistry` at `24328` bytes, `QuestionRewardPoolEscrow` at `24139` bytes.
- `make check-storage-layouts`: passed after `forge clean` and a fresh build; all pinned storage layouts matched.

Static-analysis availability:

- `yarn foundry:slither`: blocked locally because `slither` is not installed (`make: slither: No such file or directory`).
- `yarn foundry:aderyn`: blocked locally because `aderyn` is not installed (`make: aderyn: No such file or directory`).

External reference checks:

- Solidity documents that `blockhash` returns a non-zero hash only for one of the 256 most recent blocks, otherwise zero: https://docs.soliditylang.org/en/latest/units-and-global-variables.html#block-and-transaction-properties
- OpenZeppelin documents `SafeERC20.forceApprove` as the intended compatibility path for tokens that require zeroing allowance before setting a non-zero value, such as USDT: https://docs.openzeppelin.com/contracts/4.x/api/token/erc20
- OWASP Smart Contract Top 10 and SCSVS were used as a cross-check checklist for access control, business logic, oracle/randomness, denial-of-service, and arithmetic/asset-accounting classes: https://owasp.org/www-project-smart-contract-top-10/ and https://owasp.org/www-project-smart-contract-security-verification-standard/

## Findings

### M-01 - RBTS seed refresh exhaustion can permanently brick a settleable round

Severity: Medium

Affected code:

- `packages/foundry/contracts/RoundVotingEngine.sol:97-103`
- `packages/foundry/contracts/RoundVotingEngine.sol:872-908`
- `packages/foundry/contracts/libraries/RoundRevealLib.sol:271-295`
- `packages/foundry/contracts/RoundVotingEngine.sol:1215-1228`
- `packages/foundry/contracts/ContentRegistry.sol:1043`
- `packages/foundry/contracts/ContentRegistry.sol:1123`
- `packages/foundry/contracts/ContentRegistry.sol:1479`

Description:

RBTS settlement captures a delayed seed block once reveal quorum is reached. If nobody settles before that seed block ages out of the 256-block `blockhash` window, `settleRound` reverts via `RoundRevealLib.finalizeRbtsSeed`. The intended recovery is `refreshRbtsSeed`, but the engine caps refreshes at `MAX_RBTS_SEED_REFRESHES = 3`.

After the third successful refresh, if that final marker also ages out, both settlement and refresh are closed:

- `settleRound` still reverts because `blockhash(seedBlock) == 0`.
- `refreshRbtsSeed` reverts with `RbtsSeedRefreshCapped`.
- `cancelExpiredRound` cannot help once quorum-revealed state exists.
- `finalizeRevealFailedRound` rejects rounds that already reached reveal quorum.
- New commits are blocked because `thresholdReachedAt != 0`.

This applies to quorum-revealed RBTS rounds that need scoring entropy. Exact raw ties return `Tied` before RBTS scoring, so they do not depend on the expired seed path.

Exploit / grief path:

1. A round reaches RBTS reveal quorum.
2. The quorum-closing reveal captures an RBTS seed marker.
3. No one settles for more than 256 blocks, making the marker unusable.
4. A griefer repeatedly calls `refreshRbtsSeed`, then waits out each new marker.
5. After the third refresh ages out, the round stays `Open` but cannot settle, cancel, or advance.

Impact:

All stakes/rewards in that round can remain locked indefinitely, and the content cannot progress into a fresh round. Content dormancy and engine rotation are not clean escape hatches: open rounds block dormancy finalization, and a replacement engine still rejects new activity when the tracked prior engine reports an open round. This is a liveness/funds-availability grief, not a direct theft vector.

Recommendation:

Add a non-bricking terminal path once capped refreshed entropy expires. Two reasonable designs:

- Allow a permissionless refund/cancel rescue after `MAX_RBTS_SEED_REFRESHES` has been exhausted and the latest seed marker is older than the blockhash window.
- Or allow one deterministic final fallback settlement path that uses a pre-committed non-caller-controlled entropy source and cannot be repeatedly ground.

Also update the comment that says governance can arbitrate through `cancelExpiredRound`; that path is not currently available after reveal quorum.

Suggested test:

Add a branch test that reaches reveal quorum, lets the initial seed expire, refreshes exactly `MAX_RBTS_SEED_REFRESHES` times, lets the final marker expire, and asserts the round has a working rescue path.

### M-02 - Governance can configure voter caps that brick mandatory bounty-backed submissions

Severity: Medium

Affected code:

- `packages/foundry/contracts/ProtocolConfig.sol:186-195`
- `packages/foundry/contracts/ProtocolConfig.sol:627-642`
- `packages/foundry/contracts/ContentRegistry.sol:482`
- `packages/foundry/contracts/ContentRegistry.sol:503-516`
- `packages/foundry/contracts/ContentRegistry.sol:656-663`
- `packages/foundry/contracts/ContentRegistry.sol:1371-1374`
- `packages/foundry/contracts/ContentRegistry.sol:1384`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:221-225`

Description:

`ProtocolConfig` defaults `roundConfigBounds.maxVoterCap` to `1_000`, and `_validateRoundConfig` accepts any `maxVoters` within that bound. Downstream mandatory submission reward code is stricter:

- Single-question reward pools reject `contentCfg.maxVoters > 200`.
- Question bundles reject `maxVoters > 100`.

Because `ContentRegistry` reads `protocolConfig.config()` as the default content round config, a `CONFIG_ROLE` holder can set `maxVoters` above the escrow-compatible cap. New default single-question submissions will then revert when the registry tries to attach the mandatory reward pool. If governance also raises `roundConfigBounds.minVoterCap` above the downstream cap, even custom round configs cannot choose an escrow-compatible value.

The bundle path has the same shape with a lower downstream cap: registry-side bundle validation caps `maxVoters` at `100`, while `ProtocolConfig` can still validate larger default/custom caps. A first call to `setRoundConfigBounds(minVoterCap > 200)` is constrained by validation of the existing stored config, but once the stored config is raised, bounds can be moved in a way that makes bounty-compatible custom configs unavailable.

Exploit / failure path:

1. Governance or a config admin calls `setConfig(..., maxVoters = 201)`, which is valid under the current `maxVoterCap = 1_000` bound.
2. `submitQuestion` snapshots that default config.
3. The registry calls the reward escrow.
4. `QuestionRewardPoolEscrowPoolActionsLib` rejects the content config because `maxVoters > 200`.
5. Default submission flow is halted until config is corrected.

Impact:

This is a governance/configuration liveness risk. It does not let an external attacker steal funds, but it can make user submission paths unusable and can be made worse if bounds force all allowed custom configs above downstream caps.

Recommendation:

Unify the cap source. Prefer moving downstream caps into `ProtocolConfig` or exposing separate governed single-question and bundle cap bounds. At minimum:

- Ensure global default config used by mandatory single-question bounties cannot exceed `200`.
- Ensure bounds cannot force `minVoterCap > 200`.
- Ensure bundle submission config validation cannot be made impossible; either cap bundle configs at `100` in a shared governed bound or explicitly reject invalid governance bounds.

Suggested test:

Add end-to-end tests where `ProtocolConfig.setConfig` attempts `maxVoters = 201`, where bundle submission config attempts `maxVoters = 101`, and where bounds are moved after a raised stored config. Assert mandatory submission paths remain reachable or the invalid config update reverts.

### L-01 - Zero-stake advisory vote cap can be filled by fresh-address sybils

Severity: Low

Affected code:

- `packages/foundry/contracts/AdvisoryVoteRecorder.sol:248-250`
- `packages/foundry/contracts/AdvisoryVoteRecorder.sol:257-306`
- `packages/foundry/contracts/AdvisoryVoteRecorder.sol:340-350`
- `packages/foundry/test/RoundVotingEngineBranches.t.sol:3151`

Description:

`recordAdvisoryVote` intentionally records zero-stake advisory commits for an already-open staked round. The recorder dedupes and cooldowns by resolved rater identity, but address-only raters resolve to fresh address identities. An attacker can therefore create fresh EOAs and submit valid advisory commits until `roundAdvisoryCommitKeys[contentId][roundId].length >= maxVoters`. Once the advisory cap is full, availability reports `MaxAdvisoryVotersReached` and later honest advisory commits revert.

Exploit / grief path:

1. A staked round is open and still in its first blind epoch.
2. The attacker prepares valid zero-stake advisory commits from fresh EOAs.
3. Each fresh EOA passes address-identity dedupe and consumes one advisory slot.
4. After `maxVoters` advisory commits, honest zero-stake advisory raters cannot join that round.

Impact:

This censors the optional advisory launch-credit path for the affected round. It does not block staked voting, settlement, reward escrow, or custody accounting, and honest raters can still participate by submitting a normal staked vote. The cost is mostly gas and account management, so the path is cheap enough to document or harden before launch.

Recommendation:

Decide whether advisory participation is meant to be open to address-only raters or reserved for higher-trust identities. Reasonable mitigations include a small refundable LREP bond, an active human-credential gate, a separate advisory cap that address-only identities cannot fully consume, or reserved advisory slots/priority for verified-human identities.

Suggested test:

Add an adversarial branch test where `maxVoters` fresh EOAs fill advisory slots, then an honest verified/human advisory rater is rejected. If a mitigation is added, the test should assert that the mitigated honest rater can still access the advisory path.

## Positive Verifications / Non-Findings

### Follow-up report cross-check

I re-read the earlier May audit/readiness reports against current code and did not confirm additional unresolved exploit findings beyond M-01, M-02, and L-01 above. Previously reported areas that now appear fixed or consciously accepted include identity canonicalization collisions, oracle challenge/finalization edge cases, launch pending-credit finalization, escrow/oracle recovery paths, content callback reentrancy hardening, RBTS/advisory sampler edge cases, and Solidity version pinning.

### Oracle trust model

`ClusterPayoutOracle` remains consistent with the documented optimistic trust model. I did not treat the 5 USDC challenge bond as needing to cover payout value; per repo instructions it is an anti-spam bond, while proposer accountability comes from bonded frontend operators, public artifacts, challenge windows, governance arbitration, and future fee/reputation loss.

### Reveal grace period

The 60-minute `revealGracePeriod` is an accepted product/security parameter under the repo's audit trust notes. I did not raise it as a finding solely because some custom blind phases can be longer.

### Reward and escrow accounting

No confirmed double-claim or fund-loss issue was found in the reviewed reward paths. Relevant checked protections include:

- Commit-level and voter-level claim guards in `RoundRewardDistributor`.
- Pull-based reward/refund transfers through the voting engine custody balance.
- Frontend fee fallback routing when registry credit fails.
- Question reward per-identity/per-commit claim guards.
- Rejected oracle snapshot recovery/reopen paths.
- Launch earned-rater pending credit finalization against pinned oracle snapshots.

### ERC-20 transfer handling

Mandatory transfers generally use `SafeERC20`. Optional best-effort fee paths use `TokenTransferLib.tryTransfer` fallback behavior. `X402QuestionSubmitter` uses `forceApprove`, matching the OpenZeppelin-recommended compatibility path for USDT-like approval semantics.

### Upgrade/storage posture

Upgradeable contracts have pinned storage-layout snapshots, and `make check-storage-layouts` passed after a clean build. This does not replace an OZ upgrade validation against live deployments, but it is a useful regression guard for this pre-deployment branch.

## Recommended Remediation Order

1. Fix M-01 before deployment. It can permanently lock a live round and content item through inaction plus cheap refresh griefing.
2. Fix M-02 before deployment. It is cheap to correct now and prevents governance/config mistakes from breaking mandatory bounty-backed submissions.
3. Fix or consciously document L-01 before launch. If zero-stake advisory launch-credit participation is intended to be broadly available, add an anti-spam gate rather than letting address-only identities consume the entire advisory cap.
4. Install Slither and Aderyn in the local/CI audit image so future audit reports can include those static-analysis outputs instead of recording tool unavailability.

## Limitations

This was a source and local-test audit pass, not a formal verification engagement. I did not deploy to a live chain, replay historical mainnet/testnet calldata, or run unavailable static analyzers. Findings should be fixed and covered with regression tests before deployment.
