# RateLoop Tokenless Incentive and Integrity Reintegration Plan

**Date:** 13 July 2026
**Status:** Normative amendment for the next paid tokenless deployment. The currently deployed disposable v2 scoring
mechanism remains useful as a baseline, but it is not approved for a real-money RateLoop-network or hybrid panel.
This plan does not restore LREP, rater stake, governance, the legacy challenge oracle, or any operator path to funds.

## Decision

The tokenless redesign was right to remove LREP, rater staking, token governance, and the legacy
`ClusterPayoutOracle` settlement dependency. It went too far when it replaced the vote-linked RBTS information score
with prediction accuracy alone and reduced correlation analysis to shallow post-round counters.

The next paid tokenless deployment should implement this narrower integrity stack:

1. **World ID 4 Proof of Human is the initial uniqueness provider for RateLoop-network reviewers.** It is required for
   the RateLoop-network subpanel of a network or hybrid paid run. It remains optional for a customer-invited panel,
   whose provenance must say that customer selection is not proof of uniqueness or independence. World ID is an
   off-chain, server-verified admission capability; it does not enter the Base fund core.
2. **Replace the current prediction-only bonus with a genuine binary RBTS score.** Every valid reveal receives fixed,
   guaranteed USDC base compensation. A separately funded, bounded, non-negative bonus uses both the reported vote
   and the crowd prediction. There is no stake, loss, or negative balance.
3. **Reintroduce correlation epochs as prospective admission and evidence inputs, not payout oracles.** A point-in-time
   integrity manifest diversifies assignments before a round and a post-round check controls whether the verdict is
   publishable, inconclusive, or must be rerun. Neither check changes deterministic pay for accepted work.
4. **Do not restore the legacy surprise-weighted bounty formula.** First compute a per-round Surprisingly Popular
   diagnostic from the panel's own predictions. Publish it beside, not instead of, the raw preference share. Promote it
   into a small fixed bonus only if a preregistered benchmark demonstrates value beyond the RBTS bonus.
5. **Keep Self optional and later.** Self can add selective document predicates such as minimum age and country rules
   after provider-composition, privacy, conversion, and procurement gates pass. It does not replace World ID's initial
   open-network uniqueness role and does not add a Self/Celo dependency to `TokenlessPanel`.

This is not a promise that a mechanism can manufacture truth. It is a layered design for sealed independent judgment,
stronger incentives to report a private signal, one-person admission, group-risk controls, and explicit uncertainty.

## What the current branch actually does

### The current bonus does not incentivize the vote

[`TokenlessScoring`](../packages/foundry/contracts/tokenless/libraries/TokenlessScoring.sol) computes:

```text
peerUpShare_i = (totalUpVotes - vote_i) / (revealCount - 1)
accuracy_i    = maxSquaredError - (prediction_i - peerUpShare_i)^2
```

Because `totalUpVotes - vote_i` is exactly the sum of everyone else's votes, a rater can flip their own vote while
holding the other reports and their prediction fixed and receive the same score. The payout therefore rewards a
prediction about peers, but the own vote is payoff-irrelevant. An attentive rater, a random clicker, and an attacker
can submit different votes with identical personal payout incentives.

The five prediction buckets also keep every valid score positive. A maximally wrong bucket still receives a material
share of the normalized 20% pool, and the 80% equal pool dominates the result. This is understandable for accepted-work
protection, but it means the current mechanism should not be described as truth serum or as an answer-integrity control.

### The current correlation metric is not behavioral correlation

The tokenless transparency pipeline currently labels the difference between reveal, assignment, and response counts as
`correlationRiskBps`. It labels the number of distinct provider-subject hashes as `independentClusters` and detects
only exact duplicate response hashes as answer-fingerprint risk. Those are useful provenance checks, but they do not
cluster connected reviewers, detect coordinated answer patterns, or estimate panel capture.

The design of record calls for off-chain correlation and answer-fingerprint analytics, but the legacy feature graph,
point-in-time epoch scorer, and cluster-aware assignment logic are absent from the active package graph. Paid network
and hybrid assurance are already fail-closed for other reasons; they should remain so until the controls in this plan
are connected end to end.

### What the legacy stack did better

The legacy `RobustBtsMath` combined two proper quadratic components:

- a **prediction score** for predicting a randomly selected peer's signal; and
- an **information score** in which the rater's own reported signal changes a shadow prediction derived from another
  rater's prediction.

