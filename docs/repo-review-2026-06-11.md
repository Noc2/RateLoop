# Repository Review — 2026-06-11

Multi-agent review of the repo at `86231b88` (origin/main). Seven scoped reviewers
(Solidity, keeper, Next.js lib/MCP/x402, Ponder, SDK/ABI parity, app+e2e, cross-package)
produced 32 candidate findings; each was independently re-verified by an adversarial
agent against the actual code, git history, and (where relevant) live World Chain
Sepolia bytecode. 29 were confirmed, 3 refuted. After merging duplicates, **27 distinct
findings** remain: 1 critical, 4 high, 12 medium, 10 low.

The dominant theme: **the repo has moved ahead of the chain-4801 deployment.** Several
2026-06-10 commits changed contract source and regenerated TS ABIs without an upgrade
or redeploy (last deployment refresh: `5b82b1e2`, 2026-06-08), so the published ABIs no
longer describe the live contracts — in one case breaking the app's vote flow outright.
Compounding this, finding 2.1 means a naive proxy upgrade of RaterRegistry with the
current source is itself unsafe.

## Summary

| # | Sev | Area | Finding |
|---|-----|------|---------|
| 1.1 | Critical | Deploy drift | `commitVoteWithPermit` used by app, absent on deployed RoundVotingEngine — permit votes revert |
| 1.2 | High | Deploy drift | FrontendRegistry fee-withdrawal/bounty surface (keeper + app) absent on chain 4801 |
| 1.3 | High | Deploy drift | RoundVotingEngine role functions deleted from source/ABI but still live on chain |
| 1.4 | Medium | Deploy drift | ContentRegistry bundle-escrow routing functions in TS ABI, absent on chain |
| 1.5 | Medium | Deploy drift | ClusterPayoutOracle correlation-epoch rejection surface (9 entries) in TS ABI, absent on chain |
| 2.1 | High | Contracts | RaterRegistry storage shift makes proxy upgrade unsafe; drift detector was re-baselined past it |
| 2.2 | Medium | Contracts | 21-day fee-withdrawal window bypassable via 14-day deregistration sweep |
| 3.1 | High | Keeper | Main-loop lock wrapper swallows workload errors; failed ticks recorded healthy |
| 3.2 | High | Keeper | Advisory locks silently released mid-tick by idle-connection reaping |
| 3.3 | Medium | Keeper | Snapshot-publish lock wrapper re-executes the whole run on workload error |
| 3.4 | Medium | Keeper | `correlation-artifact-builder.test.ts` asserts pre-fix surprise weights — suite is red |
| 4.1 | Medium | MCP/x402 | Two-step EIP-3009 ask flow drops or hard-fails deferred webhook registration |
| 4.2 | Medium | MCP | Dry-run follow-up tools unreachable through declared input schemas |
| 4.3 | Medium | MCP | Responses violate declared outputSchemas (pollAfterMs/cohortSummary/recoverWith) |
| 4.4 | Low | MCP | Auth swallows DB policy-lookup failures, misreports 503 condition as 401 |
| 4.5 | Low | Docs | README/.env.example document dead `RATELOOP_MCP_AUTHORIZATION_SERVER_URL` |
| 4.6 | Low | Docs | Error messages still say "http(s)" after https-only enforcement |
| 5.1 | Medium | Ponder | Accuracy leaderboard mixes identity keys (`vote.voter` vs `identityHolder`) |
| 5.2 | Medium | Ponder | Payout-proof fallback builds Merkle proof over leaves from all rounds |
| 5.3 | Low | Ponder | Schema default `maxVoters=200` contradicts protocol default of 100 |
| 5.4 | Low | Ponder | FeedbackBonusEscrow comments wrong; cancelled rounds get a `settledAt` that doesn't exist on chain |
| 6.1 | Medium | ABI pkg | Stale `VotingEngineUpdated` event shipped in two ABIs about to be published to npm |
| 7.1 | Medium | Docs/UI | Docs claim a 1 LREP cancellation fee that no code charges |
| 7.2 | Medium | UI | Fully-slashed operator shown as unregistered; Register button dead-ends |
| 7.3 | Low | Docs | How-it-works payout example ignores the 1% settlement-caller incentive |
| 7.4 | Low | Docs | e2e helper (and contract NatSpec) call `claimFrontendFee` permissionless; it is operator-only |
| 7.5 | Low | Docs | correlation-snapshot-verification.md pins v1 artifact/scorer versions; code emits v2 |

