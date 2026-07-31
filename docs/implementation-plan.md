# RateLoop tokenless — implementation plan

Rewritten 31 July 2026 from six research passes into the question that matters: **what
should this be, so that an enterprise wants it and can be made to need it?**

Effort is days for one experienced engineer.

---

## 1. What the product is

**An audit-grade measurement instrument for AI output quality.**

Not a review workflow that emits evidence. A measurement instrument whose output is one
defensible number about a whole population of agent outputs — and whose review workflow
is merely how the measurement gets taken.

The distinction is the whole plan. Every evaluation product on the market records **what
you looked at**. This one records **what you did not look at, and with what
probability** — which is the definition of a sampling frame, and the only thing from
which a defensible population estimate can be built.

---

## 2. The moat is the sampling frame, and it is currently broken

`adaptiveCoverageExport.ts` emits a per-decision record for **every eligible output,
including the ones nobody reviewed**, carrying the selection probability, the sample
bucket, the sampler commitment, the key version and the reason codes — written inside
the same transaction as the decision, **before the outcome was known**.

Nothing else in the category has this. It is also, today:

- **Broken in production.** `adaptiveReview.ts:182` stores the HMAC as bare hex;
  `adaptiveCoverageExport.ts:19` requires a `sha256:` prefix. **Every real row throws on
  export.** The test passes because it hand-builds fixtures rather than driving the
  decision path. One-line fix, and nothing else here matters until it lands.
- **Capability-flagged false**, so it cannot be mentioned publicly.
- **Never used to weight anything.** Every published rate is an unweighted count.
- **Not third-party verifiable**, because the sampler key is a permanent environment
  secret.

### What is genuinely hard, and what only looks hard

The pitch must rest on the first list.

**Hard, and done:** the twelve-dimension scope partition and its migration lineage on
live data; transactional correctness around the decision, with row locks, statement
timeouts, idempotent replay and an append-only policy log wrapped around the sampling
draw; the execution manifest with canonical commitments and a validated span DAG; an OTLP
receiver with a hand-written protobuf decoder where prompt payloads are _structurally
unrepresentable_; a Rekor inclusion-proof verifier with correct domain separation; a
hash-chained audit log that refuses to export on mismatch; and the anti-overclaiming
machinery — a regex gate over marketing copy, unearned tiers made unrepresentable in the
type system, and a CI test forbidding inference by package prefix across thirteen source
roots.

**Only looks hard:** the sampler itself is twenty lines of feature-flag bucketing. The
stage ladder is four states and three thresholds. **The Merkle trees are decorative** —
the full leaf list ships inside the packet and there are no inclusion proofs, so a signed
digest of the leaf array would be equivalent. The GRC connectors are about a hundred
lines of REST. "Nine hosts" is nine documentation entries whose tier gates nothing but a
badge colour. The framework adapters are 176 lines across two frameworks, neither of
which imports its framework.

---

## 3. The evidence standard, which is the product specification

Four converging sources define what "real" human review means, far more specifically than
any statute:

1. **Named, competent, authorised reviewers.** The Amsterdam Court of Appeal found
   against Uber partly because it could not establish the reviewers' qualifications.
2. **Demonstrated non-trivial engagement.** Cigna's medical directors averaged **1.2
   seconds per claim** across 300,000+ denials in two months. That is the anti-pattern,
   and it is measurable.
3. **Evidenced override capability and actual overrides.** Under the SCHUFA line, a
   reviewer who never disagrees is itself evidence of rubber-stamping; formal decision
   authority does not cure determinative influence.
4. **A reconstructable per-decision record.** Hamburg fined a firm €492,000 for being
   unable to explain a decision when asked — not for the decision.
5. **A working contest route.** Foodinho's specific failure, twice, at €2.6M then €5M.

**The founding case is Uber.** It _had_ human review. It lost because the court asked what
the human actually did and Uber could not show it. The question was never "was there a
human?" but **"prove what the human did."**

Three of those five map onto things this codebase already computes and does not surface:
decision-time percentiles exist, override decisions are recorded and never aggregated, and
the attestation model already stores competence basis, training records and authority
scope with expiry.

**Sell the evidentiary claim. Do not sell prevention.** No public evidence exists, in
either direction, that sampled review prevents AI failures. Abundant evidence exists that
inability to demonstrate review is independently punished.

---

## 4. Where this is needed, not merely wanted

**Health-plan utilization review, sold as review _assurance_, not review substitution.**

California SB 1120 requires a licensed physician competent in the specific clinical issue
to make every adverse medical-necessity determination, and bars an AI tool from denying or
delaying care. Arizona, Texas, Nebraska and Maryland passed comparable laws in 2025; CMS
requires the same for Medicare Advantage.

The obligation is per-case, so sampling cannot satisfy it. **What sampling can do is prove
the mandated per-case review was genuine rather than a batch click** — which is precisely
what the vertical is being sued over.

- **Regulators already have audit authority in the statute and nothing to audit with.**
  InterQual and MCG supply clinical criteria, not review-quality evidence. The category is
  empty.