That at least made the own signal economically relevant. The legacy correlation scorer also built deterministic
clusters from snapshotted identity, account, funding, timing, operator, and repeated-behavior features, then reduced
effective weight for connected participants.

### What should not return unchanged

The legacy system also carried costs and trust assumptions that are incompatible with the tokenless target:

- LREP stake, forfeiture, token governance, frontend bonds, challenge bonds, arbiters, governance vetoes, and recovery
  paths made the fund flow difficult to explain and introduced privileged decisions around payouts;
- correlation payout roots delayed claims and allowed an off-chain scorer plus dispute process to determine how much
  each accepted rater earned;
- public cross-round identity keys and account-linked feature artifacts weakened the per-round pseudonymity goal; and
- the old surprise formula compared same-side agreement with a trailing cross-round vote rate. It did not compare the
  current answer share with what the current panel predicted, so it was not the canonical Surprisingly Popular rule
  despite the product name.

The old implementation is a source of tested math, failure cases, and fixtures—not an architecture to cherry-pick back.

## Security properties must stay separate

| Property | Question | Primary control | Explicit limitation |
|---|---|---|---|
| Sealed independence | Can a rater copy visible momentum? | tlock commit/reveal and hidden assignment | Does not stop off-platform coordination |
| Unique admission | Is one provider subject admitted once? | World ID 4 plus RateLoop nullifiers and voucher caps | A unique human can still collude or answer badly |
| Relevant qualification | Is the reviewer suitable for this task? | Cohort policy, practice, gold items, customer criteria | Identity assurance is not expertise |
| Truthful-report incentive | Does own payoff depend on an honestly reported private signal? | Binary RBTS fixed bonus | Guarantees depend on model assumptions and do not remove bad equilibria |
| Group independence | Are many reports controlled or coordinated together? | Prospective integrity epochs, diversified assignment, post-round analytics | New or off-platform collusion can evade detection |
| Fund integrity | Can RateLoop redirect or claw back earned money? | Immutable USDC core and deterministic non-negative settlement | Admission remains an operator trust point for future commits |
| Verdict integrity | Is this panel result safe to show as evidence? | Pending-integrity state, risk reasons, rerun/remediation | A publishable panel is evidence, not objective truth |

World ID addresses unique admission. RBTS addresses individual reporting incentives under assumptions. Correlation
controls address connected behavior. None is a substitute for the other two.

## Target mechanism: tokenless binary RBTS

### Scope

Apply the mechanism only to a binary judgment or one member of a head-to-head comparison. Score hybrid and materially
different cohorts as separate subpanels. Do not compute one peer-prediction score across groups with different
information, incentives, or selection rules.

Use the mechanism where reviewers plausibly observe correlated private signals about a shared latent property, such as
clarity, preference under a frozen audience definition, policy adherence, or comparative quality. Do not claim the
same theoretical assumptions for heterogeneous taste surveys, expert domains with asymmetric information, or questions
where the buyer has selected a conflicted panel.

### Report

Keep the existing sealed report shape:

```text
{ vote, predictedUpBps, responseHash, payoutCommitment, nullifier, voucher }
```

The prediction remains hidden with the vote. The contract accepts predictions from 1% through 99%. Before freezing the
production UI, benchmark the current five buckets against an 11-bucket control and a 1%-step slider. A coarse bucketed
variant can be useful, but it must be named `coarse-rbts` and described as an approximation rather than inheriting the
strict incentive claim of the continuous mechanism.

### Peer selection

After the reveal set is frozen, derive a seed that was unpredictable at commit time and produce a deterministic
permutation. For every rater, select:

- one distinct reference report whose prediction creates the shadow prediction; and
- one distinct peer report whose binary signal is scored.

For three reveals, the two other raters fill those roles. For larger panels, the permutation must give every eligible
report equal selection probability, prevent self-selection, avoid duplicate reference/peer selection, and be fully
recomputable. Bind the seed to chain ID, panel address, round ID, frozen reveal-set hash, and a post-closure randomness
source. If the randomness source fails, valid revealers receive guaranteed base pay and the unused bonus refunds; no
operator supplies a replacement seed.

### Score

Use a versioned port of the legacy binary RBTS math after an independent mechanism review:

```text
shadow_i      = shadow(referencePrediction, vote_i)
information_i = quadratic(shadow_i, peerVote)
prediction_i  = quadratic(prediction_i, peerVote)
rbts_i        = (information_i + prediction_i) / 2
```

