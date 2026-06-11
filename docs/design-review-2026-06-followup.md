# RateLoop Design Review — Follow-up Findings (June 2026)

A third review pass run on 2026-06-10 against commit `6bf5b907` (immediately after PR #43
`codex/fix-cluster-oracle-audit` merged). Seven independent agents re-swept the contracts, the
Next.js app, the indexer/keeper/ops layer, the agent/SDK/MCP surface, release/CI readiness, the
newly-merged PR itself, and external prior art (tlock/drand, EIP-3009, World ID/World Chain, MCP
auth).

This document lists **only findings that are not already in
[`design-review-2026-06.md`](./design-review-2026-06.md)**. It is a supplement, not a replacement —
the structural P0–P2 findings, the second-pass new findings (R/E/O/A/D), and the prior-art table in
that document still stand. **Per the review scope, tokenomics / launch distribution / token design
(finding 8 and its sub-points) are excluded here.**

## Status of the prior release blockers

PR #43 resolved the three "red at HEAD" release blockers from the second pass — re-verified at
`6bf5b907`:

- **R1a (storage-layout snapshots)** — fixed (`Update storage layout snapshots`); the
  `check-storage-layouts.sh` CI gate passes.
- **R1b (stale `FrontendRegistry` ABI / `deployedContracts.ts` / gasless allowlist)** — fixed
  (`Sync FrontendRegistry deployment ABIs`, `Update sponsored frontend fee operations`); the
  `packages/contracts/src/deployments.test.ts` ABI-parity test now passes and the gasless allowlist
  carries `requestFeeWithdrawal`/`completeFeeWithdrawal` instead of the deleted `claimFees`.
- **Deploy-profile contract-size gate** — fixed (`Trim RoundVotingEngine role mutation surface`);
  `yarn check:sizes` passes with `RoundVotingEngine` at 24,491 / 24,576 bytes.

**R1c (Ponder fabricates RBTS scores for the scoreless `scoreSeed == 0` settlement path)** remains
open at HEAD — no `scoreSeed == 0` guard exists in `packages/ponder/src/RoundVotingEngine.ts`. It is
still a release blocker; see the original doc.

The role-surface trim was verified **safe**: the engine only ever `_grantRole`s `DEFAULT_ADMIN_ROLE`
and `PAUSER_ROLE` to governance in `initialize`, the deploy script and all consumers never call the
removed `grantRole`/`revokeRole`/`renounceRole`/`getRoleAdmin`, and role mutation can still be
restored by upgrade if ever needed (TransparentUpgradeableProxy, governance is proxy admin).

## Release-doc addendum

For the current 0.1.0 publish gate, treat the seed and World ID notes below as active launch
assumptions rather than speculative cleanup:

- The removed `refreshExpiredRbtsSeed` path must not be cited as a current control. Current code
  resolves unavailable RBTS seed blockhashes as terminal scoreless settlements.
- With OpenZeppelin `Blockhash.blockHash()`, World Chain seed availability follows EIP-2935's
  extended history window. A deliberate 256-block expiry requires an explicit guard in RateLoop
  code; it is not implied by the library call.
- Mainnet World ID rollout is blocked until the final World ID v4 verifier ABI is known, the live
  verifier address has code, and an integration test exercises that exact ABI/address pair.
- `FEE_WITHDRAWAL_DELAY` is now 21 days; older "14-day" fee-withdrawal wording below describes the
  reviewed gap rather than the current launch window.

---

## New findings

Severity is engineering-impact (likelihood × blast radius), independent of the economic P0s in the
main doc. IDs are prefixed `F-` (followup) to avoid colliding with the main doc's numbering.

### Medium

#### F-1 — Two-step fee-withdrawal "Withdraw" button can never enable (app logic)

