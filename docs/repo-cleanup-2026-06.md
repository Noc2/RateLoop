# RateLoop Repo Cleanup Opportunities (June 2026)

A multi-agent code-cleanup sweep of the RateLoop monorepo at HEAD, run 2026-06-13 (sibling
to [`repo-audit-2026-06.md`](repo-audit-2026-06.md), which covered correctness/security).
Six agents (one relaunched) audited disjoint subsystems for **dead code, duplication,
redundant logic, pre-deploy-removable scaffolding, naming, and repo hygiene** — explicitly
*not* correctness bugs or style nits. Load-bearing findings were re-verified against source
by the compiler of this document (grep evidence checked).

**Key enabling context: the smart contracts are not deployed yet.** That unlocks cleanup
normally off-limits — removing migration/upgrade-compat shims, deleting deprecated/
always-revert functions, and reordering/packing storage are all in scope. Such items are
marked **BREAKING** below (ABI/storage change), which is acceptable pre-deploy.

## TL;DR

Nothing here is urgent — the codebase is clean and well-maintained (knip is already wired
as a `dead-code:scan` script; prior audit fixes are tidy). The opportunities cluster into
four themes:

1. **One root cause behind most duplication: there is no single home for protocol
   constants.** The same values are re-declared across packages and across Solidity files —
   the reward-asset enum (`0=LREP, 1=USDC`) in ~8 contracts, the address-identity-key
   derivation in 12 contracts, and a half-dozen constants (confidentiality flag, USDC
   address map, chain IDs, bounty-eligibility masks, zero-hash) across the TS packages.
   Establishing `packages/contracts/src/protocol.ts` (TS) and a couple of shared Solidity
   libraries as the canonical sources is the single highest-leverage cleanup.
2. **Dead code is real but small and safe.** Several confirmed unreachable branches,
   unused functions/constants/events, and two always-reverting "setter surface" stubs —
   mostly mechanical removals once tests are repointed.
3. **Pre-deploy scaffolding can now be deleted.** Upgrade-compat storage reservations,
   always-zero forward-compat fields, and "retained for proxy safety" mappings exist only
   to protect deployments that don't exist yet.
4. **One genuine repo-hygiene fix worth a commit:** an 11 MB regenerable video is tracked
   in git through a `.gitignore` gap. Everything else (28 GB of agent worktrees, 1.8 GB of
   foundry build output) is already gitignored — local disk hygiene only.

**Scope of this change:** this commit adds only the document. The cleanups it describes are
follow-up code work to be done deliberately (each with its test updates), not bundled here.

## Method

| Agent | Scope | Headline |
| --- | --- | --- |
| 1 | Core voting + escrow Solidity (engine + ~25 libs) | Confirmed dead RBTS branches; ~8 unused fns/consts/events; redundant funding checks |
| 2 | Registries / governance / oracle / launch Solidity | 2 always-revert setters; dead consts/mappings; 2 pre-deploy scaffolds |
| 3 | Off-chain TS (ponder/keeper/sdk/agents/node-utils) | Cross-package constant duplication; reimplemented helpers |
| 4 | Next.js frontend | knip: 1 dead file, 44 unused exports, 30 unused types; formatter duplication |
| 5 | Repo tooling / deps / docs | Tracked 11 MB video + gitignore gap; dep version skew; debunked 2 knip false positives |

Agent 3 was run twice (the first instance was slow — ~22 min — and a sharper relaunch
finished in ~2 min); both returned and agree on every shared finding, so the TS section is
cross-validated. knip findings were sample-verified with grep; two of its claims were
confirmed **false positives** (the `buffer` dep is a real polyfill import; `remotion.config.ts`
is convention-loaded) and are excluded below.

---

## 1. Solidity contracts

Contracts are undeployed, so all of these are safe to land before first deploy; BREAKING =
changes ABI/storage.

### 1.1 Dead code — mechanical (verified)