The information component is the missing link between the rater's own signal and pay. Keep the 1% and 99% endpoint
bounds that prevent degenerate shadow predictions. Commit the exact formula, peer-selection rule, probability grid,
rounding, and worked examples in the scoring-version hash.

### Funding and payout

Do not divide a fixed bonus pool in proportion to the total score. Normalizing by other raters' scores changes the
payoff function away from the fixed proper scoring rule. Instead quote and fund per seat:

```text
maximum rater pay = fixedBasePerReveal + fixedMaxRbtsBonusPerReveal
actual rater pay  = fixedBasePerReveal
                  + fixedMaxRbtsBonusPerReveal * rbtsScoreBps / 10_000
```

Suggested initial economic envelope: keep the current 80/20 maximum split—80% fixed base and at most 20% RBTS bonus—
until experiments justify a different ratio. Unused seat funds and unused score bonus return to the funder; they are not
redistributed among other raters. This preserves non-negative, understandable pay and avoids turning a proper score into
a tournament.

The attempt-reserve, no-post-commit-cancellation, under-quorum compensation, beacon-failure, claim, dust, and stale-share
invariants remain controlling. A valid reveal is accepted work and always reaches fixed base compensation. A low score
can reduce only the disclosed optional bonus; it can never create a loss, debt, clawback, or eligibility reversal.

### Result aggregation

The raw binary preference share remains the primary descriptive panel result. RBTS score controls the optional bonus,
not the vote weight, in the first production version. The decision packet reports:

- raw vote share and sample size;
- disagreement and missing/invalid cases;
- prediction calibration and score distribution;
- the mechanism version and exact recompute inputs;
- reviewer-source, assurance, qualification, and integrity-epoch summaries; and
- a separate client `go`, `revise`, or `stop` decision.

Do not call the majority, RBTS score, or client decision “truth.”

## Surprise: restore the signal, not the legacy bounty formula

The current report already collects the data needed for a per-round Surprisingly Popular diagnostic. For each side,
compare its actual panel share with the panel's mean predicted share for that side. Use leave-one-out values only for
per-rater diagnostics where self-influence matters. Report the answer whose actual share exceeds its predicted share by
the larger preregistered margin, subject to minimum sample and numerical guards.

Phase 1 is shadow-only:

- compute it from the current panel's predictions, never from a trailing cross-question base rate;
- show raw share, predicted share, surprise ratio, sample size, and whether the threshold was met;
- do not silently replace the majority result;
- do not alter pay; and
- evaluate whether it preserves expert/minority signals or merely amplifies noise.

Only create `scoring-v2` with a separate surprise bonus if the shadow evaluation improves preregistered external or gold
outcomes beyond RBTS alone. If promoted, fund it as another small fixed maximum per rater or case; never as a variable
share of other raters' earnings, and never above the guaranteed base.

## Correlation integrity epochs without a payout oracle

### Purpose

An integrity epoch is a point-in-time, versioned snapshot used for:

1. reviewer eligibility and probation;
2. cluster-diversified panel assignment;
3. a frozen record of which information existed before assignment;
4. post-round behavioral and answer-fingerprint analysis; and
5. decision-packet limitations and rerun decisions.

It is never an input that can reduce or redirect the current round's fixed base or deterministic RBTS bonus.

### Manifest

Create a signed, content-addressed `rateloop-integrity-epoch-v1` manifest:

```text
{
  epochId,
  cutoffAt,
  sourceWindow,
  featureSpecHash,
  parameterHash,
  scorerBuildHash,
  privateLeafRoot,
  aggregateClusterCounts,
  eligibleReviewerCount,
  excludedReviewerCount,
  signerKeyId,
  createdAt
}
```

Private leaves contain an epoch-specific rater pseudonym, cluster pseudonym, risk band, eligibility status, and reason
codes. Raw identifiers and features remain encrypted in a purpose-separated vault. Public or buyer-visible evidence
contains only the manifest hash, parameters, aggregate panel cluster histogram, largest-cluster share, World-ID-capable
count, and disclosed limitation codes. Do not publish account, World session, nullifier, device, IP, payout, referral,
or rationale mappings.

The epoch hash and assignment constraints are included in the frozen audience policy whose hash is already bound into
round terms and vouchers. The contract still verifies only the exact policy hash and one-per-round nullifier; the
credential issuer remains an admission trust point but gains no settlement discretion.