- **File:** `packages/nextjs/components/governance/FrontendRegistration.tsx:195, 213-219, 954`
- **What:** The new two-step fee-withdrawal UI gates the *Withdraw* (`completeFeeWithdrawal`) button
  on `pendingWithdrawalMatured = hasPendingWithdrawal && nowMs >= pendingWithdrawalReleaseAt*1000`
  (line 195). `nowMs` is advanced only by the `setInterval` effect at 213-219, which early-returns
  unless `isExitPending` is true (`if (!isExitPending) return;`). Requesting a fee withdrawal is
  independent of deregistration, so an operator who merely called `requestFeeWithdrawal` has
  `isExitPending === false`: `nowMs` is captured once at mount and never ticks, and the underlying
  `pendingFeeWithdrawal*` reads have no `refetchInterval`, so nothing re-evaluates maturation.
  Compounding it, the button is *also* disabled when `isExitPending` (line 954) — so in the only
  state where the timer runs, the button is force-disabled. Net: the maturation timer can never
  enable the button. It works only if the page is first loaded *after* the 14-day window already
  elapsed (mount-time `Date.now()` is already past release). This is distinct from R1b (stale ABI)
  and persists after the ABI fix.
- **Fix:** Run the ticker whenever any deadline is pending —
  `if (!isExitPending && !hasPendingWithdrawal) return;` — and drop the spurious `isExitPending`
  term from the Withdraw button's `disabled` (completing a fee withdrawal is not blocked by an
  in-progress exit on-chain). Optionally add a `refetchInterval` to the `pendingFeeWithdrawal*`
  reads.
- **Confidence:** High.

#### F-2 — Indexer "pending fees" derivation overstates claimable fees during the 14-day window (data/consumer)

- **File:** `packages/ponder/ponder.schema.ts:976-978` (documented formula);
  `packages/ponder/src/FrontendRegistry.ts:113-121` (`FeeWithdrawalRequested` handler);
  contract `packages/foundry/contracts/FrontendRegistry.sol:316-333`
- **What:** The schema documents pending/claimable fees as
  `totalFeesCredited - totalFeesClaimed - totalFeesConfiscated`. The two-step withdrawal breaks this
  derivation: `requestFeeWithdrawal()` moves accrued `lrepFees` into the pending bucket and emits
  **only** `FeeWithdrawalRequested` (no `FeesClaimed`/`FeesConfiscated`). The handler sets
  `pendingFeeWithdrawal = lrepAmount` but changes none of the three formula terms. So for the entire
  14-day window the requested amount is *both* still counted by the documented formula and held in
  `pendingFeeWithdrawal` — a consumer summing "derived pending + pendingFeeWithdrawal"
  double-counts, and one treating the formula as "available now" overstates by the locked amount.
  On-chain `getAccumulatedFees()` returns 0 after the request, so indexer and chain disagree on the
  operator's spendable balance. The individual handlers are correct; the documented derivation is
  the defect.
- **Fix:** Subtract the pending bucket — restate the canonical formula as
  `credited - claimed - confiscated - pendingFeeWithdrawal`, and update the schema comment.
  (Adding a `totalFeesWithdrawalRequested` cumulative counter is optional; the live
  `pendingFeeWithdrawal` field is sufficient since it zeroes on completion/slash.)
- **Confidence:** High.

#### F-3 — RBTS seed-expiry window is ~8191 blocks (EIP-2935), not the 256 the threat model assumes (contract/correctness)

- **File:** `packages/foundry/contracts/libraries/RoundRevealLib.sol:4` (imports OZ
  `Blockhash.sol`), `:282-308` (`isExpiredRbtsSeed`/`finalizeRbtsSeed`)
