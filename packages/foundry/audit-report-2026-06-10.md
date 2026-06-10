# RateLoop / Curyo — Smart Contract Security Audit — 2026-06-10

**Scope:** ~23k LOC of Solidity across `packages/foundry/contracts/` (17 contracts + 28 libraries), focused on the delta since the 2026-05-17 audit — 381 commits touching contracts, dominated by: World ID v4 credential rechecks & launch identity aliases, credential-mask bounty eligibility, RBTS seed refresh/settlement liveness, launch-distribution-pool changes, oracle challenge/rejection splitting (metadata-vs-root, same-frontend-challenge blocking, rejected-root replay blocking), reward-distributor rotation with frontend-fee preservation, and dormant-round commit guards.

**Method:** Multi-agent review — domain-focused finder agents (funds-flow/escrow, reward-distribution/launch/fees, voting-core, RBTS/reveal/settlement, advisory, identity/World-ID, content/bounty/profile, oracle, X402/frontend/media, governance/config/upgrade) plus a research agent surveying 2025-2026 exploit patterns. Every surviving finding was then **manually verified against source** by the lead (reading the cited code paths, call sites, and access control end-to-end) before inclusion. The World ID v4 presence finding was surfaced **independently by two agents**, raising confidence.

**Baseline:** prior audits at `audit-report-2026-05-04.md`, `-05-16.md`, and `-05-17.md`. The two prior Mediums (M-Vote-4 sampler bias, M-Oracle-2-Followup `firstClaimPaid`) were re-verified this pass and are **confirmed fixed and not regressed** (see below). Findings already documented there are excluded unless their fix broke.

**Deployment status:** Not deployed in production. Fresh-redeploy assumed (no live-state storage-migration concerns). Nothing here is exploitable today; all are pre-mainnet correctness/defense-in-depth gaps.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| **Medium** | **2** |
| Low | 1 |
| Informational | 2 |

The two Mediums are both in **code added since the last audit**: the World ID v4 presence-recheck feature and the same-frontend oracle-challenge hardening. Neither breaks base sybil resistance or moves funds directly; both weaken a defense-in-depth control the new feature was sold on. The Low is a **regression** of a previously-fixed issue (the L-Vote-5 advisory-cooldown migration helper was removed and never replaced).

---

## Medium findings

### M-1 — World ID v4 presence-recheck does not bind to the credential holder's nullifier; one live human can keep many farmed credentials "fresh"

**File:** `RaterRegistry.sol:919-992` (`attestHumanPresenceWithV4Proof`); compare the base path `_attestWorldCredentialWithV4Proof:835-873`. Introduced by `27497e06` / `d32dba2c` (World ID v4 rechecks).

The presence path records per-kind freshness (`_humanPresence[msg.sender][kind]`, surfaced as the `freshMask` / `BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG` bit via `hasRecentCredentialRecheck`) after verifying a v4 proof whose **signal binds only to `(msg.sender, kind)`** (`worldPresenceSignalHash`, line 933). Unlike the base-credential path, it performs **none** of the nullifier-discipline checks:

- It never compares the proof's `nullifier` (a caller-supplied argument, line 921) against the rater's base-credential nullifier. The base path explicitly reverts on mismatch (`RaterRegistry.sol:851-856, 863-869`).
- It never enforces nullifier→owner uniqueness. The base path does (`857-860, 870-871`). The mapping clearly intended for this — `_usedWorldPresenceNullifier` (line 108) — **is dead: declared but never read or written anywhere in the codebase** (verified by grep). Only the per-proof replay key `_usedWorldPresenceProof` is used.
- It never checks the revoked-nullifier set.

