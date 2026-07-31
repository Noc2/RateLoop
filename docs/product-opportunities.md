# RateLoop tokenless — what to build next

Written 29 July 2026 against `d49862fa3`. Companion to
[business-plan.md](business-plan.md). This is the "make it more interesting" list:
work that would change what a customer can do or decide to pay for.

Defects and honesty fixes live in [remediation-plan.md](remediation-plan.md). This list
assumes those are handled separately.

**Ordering principle:** revenue mechanics first, because a product that cannot take
money has no other priorities. Then the things that make it worth paying for. Then the
things that make it survivable at scale.

---

## A. Nothing here works until money can move

### A1. Turn on Stripe

Two environment flags default to false. Minutes of work, and nothing downstream matters
without it.

### A2. Build a real path for business verification

Checkout, prepaid top-ups and paid panels are all gated behind a verified-business
check that **only a function with no route, no script and no admin UI can satisfy**.
Every paying customer needs a manual intervention that has nowhere to happen, and the
first one hits it. There is also no UI handling for the resulting error, so a customer
sees a generic failure.

Either build the operator route and a self-serve declaration flow, or remove the gate
for the tiers that do not need it.

### A3. Decide the meter, then wire it

The decisions quota is **not enforced on the live lane** — the reservation path is
reachable only through the gated paid network lane, so the usage counter reads an empty
table forever while the pricing page promises an allowance.

Do not fix this by wiring decisions. The business plan argues the meter should become
**governed agents plus retention years**, because decision volume falls up to 90% as
adaptive coverage steps down. Agent and group quotas are already enforced correctly;
retention is a new but simple meter.

Whatever survives that decision, wire it into the lane that actually runs.

---

## B. Make the evidence worth paying for

This is the differentiator. Nothing else in the product is unmatched.

### B1. Ship the verifier as a standalone open-source package

**Correction:** an earlier draft called for an async-hash refactor and unifying a
duplicated implementation. Neither is needed. The core has **zero `node:` imports**,
already uses `globalThis.crypto.subtle`, and a test enforces that; the browser page
already delegates to the same module. The real work is a canonicalization defect —
key ordering uses `localeCompare`, which is locale- and ICU-sensitive, so an `en-US`
browser and a `LANG=C` server can produce different digests for the same packet. An
open-source verifier cannot ship that, and fixing it changes digests.

A browser verifier exists and the SDK is already MIT with npm provenance — but there is
no separately installable verifier with its own README, and no marketing that says _you
do not have to trust us, here is the code that checks it_.

For a vendor with no SOC 2, this reframes the security conversation from "do we trust
your controls" to "can we check the output ourselves". It is the cheapest available
substitute for a $25–60k first-year certification programme and it can ship this month.

### B2. Contract a qualified timestamp authority

Signed evidence today carries **no legal presumption** — it is admissible and nothing
more, which leaves the customer proving hash construction, key custody and clock source,
with RateLoop in the witness box.

A qualified timestamp under eIDAS Article 41(2) reverses that burden onto the
challenger, and German and French procedural law key their own presumptions to the same
tier. **ETSI EN 319 422 is a profile of RFC 3161, which the attestation pipeline already
implements** — this is closer to changing a trust anchor than building anything.
Roughly €0.50–2.50 per token.

Consider a qualified electronic seal under Article 35(2) alongside it. Do **not** pursue
becoming a trust service provider.

**Decide this before December 2026.** eIDAS 2.0's qualified electronic ledgers give
records "the presumption of their unique and accurate sequential chronological ordering
and of their integrity" — which describes this product's core claim, with a legal
presumption attached. Services are expected from December 2026, offered by supervised
providers already on EU Trusted Lists and already selling to the same buyers. Partner
with one rather than competing; the moat is the review semantics, not the hash chain.

### B3. Stop hiding capabilities that work

Roughly five shipped, deployed, working features are pinned false in the public-claim
capability map and therefore cannot be mentioned publicly: managed evidence signing, the
offline packet verifier, OTLP ingest, and the attestation paths.