### Features

Begin with explainable, consented, point-in-time signals:

- provider-subject uniqueness and account-binding conflicts;
- repeated account, recovery, payout-destination, referral, and invitation relationships where collection is lawful;
- privacy-minimized device/network risk signals with short retention, never raw long-lived IP histories;
- assignment co-occurrence and suspicious timing similarity;
- historical answer-agreement residuals after controlling for question and cohort;
- exact and near-duplicate rationale fingerprints, with the private text kept encrypted; and
- gold-question, attention, appeal, and qualification history.

Separate hard duplicate evidence from probabilistic behavioral similarity. Protected attributes, nationality, tax data,
and sanctions material must not become clustering features. Complete a DPIA and feature-by-feature retention decision
before production collection.

### Pre-round assignment

For a RateLoop-network subpanel:

1. require a current World ID capability and the exact paid/qualification policy;
2. select only from the frozen epoch cutoff—no future data or current-case answers;
3. sample randomly within the eligible cohort;
4. enforce a default maximum of one reviewer per detected high-confidence cluster;
5. enforce per-identity, per-customer, and recent co-assignment caps;
6. keep assignments and panel membership hidden until the response window closes; and
7. fail closed or request an explicit weaker-independence buyer amendment when supply cannot satisfy the policy.

For a hybrid run, construct and report customer-invited and RateLoop-network subpanels separately. Do not use World ID
or cluster weighting to make a customer-named cohort appear independent.

### Post-round verdict gate

Settlement and rater pay continue immediately through the contract. The buyer-visible result moves through:

```text
settled -> pending_integrity -> publishable
                             -> inconclusive_rerun_required
                             -> delisted_with_reasons
```

Post-round checks compare the frozen epoch with current-round timing, answer agreement, rationale fingerprints,
assignment provenance, and voucher/reveal counts. A suspicious panel can trigger a fresh independently sampled rerun,
a fee refund under the bounded remediation policy, or a decision-packet warning. It can never erase accepted work,
change its score, or transfer rater money to the operator or buyer.

### Verifiability and appeals

Ship a deterministic recompute tool for the manifest and post-round checks. An authorized auditor can receive selectively
disclosed private leaves and verify them against the root. Record scorer build, parameters, source cutoff, exclusions,
manual review, and appeal outcomes. A rater may appeal future-eligibility restrictions; an appeal does not reopen a
settled round or expose another rater's data.

## World ID 4 initial integration

### Product rule

- **Required:** RateLoop-network reviewers and the network subpanel of a paid hybrid run.
- **Optional by frozen policy:** customer-invited reviewers and unpaid private panels.
- **Not sufficient for:** expertise, age, residence, tax status, sanctions clearance, payout ownership, or behavioral
  independence.

World ID Proof of Human supplies the `unique_human` capability. Fresh-presence or document credentials are separate
capabilities and must never be inferred from Proof of Human alone.

### Flow

1. The signed-in RateLoop account requests a short-lived, single-use RP context from the server.
2. The server signs the exact World ID 4 action with the RP signing key. Never expose that key to the browser.
3. IDKit 4 requests `proof_of_human`, binds the request to a RateLoop-generated account/session context, and uses a new
   v4-only action with `allow_legacy_proofs: false`.
4. The browser forwards the untouched IDKit response to RateLoop.
5. RateLoop verifies it through `POST /api/v4/verify/{rp_id}`, verifies the original nonce/action/environment/context,
   atomically consumes the RP state, and rejects a reused nullifier.
6. RateLoop stores only encrypted provider evidence plus HMAC-separated subject/nullifier/session references needed for
   duplicate prevention and continuity. It stores no biometric, proof plaintext, or public provider identifier.
7. A successful verification writes a time-bounded `world:poh:unique_human` capability. Voucher issuance evaluates that
   capability together with qualification and paid-eligibility evidence under the frozen audience policy.

Use World ID 4 session proofs for returning-user continuity rather than repeatedly treating an unlimited action as a
new uniqueness proof. Keep provider evidence, RateLoop account identity, vote/nullifier seeds, tax records, and customer
artifacts in separate key domains. Public receipts reveal capability satisfaction and aggregate counts only.

### Required schema correction

The current `tokenless_capability_eligibility` row combines one provider, identity capabilities, tax, sanctions, payout,
cohort, and eligibility state. That cannot safely compose World ID uniqueness with a different legal/payout provider or
later Self predicates.