- **Unreachable RBTS zero-weight scoring path.** `commitRbtsWeight` is written only as
  `effectiveStake` (`RoundVotingEngine.sol:1518`), and `stakeAmount >= MIN_STAKE = 1e6`, so
  every revealed commit has weight > 0. That makes `RoundRevealLib.sol:211-215` (the
  `else`) and the function it calls, `_accountPostThresholdReveal` (`:468-479`), dead.
  Removing them also collapses `economicCount` into `revealedBuildIdx` (provably equal), so
  the `economicCount < minParticipants` half of the check at `:245` is redundant. Internal
  only (no ABI impact); needs-care because it simplifies the scoring control flow.
- **`RoundVotingEngine` unused declarations (verified):** `MAX_CIPHERTEXT_SIZE` (`:97`) — the
  real check uses `TlockVoteLib`'s own copy (`:12,144`); `_getCategoryRegistry()` (`:1298`)
  and its sole-purpose `ICategoryRegistry` import (`:24`).
- **`VotePreflightLib` three unused external wrappers (verified zero callers):**
  `validateConfidentialityGate` (`:102`), `validateVoterContentAndConfidentiality` (`:48`),
  `validateRoundOpener` (`:75`) — the live paths use the `*RecordNexus` / `_`-prefixed
  variants.
- **`TlockVoteLib.targetRoundTimestamp` (`:41-48`)** — zero in-repo callers.
- **`QuestionRewardPoolEscrow` family unused symbols (grep-verified):**
  `ClaimLib.computeClaimSplit` (`:63`), `QualificationLib.clusterRoundQualificationStatus`
  (`:436`), `EligibilityLib.isAccountEligibleForBounty` (`:23`) + its only consumer
  `_credentialStatusBits` (`:64`), `VoterLib.identityKeyForRoundRater` (`:180`) and the
  5-arg `timelyRevealedCommitFrontend` overload (`:9`), the never-emitted event
  `RewardPoolCursorAdvanced` (`QuestionRewardPoolEscrow.sol:165`), and the unused
  `MIN_EFFECTIVE_PARTICIPANT_UNITS` (`:61`).
- **`ConfidentialityEscrow.recordConfidentialityNexus(uint256,address)` (`:286`)** + its
  interface decl — superseded by `recordConfidentialityNexusForRegistry`. BREAKING
  (interface).
- **`ContentRegistry` dead constants (verified):** `SLASH_RATING_THRESHOLD` (`:109`, zero
  refs anywhere) and the two `MIN_SUBMISSION_REWARD_REQUIRED_VOTERS` /
  `MAX_SUBMISSION_REWARD_SETTLED_ROUNDS` copies (`:97,99`) that are dead because the live
  values live in `ContentRegistryRewardLib` (`:12`).
- **`RaterRegistry` (verified):** the `followingCount`/`followerCount` mappings (`:121-122`,
  never read or written — only `isFollowing` is live) and `DEFAULT_PRESENCE_TTL` (`:27`,
  zero refs). Removing the mappings is BREAKING (storage), fine pre-deploy.
- **`IFrontendRegistry.FrontendIsSlashed()` (`:7`)** — never thrown (the contract uses a
  string revert). BREAKING (error selector).

### 1.2 Always-revert / no-op "setter surface" stubs (verified) — BREAKING

Two role-gated setters exist only as tooling-probe stubs and can never change state:

- `FeedbackRegistry.setVotingEngine` (`:64-66`) — `view`, always `revert("Invalid engine")`.
- `RoundRewardDistributor.setVotingEngine` (`:202-205`) — `view`, succeeds only if passed
  the value already stored, never writes.
- (Same pattern noted at `FeedbackBonusEscrow.sol:442`.)

The engine is immutable after `initialize` in each. Remove the functions; delete the tests
that assert they revert.

### 1.3 Redundant checks (verified)

- **Shadowed min-funding checks.** `QuestionRewardPoolEscrowBundleActionsLib.sol:128` and
  `…PoolActionsLib.sol:276` are strictly dominated by the downstream `* BPS_SCALE` checks
  (`BundleLib.sol:308`, `PoolActionsLib.sol:281`) given `requiredVoters == minVoters <=
  maxVoters`. Unreachable; remove. Needs-care (relies on the config invariant).
