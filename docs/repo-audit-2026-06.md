# RateLoop Repo Audit — Bugs & Inconsistencies (June 2026)

A multi-agent correctness sweep of the RateLoop monorepo at HEAD (`aa2b56d1`), run
2026-06-13. Seven agents audited disjoint subsystems in parallel; the load-bearing findings
below were then independently re-verified against source by the compiler of this document
(file:line evidence checked, ABIs recompiled from the current Solidity). Scope was
**correctness, security, and cross-component consistency** — not style, gas, or UX polish.

## TL;DR

**No Critical or High severity bug exists in the on-chain protocol logic.** The
commit-reveal scheme, settlement/BTS math, escrow fund-accounting, access control, and the
x402/EIP-3009 and tlock cryptographic paths were all probed against their known failure
modes and held up — the contracts carry a visible audit trail of prior fixes that are
correctly implemented.

The real issues live **off-chain and at the boundaries**:

1. **ABI / deployment drift (the highest-impact, most actionable cluster).** The
   hand-maintained TypeScript ABIs and `deployedContracts.ts` were last regenerated before
   the June 12–13 Solidity changes, so they no longer match the deployed contracts. One
   **High** (a deployed function absent from the TS ABI), two Medium, one Low — all fixed
   by a single `forge build` + ABI regeneration. This is the recurring ABI-parity problem
   flagged in prior sessions; it has recurred.
2. **Indexer-vs-contract fidelity (Ponder).** Five confirmed places where the indexer's
   aggregates diverge from on-chain economics — mislabeled refunded pools, an inflated
   allocated balance, a missing reorg-replay guard that can double-count, and a dropped
   event field. None lose funds on-chain; all corrupt what the app *displays* and what
   downstream consumers read.