- **The quality gap is public and quantified:** 52.8M prior-authorisation determinations
  in Medicare Advantage in 2024, 4.1M denied, an **11.5% appeal rate against an 80.7%
  overturn rate**.
- **The pain is already priced in litigation** — a class action proceeding since March
  2025, and a court ordering disclosure of a denial algorithm in March 2026.
- The qualified human is legally defined and expensive, with reviewer quotas reported at
  one case per four minutes.

**Second: FINRA communications supervision** — the cleanest _legal_ fit anywhere, because
sampling is permitted by rule, written evidence of review is mandatory by rule, and the
qualified reviewer is defined by rule. It ranks second because the archive and workflow
are owned by entrenched suites. **One tension to resolve first:** FINRA requires evidence
of review to identify the reviewer, and the evidence packet deliberately carries reviewer
identities as counts only. The privacy architecture and this vertical are in direct
opposition.

**Third: pharmacovigilance**, where EMA guidance literally names "routine sampling of data
for manual classification" as the monitoring mechanism — but it is non-binding, and EMA
designates the area as deliberately flexible.

**The commercial argument that needs no mandate:** ISO introduced a generative-AI exclusion
for commercial general liability in January 2026, with 60+ carriers filing to adopt it,
while no AI-specific policy has publicly paid a claim. Enterprises are being told their
existing cover no longer responds — which converts review evidence from a compliance
line-item into a retained-risk control.

---

## 5. The two-week version

| #   | Task                                                        | Days |
| --- | ----------------------------------------------------------- | ---- |
| 1.1 | Fix the coverage-export hash format                         | 0.5  |
| 1.2 | Replace the fixture test with one that drives the real path | 0.5  |
| 1.3 | Golden test vector for the sampler manifest                 | 0.5  |
| 1.4 | Horvitz–Thompson weighted estimator                         | 3–4  |
| 1.5 | The one screen                                              | 2    |
| 1.6 | Sampling disclosure + claim-gate rule                       | 1    |

**1.3 matters more than its size.** The current test asserts only self-consistency, so
reordering the manifest string would silently re-roll every bucket in production with a
green suite. For a construction whose entire claim is that the draw is fixed, that is the
wrong test.

**1.5 — the single screen that sells this.** Two numbers side by side:

> Sampled agreement: 96.2% (n=740)
> **Population estimate: 88.1% (95% CI 84.3–91.4%)** > _The sampled figure is biased upward because coverage was reduced on scopes that were
> already agreeing._

A vendor telling a risk officer their own headline number is wrong, and then showing the
correct one, is the most persuasive thing available here. Give it its own top-level route
and its own auth path — not a tab inside an engineer's workspace.

**On the estimator.** Horvitz–Thompson over the recorded selection probabilities, and
Begg–Greenes for any sensitivity or specificity figure. **Do not use Rogan–Gladen** — it
assumes strata defined by the human label, this design stratifies by the machine's, and
simulated on realistic numbers it returned an endorsement rate of 4.53 against a truth of
0.85. Intervals via Korn–Graubard, because weighting produces non-integer counts the
Wilson helper rejects. Forced strata carry probability 1 by construction, so they weight
correctly for free — but report the forced share, because a mostly-deterministic design is
not a probability sample and saying so is the point.

**Where the design does not support an estimate, return a coverage gap rather than a
number.** Manual and rules modes record zero selection probability; for those scopes the
honest output is always a gap. Treat that as the common case, not an edge case.

---

## 6. The six-month version: a draw that could not have been rigged

The move that changes the category, reusing code already in the repository.

Rotate the sampler key per epoch. Publish the **hash** of the next epoch's key to a
transparency log _before_ the epoch opens. Publish the **key itself** after the epoch
closes. Anyone can then recompute every bucket for that period and confirm which outputs
were selected — and that the operator could not have chosen them after seeing outcomes.

Stronger still: **seed the epoch key from a future drand round**, so the operator cannot
grind the key at all. The beacon client already exists.

**That is the difference between "we sampled honestly" and "we could not have sampled
dishonestly."** It is the only claim here that no competitor can answer by shipping a
feature, and it is why the deterministic-decision boundary stops being a restriction and
becomes the reason the number is admissible.

| #   | Task                                                      | Days |
| --- | --------------------------------------------------------- | ---- |
| 2.1 | Epoch key rotation + pre-commitment to a transparency log | 8–10 |
| 2.2 | Beacon-seeded key derivation                              | 3–4  |
| 2.3 | Override analytics — the rubber-stamp detector            | 2    |
| 2.4 | Engagement measurement per reviewer and scope             | 2–3  |
| 2.5 | Sample a fraction of automated `pass` and `fail`          | 7–8  |
| 2.6 | Anchor the audit chain                                    | 2    |
| 2.7 | Compliance-reader entry point                             | 5    |
| 2.8 | Typed packet schema on DSSE + RFC 8785 canonicalisation   | 5    |

**2.3 and 2.4 are the Uber and Cigna findings turned into features**, and both are close
to free. Override decisions are already recorded and never aggregated; decision-time
percentiles are already computed. Together they answer "prove what the human did", which
is the question the case law actually asks.