The claim gate is a genuine asset and should not be weakened — but it now makes the
product look _less_ capable than it is. Flip the flags for what is genuinely deployed
and exercised, and keep the gate for what is not.

### B3b. Write the MCC-AI annex pack

The Commission's Model Contractual Clauses for AI ship with **Annex F, "Measures to
ensure human oversight"** — a blank box every AI supplier to an EU public body has to
fill — plus Annex E for transparency and an Annex D item on log collection. The Light
version keeps all three even for non-high-risk systems.

A pre-drafted, clause-referenced pack answers a buyer's own contract template in their
own vocabulary. Days of writing, no engineering, and it removes friction inside live
public-sector deals.

### B4. Publish a CSA STAR Level 1 self-assessment

Free, no prerequisites, listed in a public third-party registry, and the exact
questionnaire format enterprise buyers and cloud marketplaces accept. Best ratio of
procurement credibility to cost available anywhere in this document.

### B5. Make a content-free mode a first-class product option

Risk managers tier vendors by data sensitivity. A vendor holding no customer content —
only commitments, hashes and reviewer assertions — lands in the tier where security
waivers are routine, rather than the tier where a strong SOC 2 is demanded outright.

The commitments-only ingestion path already exists. Making "we never hold your output
text" a supported, documented configuration is **a procurement strategy as much as an
engineering one**, and it narrows GDPR Article 28 exposure at the same time.

---

## C. Make the evaluation story true

A code audit found the evaluation positioning outruns the product in five specific
places. These are ordered by how much each closes that gap, and **C0–C2 are the ones
that make the pitch honest.** Effort is a rough order of magnitude, not an estimate.

### C0. Let a customer compare two versions of the same agent — days

Every quality surface is bound to current versions. Ship a v2 and v1's endorsement rate,
alpha, dissent and stage history vanish from the UI, though the rows survive in the
database with no read path back.

**This kills "did my agent get better?" outright**, which is the first question anyone
evaluating an agent asks. It is a read-path problem, not a data problem.

### C0b. Collect human labels outside the uncertain band — days

Only automated-eval receipts marked `uncertain` escalate to a human; `pass` and `fail`
never do. So a customer can never measure their evaluator's false-positive or
false-negative rate — the exact number judge calibration means — and the labels they do
get are drawn from the band where the evaluator is least accurate and least
representative.

Sample a small fraction of `pass` and `fail` too. Then compute the confusion matrix and
weight by the inclusion probability already recorded per opportunity. **Those two steps
turn a labelled-data faucet into judge calibration**, which is the strongest available
claim and currently not implemented at all.

### C0c. Fix or disclose the sampling bias — days to disclose, longer to fix

Forced strata union the deterministic draw, and the sampling rate is lowered _because_
past agreement passed a threshold — selection on the dependent variable. Inclusion
probabilities are recorded per decision and never used to weight anything, so every
published rate is an unweighted count over a non-representative sample.

Cheapest honest fix: report the weighted estimate alongside the raw one, and say plainly
in the UI that the figure describes reviewed outputs. A statistically literate buyer
notices this in one meeting; better they hear it from the product.

### C1. Expose suites, cases and gold items to the live lane — weeks

**Correction:** `createOwnerGoldItem` does have a production route; what it lacks is any
UI client. And the sequencing is not a deadlock — build draft, mark ready, freeze, then
designate gold terminates. The three real conflicts are that gold can only be designated
after the suite is sealed, that designating every case as gold makes the suite unusable,
and that a frozen suite can never be extended.

Suite creation, case import, expected answers and owner adjudication are fully
implemented, tested, and reachable only through a function with no production caller.
There is no UI for gold at all. A customer on the live lane cannot build a test set or
record a known-correct answer.

### C2. Expose version comparison

Every assurance case is already a blinded baseline-versus-candidate comparison, with
counts, preference share, a Wilson interval and previous-run drift computed. It is
reachable only through the same frozen-run path.