- **What:** The seed-reroll/expiry analysis throughout the main doc (findings 5 and E5, the audit,
  the keeper docs) is framed as "if `settleRound` was not called within **256 blocks**" and
  "256 blocks ≈ 8.5 min." The code does **not** use the raw `BLOCKHASH` opcode — it calls OZ
  `Blockhash.blockHash()`, which transparently falls back to the EIP-2935 history-storage contract
  (`0x0000F90827F1C53a10cb7A02335B175320002935`) for blocks 257–8191 ago. EIP-2935 shipped across
  the OP-Stack Superchain (Isthmus, 2025); the history contract has bytecode live on World Chain
  mainnet (verified via `eth_getCode`), and World Chain produces ~2 s blocks. So a captured seed
  only becomes expired/scoreless after **~8191 blocks ≈ 4.5 hours**, not ~8.5 minutes. Two
  consequences: (a) the E5/finding-5 seed-expiry griefing is *much harder* to force than documented
  (good); (b) every "256-block / 8.5-min" timing assumption in the docs, the audit addendum, the
  keeper alerts, and any test is wrong for this chain, and the "seed is fixed shortly after closure"
  reasoning now has to hold across a 4.5-hour horizon.
- **Fix:** Re-derive findings 5/E5 timing and all keeper/alert/doc references against 8191 blocks
  @ 2 s. If a *short* expiry was actually intended (the design clearly assumed ~8.5 min), enforce it
  explicitly with `block.number - seedBlock > 256` rather than relying on `blockHash() == 0`, since
  OZ `Blockhash` silently widened the window.
- **Sources:** https://specs.optimism.io/protocol/isthmus/derivation.html ,
  https://eips.ethereum.org/EIPS/eip-2935 (OZ `Blockhash.sol` is in-repo).
- **Confidence:** High (EIP-2935 deployment + OZ fallback verified; exploitability of the wider
  window depends on settlement ordering).

#### F-4 — USDC EIP-712 domain is hardcoded with no on-chain guard; a Circle upgrade silently bricks all agent payments (correctness/reliability)

- **File:** `packages/nextjs/lib/walletSignatures.ts:76-81` (`name:"USDC"`, `version:"2"`);
  token map `packages/nextjs/lib/x402/questionPayload.ts:22` (480 → `0x79A0…24D1`)
- **What:** The client signs EIP-3009 `ReceiveWithAuthorization` with a statically hardcoded EIP-712
  domain. It is correct *today* — the recomputed separator byte-matches the live on-chain
  `DOMAIN_SEPARATOR()` (`name()="USDC"`, `version()="2"`, verified on World Chain mainnet). But the
  token is a `FiatTokenProxy` that Circle **upgraded in-place from bridged USDC.e to native USDC on
  2025-06-11** at the same address, and FiatToken caches `name`/domain at init. Any future Circle
  re-initialization or implementation swap that changes `name`/`version` silently invalidates every
  signature — `receiveWithAuthorization` reverts and no agent question submission can succeed — with
  no revert path on RateLoop's side and no test pinning the live value.
- **Fix:** Don't hardcode blindly. Read `name()`/`version()` (or `eip712Domain()` per EIP-5267) from
  the token at signing time, **or** add a CI/runtime golden-vector assertion that the computed
  domain separator equals the on-chain `DOMAIN_SEPARATOR()` (pin `0x936533d5…09ec`) so a Circle
  upgrade fails CI rather than production.
- **Sources:** https://www.circle.com/blog/now-live-native-usdc-and-cctp-v2-on-world-chain
- **Confidence:** High (current correctness and upgrade history both verified on-chain).

#### F-5 — Integration targets a preview/unreleased World ID 4.0 verifier ABI; credential path lacks a proof-replay key (reliability/launch-gating)

- **File:** `packages/foundry/contracts/interfaces/IWorldIDVerifier.sol:4-19` (self-described
  "Preview interface for World ID 4.0"); call sites `RaterRegistry.sol:875-886, 952-960`;
  credential path `RaterRegistry.sol:842-917`
