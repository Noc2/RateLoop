# RateLoop Incentives Remediation Plan — July 2026

**Scope:** `M-1 (incentives)`, `M-2 (incentives)`, and `Low / Informational (incentives)` from `docs/design-review-2026-07.md`.

**Deployment assumption:** the current contract deployment can be discarded, and the frontend can point at a newly deployed stack. Prefer clean contract/API changes over migration gymnastics.

**UX constraint:** do not fix these items by increasing UX-waiting parameters: no higher default `minSettlementVoters`, no longer `epochDuration`/`maxDuration`, no longer reveal grace, no extra challenge window for ordinary claims, and no mandatory oracle wait where the flow can remain synchronous. The fast 3-voter feedback tier should survive; it just must not pretend to have full score-spread economics.

If the fresh-deployment branch includes the `PAYOUT_DOMAIN_RBTS_SETTLEMENT` / domain-5 oracle-backed settlement path, treat it as the production incentive path and document the resulting wait explicitly. Globally routing RBTS settlement through a payout snapshot improves detected-cluster resistance, but adds snapshot-pending UX; the operational work is to make the pending state visible, monitored, and bounded by a clear timeout runbook rather than pretending settlement is instantaneous.

## Commit 1 — M-1 product decision: keep bounty eligibility creator-controlled

- **Goal:** askers should be able to choose the bounty size and payout scope they want. Everyone can still answer the question by default; Proof-of-Human bounty eligibility remains an optional creator-selected scope, not a protocol-imposed threshold.
- **Contract plan:** keep `bountyEligibility` validation limited to supported policy bits. Do not map asset/amount/non-refundable status to a required credential in `ContentRegistryRewardLib.validateSubmissionReward`, `QuestionRewardPoolEscrowPoolActionsLib._validateStoreInputs`, or `QuestionRewardPoolEscrowBundleActionsLib`.
- **Identity binding:** keep the existing submitter/funder exclusion, but treat payer identity as a first-class snapshot at content/reward creation: raw payer address, resolved holder, and identity key should all be excluded from claiming. If the payer is not verified, that should not block ask creation; it only means the payer cannot later appear as an eligible verified claimant unless they are the same excluded identity.
- **Claim path:** rely on the existing commit-time credential snapshot (`commitIdentityState` / `QuestionRewardPoolEscrowEligibilityLib.isCommitEligibleForBounty`) only when the creator selected credential-gated payout eligibility. Cluster/correlation weights remain useful defense-in-depth for payout shares.
- **Frontend, SDK, and agent plan:** update submit UI, browser handoff, MCP, SDK, and x402 validation so omitted `bountyEligibility` defaults to `0` for everyone and explicit `0` is accepted at any bounty size. Result packages should still distinguish "all answers" from "bounty-eligible answers" so askers see the full crowd and any selected payout scope.
- **Tests:** Foundry tests for direct `ContentRegistry`, escrow, and bundle creation preserving high-value open bounties; existing credential-gated qualifying/paying tests; payer/submitter identity exclusion; and bundle parity. TypeScript tests for agent/schema/UI/SDK defaults and explicit open eligibility.
- **Why this does not make users wait longer:** the protocol no longer adds a credentialing task at a bounty threshold. Creators may still select Proof of Human when they want that payout scope.
- **Accepted residual economics:** large open-eligibility bounties remain recapture-exposed by design. A creator can register a bonded frontend and route independent-looking wallets through it to recover more of the bounty and, after the 1-hour fee withdrawal window, even the frontend fee; participant floors raise the number of wallets needed, not the marginal cost per bounty dollar.

## Commit 2 — Fix M-2: make surprise weighting cluster- and anchor-aware

- **Goal:** preserve the useful part of surprise weighting — rewarding genuinely predictive low-base-rate answers — while removing the "flood the rare side and all receive 2x" payoff.
- **Scoring plan:** change `surpriseBpsForVotes` / `baseWeightForVote` in `packages/node-utils/src/correlationScoring.ts` from an independent per-voter cap to a side-and-cluster budget:
  - compute each vote's raw surprise as today;
  - group votes by detected cluster and side;
  - cap each cluster's aggregate surprise bonus on a side to at most one fully independent vote's max bonus, then allocate that budget across members by reveal weight;
  - multiply any remaining bonus by a verified-anchor factor when the side's within-round share is far above its trailing base rate but has little verified-human or high-independence support;
  - keep the flat neutral floor for missing surprise inputs and for launch-credit domains.