- **Duplicate terminal-state guard.** `RoundVotingEngine.sol:1129-1134` re-checks the exact
  Cancelled/Tied/RevealFailed condition that `RoundCleanupLib.claimCancelledRoundRefund`
  (`:361`) already checks. Needs-care (changes revert ordering for one wrong-state path).

### 1.4 Pre-deploy scaffolding now removable — BREAKING

- **`ContentRegistry.bonusPool` (`:192`)** — "legacy cancellation sink retained for upgrade
  compatibility." `cancelContent` charges nothing (tests assert zero transfer); the only
  live effect is a meaningless `bonusPool == address(0)` guard (`:811`) on an
  always-non-zero var. Remove the var, init, setter (`:455`), and guard.
- **`ClusterPayoutOracle.proposerBond`** — documented as permanently zero; both the
  pre-finalize "forfeit" (`:631`) and post-finalize "claw back" (`:711`) blocks are
  explicit no-ops. Remove the struct field and both blocks; simplify the refund credits at
  `:568,591` to `proposal.bond`. Needs-care (a storage-slot test harness exercises it).
- **`RoundRewardDistributor` upgrade-compat comments (`:83-89, :1021`)** — justify a storage
  ordering "to keep compatibility with existing TransparentUpgradeableProxy deployments."
  There are none; the rationale is moot and would be actively wrong if storage is repacked.
- **`RatingLib.RatingConfig` inert fields (`:19-28`)** — seven fields documented as
  unread leftovers of the removed confidence-reopening model. Removable to shrink the struct
  (BREAKING) — but kept deliberately, so confirm intent first.

### 1.5 Duplication (consolidation candidates)

- **Reward-asset enum `0=LREP / 1=USDC` re-declared in ~8 files** (`ContentRegistry.sol:93`,
  `ContentRegistryRewardLib.sol:10`, `X402QuestionSubmitter.sol:17`,
  `QuestionRewardPoolEscrow.sol:67`, `…PoolActionsLib:28`, `…BundleActionsLib:44`,
  `…RecoveryLib:8`, `FeedbackBonusEscrow.sol:36`) → one shared `library RewardAssets`.
- **`addressIdentityKey` derivation (`keccak256(abi.encodePacked("rateloop.address-identity-v1",
  account))`) re-declared in 12 contracts** (VotePreflightLib, the escrow family,
  RoundRewardDistributor, ContentRegistry, RaterRegistry, ProtocolConfig, ProfileRegistry,
  LaunchDistributionPool, …) → one shared `IdentityKeyLib`. Internal; needs-care (verify
  byte-identical — they are).
- **`_isIdentityBanned*` ban-resolution copy-pasted across 4 escrow files** (plus one using
  a raw `staticcall` form where siblings use `try/catch`) → one helper.
- **EIP-3009 `receiveWithAuthorization` exact-receive pattern** duplicated in
  `FeedbackBonusEscrow`, `QuestionRewardPoolEscrow`, `ConfidentialityEscrow` → lift beside
  `TokenTransferLib`. Needs-care (reconcile revert strings).
- **`LaunchRaterRewardLib.launchRewardCredentialAnchorId` (`:108`)** re-implements
  `RaterRegistry.launchHumanIdentityKey`; only a test uses it. Delete, repoint the test.

### 1.6 Stale comments / minor

- `QuestionRewardPoolEscrow.sol:225` references a removed `QuestionBundleFailed` event that
  exists nowhere — delete the comment.
- `RoundCleanupLib.sol:594` uses the literal `5e6` where the named `CLEANUP_INCENTIVE_MAX`
  (`:31`) exists.
- `EligibilityLib.eligibilityDataHash()` (`:56`) always returns `bytes32(0)`, making the
  `bountyEligibilityDataHash` field/getters/event-args permanently zero — either remove the
  field plumbing (BREAKING) or document as a placeholder.
- `RoundVotingEngine.sol:116-117` storage-layout comment cites a stale line number.

### 1.7 Over-fragmentation (note, not an action)