- **What:** All human-credential gating — the system's sole sybil defense — routes through a fixed
  9-arg `verify(...)` with a `uint256[5]` proof against a *preview* World ID 4.0 verifier. World ID
  4.0 is still an RFC/active-development spec in 2026 (it restructures identity into an on-chain
  `WorldIDRegistry` with per-RP committed keys, materially different from the Semaphore nullifier
  model), and there is no confirmed finalized production verifier matching this exact selector. If
  the shipped signature differs (arg order, proof arity, return-vs-revert), `RaterRegistry` must be
  redeployed — the `…ConfigFrozen`/`setWorldIdV4VerifierConfig` path only swaps the *address*, not
  the *ABI*. Separately, the credential (non-presence) path has **no proof-replay key**, unlike the
  presence path which has `_usedWorldPresenceProof` (`:934-950`); it relies solely on
  nullifier→owner binding, so if the real verifier's `nonce` is replayable, the same proof can be
  re-submitted by the current owner (harmless for uniqueness, but replays the `evidenceHash`/event
  stream).
- **Fix:** Gate mainnet launch on the *finalized* World ID v4 verifier ABI + a live address; add an
  integration test against the real deployed verifier (not just `MockWorldIDVerifier`); document the
  interface as unstable. Add a replay key to the credential path symmetric with the presence path.
- **Sources:** https://world.org/blog/engineering/introducing-world-id-4.0 ,
  https://github.com/worldcoin/world-id-protocol (v4 specs).
- **Confidence:** Medium-high (preview status documented by the repo itself; whether the final ABI
  differs is unknowable).

### Low

#### F-6 — SDK webhook verifier canonicalizes object bodies differently than the server signs (agent surface)

- **File:** `packages/sdk/src/agent.ts:1903-1908` (`bodyToString`), `:1844-1849` (`stringifyJson`);
  server `packages/nextjs/lib/agent-callbacks/signing.ts:25-31, 49-54` (signs over `canonicalJson`)
- **What:** The server HMAC-signs the exact stored payload string produced by `canonicalJson()`
  (recursively key-sorted). When a receiver hands the SDK verifier a parsed JS **object** body (a
  documented input), the SDK re-serializes with plain `JSON.stringify` (insertion order) — not
  sorted — so any payload whose key order differs from alphabetical (e.g. the nested
  `liveAskGuidance` object) yields a different byte string and `signatureMatches` returns a false
  negative on a legitimate webhook. Latent today because current payloads are coincidentally
  alphabetically ordered; it breaks the moment a non-sorted key is introduced.
- **Fix:** Canonicalize object bodies in the verifier with the same key-sorting as the server's
  `canonicalJson`, or require verification on the raw received bytes and have `bodyToString` reject
  plain objects.
- **Confidence:** High that the divergence exists; medium that it bites in practice.

#### F-7 — Server-side EIP-3009 `validBefore` has no upper bound (the 24h cap is client-only) (agent surface)

- **File:** `packages/nextjs/lib/x402/questionSubmission.ts:1445-1449`
- **What:** When the server builds the native x402 authorization it accepts a client-supplied
  `validBefore` and only checks `validBefore > validAfter`. The 24-hour ceiling
  (`MAX_X402_AUTHORIZATION_VALIDITY_SECONDS`) just added lives only in the local signer's
  `assertTrustedX402Authorization`. Agents signing via the browser-handoff path or any non-local
  wallet receive server-proposed typed data with an unbounded lifetime. The window is nonce-bound
  so it isn't a replay vector, but a buggy/compromised server could propose a years-long transfer
  authorization for an agent's own wallet, caught only by local-signer clients.
- **Fix:** Apply the same ~24h ceiling server-side in the native and permissionless plan builders so
  every signing surface is protected, not just the local signer.
- **Confidence:** High; severity low (agent signs/pays for itself, recipient pinned).

#### F-8 — SDK webhook freshness check is silently disabled by a negative `toleranceSeconds` (agent surface)

- **File:** `packages/sdk/src/agent.ts:1281-1287`
- **What:** `verifyEvent` enforces timestamp freshness only when `toleranceSeconds >= 0`. A caller
  passing a negative tolerance (a plausible "very strict / no skew" attempt) instead completely
  disables the replay-window check, accepting arbitrarily old timestamps; replay protection then
  rests solely on the optional, often-unconfigured `replayProtection` store.
