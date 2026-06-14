# RateLoop Post-Cleanup Audit — Bugs & Inconsistencies (June 2026)

A multi-agent read-only audit of the RateLoop monorepo at HEAD after the June 13 cleanup
commits (`7689295c`..`cbc432a7`, per [`repo-cleanup-2026-06.md`](repo-cleanup-2026-06.md)).
Four agents audited disjoint subsystems in parallel; load-bearing findings were
re-verified against source by the compiler of this document (grep, targeted test runs,
ABI/Solidity cross-checks).

Scope: **bugs, inconsistencies, and drift introduced or left exposed by the cleanup** —
plus carry-over items from [`repo-audit-2026-06.md`](repo-audit-2026-06.md) that remain
open. Not style, gas, or UX polish.

**No code was changed for this audit.**

## TL;DR

The cleanup was **mechanically sound**: no live TypeScript call sites reference removed
contract functions; governance dropped the dead `setBonusPool` action; Certora, Ponder
handlers, and foundry tests no longer reference removed symbols. Full `forge test` is
**green at 1704/1704** on a clean re-run (2026-06-13), though at least one test showed
**order-dependent flakiness** in an earlier full-suite run.

The **single highest-impact gap** is unchanged from prior audits and now **worse** after
contract surface removal:

1. **Generated ABIs are stale** — `@rateloop/contracts` still exports functions, events,
   errors, and struct fields removed from Solidity during cleanup. Integrators, viem
   typing, and struct decoders can be misled until `forge build` + `generateTsAbis.js`
   runs and a CI gate enforces parity.

Secondary clusters:

2. **Partial pre-deploy scaffolding** — `ContentRegistry.bonusPool` is a private dead
   storage slot with no getter/setter, but ABIs still expose `bonusPool()` /
   `setBonusPool`. Three conflicting stories: “removed,” “slot retained,” “still in ABI.”
3. **Constant/helper duplication largely deferred** — cleanup doc §2.1 consolidation into
   `protocol.ts` was not done; drift risk remains across agents, nextjs, ponder, and
   Solidity.
4. **x402 allowlist drift** — agents `local-ask` parser and nextjs MCP parser accept
   different top-level field sets.
5. **Ponder indexer fidelity** — several Medium findings from the June 13 correctness
   audit appear still open (refund labeling, replay guards, event-field drops).

---

## Method

| Agent | Scope | Headline |
| --- | --- | --- |
| 1 | Solidity post-cleanup | Stale ABIs; partial `bonusPool` removal; bundle-observer tests |
| 2 | TS packages (ponder/keeper/nextjs/contracts/agents) | No stale call sites; ABI drift; x402 allowlist gap |
| 3 | Cross-package constants & assets | Duplication still present; promo assets aligned |
| 4 | Local verification | Full forge suite, isolated reruns, grep evidence |

Prior audit context: [`repo-audit-2026-06.md`](repo-audit-2026-06.md) (correctness sweep
at `aa2b56d1`). That audit’s **High** `confiscateBannedReward` ABI gap is **fixed** in
current HEAD (`RoundRewardDistributorAbi.ts` includes the function). Other Ponder and
spec-consistency items from that document are noted in §5 where still applicable.

---

## 1. High

### H1 — Generated ABIs not regenerated after cleanup (worse than before)

**Severity:** High  
**Status:** Open  
**Introduced by:** Cleanup commit `03cb13a7` removed contract surfaces without ABI regen.

Solidity removed or changed these surfaces; TypeScript ABIs and `deployedContracts.ts`
still export the old API:

| Removed/changed in Solidity | Still in generated ABI |
| --- | --- |
| `ContentRegistry.bonusPool()` getter, `setBonusPool` | `ContentRegistryAbi.ts` (`bonusPool` ~196, `setBonusPool` ~817); `deployedContracts.ts` (~5394, ~35002) |
| `FeedbackRegistry.setVotingEngine` (external stub) | `FeedbackRegistryAbi.ts` (~416) |
| `RoundRewardDistributor.setVotingEngine` | `RoundRewardDistributorAbi.ts` (~849) |
| `FeedbackBonusEscrow.setVotingEngine` | `FeedbackBonusEscrowAbi.ts` (~882) |
| `ClusterPayoutOracle.RoundPayoutProposal.proposerBond` | `ClusterPayoutOracleAbi.ts` struct (~1539) |
| Event `ProposerBondUnrecoverable` | `ClusterPayoutOracleAbi.ts` (~2129) |
| `ConfidentialityEscrow.recordConfidentialityNexus(uint256,address)` | `ConfidentialityEscrowAbi.ts` (~845); live path is `recordConfidentialityNexusForRegistry` |
| Error `FrontendIsSlashed` on `IFrontendRegistry` | `FrontendRegistryAbi.ts` (~1353) |
| Event `RewardPoolCursorAdvanced` | `QuestionRewardPoolEscrowAbi.ts` (~2406) |