The `QuestionRewardPoolEscrow*` family is ~13 libraries, split partly for the 24 KB
size limit and `forge coverage --ir-minimum`, so merges carry real size/stack risk. Only
`RecoveryLib` (small, 2 callers, both in the escrow) and the post-cleanup `EligibilityLib`
are defensible merge candidates — verify the combined size stays < 24 KB. Low priority.

### Ruled out (don't remove)

Engine/library error & event re-declarations (`SelfVote`, `RewardPoolCreated`,
`TreasuryFeeDistributed`, etc.) are **not** dead — Solidity doesn't merge linked-library
events/errors into the consuming ABI, so the re-declarations are how they surface to
indexers and inline-assembly `revert`/`log4`. `RewardMath.calculateRating` + `RATING_B` are
exercised by Certora specs/fuzz tests. `FrontendRegistry.authorizedFeeCreditors` is a live
defense-in-depth check. `RoundCleanupLib` `stakeAmount == 0` guards protect already-refunded
commits, not sub-min stakes.

---

## 2. Off-chain TypeScript (ponder / keeper / sdk / agents)

Cross-validated by two independent agent runs. The throughline: **constants that mirror
on-chain values are re-declared per package instead of imported from `@rateloop/contracts`
(or `@rateloop/node-utils`)**, which all these packages already depend on.

### 2.1 Duplicated constants (verified) → consolidate into `contracts/src/protocol.ts`

- **`CONFIDENTIALITY_FLAG_PRIVATE_FOREVER = 1` — 4 copies** (verified): `agents/src/localSigner.ts:94`,
  `ponder/src/ConfidentialityEscrow.ts:8`, `ponder/src/ContentRegistry.ts:108`,
  `nextjs/lib/questionSubmissionCommitment.ts:10`.
- **World Chain USDC address map `{480, 4801}` — 3 copies** (byte-identical):
  `agents/src/localSigner.ts:68`, `nextjs/lib/questionRewardPools.ts:56`,
  `nextjs/lib/x402/questionPayload.ts:28`.
- **`MIN_NONZERO_CONFIDENTIALITY_BOND = 1_000_000n` — 4 copies:** `agents/src/localSigner.ts:97`,
  `agents/src/questions/lint.ts:16`, `nextjs/lib/questionRewardPools.ts:17`,
  `nextjs/lib/x402/questionPayload.ts:38`.
- **Bounty-eligibility bit masks (`CREDENTIAL_MASK=0x0e`, `RECENT_RECHECK_FLAG=0x80`) — 4
  files, written 4 different ways** (`2|4|8` vs `0x0e` vs a `.reduce()`):
  `agents/src/localSigner.ts:91`, `ponder/src/api/routes/correlation-routes.ts:24`,
  `ponder/src/api/shared.ts:502`, `nextjs/lib/bountyEligibility.ts:15`. The divergent forms
  are a maintenance hazard. Needs-care (confirm shared bit layout — they match).
- **X402 scalar constants** (`X402_SUBMISSION_REWARD_ASSET_USDC`,
  `X402_DEFAULT_SUBMISSION_BOUNTY_USDC`, required-voters/settled-rounds, max-bundle-count,
  disclosure-policy default) duplicated verbatim between `agents/src/localSigner.ts:86-96`
  and `nextjs/lib/x402/questionPayload.ts:32-40` (disclosure default appears a 3rd time at
  `agents/questionSpecs.ts:11`).

### 2.2 Duplicated constants with simpler fixes

- **`PAYOUT_DOMAIN_QUESTION_REWARD = 1`** is already exported from
  `node-utils/src/correlationScoring.ts:12` but re-declared privately in
  `ponder/src/api/routes/data-routes.ts:59`, `…/correlation-routes.ts:21`,
  `keeper/src/correlation-snapshots.ts:33` → import the existing export.
- **`PONDER_NETWORK_CHAIN_IDS` exact duplicate** within ponder (verified):
  `protocol-deployment.ts:5` and `LoopReputation.ts:7` → export once.