3. **Spec-vs-code consistency.** Two documented invariants ("protocol-wide identity earning
   ban", "gated rounds are human-credential-only") are narrower or softer in the code than
   the docs claim — likely intentional, but they need an explicit product decision.

Remediation priority: **regenerate ABIs + deployedContracts first** (mechanical, removes
the only High), then the Ponder aggregation fixes, then adjudicate the spec-vs-code items.

## Method

| Agent | Scope | Result |
| --- | --- | --- |
| 1 | Core voting / round lifecycle / settlement math (14 libs + engine) | No Crit/High; 1 Low edge case |
| 2 | Escrow / rewards / confidentiality / payout pipeline | No Crit/High; 1 Med + 3 Low (mostly by-design) |
| 3 | Registries / identity / governance / submission | No Crit/High; 1 Med + 2 Low |
| 4 | **ABI parity** (TS ABIs vs compiled Solidity; deployment addresses) | **1 High + 2 Med + 1 Low** |
| 5 | Ponder indexer + keeper bot | 5 Med + 4 Low |
| 6 | SDK + agents (commit-reveal / signing parity) | No Crit/High; 2 Low |
| 7 | Next.js critical money/identity flows | No Crit/High; 2 Low |

Note on Agent 4: the compiled `packages/foundry/out/*.json` artifacts were stale at audit
start (compiled Jun 12 12:17; sources modified through Jun 13 08:36). The agent ran
`forge build` to regenerate them, so all ABI comparisons are against freshly-compiled ABIs
matching the current source. (The regenerated `out/` is gitignored — the working tree is
clean.) An audit trusting the stale artifacts would have produced false alarms.

---

## 1. ABI & deployment drift

Root cause for 1.1–1.3: `packages/contracts/src/abis/*.ts` and `deployedContracts.ts` were
last regenerated before commits `80f234d1` ("Expose round verdict in roundCore"), the
banned-reward confiscation series, and the on-chain confidentiality-flag validation series.
A single ABI regeneration after `forge build` resolves all three.

### 1.1 — HIGH (confirmed): `confiscateBannedReward` is deployed but absent from the TS ABI

- Solidity: `packages/foundry/contracts/RoundRewardDistributor.sol:245` —
  `function confiscateBannedReward(uint256 contentId, uint256 roundId, bytes32 commitKey) external nonReentrant`
- Absent from `packages/contracts/src/abis/RoundRewardDistributorAbi.ts` **and** from
  `packages/contracts/src/deployedContracts.ts` on both chains (verified: 0 occurrences in
  each).
- Consequence: no client can encode a call to this function via the indexed ABI. Impact is
  latent today (no TS consumer calls it yet), but the deployed 4801 contract exposes a
  governance/confiscation entrypoint the application layer is blind to. This is the only
  High; it is purely a regeneration miss, not a logic defect.

### 1.2 — MEDIUM (confirmed): `ConfidentialityEscrow` missing three functions from its TS ABI

- Present in `packages/foundry/contracts/ConfidentialityEscrow.sol`, absent from
  `packages/contracts/src/abis/ConfidentialityEscrowAbi.ts` (verified):
  `CONFIDENTIALITY_FLAG_PRIVATE_FOREVER()`, `confidentialityEscrowConfigShape()`,
  `recordConfidentialityNexusForRegistry(uint256,address,address)`.
- Consequence: reads/encodes of these via the ABI fail. Partly masked because consumers
  currently **hardcode** `CONFIDENTIALITY_FLAG_PRIVATE_FOREVER = 1` in TS
  (`packages/ponder/src/ConfidentialityEscrow.ts:8`, `packages/agents/src/localSigner.ts:94`,
  `packages/nextjs/lib/questionSubmissionCommitment.ts:10`) instead of reading the ABI —
  itself a fragility (a constant duplicated off-chain that the ABI can no longer confirm).

### 1.3 — LOW (confirmed): `ContentRegistry` carries a stale `revokeVotingEngine` / `VotingEngineRevoked`

- Neither exists in current `packages/foundry/contracts/ContentRegistry.sol` (verified: 0
  occurrences), but both remain in `packages/contracts/src/abis/ContentRegistryAbi.ts`
  (verified: present) and in `deployedContracts.ts` on both chains.
- Consequence: dead ABI entries. Calling `revokeVotingEngine` would revert (no such
  selector on the deployed contract). No TS consumer references either name — harmless, but
  prune on next regen.

### 1.4 — MEDIUM (confirmed, local-dev only): `deployedContracts.ts` chain 31337 is entirely stale

- All 16 comparable 31337 addresses in `packages/contracts/src/deployedContracts.ts` differ
  from the current `packages/foundry/deployments/31337.json`, with **label collisions**:
  - `0xF1078fD568Ad76E49E6F88D1fF485402a086976b` → `deployedContracts.ts:36256` labels it
    `RoundVotingEngine`; the fresh foundry artifact labels it `CategoryRegistry` (verified).
  - `0xe8F76a822B…` → `RoundRewardDistributor` in deployedContracts, `ClusterPayoutOracle`
    in the artifact; `0x2c4b93b614Dd…` → `ContentRegistry` vs `MockWorldIDRouter`.
- Propagation: `packages/contracts/src/deployments.ts:15` `getSharedDeploymentAddress()`
  reads the stale data; consumed by `packages/keeper/src/config.ts`,
  `packages/ponder/src/protocol-deployment.ts`, `packages/nextjs/lib/protocolDeployment.ts`.
  So nextjs/keeper resolve **wrong** local addresses and would revert/no-op against them.
  Meanwhile `packages/ponder/.env.local` hardcodes 31337 addresses that *do* match the
  fresh artifact — so the local stack disagrees with itself.
- Scope: **local-dev only.** Chain 4801 (testnet): all 19 addresses match
  `packages/foundry/deployments/4801.json` — consistent.

**Clean:** all 79 Ponder event references (event names + every `event.args.*` access)
resolve correctly against both the TS ABIs and the fresh compiled JSON; no tuple/struct
shape drift on any of the 7 priority contracts; no stale protocol address hardcoded in
non-test source; `SubmissionMediaValidator(+Factory)` having no TS ABI is intentional
(factory-deployed per submission).

---

## 2. Indexer-vs-contract fidelity (Ponder)

None of these lose funds on-chain; they corrupt indexed/displayed state and what
downstream API routes read.

### 2.1 — MEDIUM (confirmed): refund/forfeit handlers mislabel still-live pools as fully refunded

- `packages/ponder/src/QuestionRewardPoolEscrow.ts` `RewardPoolForfeited` (~165-172),
  `RewardPoolRefunded` (~408-438), and bundle equivalents (~684-714) unconditionally set
  `unallocatedAmount: 0n, refunded: true`.
- On-chain, two different paths emit through the **same** event
  (`QuestionRewardPoolEscrowTransferLib.sol:73/76`): `_refundUnallocatedRewardPool`
  (`…PoolActionsLib.sol:342`, sets only `unallocatedRefunded = true` — pool stays live and
  keeps paying claims) and `_refundCompleteRewardPool` (`…:366`, sets `refunded = true`).
- The indexer can't distinguish them, so a pool that only had its unallocated tail swept is
  shown as closed/refunded. **Root cause is contract-side event reuse** — a clean fix needs
  a distinguishing flag/event on-chain, not just an indexer patch.

### 2.2 — MEDIUM (confirmed): `allocatedAmount` left permanently inflated after a complete refund

- Same handlers. The complete-refund path on-chain refunds
  `fundedAmount - claimedAmount` (includes allocated-but-unclaimed funds), but the handler
  zeroes only `unallocatedAmount` and never reduces `allocatedAmount`.
- Conservation (`unallocated + allocated + refunded == funded`) breaks after a complete
  refund; the index keeps presenting allocated/claimable funds that were already swept out.

### 2.3 — MEDIUM (confirmed): `FeedbackBonusAwarded` mutates pool aggregates without the replay guard its siblings use

- `packages/ponder/src/FeedbackBonusEscrow.ts:~88-101`: the `feedbackBonusAward` insert is
  `onConflictDoNothing()` (idempotent), but the following `feedbackBonusPool` update
  (`remainingAmount -= grossAmount`, `awardedAmount += grossAmount`, `awardCount++`, …) runs
  **unconditionally**. By contrast, `QuestionRewardPoolEscrow.ts:386` guards its aggregate
  mutation behind `if (!existingClaim)` (verified).
- On a reorg/replay of the same log, pool totals double-count and `remainingAmount` can go
  negative; the award row itself does not. Conditional on Ponder re-running the handler.

### 2.4 — MEDIUM (confirmed): `HumanCredentialRevoked` hardcodes `provider: 0`, dropping the emitted value

- `packages/ponder/src/RaterRegistry.ts:413` inserts `provider: 0` while the event emits
  the real provider (`RaterRegistry.sol:1140 emit HumanCredentialRevoked(rater, nullifierHash, provider)`;
  the handler reads `event.args.nullifierHash` but ignores `event.args.provider`) (verified).
- On the **insert** path (a revocation arriving with no prior credential row — e.g. after a
  re-seed/cleanup) the persisted provider is wrong (0 = None). The `onConflictDoUpdate` path
  preserves an existing row's provider, which narrows the blast radius — hence Medium.

### 2.5 — MEDIUM / latent (suspected): RBTS settlement recomputes the mean instead of trusting the emitted `meanScoreBps`

- `packages/ponder/src/RoundVotingEngine.ts:1110-1111` recomputes
  `indexedMeanScoreBps = weightedScoreSum / totalScoreWeight` over `scoredVotes`, and
  `:1131-1137` gates forfeiture on `scoredVotes.length` — but the `continue` guards at
  `:1038-1045` and `:1070-1072` can drop a weight>0 vote, after which both the recomputed
  mean and the count diverge from chain. The authoritative `meanScoreBps` is already stored
  to `round.rbtsMeanScoreBps` (~:971) but is **not** used for per-vote settlement.
- When a guard fires, indexed `rbtsRewardWeight`/`rbtsStakeReturned`/`rbtsForfeitedStake`
  (feeding `voterStats.totalStakeLost`) diverge from on-chain economics. Latent because the
  guards shouldn't fire for a revealed weight>0 vote under consistent indexing; the smell is
  the design choice to recompute rather than consume the emitted mean/count.

### 2.6–2.9 — LOW

- **2.6** `packages/ponder/src/api/routes/correlation-routes.ts:~37-38,486-504`: a silent
  50k-row scan cap (`MAX_VOTE_SCAN_PAGES=50 × 1000`) on a settlement path; a round needing
  >50k scanned rows to reach the offset would silently drop eligible votes from the payout
  merkle tree with no error surfaced. Only fires for pathologically large rounds.
- **2.7** `packages/ponder/src/QuestionRewardPoolEscrow.ts:492`: `questionBundleReward.failed`
  is never written (always false) yet API routes filter on it — dead column or a
  missing/intended signal.
- **2.8** `packages/keeper/src/keeper.ts:~1578-1583` (gate ~1183-1220): when a commit's
  ciphertext is in neither Ponder nor the `eth_getLogs` lookback window, the keeper sets
  `infrastructureFailure=true` (blocking *this* keeper from `finalizeRevealFailedRound`) and
  never increments the decrypt-failure budget, re-scanning every tick forever. Bounded —
  finalization stays permissionless and the deadline normally lands inside the log window —
  but no escape/alert inside this keeper.
- **2.9** `packages/keeper/src/revert-utils.ts:~11-21`: `getRevertReason` decodes custom
  errors only against `RoundVotingEngineAbi`, so reverts from AdvisoryVoteRecorder /
  ContentRegistry / QuestionRewardPoolEscrow may misclassify as unexpected. Log noise only.

**Clean (bounding the audit):** keeper struct field-index parsing, commit-key derivation,
reveal-failed deadline math, `processUnrevealedVotes` pagination, the correlation
builder/verifier round-trip and epoch state machine, drand BLS verification pinning, and the
double-emit reveal guard were all checked and match the contracts.

---

## 3. On-chain contracts — no Crit/High; by-design & spec-consistency items

### 3.1 — MEDIUM (confirmed behavior; likely-intentional gap): identity ban is unreachable for any World ID identity that never posted a confidentiality bond

- `RaterRegistry.sol:639` gates every `banIdentity` behind
  `_requireConfidentialityNexus` (`:1437-1443`), which requires a nexus that
  `ConfidentialityEscrow` only ever sets for **gated** content
  (`ConfidentialityEscrow.sol:309` early-returns on non-gated content; `:363-366`,
  `:425-440`).
- So an identity that only votes/earns on ordinary (non-gated) content never acquires a
  nexus, and `banIdentity` always reverts `InvalidBan` for it. The manual escape hatch
  `recordAccessNexus` (ACCESS_RECORDER_ROLE) also no-ops unless invoked against gated
  content. This **materially contradicts** the "protocol-wide World ID identity earning
  ban" described in the use-case doc — the enforceable scope is far narrower. Needs a
  product decision: is the nexus precondition intended?

### 3.2 — MEDIUM (suspected, documented optimistic-oracle tradeoff): payout claim-weight is never reconciled on-chain against the committed leaf set

- `ClusterPayoutOracle.sol:845-847` `verifyPayoutWeight` checks only
  `effectiveWeight <= baseWeight` and `independenceBps <= 10000`; the qualification path
  (`QuestionRewardPoolEscrowQualificationLib.sol:322-337`) accepts the proposer's asserted
  `totalClaimWeight` / `effectiveParticipantUnits` with no
  `Σ effectiveWeight(leaves) == totalClaimWeight` invariant.
- A proposer can finalize a snapshot whose `totalClaimWeight` mis-states the true leaf sum,
  shifting the **relative** split among honest voters. **Solvency is preserved** — the
  consumer caps the final claimant at `totalAmount - claimedAmount`
  (`QuestionRewardPoolEscrowClaimLib._nextWeightedShare`) and every share is drawn from the
  allocation, so the pool can be mis-split but not over-drained. Protection rests entirely
  on the challenge window + arbiter veto. This is the explicitly-documented optimistic
  design; flagged because the verification gap is real.

### 3.3 — LOW items (contracts)

- **`ConfidentialityEscrow.sol:390-405,425-440`** — `_markNullifierBonded` records the nexus
  against the holder's *current* credential nullifier, read independently of the bonded
  `identityKey`; if the holder rotates credentials the nexus can bind the wrong nullifier
  (compounds 3.1).
- **`LaunchDistributionPool.sol:564-587,640-660,696-717`** — the "gated rounds are
  human-credential-only" invariant is **not enforced**: unverified raters are *capped*
  (25% via `unverifiedEarnedRaterCapBps`), not blocked, and `finalize…` re-checks only ban
  status, not credential. The presence of dedicated unverified-cap constants suggests the
  **docs are stale**, not the code — but reconcile explicitly. (Cross-references 3.1 and the
  use-case doc's "AI raters excluded from gated rounds.")
- **`LaunchDistributionPool.sol:696`** — launch credit is not re-gated on credential
  revocation/expiry between record and finalize (only ban is re-checked).
- **`ClusterPayoutOracle.sol:846-847` vs `IClusterPayoutOracle.sol:59-62`** — the documented
  `baseWeight` bounds (`[10_000,20_000]` / `==10_000`) are enforced only by the off-chain
  tree builder, not on-chain (the question consumer separately bounds `<= 20_000`, but the
  launch path requires exactly `== 10_000`).
- **`FeedbackRegistry.sol:64-66`** — `setVotingEngine` is a role-gated `view` setter that
  always `revert("Invalid engine")`; the engine is immutable after `initialize`. Misleading
  always-reverting surface; remove or document as a no-op.
- **`RoundSettlementDistributionLib.sol:34-83`** (core, Low edge): when
  `weightedWinningStake == 0` (no revealed voter strictly above the truncated mean) the
  platform fee can be added to an unclaimable `roundVoterPool` and stranded in
  `accountedLrepBalance`. Nearly unreachable — requires every revealed RBTS score identical.
- **`RoundRevealLib.sol:211-215,245-250,468-479`** (core, Low): dead branches defending
  against a zero-RBTS-weight revealed commit, unreachable while `MIN_STAKE = 1e6` holds.
  Benign, but they obscure the real invariant.

**Verified sound (so coverage is known):** commit-reveal replay/seed-grinding/double-settle;
the ≥8-reveal forfeit and 3-voter quorum constants match the logic; BTS scoring arithmetic
and sampler bounds; bounty minimum-voter floors (5/8/3 at the USDC thresholds);
credential-mask gating (SELFIE=2/PASSPORT=4/VERIFIED_HUMAN=8); double-claim guards and
dust/remainder reconciliation; x402 EIP-3009 nonce binding and gateway role-gating;
governance proposal/quorum/timelock bounds; LREP forced self-delegation and lock-on-transfer.

---

## 4. Off-chain clients (SDK, agents, Next.js) — clean

The highest-risk client paths were verified **byte-for-byte consistent** with the deployed
Solidity, so they get no findings beyond minor hardening:

- **SDK/agents (no Crit/High):** commit-hash field order, RBTS plaintext encoding, tlock
  target-round window, x402 EIP-3009 nonce + all sub-hashes, EIP-712 domain/typehash
  constants, reveal/bundle commitments, USDC 6-decimal handling, and keystore crypto all
  match the contracts. Two Low hardening notes: `localSigner.ts:1058-1077` lacks a
  `validBefore > now` lower bound (benign — on-chain reverts on expiry); `agent.ts:2047`
  webhook timestamp seconds/ms disambiguation uses a length heuristic (practically
  unreachable edge).
- **Next.js (no Crit/High):** commit/reveal parity (shared SDK builder), decimals (no
  6-vs-18 confusion), x402 server-side validation (client `maxPaymentAmount` is only a cap),
  gated-context authorization (server-enforced; client gate is UX-only), feedback-hash
  recomputation, and API auth/secret handling (timing-safe secrets, no sensitive
  `NEXT_PUBLIC_`, DNS-pinned SSRF allowlist) all verified clean. Two Low:
  `lib/confidentiality/context.ts:655-665` `createConfidentialViewToken` HMACs a random,
  never-returned `viewId` so the "view token" is an unverifiable opaque string (misnamed,
  not a hole — access is gated elsewhere); and display-only `Number(microAmount)` precision
  loss above ~9 billion tokens in wallet/leaderboard hooks (never feeds an on-chain amount).

---

## Cross-cutting themes

1. **ABI/deployment regeneration is a recurring failure mode.** Findings 1.1–1.4 all trace
   to TS ABIs and `deployedContracts.ts` lagging the Solidity. This has been flagged before.
   Worth a CI gate: fail the build if `forge build` + ABI codegen produces a diff against
   the committed `abis/*.ts` / `deployedContracts.ts`.
2. **One event, two meanings.** Findings 2.1 and 2.2 both stem from
   `RewardPool{Refunded,Forfeited}` covering both partial (unallocated-only) and complete
   refunds. The durable fix is on-chain (distinct events or a flag), not in the indexer.
3. **"Gated rounds are human-only" / "protocol-wide ban" are softer in code than in docs.**
   Findings 3.1 and 3.3 (LaunchDistributionPool) and the use-case doc's claims disagree with
   the implementation. Likely the code is intended and the prose is stale — but it needs an
   explicit decision, because the gap is in trust/identity guarantees the product markets.

## Recommended remediation order

1. **Regenerate ABIs + `deployedContracts.ts`** after `forge build` (fixes 1.1 High, 1.2,
   1.3; regenerate 31337 for 1.4). Mechanical; clears the only High and the whole drift
   cluster. Add the CI parity gate.
2. **Ponder aggregation fixes:** add the replay guard to `FeedbackBonusAwarded` (2.3), pass
   the real `provider` in `HumanCredentialRevoked` (2.4) — both are local, unambiguous code
   fixes. Then address 2.1/2.2 (needs the on-chain event-disambiguation decision) and 2.5
   (consume the emitted `meanScoreBps`).
3. **Adjudicate spec-vs-code:** decide the intended scope of the identity ban (3.1) and the
   gated-round credential rule (3.3 / use-case doc), then align either the contracts or the
   documentation.
4. **Low/cosmetic:** prune dead branches and misleading always-revert setters; bigint-clean
   the display paths; rename/remove the unverifiable "view token".

---

*Severity reflects on-chain/financial blast radius. "Confirmed" = re-verified against
source by the audit compiler; "suspected" = agent-reported, plausible, not exhaustively
reproduced. Solidity audited at `packages/foundry/contracts`; ABIs recompiled from current
source.*