**Evidence:**

- `ContentRegistry.sol:172` — only `address private bonusPool;` (no public accessor).
- `FeedbackRegistry.sol` — `_setVotingEngine` internal only; no external setter.
- `git log -1 -- packages/contracts/src/abis/` predates cleanup commits.

**Impact:**

- Calldata built from stale selectors **reverts** at runtime.
- Struct/tuple decoding with ghost fields (notably `proposerBond` alongside `bond`) can
  use **wrong field offsets**.
- TypeScript consumers get false confidence that removed admin surfaces still exist.

**Fix:** `forge build` + `packages/foundry/scripts-js/generateTsAbis.js`; add CI diff gate
(as recommended in `repo-audit-2026-06.md` §Cross-cutting themes).

**Not broken today:** No grep hits for `setBonusPool`, `recordConfidentialityNexus`, or
removed `setVotingEngine` in ponder/keeper/nextjs/agents **call sites** — drift is in
generated artifacts, not live app code paths.

---

## 2. Medium

### M1 — Partial `ContentRegistry.bonusPool` removal

**Severity:** Medium  
**Status:** Open (intentional slot retention vs incomplete ABI cleanup)

Cleanup removed init, setter, cancel guard, and governance template, but kept the storage
slot as `private bonusPool` (`ContentRegistry.sol:172`) “for proxy-safe upgrades.”

| Layer | State |
| --- | --- |
| Solidity | Dead private slot, never read/written in live paths |
| Storage layout JSON | Still labels slot 3 `bonusPool` (accurate for current layout) |
| Generated ABI | Still exposes getter/setter (incorrect — H1) |
| Governance UI | Correctly removed `content-set-bonus-pool` |
| E2E / tests | No stale `setBonusPool` references |

**Recommendation:** Pre-deploy, either drop the slot entirely (BREAKING, fine pre-mainnet)
or regenerate ABIs to match the no-getter reality and document the reserved slot.

---

### M2 — x402 top-level field allowlist drift (agents vs nextjs)

**Severity:** Medium  
**Status:** Open

`X402_QUESTION_TOP_LEVEL_FIELDS` differs between parsers:

| Only in **agents** (`localSigner.ts:128`) | Only in **nextjs** (`questionPayload.ts:678`) |
| --- | --- |
| `detailsHash`, `detailsUrl` | `webhookChallengeId`, `webhookSignature`, `dryRun`, `executionMode`, `sandbox` |

Shared core fields (questions, bounty, confidentiality, payment, webhook URL/secret/events,
signatureMode, transport) align.

**Impact:**

- MCP / server-side `parseX402QuestionRequest` accepts webhook challenge/signature and
  sandbox/dry-run fields that **`local-ask` rejects** if present at top level.
- Agents accepts `detailsHash` / `detailsUrl` at top level that nextjs strict gate does
  not — reverse drift.

**Fix:** Extract one shared allowlist (e.g. `@rateloop/agents` or `@rateloop/node-utils`)
used by both packages.

---

### M3 — Constant duplication deferred (cleanup doc §2.1)

**Severity:** Medium (drift risk, not current bug)  
**Status:** Open

`packages/contracts/src/protocol.ts` centralizes round/reward math but **not** the
cross-package mirrors flagged in cleanup doc §2.1:

| Constant | Copies still present (values match today) |
| --- | --- |
| `CONFIDENTIALITY_FLAG_PRIVATE_FOREVER = 1` | agents, ponder (2), nextjs (2), e2e helper, Solidity |
| World Chain USDC `{480, 4801}` | agents, `questionRewardPools.ts`, `questionPayload.ts` |
| `MIN_NONZERO_CONFIDENTIALITY_BOND = 1_000_000n` | agents (2), nextjs (2) |
| Bounty eligibility masks (`0x0e`, `0x80`) | agents (`2\|4\|8`), nextjs (shifts), ponder (`.reduce()` + literals) |

**Impact:** Future bit-layout or address changes require multi-file edits; e2e duplicates
production constants on a separate import path.

---

### M4 — `addressIdentityKey` still duplicated on-chain (11 locations)

**Severity:** Medium (maintenance / edge-case risk)  
**Status:** Open

Ponder consolidated to `packages/ponder/src/identity-keys.ts` (good). Solidity still
re-declares byte-identical `keccak256(abi.encodePacked("rateloop.address-identity-v1",
account))` in 11 production locations (VotePreflightLib, escrow family, registries, etc.)
plus inline probes in ProtocolConfig, ProfileRegistry, LaunchDistributionPool,
ConfidentialityEscrow.

**Edge case:** Solidity helpers return `bytes32(0)` for `address(0)`; ponder helper always
hashes. Unlikely in normal flows but ban/correlation paths could disagree.

---

### M5 — Contract size warnings (deployment risk)

**Severity:** Medium (pre-mainnet deploy constraint)  
**Status:** Open (pre-existing)

`forge test` compilation emits Spurious Dragon size warnings:

| Contract / library | Reported size |
| --- | --- |
| `LaunchDistributionPool` | 24,681 bytes (> 24,576 limit) |
| `QuestionRewardPoolEscrowBundleActionsLib` | 25,135 bytes |
| `QuestionRewardPoolEscrow` | 25,681 bytes |

Cleanup removed dead code but did not resolve deploy-size pressure. Verify optimizer
settings and library split strategy before mainnet deployment.

---

### M6 — Test suite order-dependent flakiness

**Severity:** Medium (CI reliability)  
**Status:** Observed, intermittent

| Run | Result |
| --- | --- |
| Full suite (first run, 2026-06-13) | **1701/1702 pass** — `test_ClaimReward_SkipsVerifiedHumanAnchorBannedInCurrentRegistry` failed with `InvalidAddress()` |
| Same test isolated | **PASS** |
| `forge test --rerun` | **PASS** |
| Full suite (second run) | **1704/1704 pass** |

Earlier cleanup notes also reported bundle-observer tests failing in full suite but passing
isolated (`test_SettleRound_BundleObserverSeesInitializedRewardPoolsBeforeClaim`,
`test_ReplayBundleObserverNotify_ReplaysFailedSettledNotification`). Those **pass**
isolated at audit time; full-suite status varies.

**Likely cause:** Shared fixture/state leakage between heavy branch tests (registry
rotation, `vm.store` observer injection, launch-pool accounting).

**Recommendation:** Audit test isolation in `RoundRewardDistributorBranches.t.sol` and
`RoundVotingEngineBranches.t.sol`; consider `--isolate-by-default` in CI or split
shared setup.

---

## 3. Low

### L1 — Promo video asset sync is manual

**Severity:** Low (operational)  
**Status:** OK at audit time; process gap

| Asset | Location | Notes |
| --- | --- | --- |
| Served MP4 | `packages/nextjs/public/videos/rateloop-promo.mp4` | Git-tracked |
| Render output | `packages/promo-video/out/rateloop-promo.mp4` | Gitignored (`out/`) |
| MD5 | Both files | **Identical** at audit (`e7673ec8…`) |
| Captions | `rateloop-promo.vtt` | Timings derived from `RateLoopPromo.tsx` beats |

Cleanup correctly stopped tracking the duplicate promo-video copy. Re-render still requires
manual copy to `nextjs/public/videos/` (or a script).

---

### L2 — Dead scaffolding still on-chain (deferred from cleanup doc)

**Severity:** Low  
**Status:** Documented deferrals

| Item | Notes |
| --- | --- |
| `ContentRegistry.bonusPool` private slot | See M1 |
| `RatingLib.RatingConfig` inert fields | Still wired through governance/events; cleanup doc §1.4 deferred |
| `RaterRegistry.followingCount` / `followerCount` | Dead mappings removed in cleanup ✓ |
| Reward-asset enum in ~8 Solidity files | Consolidation deferred (§1.5) |
| `canonicalJson` duplicated in SDK vs node-utils | Hash/signing path; needs byte-identical verification before merge |