- **`ZERO_ADDRESS` string re-declared 5×** (verified: `ponder/src/LoopReputation.ts:6`,
  `protocol-deployment.ts:4`, `keeper/src/correlation-snapshots.ts:34`, `config.ts:23`,
  `frontend-fees.ts:17`) and **zero-bytes32 (`0x…64 zeros`) re-declared 3× in-scope**
  (`agents/src/localSigner.ts:95`, `ponder/.../correlation-routes.ts:27`,
  `data-routes.ts:61`) → use viem's `zeroAddress` / `zeroHash` (viem is already a dep).

### 2.3 Reimplemented helper logic

- **`buildCommitKey`** is exported from `contracts/src/votingCore.ts:250` but re-implemented
  in `ponder/src/RoundVotingEngine.ts:386` and `keeper/src/keeper.ts:805` → import it.
  Mechanical-safe (identical logic).
- **`addressIdentityKey`** re-implemented twice within ponder
  (`RoundVotingEngine.ts:56`, `api/routes/correlation-routes.ts:50`) — mirror of the
  Solidity 1.5 item.
- **`canonicalJson`** has a canonical home in `node-utils/src/json.ts:3` but is
  re-implemented in `sdk/src/agent.ts:1954` (verified). Needs-care: the SDK package does
  **not** depend on `@rateloop/node-utils`, and this output feeds signatures/hashes — verify
  byte-identical canonical output before swapping, or keep but de-dup the helpers.
- **hex/address/bytes32 normalization validators** reimplemented ~5× across ponder/agents/
  keeper with slightly different semantics (regex vs viem `isHex` vs checksummed
  `getAddress`) → consolidate into one `node-utils` validation module. Needs-care (reconcile
  semantics).

**Confirmed clean:** no tracked `packages/contracts/dist/` (both TS agents + the tooling
agent agree — `.gitignore:42` covers `dist`); merkle/keystore helpers already centralized in
node-utils.

---

## 3. Next.js frontend

knip (scoped to the workspace) reported **1 unused file, 44 unused exports, 30 unused
exported types, 0 unused deps**; a sample was grep-verified (knip was accurate on dead
exports but flagged ~4 "exported-but-used-internally" symbols that should keep their value
and only drop `export` — not be deleted).

- **Dead file (verified zero importers):** `hooks/useVoterAccuracyBatch.ts` — only the
  singular `useVoterAccuracy` is consumed.
- **Unused exports (mechanical-safe):** ~44, e.g. `getRewardPoolDisplay`/`getFeedbackBonusDisplay`
  (`components/shared/VotingQuestionCard.tsx:301,349`), `getTransactionErrorText`
  (`lib/transactionErrors.ts:31`), 7 agent-snippet constants in `lib/agent/installSnippets.ts`,
  and several `lib/questionRoundConfig.ts` helpers/constants. The full list is in knip's
  output; treat as a curated review list, confirming each isn't an intended public surface.
- **Formatter duplication (verified, high-value):** the lossy `Number(microAmount)/1e6`
  pattern appears at ~14 display sites across hooks/components, and
  `components/scaffold-eth/ConnectButton/AddressInfoDropdown.tsx:42` defines a **local
  `formatLrepAmount`** that shadows the canonical, bigint-safe, tested `formatLrepAmount`
  (`lib/vote/voteIncentives.ts:58`, takes `bigint | number`). Route the call sites through
  the canonical one (or a shared `formatMicroUsdc`). Needs-care: most sites format
  already-small numbers, so consolidating subtly changes rounding/`toLocaleString` output —
  verify visually.
- **`createQuestionDetailsId` + `sha256Hex` reimplemented** byte-for-byte in
  `components/submit/ContentSubmissionSection.tsx:329` and
  `components/agent/AgentAskHandoffPage.tsx:505`, while an unused canonical version sits in
  `lib/attachments/questionDetails.ts:91`. De-dup the two browser copies first (safe).
- **Naming / dead-logic:** `lib/confidentiality/context.ts:655` `createConfidentialViewToken`
  HMACs a randomly-generated `viewId` that is never returned or stored, so the "token" is an
  unverifiable salted hash. Rename to reflect it's a deterministic access digest (or return/
  persist the id if a verifiable token was intended). Needs-care — 3 live API routes consume
  it.