Replace it with:

- `tokenless_provider_subject_bindings`: one encrypted/HMAC-bound subject per provider/RP namespace and RateLoop rater;
- `tokenless_assurance_assertions`: many time-bounded provider assertions per rater, with capabilities and encrypted
  evidence;
- `tokenless_legal_eligibility`: adulthood, declared/tax residence, DAC7, sanctions decision, and expiry;
- `tokenless_payout_eligibility`: account ownership and payout readiness;
- `tokenless_reviewer_qualifications`: source, cohort, gold/practice, and task qualifications; and
- a policy evaluator that composes unexpired evidence by capability and allowed provider instead of assuming one global
  provider satisfies every requirement.

Retain uniqueness constraints on `(provider, RP namespace, subject HMAC)` and on one voucher per rater/round. A later
provider must not silently replace or merge a World subject. Cross-provider deduplication remains explicitly unsolved.

### Secrets and outage behavior

Add separate server-only roles and fail-closed guards for:

- `WORLD_ID_RP_SIGNING_KEY`;
- the provider-evidence HMAC/encryption key domain;
- the tokenless credential signer; and
- thirdweb browser authentication.

`WORLD_ID_APP_ID` and `WORLD_ID_RP_ID` may be delivered as public configuration; the RP signing key never has a
`NEXT_PUBLIC_` form. A World outage blocks new or freshness-required admission but never affects an accepted commit,
settlement, claim, or previously earned payout.

## Self as a later composed provider

After the multi-provider schema and World flow are stable, Self may supply narrowly requested document predicates:

- `minimum_age` without date of birth;
- supported-document or document-uniqueness capability;
- excluded-country predicates where legally and product-relevant; and
- an OFAC/watchlist signal as one input to RateLoop's sanctions process, subject to legal and semantic validation.

Use backend verification, bind the proof's user identifier/context to the RateLoop account, require frontend/backend
configuration equality, and request the minimum disclosure. Do not store name, document number, full birth date,
nationality, or issuing country unless a separately documented requirement needs it. Do not treat document country as
residence or tax residence.

Self remains optional until production coverage, conversion, support, pricing, data-processing terms, error semantics,
revocation, retention, and false-positive handling pass review. No Self contract or Celo dependency enters the Base
fund core. A Self document subject and a World PoH subject cannot be assumed to represent the same human.

## Threat model after reintegration

| Attack | Control after this plan | Residual risk |
|---|---|---|
| Random clicking | Fixed RBTS bonus, gold/practice history, rationale checks | Base pay still compensates accepted work; sophisticated random strategies can pass some checks |
| Copying visible votes | Sealed commit/reveal and hidden assignment | Off-platform communication remains possible |
| One person, many accounts | World ID for network supply, provider-subject uniqueness, per-round nullifier | Provider compromise, account rental, and multiple real colluders remain |
| Coordinated real-human ring | Diversified epoch assignment, co-behavior/rationale analysis, pending verdict, rerun | A new low-and-slow ring may evade detection |
| RBTS uninformative equilibrium | Random peer selection, gold anchors, cohort separation, empirical monitoring | Peer prediction has multiple equilibria; no formula removes all collusion |
| Funder self-dealing | External/network cohort provenance, frozen manifest, conflict disclosure, client sign-off | A buyer can still choose biased cases or invited reviewers |
| Malicious issuer | Public issuance counts, policy-bound vouchers, alarms, epoch rotation | Issuer can censor or mint future voters; it cannot alter accepted commits or funds |
| Malicious correlation scorer | Deterministic manifest, recompute, appeals, no payout influence | It can affect future access or publication until detected |

## Dependency-ordered implementation plan

Each numbered item is one intended commit. Preserve deletion, contract, schema, service, app, generated-artifact, and
deployment boundaries.

### Phase 0 — freeze the mechanism and benchmark

1. **`docs(mechanism): reopen tokenless integrity decisions`**
   Adopt this amendment across the design of record, human-assurance plan, PMF caveats, readiness gate, public claim
   vocabulary, and threat model.
2. **`test(mechanism): codify the prediction-only baseline`**
   Add an executable property proving the current score is invariant to the rater's own vote, plus payout-range and
   random-click fixtures. This is the baseline, not a regression to preserve in the replacement.
