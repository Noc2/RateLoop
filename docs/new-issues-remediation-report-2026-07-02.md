# New Issues Remediation Report - 2026-07-02

Branch: `main`

Scope: the new fifth-pass issues and adjacent inconsistencies found after the prior fixes. The plan assumed a fresh redeploy of the protocol stack; no compatibility shims for old deployed contracts were added.

Superseded RBTS entropy note, 2026-07-03: the future blockhash/EIP-2935 remediation described in this historical report is not the fresh-redeploy launch posture. The current plan is precommitted reveal entropy bound to the closed scoring set, as described in `docs/incentives-remediation-plan-2026-07.md`. Do not treat a future-blockhash or sequencer non-grinding assumption as the launch model.

## Principles Applied

- Keep the protocol decentralized from launch: no trusted keeper-only, admin-only, or centralized randomness escape hatch was added for ordinary liveness.
- Preserve UX: healthy unchallenged payout/result finality stays on the one-hour launch path, and users get clearer timing copy rather than vague pending states.
- Prefer permissionless progress: where liveness can be recovered by any caller, the fix keeps that path permissionless and data-validated.
- Keep old-contract migration out of scope: tests and code now model the fresh deployment behavior the launch will actually use.

## Plan And Double-Check

1. Close the high-risk payout-finality and prequalification liveness gaps first.
   - Checked that skipped/recovered reward-pool states cannot be bypassed into refunds.
   - Checked that replacement snapshots are only treated as blocking when the same replacement can actually qualify.
   - Checked that later rounds cannot complete a reward pool while earlier skipped prequalification rounds still need resolution.
2. Close the RBTS entropy issue without centralization.
   - Replaced predictable settlement entropy with a future blockhash/EIP-2935 path.
   - Added permissionless re-arming when the future blockhash is missed or unavailable.
   - Removed the `prevrandao` fallback so the settlement caller cannot grind the seed.
3. Close public-rating cursor liveness gaps without hurting normal users.
   - Added a bounded, permissionless skip for rounds whose payout snapshot is missing past the no-proposal grace.
   - Kept in-order cursor application so later ratings cannot leapfrog unresolved earlier rounds.
4. Align user-facing and agent-facing surfaces.
   - Updated finality docs from stale multi-hour wording to the one-hour healthy path.
   - Added agent lint for unsupported `bountyEligibility` values so generated asks fail early.
5. Verify the whole result, then commit by concern.

## Findings Fixed

### RBTS seed could still be influenced by pivotal reveal timing

Fix: RBTS scoring now arms a future entropy block when settlement closes. Settlement uses the captured future blockhash or EIP-2935 history; if neither is available, anyone can re-arm the seed to a new future block. Post-closure reveals remain rejected, so the scoring set is stable while the final seed is unknown.

Status: fixed without adding a centralized randomness provider or trusted resolver.

### Skipped prequalification and recovered reward exits could bypass each other

Fix: reward-pool recovery/refund flows now respect pending skipped prequalification rounds, and skipped prequalification rounds must be resolved before later rounds can complete the pool. Replacement checks preview whether the replacement is actually qualifiable before using it to block a refund.

Status: fixed with permissionless qualify/abandon paths.

### Public-rating cursor could wedge when no payout proposer appears

Fix: after the no-proposal grace, the cursor can skip a still-missing public-rating snapshot in order and emit an explicit skip event. This avoids freezing later public ratings while preserving visible evidence that the round did not receive a payout root.

Status: fixed without a centralized override.

### Event and indexing surfaces drifted around payout finality

Fix: payout snapshot events expose proposal-scoped timing, Ponder tracks challenge/veto/consumption phases, and the indexer health route now exposes correlation finality status.

Status: fixed by earlier commits in this branch.

### Launch timing docs and agent ask validation were inconsistent

Fix: docs now describe the one-hour healthy path and one-hour feedback/fee timing. Agent lint rejects unsupported `bountyEligibility` values instead of letting malformed asks reach protocol surfaces.

Status: fixed.

## Verification

- `forge test` from `packages/foundry`: passed, 1823 tests.
- `forge test --match-contract FrontendRegistryCoverageTest --match-test test_Deregister_WithFees_EmitsFeesClaimed -vv`: passed after updating the coverage expectation to wait through unbonding.
- `yarn workspace @rateloop/ponder vitest run tests/route-validation.test.ts`: passed earlier in this remediation pass.
- `yarn workspace @rateloop/ponder vitest run tests/cluster-payout-oracle-handlers.test.ts`: passed earlier in this remediation pass.
- `yarn workspace @rateloop/ponder check-types`: passed earlier in this remediation pass.
- `yarn workspace @rateloop/agents vitest run src/__tests__/lint.test.ts`: passed earlier in this remediation pass.
- `yarn workspace @rateloop/agents check-types`: passed earlier in this remediation pass.

## Residual Notes

- Existing Foundry warnings about test initcode size and deployed bytecode size remain warnings from the local profile; the full suite passed.
- The optimistic oracle trust model remains unchanged: challenge bonds are anti-spam bonds, and public deterministic artifacts plus frontend accountability remain the audit model.
- Governance can still change future launch timing, but the one-hour user-facing healthy path is the current launch posture.