- **Fix:** Treat negative `toleranceSeconds` as invalid (throw at construction) or clamp to 0;
  document that 0 means exact-match and there is no disable sentinel.
- **Confidence:** High.

#### F-9 — Keeper uses local wall-clock instead of chain time to gate `completeFeeWithdrawal` (keeper)

- **File:** `packages/keeper/src/frontend-fees.ts:358`
- **What:** The keeper completes a matured pending withdrawal when
  `releaseAt <= Date.now()/1000`, but the contract checks `block.timestamp >= releaseAt`
  (`FrontendRegistry.sol:347`). If the keeper host clock runs ahead near the boundary, it submits
  `completeFeeWithdrawal` while the on-chain delay is still active. Because writes now estimate gas
  before broadcasting, the revert is caught at estimation (no gas burned) and self-corrects next
  tick — so impact is a noisy warning + missed sweep, not loss.
- **Fix:** Compare against chain time (`publicClient.getBlock({blockTag:"latest"}).timestamp`, which
  the keeper already fetches for the main loop) instead of `Date.now()`.
- **Confidence:** High.

#### F-10 — Permanently-rejected correlation roots trigger a full artifact rebuild + futile re-propose every tick (keeper/ops)

- **File:** `packages/keeper/src/correlation-snapshots.ts:462-465, 527-541, 609`
- **What:** After PR #43's `Check rejected correlation roots before source work` (commit
  `b2404ff8`), re-proposing an identical (deterministically rebuilt) rejected `clusterRoot` reverts
  early with `InvalidSnapshot`. The keeper treats `STATUS.Rejected` like `STATUS.None`: preflight
  sets `needsArtifactBuild = true`, so it rebuilds the artifact and calls `proposeCorrelationEpoch`
  every tick. The revert is caught/logged (no crash, no stall of other work), and if the eligible
  set legitimately changes the new root succeeds — so it's correct, not a stall. But for a root
  rejected on its merits with an unchanged eligible set, the keeper burns a rebuild + RPC reads
  every tick indefinitely, compounding the O1 Ponder rate-limit self-throttle.
- **Fix:** Cache rejected `(epochId, clusterRoot)` and skip rebuild/re-propose unless the candidate
  fingerprint / eligible set changed.
- **Confidence:** Medium.

#### F-11 — Keeper in-code comment still claims RevealFailed forfeits stake (docs)

- **File:** `packages/keeper/src/keeper.ts:1181-1183`
- **What:** The reveal-failed finalization-skip comment states finalization "forfeits unrevealed
  stakes," but `RoundCleanupLib.sol:566-585` now *refunds* them (forfeiture is `Settled`-only). The
  skip logic is still defensible as defense-in-depth, but the rationale is wrong and could mislead a
  maintainer. Distinct from D1 (which covered the keeper README, not this comment).
- **Fix:** Update the comment to reflect the refund; reframe the skip as avoiding premature
  finalization / preferring this keeper's own reveal attempt.
- **Confidence:** High.

#### F-12 — Dead `RoleRevoked` event / `AccessControlBadConfirmation` error after the role-surface trim (contract cleanup)

- **File:** `packages/foundry/contracts/RoundVotingEngine.sol:76, 279`
- **What:** The role trim removed the only emitter of `RoleRevoked` (`_revokeRole`) and the only
  thrower of `AccessControlBadConfirmation` (`renounceRole`), but both declarations remain and are
  carried into the published ABI. Cosmetic, but the `RoleRevoked` ABI entry can mislead an indexer
  into subscribing to an event that can never fire.
- **Fix:** Delete both declarations and regenerate ABIs (or leave them if ABI churn is undesirable —
  no functional impact).
- **Confidence:** High (dead); low severity.

#### F-13 — Keeper allowlists a deprecated drand legacy testnet chain; no mainnet-quicknet assertion (keeper/reliability)