Bind both artifacts to explicit baseline and candidate agent-version identifiers and
emit one signed comparison report. **"We changed the agent, here is the human-judged
difference, signed"** is a saleable artefact that nothing else in the market produces.

### C3. A CI command that waits for a human decision

The Promptfoo adapter exists and fails uncertainty closed, but there is no CLI command
that blocks on one immutable review run and returns distinct pass, fail, timeout and
transport-error exit states.

This is what makes the product sticky to the engineer who installs it — the persona the
product already serves best.

### C4. Capture end-user feedback on live output

There is no channel for "the customer's own users said this output was wrong", which is
the highest-value review signal available and costs nothing to collect.

Bind it to a short-lived capture token scoped to workspace, agent version, execution and
output commitment. Route negative signals into review; never let them become a verdict
directly.

### C5. Show the reviewer a trace, not just an output

OTLP GenAI trace ingestion is live and substantial. The reviewer case view does not show
it. When a reviewer rejects an output the useful question is _which step went wrong_.

Do this only after redaction rules are specified and tested — show inputs, outputs,
errors, timing and sources, not hidden reasoning.

### C6. Fill the framework-adapter gaps

LangGraph, the OpenAI Agents SDK and MCP elicitation are covered. **Vercel AI SDK,
Mastra and CrewAI are absent entirely.** Each is a distribution channel that costs an
adapter.

### C7. Republish the npm packages

The published SDK and agents packages are pre-tokenless snapshots at `0.1.0`. **Anyone
installing today gets a different product.** For a developer-led distribution strategy
this is an own goal, and it is an afternoon of work.

### C8. Alert delivery beyond the inbox

Six event types reach an in-app inbox with opt-in email. No Slack, no Teams, no webhook
for humans. Cheap, and it is the difference between a dashboard someone remembers to
open and a system that tells them.

---

## D. Things that break as soon as anyone uses it

No admin UI, no error tracking, no on-call path, no row-level security, roughly 200
unbounded ordered queries, and single replicas on the keeper and indexer. These are
engineering risks rather than product opportunities and live in
[remediation-plan.md](remediation-plan.md); they are named here only so the build list
is not read as the whole picture.

## E. Deliberately not doing

**An LLM evaluator in the core.** Reviewer scoring and routing are Annex III(4)(b) on
their face and escape the AI Act only because nothing infers. Any inference feature
risks making RateLoop the provider of a high-risk system. If wanted, it ships as a
separately licensed, off-by-default module after an Article 3(1) assessment — and it
decides only what a human looks at, never the outcome.

**A prompt editor or playground.** That is an LLM development tool. It would start a
fight against better-resourced products and dilute the only thing no competitor does.

**Turning on the reviewer marketplace.** See the business plan: no comparable company
launched as a marketplace, the Platform Work Directive's Article 10 duties attach even
to the genuinely self-employed from December 2026, and the paid lane does not produce
the Article 26(2) artefact the product sells.

**ISO 42001.** About 350 certificates exist worldwide, first-year cost is $85–150k, and
there is no evidence of it appearing in European tenders. Revisit in 2027.

---

## Suggested order

| Phase | Items        | Rationale                                                                     |
| ----- | ------------ | ----------------------------------------------------------------------------- |
| 1     | A1–A3        | Revenue is impossible until these land, and A3 waits on the pricing decision. |
| 2     | C0, C0b, C0c | Make the evaluation pitch true before anyone hears it. Days each.             |
| 3     | C3           | The only real switching cost in the list. Moved up from last.                 |
| 4     | B1, B3, B4   | Cheap, compounding, and they make the product presentable.                    |
| 5     | C1, C2       | The largest gap between what the code does and what a customer reaches.       |
| 6     | B2, B5, B3b  | Procurement unlocks. B2 is a purchase order; B3b is drafting.                 |
| 7     | C4–C8        | Real value, no deadline.                                                      |

Engineering defects and honesty fixes are in [remediation-plan.md](remediation-plan.md)
and deliberately not repeated here.