---

### L3 — Import path style inconsistency

**Severity:** Low  
**Status:** Cosmetic

- `buildCommitKey`: ponder/keeper use `@rateloop/contracts/votingCore`; nextjs uses
  `@rateloop/contracts/voting` re-export.
- `ZERO_ADDRESS`: mix of scaffold-eth local constant and viem `zeroAddress` across nextjs;
  ponder/keeper mostly on viem after cleanup.

---

## 4. Informational — Cleanup verified correct

These cleanup items were **re-verified and look correct**:

| Area | Finding |
| --- | --- |
| Removed `setVotingEngine` stubs | No TS/governance/e2e call sites; tests for revert behavior deleted |
| `ClusterPayoutOracle.proposerBond` | Removed from contract; test harness deleted; ABI ghost remains (H1) |
| `LaunchRaterRewardLib.launchRewardCredentialAnchorId` | Removed; test repointed to `launchHumanIdentityKey()` |
| Ponder dedup | `buildCommitKey`, `PAYOUT_DOMAIN_QUESTION_REWARD`, `PONDER_NETWORK_CHAIN_IDS`, viem zero helpers — type-check clean |
| Next.js dedup | `useVoterAccuracyBatch` deleted; browser `createQuestionDetailsId` / `sha256Hex` shared; dead exports removed |
| Governance | `content-set-bonus-pool` removed from `GovernanceActionComposer.tsx` |
| Certora / ponder handlers | No references to removed events/fields |
| Prior audit H1 | `confiscateBannedReward` now in ABI ✓ |

---

## 5. Carry-over from `repo-audit-2026-06.md` (not re-audited exhaustively)

The June 13 **correctness** audit flagged Ponder and spec-consistency items that appear
**still open** and were **not** addressed by the cleanup commits. Spot-check only:

| ID | Theme | Spot-check |
| --- | --- | --- |
| 2.1–2.2 | Refund handlers mislabel pools / inflated `allocatedAmount` | `QuestionRewardPoolEscrow.ts` still sets `refunded: true` on partial paths (~166, ~423) |
| 2.3 | `FeedbackBonusAwarded` missing replay guard | `FeedbackBonusEscrow.ts:58` — `onConflictDoNothing` on award insert, no event-id replay guard visible |
| 2.4 | `HumanCredentialRevoked` provider hardcoded | Not re-verified line-by-line |
| 3.1 | Identity ban unreachable without confidentiality bond | Behavioral; not changed by cleanup |
| 3.2 | Payout claim-weight vs committed leaf set | Documented optimistic-oracle tradeoff; unchanged |

Treat these as **separate follow-up** from cleanup verification; full re-audit of Ponder
economics was out of scope for this pass.

---

## 6. Recommended remediation order

1. **Regenerate ABIs** from current Foundry artifacts and add CI parity gate (**H1**).
2. **Finish pre-deploy scaffolding** — drop `bonusPool` slot or document + strip from ABI
   (**M1**).
3. **Unify x402 allowlists** between agents and nextjs (**M2**).
4. **Investigate test flakiness** — isolate heavy distributor/engine branch tests (**M6**).
5. **Extend `protocol.ts`** with confidentiality, USDC map, bounty masks; add Solidity
   `IdentityKeyLib` / `RewardAssets` (**M3**, **M4**).
6. **Address contract size warnings** before mainnet (**M5**).
7. **Revisit Ponder findings** from `repo-audit-2026-06.md` §2 (**§5 carry-over**).

---

## Severity summary

| Severity | Count | Primary theme |
| --- | --- | --- |
| **High** | 1 | Stale generated ABIs after cleanup |
| **Medium** | 6 | Partial scaffolding, x402 drift, constant duplication, test flakiness, contract size |
| **Low** | 3 | Promo sync ops, deferred scaffolding, import style |
| **Info** | 1 | Cleanup mechanically correct; prior Ponder items still open |

---

*Audit date: 2026-06-13. Labels: "verified" = re-checked against source by compiler;
"spot-check" = sampled, not exhaustively reproduced. No files were modified.*
