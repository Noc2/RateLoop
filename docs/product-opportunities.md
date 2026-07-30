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

### B3. Stop hiding capabilities that work

Roughly five shipped, deployed, working features are pinned false in the public-claim
capability map and therefore cannot be mentioned publicly: managed evidence signing, the
offline packet verifier, OTLP ingest, and the attestation paths.

The claim gate is a genuine asset and should not be weakened — but it now makes the
product look _less_ capable than it is. Flip the flags for what is genuinely deployed
and exercised, and keep the gate for what is not.

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

## C. Make the product do more for the customer it already has

Reachability, mostly. Several of these exist and are wired only to the switched-off lane.

### C1. Expose suites, cases and deterministic checks to the live lane

Assurance suites, case import and the five deterministic check operators are implemented
— and reachable **only from the gated paid network lane**. `createAssuranceSuite`,
`importAssuranceCases` and `recordDeterministicCheckResult` have no production callers.

A customer on the live lane cannot build a test set or attach an automated check. This
is the single largest gap between what the code can do and what a customer can do.

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

### D1. There is no admin interface at all

No admin UI exists anywhere. Operator power is a handful of curl endpoints, environment
variables and five raw hex signer keys with no key-management service — rotation means
editing environment values and redeploying. At one customer this is fine. At ten it is
the constraint on everything else.

### D2. Nothing pages anyone

No error tracking, no alerting, no on-call path. The maintenance cron now returns 503
after repeated processor failures, which is good — but **nothing watches it**. The
health endpoint is per-workspace and owner-gated; there is no platform-wide operator
view.

### D3. Multi-tenancy is per-route discipline

No row-level security across 163 migrations, and membership checks re-implemented across
dozens of files. The failure mode is a future route forgetting the check, and the blast
radius is another customer's data. A shared policy module, or database-level enforcement,
is the highest-consequence latent risk in the codebase.

### D4. Unbounded queries on user-triggered paths

Roughly 200 ordered statements have no limit, including a subject-access export that
issues about thirty consecutive unbounded selects, and evidence packet generation that
loads every case and response uncapped. Both are customer-triggerable.

### D5. Single points of failure in settlement

The keeper and the indexer each run one replica. Both are load-bearing for on-chain
settlement and indexing.

---

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

| Phase | Items             | Rationale                                                                        |
| ----- | ----------------- | -------------------------------------------------------------------------------- |
| 1     | A1–A3             | Revenue is impossible until these land, and A3 needs the pricing decision first. |
| 2     | B1, B3, B4        | Cheap, compounding, and they make the product presentable to a buyer.            |
| 3     | C1, C2            | The largest gap between what the code does and what a customer can reach.        |
| 4     | B2, B5            | Procurement unlocks. B2 is a purchase order; B5 is a supported configuration.    |
| 5     | C3, C7, C6        | Distribution to the engineer persona. C7 is an afternoon.                        |
| 6     | D1, D2            | Before the tenth customer, not after.                                            |
| 7     | C4, C5, C8, D3–D5 | Real value, no deadline. D3 is the one to bring forward if usage grows.          |

Phase 1 is sequenced behind a pricing decision, not behind engineering. Phase 2 can run
in parallel with it.