- **File:** `packages/keeper/src/drand.ts:25-26, 60-74`
- **What:** Mainnet correctly pins **quicknet** (`52db9ba7…`, RFC 9380-conformant). But the
  allowlist also ships the legacy tlock-js testnet (`7672797f…`), a chained/legacy-scheme network in
  the same family drand sunset for non-RFC-9380 hashing. If a deployment's
  `ProtocolConfig.drandChainHash` is ever pointed there (testnet/staging mix-up), reveals depend on
  a deprecated beacon that can be torn down, and ciphertexts encrypted to it could become
  permanently undecryptable → RevealFailed churn. No on-chain or startup check enforces production
  quicknet.
- **Fix:** Drop the legacy testnet chain from the mainnet keeper build (or env-gate to
  non-production), and assert at startup that the resolved chain hash is `52db9ba7…` for mainnet.
- **Sources:** https://docs.drand.love/blog/fastnet-to-be-sunset/
- **Confidence:** High.

#### F-14 — Superseded MCP authorization-server metadata note

**Superseded:** active MCP protected-resource metadata is opaque-bearer-only for
pre-registered static or DB-backed RateLoop policy tokens. The older OAuth/OIDC
authorization-server action item no longer applies.

#### F-15 — E2E fee-claim helper + active spec still call the removed `claimFees` (release/test)

- **File:** `packages/nextjs/e2e/helpers/admin-helpers.ts:2252, 2259`;
  `packages/nextjs/e2e/tests/frontend-fee-claim.spec.ts:234-259`
- **What:** PR #43 migrated the gasless allowlist off `claimFees`, but the E2E helper
  `claimFrontendFees()` still encodes a `claimFees` call and the active (non-skipped) spec asserts
  single-step semantics. `claimFees` was removed from `FrontendRegistry.sol` (in an ancestor commit
  of the PR base), so this spec fails at runtime against the current contract. Pre-existing break,
  but within the fee-ops migration the PR touched and left incomplete.
- **Fix:** Rework the helper/spec to the two-step `requestFeeWithdrawal` → (advance window) →
  `completeFeeWithdrawal` flow, or skip the spec until migrated.
- **Confidence:** High.

#### F-16 — `worldchain:check` crashes with `ENOENT` instead of reporting "mainnet not yet deployed" (tooling)

- **File:** `scripts/check-worldchain-mainnet-readiness.mjs`
- **What:** The mainnet-readiness script throws an unhandled `ENOENT` on the missing
  `packages/foundry/deployments/480.json` rather than a clean "mainnet not deployed yet" message. It
  does exit non-zero and is not wired into CI, so it's a tooling rough edge only.
- **Fix:** Catch the missing-deployment case and print an explicit not-deployed status.
- **Confidence:** High; low severity.

#### F-17 — `@rateloop/sdk`/`agents` pin dependencies to literal `0.0.1` instead of `workspace:*` (release/config)

- **File:** `packages/sdk/package.json`, `packages/agents/package.json`
- **What:** These pin `@rateloop/contracts`/`@rateloop/sdk` to the literal `"0.0.1"` while
  ponder/keeper/nextjs use `"workspace:*"`. It resolves to the workspace today only because versions
  match; the first version bump (e.g. the `0.1.0` publish A1 calls for) silently breaks workspace
  resolution / pulls a stale published version.
- **Fix:** Use `"workspace:*"` (or `workspace:^`) for intra-monorepo deps, consistent with the other
  packages.
- **Confidence:** High; low severity.

#### F-18 — `ponder.config.test.ts` probe-chain fallback mismatches the hardhat default (test-only)

- **File:** `packages/ponder/ponder.config.test.ts` (`getExpectedProbeChainId` helper)
- **What:** The test helper returns 4801 when `PONDER_NETWORK` is unset, but `ponder.config.ts`
  defaults to `hardhat` (31337) in non-production. The real probe only `console.warn`s on mismatch
  and never throws, so tests pass today; latent inconsistency if a future test omits
  `PONDER_NETWORK`.