3. **`feat(mechanism): add an offline RBTS and attack simulator`**
   Port the legacy pure math into an isolated package; simulate honest reporting, nearest-bucket prediction, random
   clicks, constant-report equilibria, coordinated minorities/majorities, selective reveal, heterogeneous priors, and
   seeded correlation rings. Version fixtures and publish worked examples.
4. **`docs(mechanism): freeze tokenless-rbts-v1`**
   Obtain mechanism/security review and freeze probability input, score, peer permutation, randomness, fixed base/max
   bonus, refund/dust behavior, result semantics, and failure fallback before Solidity changes.

### Phase 1 — compose identity and ship World ID

5. **`refactor(db): separate assurance legal and payout evidence`**
   Add the multi-provider tables and backfill current synthetic/test data without weakening paid fail-closed behavior.
6. **`refactor(eligibility): compose capability assertions`**
   Replace the one-provider `EligibilityProvider` assumption with provider adapters and capability-specific policy
   requirements. Preserve purpose-separated vaults and exact policy hashing.
7. **`feat(identity): verify World ID 4 Proof of Human`**
   Add server RP signatures, v4-only IDKit request/verification, account/context binding, atomic nullifier replay
   protection, encrypted session continuity, capability mapping, expiry, rotation, and outage behavior.
8. **`feat(audience): require World ID for network panels`**
   Update policy schemas, buyer labels, reviewer onboarding, receipts, and fail-closed voucher issuance. Keep invited
   reviewer rules separate.

### Phase 2 — prospective correlation integrity

9. **`feat(integrity): snapshot privacy-safe integrity epochs`**
   Add point-in-time sources, private feature vault, deterministic clustering, manifest/root generation, signing,
   retention, reason codes, and recompute fixtures. Do not port the old oracle or public identity artifacts.
10. **`feat(audience): diversify epoch-bound assignments`**
    Bind the epoch and cluster constraints into frozen policies, randomize selection, cap detected clusters and recent
    co-assignment, and fail closed when supply cannot meet the buyer-approved independence policy.
11. **`feat(evidence): gate verdicts on post-round integrity`**
    Replace the current count-mismatch `correlationRiskBps` with versioned analytics; add pending/publishable/
    inconclusive/delisted states, rerun/remediation, aggregate evidence, and appeals. Prove no code path changes payout.

### Phase 3 — replace the fund-core score

12. **`feat(contracts): add tokenless binary RBTS math`**
    Add pure scoring/permutation libraries with endpoint, self-peer, seed, rounding, and reference/peer property tests.
13. **`feat(contracts): fund fixed base and maximum score bonuses`**
    Replace total-score pool normalization, add post-closure seed state, preserve permissionless paginated settlement and
    every terminal-payment invariant, and extend stateful invariants for conservation and issuer/scorer isolation.
14. **`feat(indexer): index RBTS settlement evidence`**
    Replace tokenless Ponder/keeper event and status handling; add independent recomputation and bounded pagination.
15. **`feat(app): explain base bonus and integrity states`**
    Update rater input/receipts, buyer quotes/results, SDK schemas, agent results, webhooks, and offline evidence verifier.
16. **`chore(deploy): publish a fresh isolated tokenless bundle`**
    Regenerate ABIs and the deployment schema only after the final contract commit; deploy all isolated services against
    one fresh complete key. Never repoint tokenless code to the v2 artifact or legacy projects.

### Phase 4 — surprise shadow and optional Self

17. **`feat(analytics): shadow per-round surprisingly-popular results`**
    Add versioned per-round predicted-versus-actual diagnostics, minimum sample guards, evidence output, and benchmark
    reports with no payout or primary-verdict effect.
18. **`feat(identity): add optional Self document predicates`**
    Only after the provider and procurement gates pass, add backend minimum-age/document/country verification with data
    minimization and no fund-core dependency.
19. **`docs(mechanism): decide scoring-v2 from evidence`**
    Either keep RBTS-only, promote a bounded fixed surprise bonus in a fresh deployment, or remove the prediction input
    if it does not beat equal-pay panels. Never change the rule for an already funded round.

## Verification and release gates

### Contract and mechanism properties

- changing the own vote can change the information score under a fixed valid peer/reference fixture;
- truthful signal and truthful/nearest-bucket prediction maximize expected score in the reviewed model fixtures;
- no rater is their own reference or peer, selection is order-invariant, and the final draw is unpredictable at commit;
- fixed base pay is independent of score and other raters' scores;
- the maximum bonus is bounded per seat and unused bonus refunds rather than redistributes;
- total paid plus refundable credits never exceeds funded USDC;
- under-quorum, dead-beacon, takedown, partial processing, transfer failure, stale claim, and retry paths preserve accepted
  work and liveness;