- **Parameter/versioning plan:** add explicit parameters such as `surpriseClusterBudgetBps`, `surpriseVerifiedAnchorMinBps`, and `surpriseFloodDivergenceBps`; include them in `correlationParameterHash`, artifacts, verifier checks, and generated docs. Bump the scorer/spec version so old artifacts are not silently reused.
- **Oracle/artifact plan:** update `correlation-artifact-builder`, `correlation-artifact-verifier`, Ponder payout-proof serialization, and keeper tests so the new reasons explain whether a bonus was reduced by cluster budget or weak verified anchoring.
- **Tests:** unit tests proving a coordinated cluster on the rare side gets no more aggregate surprise bonus than one independent rater; independent verified raters on a genuinely surprising side still earn the intended bonus; unverified rare-side floods collapse toward neutral; bundle and question reward domains match; parameter hashes change; verifier rejects old reason/weight roots.
- **Why this does not make users wait longer:** it is a pure scoring/artifact change. It keeps the same round duration, reveal timing, claim windows, and base-rate lookback. Raters do the same work; the payout math is less gameable.

## Commit 3 — Fix Low: remove the vestigial parimutuel payout story

- **Goal:** stop implying that the binary losing pool drives payouts. `upWins` is still the public round verdict, but RBTS score-spread settlement, not parimutuel majority loss, determines LREP forfeits/rewards.
- **Contract/API plan for the clean redeploy:** either remove `losingPool` from `RoundSettled` and generated ABIs, or rename/index it as `binaryLosingStakeForTelemetry` if downstream analytics still need it. Keep `upWins` because external consumers and result packages need the verdict. Rename local variables/comments around `binaryLosingPool` so future readers do not infer payout semantics.
- **Docs/indexer plan:** update `how-it-works`, `smart-contracts`, `tech-stack`, public `skill.md`, result package copy, Ponder schema/handlers, and E2E helpers to describe the binary verdict separately from score-spread economics.
- **Tests:** ABI/typegen snapshot updates; Ponder event ingestion tests; docs fact tests if present; E2E settlement helpers asserting `upWins` still flows to the UI/result package.
- **Why this does not make users wait longer:** it is semantic cleanup plus optional event shape cleanup for the redeploy. No timing parameter changes.

## Commit 4 — Fix Low: make 3-7 revealer rounds an explicit fast-feedback tier

- **Goal:** keep fast low-turnout rounds, but remove the dead-zone expectation that 3-7 revealer rounds have meaningful LREP score-spread incentives.
- **Contract plan:** add an explicit settlement mode derived from the round config: rounds whose configured `minVoters` is below `SCORE_SPREAD_FORFEIT_MIN_REVEALS` are `FeedbackOnly` by default. In `FeedbackOnly` rounds, either reject nonzero LREP stake at commit time or return stake without computing score-spread rewards, and emit a clear settlement-mode flag. Full `ScoreSpread` economics remain available when the asker/front-end intentionally configures an 8+ voter economic round.
- **Bounty plan:** bounty payouts still work in fast rounds; Commit 1 handles high-value claimant eligibility. This keeps the product's quick feedback experience while ensuring the LREP stake UI does not imply a reward/forfeit game that will not activate.
- **Frontend/agent plan:** hide or disable positive LREP stake on fast-feedback questions, label them as bounty/feedback rounds, and let askers opt into 8+ voter economic settlement only when they explicitly want stronger LREP incentives.
- **Tests:** Foundry tests for zero-stake fast rounds settling at 3-7 reveals, nonzero stake rejection or full return in `FeedbackOnly`, unchanged 8+ score-spread behavior, and bounty claims in fast rounds. UI/agent tests proving default asks keep the fast tier and economic-round opt-in is explicit.
- **Why this does not make users wait longer:** defaults stay fast. The plan does not raise the minimum voter floor; it makes the economic mode honest. Users who want score-spread economics can opt into 8+ voters knowingly.

## Commit 5 — Fix Low: replace sequencer-influenced pairing entropy without adding a new wait

