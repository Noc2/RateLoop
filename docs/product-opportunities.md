# RateLoop tokenless — what to build next

Written 29 July 2026 against `d49862fa3`; re-verified 3 August 2026 against `8e9a01e4a`.
Companion to [business-plan.md](business-plan.md). This is the "make it more interesting"
list: work that would change what a customer can do or decide to pay for.

Defects and honesty fixes live in [remediation-plan.md](remediation-plan.md). This list
assumes those are handled separately.

**Ordering principle:** the price levers first — the work that changes what a buyer is
willing to pay, ranked in §6a of [implementation-plan.md](implementation-plan.md). Then
revenue mechanics, because a product that cannot take money has no other priorities.
Then the things that make it worth paying for, then the things that make it survivable
at scale.

Compliance software is paid for because it **transfers legal risk**, because it is
**mandatory by a date**, or because **removing it is a deliberate act with a named
owner**. Items are judged against those three levers, not against feature count.

---

## 0. The price levers, in order

Full argument and citations in §6a of [implementation-plan.md](implementation-plan.md).
Summarised here so this list can be read alone:

| #   | Work                                                       | Lever                       | Size             |
| --- | ---------------------------------------------------------- | --------------------------- | ---------------- |
| P1  | Operator entry point for the closed-frame draw (2.1)       | Risk transfer — Art. 37     | Days             |
| P2  | Qualified timestamp anchor (eIDAS Art. 41(2))              | Risk transfer — burden flip | Purchase order   |
| P3  | Name the AI Act Art. 72 post-market monitoring product     | Mandatory, recurring        | Mapping + export |
| P4  | A compliance-officer-reachable UI over the finished routes | Perceived value             | Presentation     |
| P5  | Sell the auditor a scoped seat                             | Switching cost              | Builds on 2.7    |
| P6  | Distinct CI exit states                                    | Switching cost              | Hours            |

**P1 is the finding of this pass.** `commitDsaReferenceSamplingEpoch`,
`freezeDsaReferenceSamplingEpoch`, `loadDsaReferenceSamplingEpochSources` and the whole
of `dsaPopulationLedger` have **zero non-test callers** — no route, no script, no admin
action. The pre-committed, beacon-seeded draw is the one artefact an Article 37 auditor
can rely on instead of re-performing, it is written and tested, and nothing in the
product can invoke it.

**P3 is the largest unclaimed market.** Article 72 binds every high-risk **provider**
(not deployer) to a continuous, documented performance record inside Annex IV technical
documentation. That is what this product already produces. It appears in
[business-plan.md](business-plan.md), is absent from the implementation plan, and has no
code that names it.

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

**Correction, twice over.** An earlier draft called for an async-hash refactor and
unifying a duplicated implementation. Neither is needed: the core has **zero `node:`
imports**, already uses `globalThis.crypto.subtle`, and a test enforces that; the browser
page already delegates to the same module.

That draft then named a canonicalization defect — key ordering by `localeCompare`, which
is locale- and ICU-sensitive, so an `en-US` browser and a `LANG=C` server can produce
different digests for the same input. **Task 2.8 fixed this for evidence packets** by
moving them to RFC 8785, which mandates sorting by UTF-16 code units. Re-verified 3
August 2026: the evidence-packet and DSA paths are clean.

**The remainder is far larger than an earlier draft of this line claimed.** It said
"roughly eight other canonicalizers". A full sweep on 3 August 2026 found **82 sites in
`packages/nextjs` alone**, plus four outside it, and essentially none is
comparison-only — nearly every one terminates in `createHash("sha256")`, `keccak256`,
`createHmac`, an Ed25519 `sign`, or a persisted `*_json` column that is later
byte-compared. Do not quote the number without re-running the sweep.

Seven are critical, because the locale-sensitive bytes are signed or go on-chain:

| Site                                                                                                  | Why critical                                                          |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [`tokenless/admissionPolicy.ts:43`](../packages/nextjs/lib/tokenless/admissionPolicy.ts:43)           | `admissionPolicyHash` written on-chain as bytes32                     |
| [`tokenless/rater/publicResponse.ts:51`](../packages/nextjs/lib/tokenless/rater/publicResponse.ts:51) | `keccak256` on-chain commitment                                       |
| [`tokenless/integrityEpochs.ts:170`](../packages/nextjs/lib/tokenless/integrityEpochs.ts:170)         | Ed25519-signed epoch manifest                                         |
| [`privacy/audit.ts:69`](../packages/nextjs/lib/privacy/audit.ts:69)                                   | the tamper-evident audit hash chain, persisted                        |
| [`scripts/audit-export-core.mjs:11`](../packages/nextjs/scripts/audit-export-core.mjs:11)             | the external verifier for that chain; must match byte-for-byte        |
| [`tokenless/assuranceWormS3.ts:74`](../packages/nextjs/lib/tokenless/assuranceWormS3.ts:74)           | AWS SigV4 canonical request — a mis-ordered header is an auth failure. **Fixed** |
| [`sdk/src/tokenless.ts:450`](../packages/sdk/src/tokenless.ts:450)                                    | `intentDigest`, shipped to third parties, must match the server       |

**Why it is wrong:** bare `localeCompare` uses the host's default ICU collation, so
ordering depends on the Node build (full-icu vs small-icu), the ICU version and
`LANG`/`LC_ALL`. `"Z".localeCompare("a")` is `-1` under code units and the opposite under
ICU. RFC 8785 requires UTF-16 code-unit order.

**Why it is not a quick fix.** A correct shared producer already exists —
`canonicalizeRfc8785` in [`@rateloop/node-utils/jcs`](../packages/node-utils/src/jcs.ts)
— and about ten modules already use it, so this is a live migration rather than a
greenfield problem. But every replacement **changes the digest**, so anything already
persisted needs the v1/v2 dual-path treatment `assuranceAttestations.ts` and
`assuranceWormExports.ts` already demonstrate. Sequence it as its own project, not as a
sweep.

Two pieces are safe to take immediately, because nothing durable depends on their
current bytes: `assuranceWormS3.ts` (SigV4 is recomputed per request) and a
locale-independence test. No test anywhere currently varies `LANG` or asserts
case-mixed ordering — `humanReviewRequestPreparation.test.ts:252` uses ASCII-only keys
and passes under both comparators. One `{ Z: 1, a: 2 }` fixture run against every
canonicalizer would catch the entire class.

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

**Sixteen of nineteen** capabilities are hardcoded false in the public-claim map; the
other three derive from lane readiness and are also false. Earlier drafts said "roughly
five", then "fourteen of seventeen" — the map has since grown, so re-count it rather than
quoting this line. Several of the sixteen are shipped and working and therefore cannot be
mentioned publicly: managed evidence signing, the offline packet verifier, OTLP ingest,
RFC 3161 timestamping and the attestation paths.

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

### C0b. Finish the consumer for reference labels outside the uncertain band — days

The repository now has a separate, future-beacon reference draw for automated `pass` and
`fail`, plus design-weighted confusion-matrix point estimates. What remains is the
authorized reviewer assignment/label consumer and durable report publication. Reference
labels never enter the operational adaptive-promotion window.

### C0c. Fix or disclose the sampling bias — days to disclose, longer to fix

Forced strata union the operational deterministic draw, and the sampling rate is lowered
_because_ past agreement passed a threshold. The implementation now reports an explicitly
typed history-conditioned weighted point estimate and uses a separate closed-frame DSA
draw. Public intervals stay disabled until the actual dependency/variance design passes
external method review.

The remaining honest fix is to finish the two-number UI and disclosure, then obtain the
external method decision. A statistically literate buyer notices unsupported intervals
in one meeting; the product must return a typed gap instead.

### C1. Expose suites, cases and gold items to the live lane — weeks