---

## 1. Deployment drift — repo vs. chain 4801

All five findings share a root cause: source/ABI changes on 2026-06-10 with no proxy
upgrade or `deployments/4801.json` refresh since `5b82b1e2` (2026-06-08). Each was
confirmed against live bytecode via the EIP-1967 implementation slot. The fix for the
group is an ops action — upgrade/redeploy on 4801 and refresh the deployment artifacts —
**but read finding 2.1 first: upgrading RaterRegistry with current source corrupts its
storage.**

### 1.1 Permit-based vote commits revert (CRITICAL)

`commitVoteWithPermit` was added to `RoundVotingEngine.sol` in `b3e0a8a5` (2026-06-10)
and regenerated into the TS ABIs, but the live implementation behind proxy
`0x0805…02Ff` (impl `0x8C96…48CB`) does not dispatch the selector (`0x4703c8d2` — zero
occurrences in bytecode; plain `commitVote` is present). The app prefers the permit
path whenever typed-data signing succeeds and allowance is insufficient
(`packages/nextjs/lib/vote/roundVoteTransactionPlan.ts:129`), and the approve+commitVote
fallback only triggers when permit *signing* fails — not when the transaction reverts.
Every staked vote taking the permit path reverts on-chain.

### 1.2 FrontendRegistry fee-withdrawal/bounty surface missing on chain (HIGH)

The TS ABI exposes `requestFeeWithdrawal`, `completeFeeWithdrawal`,
`pendingFeeWithdrawalAmount/ReleaseAt`, `FEE_WITHDRAWAL_DELAY`, `CHALLENGER_BOUNTY_BPS`,
`feeCreditor`, `slashFrontendWithBounty` — none exist on the deployed implementation
(`0x0e6d…3de2`). The keeper sweep (`packages/keeper/src/frontend-fees.ts:383-430`) and
the app claim flow (`useClaimAll.ts`, `useClaimableFrontendRewards.ts`) call them: reads
fail, writes revert. Conversely the deployed contract still has `claimFees()`
(`0xd294f093`), which was removed from the TS ABI, so the old working path is no longer
reachable from repo code.

### 1.3 RoundVotingEngine role-mutation surface still live on chain (HIGH)

Commits `80bb8bd3`/`7e886919` removed `grantRole`/`revokeRole`/`renounceRole`/
`getRoleAdmin`, the `RoleRevoked` event and `AccessControlBadConfirmation` from source,
the TS ABI, **and the chain-4801 block of `deployedContracts.ts`** — but the deployed
implementation still dispatches all four selectors and can emit `RoleRevoked`. The
"stale ABI" justification in `7e886919` is factually wrong for 4801: the role functions
(`b02da428`, 2026-06-06) are in the deployed lineage. The repo now misrepresents the
live admin surface (DEFAULT_ADMIN_ROLE can still grant/revoke roles on-chain), and
tooling using the published ABI cannot decode `RoleRevoked` logs. Note the trim is also
partial — `hasRole`/`RoleGranted` were left in. (Merges the separate
`deployedContracts.ts:7004` finding — same root cause.)

### 1.4 ContentRegistry staged bundle-escrow routing absent on chain (MEDIUM)

`initializeSubmissionMediaValidator`, `questionBundleRewardPoolEscrow(+ForBundle)`,
`questionBundleRoundObserver`, `setQuestionBundleRewardPoolEscrow` (from `e8842c0b`)
are in `ContentRegistryAbi.ts` and the 4801 entry of `deployedContracts.ts`, but the
deployed implementation (`0x91ec…FCaC`) contains none of these selectors.

### 1.5 ClusterPayoutOracle rejection surface absent on chain (MEDIUM)

Nine entries (`rejectCorrelationEpochRoot`, `rejectFinalizedCorrelationEpochRoot`,
`correlationEpochProposalDigest`, `correlationEpochRootKey`,
`correlationEpochSourceSetDigest`, `rejectedCorrelationEpochRootKeys`,
`rejectedCorrelationEpochSnapshotDigests`, two `CORRELATION_EPOCH_*_DOMAIN` constants)
are in `ClusterPayoutOracleAbi.ts` but not on the live contract at `0x2FD4…40ad`.
Governance tooling attempting to reject a bad correlation root would revert.