- **Status:** required for the fresh redeploy posture. Do not treat a future-blockhash or sequencer non-grinding assumption as the launch model.
- **Goal:** prevent a centralized L2 sequencer from biasing RBTS reference/peer pairings through the delayed blockhash.
- **Contract plan:** derive `scoreSeed` from precommitted voter entropy instead of a future blockhash: accumulate a `roundRevealEntropy` hash from `(commitKey, salt)` during reveal, combine it with the settlement-closed `scoringSetHash`, `chainid`, engine address, content ID, round ID, and a version string, and use that seed for `_rbtsOtherIndex` / `_rbtsPeerIndex`. The salt is already bound into the commit hash, so the sequencer cannot choose it after seeing the scoring set; censorship remains possible but no longer gives direct pairing choice.
- **Compatibility plan:** remove the one-block delayed-seed state machine for the redeployed engine, or keep it only as a fallback when no reveal entropy exists. Update event names/comments so `RbtsSeedCaptured` no longer suggests blockhash dependence.
- **Tests:** commit/reveal hash tests proving salt binding; settlement tests showing the same revealed set produces the same seed independent of blockhash; sampler distribution/fuzz tests; and a regression that an unrevealed commit cannot enter the entropy or scoring set after settlement closure.
- **Why this does not make users wait longer:** it removes the delayed-blockhash dependency and can only shorten settlement. No new randomness beacon, VRF callback, challenge period, or extra transaction wait is introduced.

## Commit 6 — Fix Low: tighten advisory/launch farming at the credit layer

- **Goal:** keep launch/advisory incentives useful while making slow unverified farms and two-anchor collusion less profitable.
- **Launch/advisory scoring plan:** apply the same cluster independence accounting used by bounty artifacts before unverified launch/advisory credits count toward earned LREP. Add per-anchor and per-cluster credit budgets so two verified anchors cannot repeatedly bootstrap the same unverified cluster to the cap. Keep verified referral rewards gated by World ID nullifier uniqueness as-is.
- **Contract/off-chain plan:** update `LaunchDistributionPool`, `AdvisoryVoteRecorder`, keeper artifact generation, and result package labels so unverified credits carry an explicit `effectiveCreditBps` and reason hash. If bytecode pressure is tight, put the heavy clustering in the existing oracle artifact path and have contracts verify weights.
- **Tests:** unverified sybil cluster earns fractional credit; repeated use of the same verified anchors hits the per-anchor/per-cluster budget; independent verified humans retain full launch credit; existing referral cap behavior is unchanged.
- **Why this does not make users wait longer:** it reduces credit amounts for correlated activity, not eligibility timing. No additional revealers, epochs, or claim delays are required.

## Commit 7 — Fix Informational: align docs, prompts, and result wording with the actual math

- **Goal:** remove the remaining "mean prediction" and parimutuel wording drift everywhere a rater, asker, agent, or integrator learns the protocol.
- **Docs/product plan:** update `docs/design-review-2026-07.md`, `packages/nextjs/app/(public)/docs/how-it-works/page.tsx`, `smart-contracts`, `tech-stack`, `docs/ai`, `packages/nextjs/public/skill.md`, SDK/agents READMEs, MCP tool guidance, and result package copy to consistently say: public verdict = binary weighted signal; LREP economics = leave-one-out mean of RBTS scores; below 8 score-eligible revealers = fast feedback/bounty tier, not score-spread economics.
- **Tests:** snapshot or text tests for public docs where available; agent schema/help tests for generated instructions; result package tests for the wording and fields exposed to agents.
- **Why this does not make users wait longer:** documentation only.

## Commit 8 — Fix Informational: lower honest-rater variance once score-spread economics are active

- **Goal:** reduce the chance that an honest accurate rater at the 8-reveal threshold forfeits due to one unlucky reference/peer draw.
- **Contract plan:** once `revealedCount >= SCORE_SPREAD_FORFEIT_MIN_REVEALS`, score each report against multiple deterministic reference/peer draws from the same seed and average the RBTS score. Start with a small fixed sample count, e.g. 3, with distinct sampled peers when the revealed set allows it. Keep 3-7 revealer `FeedbackOnly` rounds out of score-spread economics per Commit 4.
- **Gas/complexity guard:** cap the sample count and fuzz gas for 8/25/100/200 revealers. If the on-chain cost is too high for the redeploy target, do not silently add multi-sample scoring to the default `PAYOUT_DOMAIN_RBTS_SETTLEMENT` path; keep multi-sample scoring for an explicit high-assurance mode, or defer it while retaining the existing snapshot-weighted stake-accounting path.
- **Tests:** deterministic multi-sample scoring tests; no duplicate self/peer draws; gas snapshots; simulation-style TS tests showing lower honest-score variance at 8 revealers; unchanged stake cap and max-forfeit behavior.
- **Why this does not make users wait longer:** it reuses the same settled revealed set and seed. The tradeoff is gas or oracle-artifact complexity, not user waiting time.