- **Fix:** Mirror the config default — return 31337 when `PONDER_NETWORK` is unset.
- **Confidence:** Medium; test-only.

---

## Areas swept and found clean (no new issues)

Recorded so the coverage is auditable, not padded:

- **Contracts:** RewardMath/RobustBtsMath overflow + forfeit/reward math; `RoundRevealLib`
  scoreless-seed on-chain path (returns full stakes, R1c is Ponder-only); `ClusterPayoutOracle`
  bond/CEI/veto accounting and the new `_requireDisinterestedChallenger` (partially closes E1);
  `FrontendRegistry` slash + fee-escrow math; `X402QuestionSubmitter` nonce binding;
  `transferReward`/`claimReward` accounting. A candidate "no-winner forfeit-pool stranding" bug was
  chased and **disproved** (floored weighted mean guarantees `forfeitedPool > 0 ⇒
  weightedWinningStake > 0`), as was a cancel-then-finalize double-release (correctly guarded).
- **App:** SSRF/webhook delivery (DNS-pinned, private-range blocked, https-only, no redirect
  following — strong); stake-modal rating scale (now a single `/10`); stake-modal item snapshot;
  claimable-reward pool-share math; API auth gating on the routes inspected.
- **Indexer/keeper:** RBTS scoring mirror matches `RewardMath`/`RoundRevealLib`; claim accounting
  `onConflictDoNothing` + existing-row guards; earnings/leaderboard source-split and joins; trailing
  base-rate computation matches the normative spec; gas estimate-before-broadcast, sequential nonce
  handling, secrets handling, artifact server path-traversal regex; Ponder build-ordering scripts
  are fail-closed (build failure → exit 1, never serves stale/empty data in production).
- **Agent surface:** EIP-3009 typed-data field/order/domain/nonce validation, local-signer
  transaction-plan validation (could not construct a deviating plan it would sign), server confirm
  verification, MCP token hashing + scope enforcement + public allowlist, budget/idempotency row
  locks, signed-action challenge replay-safety, keystore Web3 v3 crypto.
- **Release/PR #43:** role trim safe; gasless allowlist consistent; deploy script grants all roles;
  Certora `MathHarness`/`Math.spec` faithfully track the new `calculateNegativeScoreSpreadForfeit`
  signature; ABI/deployedContracts/storage snapshots synced; cross-package address consistency.

Researched and explicitly **discarded** (do not raise): USDC EIP-712 `name` being "USD Coin"
(false — it is "USDC"); EIP-3009 front-running griefing (N/A — `receiveWithAuthorization`, caller ==
payee); EIP-2935 wrong address on OP Stack (false — canonical address, live on World Chain); the
200-voter O(N) gas concern is *overstated* by the main doc (World Chain block gas limit is
280M, ~9× the 30M `GasBudget.t.sol` asserts against); drand v2.0 March-2025 post-mortem
(operator/DKG issue, not beacon verification); drand round-to-time off-by-one (code computes
round-at-or-after and the contract independently enforces `revealableAfter`).

## Suggested sequencing (supplements the main doc)

1. **Before mainnet value flows:** F-3 (re-derive the seed-expiry threat model against the real
   8191-block window — it changes the audit's conclusions), F-4 (USDC domain golden-vector / runtime
   read — a Circle upgrade silently bricks payments), F-5 (gate launch on the finalized World ID v4
   verifier ABI + integration test; add the credential-path replay key). R1c remains from the main
   doc.
2. **Before pushing agent adoption:** F-1 (the Withdraw button is unusable), F-2 (indexer pending-fee
   derivation), F-6/F-7/F-8 (webhook canonicalization, server-side `validBefore` cap, freshness
   sentinel), F-14 (MCP OAuth advertisement).
3. **Hardening / cleanup:** F-9, F-10, F-11, F-12, F-13, F-15, F-16, F-17, F-18.