- credential, World, integrity, keeper, and operator keys cannot transfer, redirect, reduce, or claw back panel funds; and
- mixed v2/new-scoring deployment keys fail closed.

### Identity properties

- RP signatures are server-only, scoped to the exact action, nonce, origin, account context, environment, and expiry;
- replayed nullifiers, consumed state, duplicate provider subjects, account rebinding, stale proofs, legacy-protocol
  downgrade, malformed responses, and provider mismatch fail closed;
- World outage affects only new/fresh admission and never accepted commitments;
- logs, analytics, receipts, webhooks, and public evidence contain no raw proof, nullifier, session ID, provider subject,
  document field, or cross-round identity mapping; and
- customer-invited, network, hybrid, and sandbox evidence remain visibly distinct.

### Correlation properties

- the same frozen inputs and parameters produce the same manifest/root regardless of input order;
- every feature is point-in-time at the cutoff, retained under a named purpose, and excluded when stale or unavailable;
- high-confidence cluster caps hold under concurrent reservation and retry;
- seeded duplicate, timing, co-assignment, and rationale rings reach the expected reason codes without using protected or
  legal-eligibility data;
- changing the integrity result cannot change contract payout or claimability; and
- appeal and manual-review actions are auditable and cannot rewrite the original epoch.

### Empirical go/no-go gate

Preregister the benchmark and power analysis before collecting outcomes. Compare equal pay, current prediction-only,
and tokenless RBTS on matched low-risk/gold tasks. At minimum measure:

- gold/external outcome accuracy where a defensible reference exists;
- random-click and seeded-collusion payout discrimination;
- completion, abandonment, time, comprehension, and prediction calibration;
- repeatability, minority-signal preservation, and score/payout concentration;
- World verification completion and failure reasons; and
- correlation detection recall and false-positive/appeal rates on seeded and natural clusters.

Suggested launch threshold: RBTS must materially improve at least one preregistered integrity outcome over equal pay,
with no more than a five-percentage-point completion loss and no severe payout-concentration or comprehension failure.
The integrity scorer must catch all high-confidence duplicate fixtures and achieve a separately preregistered behavioral
ring target without an unacceptable false-positive or appeal-overturn rate. Freeze the exact statistical thresholds only
after pilot size and base rates are known; do not retrofit them after seeing results.

If RBTS does not win, retain World ID, sealed voting, qualification, fixed pay, correlation-diversified panels, and
integrity-gated results, but remove the prediction input. If correlation analytics cannot reach an acceptable error rate,
limit panel value, use two independently sourced subpanels, and describe the result as vulnerable to coordinated humans.

## Public claim boundary

Until this plan is implemented and externally benchmarked, say:

> RateLoop collects sealed independent judgments and publishes recomputable panel evidence.

After World ID and the integrity epochs are live, it may add:

> RateLoop-network panels use proof-of-human admission and cluster-diversified assignment, with disclosed limitations.

After the reviewed RBTS implementation and benchmark pass, it may add:

> A bounded prediction-based bonus rewards reports under RateLoop's published binary scoring rule.

Do not say “truth serum guarantees honesty,” “Sybil-proof,” “collusion-proof,” “independent humans,” or “truth” without
the precise provider, cohort, mechanism version, empirical evidence, and limitations beside the claim.

## References

- [Witkowski and Parkes, A Robust Bayesian Truth Serum for Small Populations](https://ojs.aaai.org/index.php/AAAI/article/view/8261)
- [Kong, Schoenebeck, and Ligett, Putting Peer Prediction Under the Micro(economic)scope](https://schoeneb.people.si.umich.edu/papers/PeerFocal.html)
- [Prelec, Seung, and McCoy, A solution to the single-question crowd wisdom problem](https://www.nature.com/articles/nature21054)
- [World ID 4 integration](https://docs.world.org/world-id/idkit/integrate)
- [World ID 4 migration and uniqueness/session distinction](https://docs.world.org/world-id/4-0-migration)
- [World ID Proof of Human credential](https://docs.world.org/world-id/credentials/1)
- [Self backend verifier](https://docs.self.xyz/backend-integration/selfbackendverifier-api-reference)
- [Self selective disclosures](https://docs.self.xyz/use-self/disclosures)