**Correction, twice over.** Gold has a live authenticated route covering create,
configure, retire and read, and gold failure rate is rendered in the dashboard. What is
actually broken is **injection**: gold enters a run only through the frozen-run path, so
items created via the route are never injected on the lane that runs. Different claim,
different fix. And the sequencing is not a deadlock — build draft, mark ready, freeze, then
designate gold terminates. The three real conflicts are that gold can only be designated
after the suite is sealed, that designating every case as gold makes the suite unusable,
and that a frozen suite can never be extended.

Suite creation, case import, expected answers and owner adjudication are fully
implemented, tested, and reachable only through a function with no production caller.
There is no UI for gold at all. A customer on the live lane cannot build a test set or
record a known-correct answer.

### C2. Bind version comparison to explicit versions — weeks

**Correction:** this surface has a live route and a rendered panel, and previous-run
drift is genuinely computed across all completed runs, including the ones the live lane
synthesises. The gap is narrower than an earlier draft claimed: nothing binds the
artifacts to explicit baseline and candidate agent-version identifiers, and there is no
signed comparison report.

Note also that the comparison is **not blinded on the live lane**, where the swap flag is
hardcoded false — so "blinded baseline-versus-candidate" describes the switched-off lane
only.

### C3. A CI command that waits for a human decision

**Correction:** a blocking command already exists — `wait --until-ready`, 300-second
default. What is missing is only **distinct exit states**: every error path sets exit
code 1, so CI cannot distinguish a failed review from a timeout from a network error.

**Move this first if the moat matters.** It is the only item in either document that
creates a real switching cost — a pipeline gate is removed by a deliberate act with a
named owner, where everything else is observational and removable silently.

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

### C8. Alert delivery beyond the inbox — days

Six oversight event types reach an in-app inbox with opt-in email and browser push. No
Slack, no Teams. **A signed webhook delivery system already exists** with endpoints and
live routes — what is missing is a human-facing destination, not the transport.

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

**Turning on an open reviewer marketplace.** No comparable company launched with that
model, the Platform Work Directive reaches genuinely self-employed platform workers from
national transposition, and open case selection would damage the sampling claim. Keep the
principal-assigned network as a default-off public-safe benchmark experiment; do not add
browsing, rankings, streaks, dynamic bonuses or hybrid supply.

**ISO 42001.** About 350 certificates exist worldwide, first-year cost is $85–150k, and
there is no evidence of it appearing in European tenders. Revisit in 2027.

---

## Suggested order

| Phase | Items        | Rationale                                                                     |
| ----- | ------------ | ----------------------------------------------------------------------------- |
| 0     | P1           | Days of work, and every downstream gate is blocked behind it.                 |
| 1     | P2, P6       | A purchase order and a few hours. Best price-per-effort in the document.      |
| 2     | A1–A3        | Revenue is impossible until these land, and A3 waits on the pricing decision. |
| 3     | C0, C0b, C0c | Make the evaluation pitch true before anyone hears it. Days each.             |
| 4     | P3           | Article 72 is the largest unclaimed market and mostly a mapping exercise.     |
| 5     | P4, B3, B1   | Make the finished machinery visible and describable. Presentation, not build. |
| 6     | P5, B4       | Auditor access and the free STAR self-assessment. Procurement credibility.    |
| 7     | C1, C2       | The largest gap between what the code does and what a customer reaches.       |
| 8     | B2, B5, B3b  | Remaining procurement unlocks. B3b is drafting, not engineering.              |
| 9     | C4–C8        | Real value, no deadline.                                                      |

**Why P1 moved to phase 0.** It is not the biggest item, but it is the only one that
blocks other people's work: without an operator entry point there is no artefact for an
audit partner to accept, so the external validation gate cannot even start. Everything
else in this table can proceed in parallel; that one cannot be started late.

Engineering defects and honesty fixes are in [remediation-plan.md](remediation-plan.md)
and deliberately not repeated here.