## 2. Smart contracts

### 2.1 RaterRegistry storage shift — proxy upgrade would corrupt state (HIGH)

`c4d8ae7e` ("reject repeated World ID credential proofs") inserted
`_usedWorldCredentialProof` **before** the pre-existing `_usedWorldPresenceProof`
(`RaterRegistry.sol:135-136`), shifting the presence mapping from slot 28 to 29 and
shrinking `__gap` to `uint256[29]`. The deployed 4801 implementation has the presence
mapping at slot 28 (verified via the layout snapshot in the `5b82b1e2` lineage).
Upgrading the proxy with current source would make every presence proof consumed
pre-upgrade replayable (bounded by the ~15-min TTL) and orphan the old markers. The
same commit re-baselined `expected-storage-layouts/RaterRegistry.json`, so
`check-storage-layouts.sh` — the control built for exactly this hazard
(M-Crosscutting-1) — now passes and no longer flags the break.

**Fix:** declare `_usedWorldCredentialProof` *after* `_usedWorldPresenceProof` (slot-
compatible with the deployed layout) and re-snapshot; or accept a full redeploy instead
of an upgrade on 4801. Impact is testnet-only today (no mainnet artifact exists), but
this must be resolved before the group-1 upgrades.

### 2.2 21-day fee-withdrawal window bypassable via deregistration (MEDIUM)

`4a3a69a2` raised `FEE_WITHDRAWAL_DELAY` to 21 days (`FrontendRegistry.sol:59`) and
updated five docs pages to advertise a 21-day slashable review window, but
`UNBONDING_PERIOD` stayed at 14 days (line 53), and `completeDeregister`
(lines 282-309) sweeps stake + `lrepFees` + `pendingFeeWithdrawalAmount` after only
`frontendExitAvailableAt` — it never checks `pendingFeeWithdrawalReleaseAt`. Any
operator (including a misbehaving payout-root proposer, the actor this bond targets)
can extract all accrued fees 7 days before the documented window via
requestDeregister → completeDeregister. The existing test
`test_DeregisterSweepsPendingFeeWithdrawal` (`FrontendRegistry.t.sol:920`) demonstrates
the sweep. **Fix:** gate the swept fee buckets on
`max(frontendExitAvailableAt, pendingFeeWithdrawalReleaseAt)` (or
`requestDeregister + FEE_WITHDRAWAL_DELAY`), or block exit while a withdrawal is
unmatured.

## 3. Keeper

### 3.1 Main-loop lock wrapper swallows workload errors (HIGH)

In `runWithKeeperMainLoopLock` (`packages/keeper/src/keeper-state.ts:162-181`) the
try/catch wraps both the `pg_try_advisory_lock` query **and** `return await run()`.
Any exception from the workload (resolveRounds / fee sweep) is caught, logged once as
"main loop lock unavailable; skipping this tick" (deduplicated via
`warnPersistenceOnce`, so subsequent failures are fully silent), and converted to the
fallback empty result — which `index.ts` then passes to `recordRun`, counting the tick
as successful and keeping `/health` green. This contradicts the documented invariant in
`keeper.ts:944-957` that a total RPC outage must surface as a failed tick. If
`ensureSchema` fails (DB down), the keeper silently stops doing **all** round work
indefinitely. **Fix:** only the lock acquisition belongs in the try/catch; `run()`
errors must propagate to `recordError`.

### 3.2 Advisory locks released mid-tick by idle-connection reaping (HIGH)

Both lock wrappers acquire session-level advisory locks via `activePool.query(...)`
(`keeper-state.ts:163-166` and `~108`) instead of holding a dedicated client for the
duration of `run()`. `pool.query` returns the connection to the pool immediately; the
pool has `idleTimeoutMillis: 30_000` (lines 37-43) and `run()` issues no SQL (it is
pure RPC work that routinely exceeds 30s). node-postgres destroys the idle client,
PostgreSQL releases the session lock, and the mutual exclusion silently evaporates
mid-tick — exactly when a redundant keeper would overlap (concurrent
reveal/settle/finalize). The trailing `pg_advisory_unlock` runs on a fresh connection,
returns false as a Postgres WARNING, and the `.catch` never fires. **Fix:** check out a
client (`pool.connect()`), acquire/release the lock on that client, hold it for the
tick.