**2.5 needs its ordering respected.** Audit-sampled reviews must be excluded from the
adaptive coverage window _before_ the weighted estimator reads it, or the estimator
computes weights over a population the audit then changes. Make the audit a **one-way
ratchet**: it may force a reset to full coverage, never a promotion.

**2.8 changes digests.** Do it before anyone depends on them. The repository already
implements DSSE correctly, and there are currently six divergent hand-rolled canonical-JSON
implementations.

---

## 7. What to delete

Roughly **40% of the codebase — around 55,000 lines — serves a reviewer marketplace that
will not run.** It is the strongest engineering in the repository and it serves a lane that
is switched off, gated behind an evidence lock nobody will satisfy, and legally hazardous
to open.

- The paid lane, settlement, vouchers, identity assurance, wallet screening, tax
  declaration and the on-chain stack — contracts, keeper, indexer, chain and rater modules,
  and the 56 associated tables. **Keep only the drand beacon client**, which becomes the
  seed for §6.
- Crowd forecast, surprise bounty and feedback bonus — sophisticated reviewer-scoring
  machinery for a lane that does not exist.
- **The Merkle trees, or fix them.** Today the leaves ship inside the packet and there are
  no inclusion proofs, so they imply more than they deliver. Either ship a proof API or
  replace them with a signed leaf-list digest.
- The host support tier, unless the smoke harness is actually run. A tier that gates only a
  badge colour is an unevidenced claim, in a codebase whose best property is refusing to
  make those.

Follow the deletion order recorded in the contributor guide.

---

## 8. What not to build

**Judge calibration as the headline.** The category is served — Galileo ships a
first-class calibration UI, and the category leader publishes a "best human-in-the-loop
evaluation platforms" listicle. Keep it as a _data source_ inside the measurement
instrument, where the probability frame makes the confusion matrix defensible in a way
theirs cannot be. Do not make it the pitch.

**A flight recorder for agent executions.** Langfuse, Arize, Braintrust, Datadog and Weave
all ingest OTLP GenAI traces. Provable payload exclusion is a differentiator inside a
bigger story, not a wedge.

**An LLM evaluator anywhere in scoring, routing or triage.** The determinism boundary is
airtight and CI-enforced; breaking it would make reviewer management an Annex III(4)(b)
system with RateLoop as provider. One hole to close: the boundary test scans one package's
source directory but not its scripts directory, which is exactly where the repository's
only outbound model call lives.

**Reviewer scorecards without a per-workspace off switch.** Per-reviewer performance
measurement is worker monitoring, and German works-council co-determination under
§87(1)(6) BetrVG means a customer cannot deploy it without an agreement. It must be
switchable off, not merely disclaimed.

**An MCP "get a human to sign off" tool.** Nearly free given the existing servers, which is
why it is tempting. It is also precisely the product HumanLayer abandoned while OpenAI
shipped native approve-and-resume.

---

## 9. Sequence

| Order | Work                                         | Days  |
| ----- | -------------------------------------------- | ----- |
| 1     | 1.1–1.3 — make the frame load and stay fixed | 1.5   |
| 2     | 1.4, 1.5 — the estimator and the screen      | 5–6   |
| 3     | 1.6 — disclosure and claim gate              | 1     |
| 4     | 2.3, 2.4 — override and engagement analytics | 4–5   |
| 5     | 2.1, 2.2 — the verifiable draw               | 11–14 |
| 6     | 2.7 — compliance-reader entry point          | 5     |
| 7     | 2.5 — stratified automated-eval sampling     | 7–8   |
| 8     | 2.6, 2.8 — anchoring and schema              | 7     |
| 9     | Deletion pass                                | —     |

**Rows one and two are the product.** Everything after row three makes it defensible
rather than merely correct.

### Ordering hazards

- **2.5 before any weighting that reads its output**, never in parallel.
- **One migration in flight at a time.** `0164` is taken; the next is `0165`.
- **Copy fixes now span four files**, because public strings moved into message catalogs
  and the German translations are already written. Editing a page component alone breaks no
  test and leaves the other language asserting the old claim.
- **The claim-gate walker never scans the message catalogs.** Adding a rule without
  extending it certifies English and ignores German — worse than no gate.
- **Fix the locale-dependent canonicalisation before publishing any verifier.** Key
  ordering uses locale comparison, so two machines can derive different digests for the
  same packet.

---

## 10. What this plan does not claim

Recorded because the codebase's best property is refusing to let the pitch outrun it, and
this document should hold to the same standard.

- **Not that sampled review prevents failures.** No public evidence supports that.
- **Not that any regulator prescribes a sampling rate.** None does; FINRA says so
  explicitly.
- **Not that the evidence is legally privileged.** Signed evidence is admissible and
  carries no presumption without a qualified timestamp.
- **Not that blinding or independence hold on the live lane.** They do not — the swap flag
  is hardcoded false and reviewers are customer-invited and customer-named.
- **Not that "we cannot prove what happened" is a named buyer category.** It is not; no
  major survey isolates it. That is both the opportunity and the sales-cycle risk.