---

## 4. Repo hygiene

### 4.1 Worth a commit (verified)

- **Tracked 11 MB regenerable video.** `packages/promo-video/out/rateloop-promo.mp4` is
  tracked (verified: `git ls-files` lists it; `git check-ignore` exit 1) and is
  **byte-identical** (same md5 `e7673ec8…`) to `packages/nextjs/public/videos/rateloop-promo.mp4`,
  which is the copy actually served. It's the regenerable render output of `yarn render`,
  committed because `packages/promo-video/.gitignore` ignores `out/*.png` but not `out/*.mp4`.
  Remove it from git and broaden the ignore to `out/`. Keep the nextjs copy.

### 4.2 Low-priority hygiene

- **Cross-package dependency version skew:** `prettier` `~2.8.8` (foundry) vs `~3.5.3`
  (nextjs) is a major split worth aligning (affects format output); also minor skews in
  `dotenv`, `tsx`, `pg`, `qrcode`, `@types/react`. Align ranges, re-run tests.

### 4.3 Local-only (not git — informational)

- `.claude/worktrees/agent-*` — **28 GB** of full tree copies, already gitignored. Clean
  with `git worktree prune` + manual delete after checking `git worktree list`.
- `packages/foundry/out` (669 MB), `.certora_internal` (1.1 GB), `cache`, `broadcast` — all
  gitignored; optional `forge clean` reclaims ~1.8 GB.

### 4.4 knip false positives (excluded — do not act)

- `buffer` (`packages/contracts/package.json`) is a real runtime polyfill, explicitly
  imported in `voting.ts`/`votingCore.ts` for the dual ESM/CJS build — keep.
- `packages/promo-video/remotion.config.ts` is convention-loaded by the Remotion CLI, not
  imported — keep.

---

## Cross-cutting themes

1. **Stand up canonical homes for shared values.** A single `protocol.ts` (TS) and a couple
   of shared Solidity libraries (`RewardAssets`, `IdentityKeyLib`) would eliminate the
   bulk of sections 1.5 and 2.1–2.3 and prevent the next round of drift — and would have
   prevented the ABI/constant-duplication issues the correctness audit also flagged.
2. **The "shared setter surface" pattern left always-revert stubs.** 1.2's dead setters
   exist so external tooling can probe a uniform interface; pre-deploy, just delete them.
3. **Pre-deploy is the moment to drop upgrade scaffolding.** 1.4's reserved slots, zero
   fields, and compat comments all protect deployments that don't exist. They get harder to
   remove safely after launch.

## Recommended sequencing

1. **This doc** (commit) — then tackle code in follow-ups.
2. **Mechanical quick wins (low risk):** delete the verified dead code (1.1), the
   always-revert setters (1.2), and the dead frontend file/exports (§3); swap in viem
   `zeroAddress`/`zeroHash` and import the existing `PAYOUT_DOMAIN_QUESTION_REWARD` /
   `buildCommitKey` / `PONDER_NETWORK_CHAIN_IDS` (2.2–2.3); remove the tracked mp4 + fix the
   gitignore (4.1).
3. **Consolidation (medium):** stand up the canonical constant homes and migrate the
   duplicated constants (1.5, 2.1); unify the bigint formatter usage (§3).
4. **Pre-deploy scaffolding removal (BREAKING, deliberate):** 1.4 items, with their test
   updates, before first deploy.
5. **Deferred / confirm-intent:** `RatingConfig` inert fields, the X402 validation-function
   consolidation (intentional client/server double-validation may stay split), the
   over-fragmentation merges.

---

*Effort/risk labels: "mechanical-safe" = remove/replace with test updates only;
"needs-care" = touches control flow, signing/hash output, an invariant, or intentional
redundancy — verify before applying. "Verified" = re-checked against source by the audit
compiler; other items are agent-reported and grep-evidenced but not exhaustively reproduced.
"BREAKING" = changes contract ABI/storage, acceptable only because contracts are undeployed.*