### 3.3 Snapshot-publish wrapper re-executes the run on workload error (MEDIUM)

`runWithCorrelationSnapshotPublishLock` (`keeper-state.ts:107-127`): the catch block's
no-lock fallback is `return run()` — but the try block also contains
`return await run()`, so a workload exception (e.g. unwrapped `readContract` failures
in `correlation-snapshots.ts:711-717`, `838-848`) causes the **entire publication run
to execute a second time in the same tick**, potentially after the first run already
broadcast proposeCorrelationEpoch / proposeRoundPayoutSnapshot / finalize transactions,
with the error mislabeled as a persistence-lock warning. Same fix shape as 3.1:
distinguish lock failure from workload failure.

### 3.4 Keeper test suite is red (MEDIUM)

`55aae145` added `surpriseMinReveals: 8` to the default scoring params, but
`correlation-artifact-builder.test.ts:255-266` ("builds non-flat surprise-weighted
baseWeights…") feeds 3 votes through the production builder and still asserts the
pre-floor weights. Verified by execution: `npx vitest run` in `packages/keeper` fails
1/179 with `expected [10000, 10000, 10000] to deeply equal [25000, 25000, 10000]`. The
node-utils equivalents were fixed by passing `surpriseMinReveals: 3`; this test needs
either ≥8 reveals or a param override path through the builder.

## 4. Next.js — MCP, x402, auth

### 4.1 Two-step EIP-3009 ask flow loses webhook registration (MEDIUM)

`a4a3eaa4` defers webhook registration to confirm-time by storing a `pendingCallback`
in the submission's `payment_receipt`. Two breaks in the two-call
`x402_authorization` flow: (1) the duplicate-key UPDATE path
(`questionSubmission.ts:2194-2219`) unconditionally rebuilds the receipt, so if the
caller omits webhook fields on the signed re-call, the stored `pendingCallback` is
silently erased — webhook never fires, no warning. (2) For public callers, the
`nextAction` hint (`mcp/tools.ts:1923-1924`) instructs resending the same
`webhookChallengeId`/`webhookSignature`, but challenges are single-use
(`signedActions.ts:186-222`), so following the server's own instruction fails the whole
payment call with `CHALLENGE_USED`. The only working sequence — signing a fresh
challenge for the final call — is documented nowhere.

### 4.2 Dry-run follow-up tools unreachable via declared schemas (MEDIUM)

Dry-run ask responses point agents at `rateloop_get_question_status` /
`rateloop_get_result`, whose handlers only return dry-run fixtures when passed
`dryRun`/`sandbox`/`mode`/`executionMode` — but both input schemas
(`agent/schemas.ts:244-257`; `mcp/tools.ts:463-478`) set
`additionalProperties: false` without those fields. A schema-validating client cannot
pass them; `get_result` then returns a perpetual "pending" package
(`pollAfterMs: 5000`, `wait_for_settlement`) for a result that will never exist.
Mitigating: the dry-run result is embedded inline in the ask response, and
`get_question_status` at least returns terminal `not_found`. **Fix:** add the dry-run
fields to the two input schemas, or detect the deterministic dry-run operationKey
server-side.

### 4.3 Responses violate declared outputSchemas (MEDIUM)

Strict clients validating `structuredContent` (the server advertises `outputSchema`
in tools/list, `app/api/mcp/route.ts:260`) will reject: (1) `pollAfterMs: null` in
webhook-challenge and dry-run ask responses (`mcp/tools.ts:1926`, `2407`) vs.
`{ type: "integer" }` (`agent/schemas.ts:907`); (2) the dry-run fixture's
`cohortSummary` string (`tools.ts:2283`) vs. `["object","null"]` (`schemas.ts:1018`);
(3) dry-run `wait.recoverWith: null` (`tools.ts:2353`) vs. `{ type: "string" }`
(`schemas.ts:1063`).

### 4.4 MCP auth misreports DB outages as invalid token (LOW)

`auth.ts:172-192`: a `getMcpAgentFromPolicyTokenHash` failure becomes a 503 only when
no static env agents are configured. With any static agent present, a DB outage is
discarded unlogged and valid DB-backed policy tokens get 401 "Invalid bearer token" —
prompting needless token rotation and giving operators no diagnostic.

### 4.5 Dead config still documented (LOW)

`d921b098` removed all reads of `RATELOOP_MCP_AUTHORIZATION_SERVER_URL`, but
`README.md:94` and `.env.example:53-57` still document it as changing the
protected-resource metadata (tests now assert it is ignored).
`docs/design-review-2026-06-followup.md:289` repeats the stale claim.

### 4.6 "http(s)" messages after https-only enforcement (LOW)

`sourceUrl.ts:14` now rejects non-https URLs, but the submitter error
(`contentFeedback.ts:231`, "must be a valid http(s) URL") and the agent-facing
`RATELOOP_SOURCE_URL_WARNING` (`resultPackage.ts:45`) still say http(s).

## 5. Ponder indexer

### 5.1 Accuracy leaderboard mixes identity keys (MEDIUM)

`/accuracy-leaderboard` keys all-time stats by resolved identity holder (`voterStats`
is written with `voter: identityHolder`, `src/RoundVotingEngine.ts:1261, 1288-1299`),
but the signalScore (default sort) and every windowed path group by raw `vote.voter`
and join `voterStats` on `vote.voter` (`leaderboard-routes.ts:347, 407, 409-414, 526,
574, 596`). For delegated votes the same settled vote is attributed to the holder in
`window=all` and the delegate elsewhere, and streak columns come back null.
`correlation-routes.ts:216-219` shows the intended convention (joins on
`vote.identityHolder`).

### 5.2 Payout-proof fallback spans all rounds (MEDIUM)

When an artifact entry lacks an embedded proof, `resolveQuestionPayoutProof`
(`payout-proofs.ts:103-127`) builds the Merkle tree from `collectPayoutWeights`
(lines 313-351), which recurses through **all** `roundPayoutSnapshots` — but the
on-chain `weightRoot` is per round snapshot, and keeper artifacts routinely contain
multiple rounds. For any multi-round artifact without embedded proofs the served proof
is guaranteed invalid. Practical impact is bounded (keeper artifacts embed proofs and
the on-chain verifier fails closed), but the fallback as written can never serve a
valid proof for multi-snapshot artifacts. **Fix:** filter leaves to the matched
candidate's round before building the tree.

### 5.3 Schema default maxVoters=200 vs protocol 100 (LOW)

`ponder.schema.ts:41, 131` default `maxVoters`/`roundMaxVoters` to 200, but the
protocol constant is 100 (`contracts/src/protocol.ts:35`; `ProtocolConfig.sol`
`MAX_DEFAULT_ROUND_VOTERS = 100` rejects higher defaults). Fallback inserts in the
RoundSettled/RoundCancelled/RoundTied/RoundRevealFailed and RatingStateUpdated handlers
omit config fields, so those rows persist a value the protocol never allows — the same
round can index as 100 or 200 depending on which event created the row.

### 5.4 Misleading comments + phantom settledAt for cancelled rounds (LOW)

`src/FeedbackBonusEscrow.ts:17-24` claims pools can target terminal rounds (false —
`_requireTargetRound` requires the current Open round) and that cancelled rounds never
get `settledAt` "matching the contract" (false — the RoundCancelled handler sets
`settledAt: event.block.timestamp` on both paths, `src/RoundVotingEngine.ts:1354-1356,
1385`, while on-chain `_markRoundCancelled` never sets it). Cancelled is the only round
state whose indexed `settledAt` reports a timestamp that does not exist on chain.

## 6. @rateloop/contracts package

### 6.1 Stale VotingEngineUpdated event about to ship to npm (MEDIUM)

`be5523c0` removed `VotingEngineUpdated` from `FeedbackBonusEscrow.sol` and
`RoundRewardDistributor.sol` (the setters now revert / no-op), but the event survives
in `FeedbackBonusEscrowAbi.ts:1346`, `RoundRewardDistributorAbi.ts:1344`, and four
stale `deployedContracts.ts` entries (both chains). The deployed 4801 bytecode lacks
the event topic, so a consumer watching it can never receive it. The new
`publish-npm.yaml` workflow would publish `@rateloop/contracts` with this ABI; the next
local deploy will regenerate the 31337 section without the event while 4801 keeps it.
This was the only TS-ABI-vs-fresh-artifact diff across all 18 ABIs besides the
deployment-drift findings in section 1.

## 7. Docs and UI vs. contract behavior

### 7.1 Phantom 1 LREP cancellation fee (MEDIUM)

`docs/smart-contracts/page.tsx:300, 335-336` ("1 LREP cancellation fee… to the
configured cancellation-fee sink"), `docs/tokenomics/page.tsx:227`, and
`TreasuryBalance.tsx:88` all describe a cancellation fee, but
`ContentRegistry.cancelContent` (`ContentRegistry.sol:795-817`) contains no token
transfer at all — the contract's only LREP transfer is the 5 LREP revival stake.
Governance/treasury docs describe a revenue source that does not exist.
`ContentRegistry.sol:200` and `GovernanceActionComposer.tsx:687-696` carry the same
stale terminology.

### 7.2 Fully-slashed operator dead-ends in the UI (MEDIUM)

`FrontendRegistration.tsx:186` derives registration from `stakedAmount > 0`, but
governance can slash 100% of stake without clearing `f.operator`
(`FrontendRegistry.sol:462-510`). The UI then hides the Penalized badge and fee panels
and shows the registration form; clicking Register burns an approve and reverts
"Already registered" (`FrontendRegistry.sol:254`). The correct check is
`operator != address(0)` — exactly what `admin-helpers.ts` `getFrontendInfoOnChain`
uses.

### 7.3 Payout example ignores the settlement-caller incentive (LOW)

`public/docs/how-it-works.md:70, 90` and `docs/how-it-works/page.tsx:98-121` document a
96/3/1 split of the forfeited pool with exact example numbers, but
`RoundVotingEngine.sol:1010` first pays a 1% settlement-caller incentive (capped at
1 LREP), and only the remainder splits 96/3/1. Every documented figure is ~1% off
(e.g. voter share 1.51470 vs the documented 1.53); the caller incentive appears nowhere
in the nextjs docs.

### 7.4 claimFrontendFee is not permissionless (LOW)

`e2e/helpers/admin-helpers.ts:1334-1338` says the call is permissionless;
`RoundRewardDistributor.sol:521-522` reverts `UnauthorizedFrontendFeeCaller` for any
caller other than the resolved operator (or raw frontend). The contract's own NatSpec
(lines 500-503) has the same stale "Permissionless callers" wording.

### 7.5 Verification doc pins superseded v1 versions (LOW)

`docs/correlation-snapshot-verification.md:11-12` pins
`rateloop-correlation-artifact-v1` / `rateloop-correlation-epoch-v1`; the keeper emits
v2 (`correlation-artifact-builder.ts:248`; `correlationScoring.ts:144`), as
`docs/surprise-weighted-bounty-weights.md` confirms. A challenger following the doc
would reject every artifact the keeper produces.

---

## Refuted candidates (for the record)

Three candidates were raised and struck down on verification:

- **RBTS seed expiry 8191→256 blocks voiding forfeits** — refuted; the claimed
  unreachability does not hold as described.
- **`feedbackBonusPool.awardDeadline` misclassifying open-round pools as expired** —
  refuted; the open-round branch is handled.
- **chain-31337 `deployedContracts.ts` contradicting `deployments/31337.json`** —
  refuted; the local artifacts are consistent.

## Suggested order of attack

1. **2.1 first** (reorder RaterRegistry storage) — it gates everything in section 1.
2. **Section 1 ops pass**: upgrade/redeploy the 4801 implementations
   (RoundVotingEngine, FrontendRegistry, ContentRegistry, ClusterPayoutOracle,
   RaterRegistry) and refresh `deployments/4801.json` + `deployedContracts.ts`,
   restoring the ABI-parity invariant. Until then, 1.1 breaks live permit voting and
   1.2 breaks the keeper fee sweep.
3. **3.1–3.3** are small, contained fixes in `keeper-state.ts`; **3.4** unblocks CI.
4. **2.2** needs a design decision (gate sweep vs. block exit) before mainnet.
5. The rest are independent doc/UI/schema corrections.