The only gate is `hasActiveCredentialKind(msg.sender, kind)` (line 927) — the caller must already hold the base credential of that kind. A World ID prover can endorse **any** signal (the signal is an arbitrary message, not the prover's identity), so a single live human can produce a valid presence proof for **any** credentialed address's signal.

**Nuance considered:** the presence config (`_worldPresenceConfigs`) carries its own `rpId`/`action` (`setWorldPresenceV4Config:556-579`), independent from the credential config. Because World ID nullifiers are scope-derived, the presence-proof nullifier and the base-credential nullifier may *legitimately* differ, so strict nullifier-equality is only correct if the two configs share a scope. **Regardless of that choice, the absence of any presence nullifier→owner uniqueness check is the load-bearing gap:** one human (nullifier `Np`) can sign presence proofs for the signals of addresses `A1, A2, A3…`, marking each `_humanPresence[Ai][kind]` fresh, because nothing records that `Np` was already spent.

**Impact.** `freshMask` flows into recheck-gated bounty eligibility (consumed by `QuestionRewardPoolEscrow` qualification/claim/bundle paths). An operator controlling many credentialed addresses (multiple seeded/lent/farmed base credentials) can keep them all RECENT_RECHECK-eligible using a *single* recurring human, defeating the liveness gate recheck-bounties rely on. It does **not** let an uncredentialed account vote (each address still needs a nullifier-bound base credential), so it degrades rather than fully bypasses sybil resistance — Medium, not High. Severity scales with how heavily recheck-gating is used as an anti-dormancy control.

**Fix.** Wire the dead `_usedWorldPresenceNullifier[kind][storedNullifier]` mapping: on attestation, reject if the nullifier is already owned by a different address (mirroring `_worldCredentialNullifierOwner` discipline), and bind the presence nullifier to the base credential's nullifier where the configs share scope. If scopes intentionally differ, at minimum enforce per-presence-nullifier→owner uniqueness so one human cannot freshen multiple accounts. Add a negative test: a presence proof whose nullifier is owned by another rater (or differs from the base credential) must revert.

### M-2 — A bonded frontend operator can censor a specific oracle challenger by binding them as its snapshot proposer (consent-free)

**File:** `ClusterPayoutOracle.sol:1130-1145` (`_requireDisinterestedChallenger`), `317-336` / `533-552` (challenge entrypoints); `FrontendRegistry.sol:354-367` (`setSnapshotProposer`), `522-537`. The disinterested-challenger guard was added by `808570b3` and extended by `9e2c7701`.

The same-frontend-challenge hardening blocks a challenge when the challenger equals the proposer, the frontend operator, or the **proposal-time** snapshot proposer (`proposalTimeSnapshotProposer`, the `9e2c7701` fix that captures the bound proposer at propose time so it can't be retroactively weaponized). **But it then also performs a *live* read** — `frontendRegistry.isAuthorizedSnapshotProposer(frontendOperator, challenger)` (line 1142) — and reverts if true. This live check re-introduces the very post-proposal mutability the `proposalTimeSnapshotProposer` snapshot was added to close.

`FrontendRegistry.setSnapshotProposer(address proposer)` lets a bonded, non-slashed frontend operator bind **any** address as its snapshot proposer with **no consent** from the target. The only constraints (lines 360-364): the target must not be address(0), must not itself be a registered frontend, and must not already be assigned to a *different* frontend. An honest challenger EOA satisfies all three. The victim cannot self-detach — `clearSnapshotProposer` is operator-only.

**Attack.** A malicious eligible frontend proposes a poisoned root/epoch directly as operator (so `proposalTimeSnapshotProposer` is address(0) or itself and the snapshot check at line 1138 doesn't fire). When a known honest challenger `X` (e.g. the protocol's own monitoring keeper, or a public watchdog) tries to challenge within the window, the operator calls `setSnapshotProposer(X)`. Now `isAuthorizedSnapshotProposer(operator, X)` returns true and `X`'s `challengeRoundPayoutSnapshot` / `challengeCorrelationEpoch` reverts with `InvalidSnapshot()`.

**Impact.** Targeted censorship of the permissionless-challenge layer: a pre-identified watchdog/keeper address can be blocked from challenging a poisoned snapshot, narrowing the defense from "permissionless economic challenge + 7-day arbiter veto" to "arbiter only" against that address.

**Caveats (why Medium, not High).** `setSnapshotProposer` overwrites the previous binding, so **only one address is blockable at any instant** — a challenger can simply use a fresh address. Persistently blocking *each* challenge attempt requires front-running every challenge tx with a re-bind, which is unreliable on the target single-sequencer L2s (Optimism/Base/World Chain) where there is no public mempool to watch. The realistic impact is blocking a *known, fixed* watchdog address until operators notice and rotate.

**Fix.** Drop the live `isAuthorizedSnapshotProposer` check at `ClusterPayoutOracle.sol:1142-1144` and rely solely on `proposalTimeSnapshotProposer` (already captured at propose time and not retroactively mutable) — this preserves the anti-self-challenge intent while removing the censorship primitive. Alternatively, require target consent (two-step accept) in `FrontendRegistry.setSnapshotProposer`.

---

## Low findings

### L-1 — Advisory 24h cooldown resets across an advisory-vote-recorder rotation (regression of L-Vote-5; migration helper removed)

**File:** `AdvisoryVoteRecorder.sol:863-886` (`_validateAdvisoryCooldown`), `133-134` (recorder-local timestamp maps). Migration helpers `migrateAdvisoryCooldown` / `migrateAdvisoryCooldownByIdentity` were added by `b3b429e6` (the L-Vote-5 fix) and **removed by `09517132` ("Bind advisory votes to holder identity")**; they do not exist today (verified by grep).

`_validateAdvisoryCooldown` takes the max of (a) the voting engine's persistent real-vote cooldowns (`votingEngine.voteCooldownTimestamps`, which survive recorder rotation) and (b) the recorder's **own** `lastAdvisoryVoteTimestamp[content][voter]` maps. The advisory↔advisory and advisory↔real linkage lives **only** in (b). On `protocolConfig.setAdvisoryVoteRecorder(R2)`, the new recorder's maps are empty, and rounds opened post-rotation snapshot `R2`.

**Impact.** After a governance recorder rotation, the 24h advisory cooldown resets to zero for any voter whose most recent action in a content was an *advisory* commit (voters whose last action was a *real* vote are unaffected — engine state persists). A sybil can immediately re-commit advisory votes, farming launch-credit-eligible advisory positions faster than intended across the rotation window. Bounded to a rare governance event and to zero-stake advisory credit, hence Low — but it re-introduces a previously-fixed, explicitly-documented issue with no migration path and no rotation test.

**Fix.** Either (a) reinstate the migration helpers and enforce migrate-before-rotate as a runbook invariant; (b) wire a `previousRecorder` reference so the new recorder ORs in the prior recorder's advisory timestamps; or (c) move advisory cooldown timestamps into the (non-rotated) voting engine so the recorder only writes through. Add a rotation regression test asserting the advisory cooldown survives `setAdvisoryVoteRecorder`.

---

## Informational

- **I-1** — `RaterRegistry._usedWorldPresenceNullifier` (line 108) is dead storage (declared, never read/written). Wire it as part of the M-1 fix, or remove it; it currently occupies a word in the `__gap`-accounted layout for nothing.
- **I-2** — `ClusterPayoutOracle` still trusts a single `ARBITER_ROLE` (carried forward, prior I-Oracle-2). The new rejection-splitting and disinterested-challenger logic is correct but the arbiter is the last line of defense; migrate `ARBITER_ROLE` to a multisig/DAO before opening the proposer set.

---

## Prior Mediums — re-verified fixed, not regressed

- **M-Oracle-2-Followup (`firstClaimPaid`):** FIXED. `QuestionRewardPoolEscrow.isRoundPayoutSnapshotConsumed` returns `snapshot.firstClaimPaid` (`:1214`), flipped only inside `_claimQuestionReward` after the first actual paid claim (`:781-782`), not at `qualifyRound`. The oracle's out-of-veto rejection gate defensively defaults `consumed=true` on a failed consumer read but only permanently kills the slot when the consumed state is known. Sound.
- **M-Vote-4 (sampler bias):** FIXED via the report's *preferred* remediation. `RoundRevealLib.sol:531-547` now draws reference/peer indices directly over the revealed subset (`revealedKeys`/`revealedCount`); the biased forward-scan `_advanceToRevealed` is gone and the seed is reveal-independent. The `fd7564f9` RBTS-seed change touched the same file but only entropy capture, not the sampler.

---

## Items checked and confirmed sound

Areas the agents validated this pass without finding exploitable issues:

**Oracle / integrations**
- Rejected-root replay blocking (`rejectedCorrelationEpochRoots` / `…RootKeys`, `ClusterPayoutOracle.sol:274-278, 442-462, 1123-1128`) correctly prevents identical re-proposal of rejected roots (`10ded66c`).
- Metadata-vs-root rejection split (`969536f0`) is correct; epoch-artifact-URI bound into the rejection digest (`330bd274`).
- EIP-3009 / x402 `transferWithAuthorization` binding (chainid + registry + escrow + gateway + payer + payee + value + payload) remains comprehensive; gateway-controlled receive-and-forward flow; no replay across the `e3c8156e` escrow-refresh path.
- Merkle `payoutWeightLeaf` built from typed in-contract fields with `block.chainid` + `address(this)` binding; per-leaf verification isolates bad leaves (no 64-byte secondary-preimage, no bad-leaf-locks-tree).

**Funds flow / rewards**
- Distributor rotation preserves `feeCreditorForEngine[oldEngine]` (`FrontendRegistry.sol:440-441`); `creditFees` has four independent binding checks; `_requireFrontendFeeCreditorConfigured` reverts if the snapshot registry's creditor ≠ the distributor (`RoundRewardDistributor.sol:826-841`). `rewardClaimed` / `bundleRoundSetRewardClaimed` keys remain disjoint — no double-claim.
- Launch double-earn via shared credential closed by binding earning to the nullifier owner (`LaunchDistributionPool.sol`, `5ef0841d`); migrated launch credentials cannot re-earn.

**Voting / RBTS**
- `fd7564f9` replaced the predictable `_fallbackRbtsSeed` (grindable from on-chain-known values) with a hard `RbtsSeedUnavailable` revert; the seed is now a future-block blockhash re-anchored via permissionless `refreshExpiredRbtsSeed` within the 256-block window (`RoundRevealLib.sol:287-343`) — net security gain, liveness preserved (fail-closed on expiry).
- Dormant/stale-round commit replay blocked by `_requireRoundContentLifecycleActive` on the commit path (`5a71d471`).
- Base World ID v4 credential verify enforces per-kind nullifier ownership, prior-nullifier match, and revocation checks (`RaterRegistry.sol:849-872`).

**Governance / upgrade**
- `_disableInitializers()` present on upgradeable contracts; `__gap` accounting balanced under fresh-redeploy. (See Watch item below for the RaterRegistry layout.)

---

## 2025-2026 attack-pattern checklist (research agent)

| Pattern | Source / year | Status |
|---|---|---|
| EIP-3009 / x402 auth front-run & replay | tlay.io, OpenZeppelin 2025-2026 | Mitigated — comprehensive nonce/payload binding, gateway-controlled flow. |
| UMA optimistic-oracle whale capture / rejected-root replay | Polymarket disputes, orochi.network 2025 | Mitigated + hardened this cycle; one new gap (M-2, challenger censorship). |
| Merkle-airdrop double-claim / distributor-rotation fee theft | Cyfrin CodeHawks 2025 | Mitigated — fee-creditor preserved across rotation, disjoint claim keys. |
| World ID v4 nullifier reuse / aliasing / launch double-earn | world.org v4 spec 2025-2026 | Mostly mitigated; **presence-recheck gap = M-1**. |
| L2 sequencer reorg / prevrandao grind vs commit-reveal | arXiv 2506.01462, Flashbots Superchain 2025 | Mitigated, improved (RBTS seed now future-blockhash, fail-closed). |
| Dormant/stale-round commit replay | commit-reveal hygiene | Mitigated (`5a71d471`). |
| ERC-2612 permit front-run grief on `commitVoteWithPermit` | Universal Router pattern | Unchanged Low (prior L-Vote-7); not exploited in delta. |
| Merkle 64-byte secondary-preimage / bad-leaf-locks-tree | sciencedirect 2024-2025 | N/A — typed in-contract leaf, per-leaf verification. |
| UUPS slot-collision on storage refactor | OWASP SC10:2026 | **Watch** — RaterRegistry's large storage rewrite (`27497e06`) reworked `worldId*` slots and `__gap` (`[40]→[31]`). Fine under fresh-redeploy; add a `RaterRegistry` layout-stability test before any future upgrade. |

---

## Recommended remediation order

1. **Before mainnet** — M-1 (wire the dead `_usedWorldPresenceNullifier` / bind presence to credential owner) and M-2 (drop the live `isAuthorizedSnapshotProposer` check, or require proposer-bind consent). Both are small, localized fixes to recently-added code.
2. **Before mainnet** — L-1: restore advisory-cooldown rotation safety (reinstate migration or move timestamps to the engine).
3. **Before opening the proposer set** — I-2: migrate `ARBITER_ROLE` to a multisig.
4. **Anytime, low cost** — I-1: remove or wire the dead presence-nullifier slot; add the `RaterRegistry` layout-stability test.

## Suggested test additions

- Presence proof whose nullifier is owned by a different rater (or differs from the base credential) must revert (M-1).
- After binding an honest challenger via `setSnapshotProposer`, that challenger's challenge must still succeed once the live check is removed (M-2 regression guard).
- Advisory cooldown survives `setAdvisoryVoteRecorder` rotation (L-1).
- `RaterRegistry` storage-layout stability test (I-1 / UUPS Watch).

---

## Methodology note

The initial full multi-agent run (10 finders + per-finding adversarial verifiers) repeatedly tripped the account's session/rate limit and did not converge; three finder domains completed and were cached (escrow/claims: clean; identity/World-ID: clean; advisory: L-1). The remaining seven domains plus the research survey were re-run as a single lean parallel wave that completed cleanly, and **every reported finding was then manually verified against source by the lead** rather than by agent verifiers. The World ID v4 presence finding (M-1) was independently surfaced by both the content/bounty finder and the research agent.

*All paths relative to `packages/foundry/contracts/` unless otherwise noted.*
