# RateLoop tokenless — remediation plan

Written 29 July 2026, from a second research pass that verified every weakness in
[design-assessment.md](design-assessment.md) against the code, plus legal and market
research. Each item below is sized as one commit.

**This plan fixes what is wrong. It does not build what is missing** — the feature
gaps, and the one feature that would bring RateLoop itself inside the AI Act, are in
[evaluation-platform-gaps.md](evaluation-platform-gaps.md). Read that second: several
of its items depend on constraints established here, particularly 3b.7.

## Implementation status — 29 July 2026

All repository-owned code, copy, schema, route, CI, observability, legal-surface, and
test-harness work in this plan is implemented on `tokenless`. Item 3b.7 remains a
standing architecture constraint, and the items under **Deferred, with reasons**
remain intentionally outside this remediation.

The completed implementation was checked with:

- the full Foundry and workspace test aggregate, including 77 Foundry tests, 2,258
  Next.js tests, and every contracts, SDK, agent, keeper, Ponder, and promo test;
- a fresh real-PostgreSQL migration through the current journal head plus rollback,
  CHECK-constraint, and partial-uniqueness invariant tests;
- repository lint, package type checks, an optimized Next.js production build, and
  immutable dependency installation;
- live production and development dependency audits with no audit suggestions; and
- the dead-code scan, with no unused-file or unused-dependency finding after its
  environment-independent entry graph was corrected.

Two release actions are necessarily external:

1. Item 3b.6 requires selecting and contracting an EU/EEA Trusted
   List-qualified timestamp service. The RFC 3161 integration and release gate are
   implemented, but `qualifiedTimestamping` remains false until procurement,
   trust-anchor configuration, and issuance-time qualification validation are
   complete.
2. Fund-core changes invalidate the historical Base Sepolia artifact. A fresh
   deployment must produce one complete deployment key and update the isolated
   tokenless app, Ponder, and keeper services together. Release validation rejects
   the stale or mixed bundle.

## The ordering principle

The research changed the priority order. Two things emerged that the assessment did
not have:

**Most of this is routing, not building.** The auditor role, the public verification
key, the canonical framework map, and the near-isomorphic verifier all exist and are
wired to nothing. Work that connects finished parts costs a fraction of what the
assessment implied and carries almost no design risk.

**The urgent items are the ones where the product says something untrue.** A claim
the code contradicts is a legal exposure that compounds daily. Everything else can
wait behind it.

So: **stop saying false things → connect what exists → make failure loud → re-aim the
regulatory story → change how fixes are tested.** Strategy comes last because the
question it turns on is still open.

---

## Tier 0 — Stop making claims the code contradicts

Ship this tier before anything else.

### 0.1 Delete the three false verified-host sentences

Three statements are false, not merely overstated: that a named product is "the
primary verified path"; an instruction to "use a verified host-enforced integration
when blocking is mandatory"; and a present-tense claim that verified host enforcement
"can hold" output undelivered and that "verified hosts honor" workspace stop.

The correct wording already exists elsewhere in the product — the connection matrix
says plainly that no host is in the Verified tier. This is copy alignment, not a new
position. Drop the verb _prove_ throughout in favour of _establish_, matching what the
evidence packet itself already says.

**One** test file asserts the false copy as contract — the evidence page's — and must
be updated in the same commit. The two `/docs/ai` sentences are deletable with no test
change. Sentence (c) exists in two surfaces: the page and its markdown mirror.

### 0.2 Extend the tier-honesty gate to every public surface

Two gates exist and the cheaper path is the second one. The tier gate derives its
expectation from the host registry — the right design, since it relaxes automatically
the day a host earns the tier — but it scans only two route modules. Meanwhile the
claim-gate test **already walks** every public page, every transitively imported
component, all of `components/tokenless`, every machine doc and every plugin markdown
file. It simply has no tier rule.

Add one registry-driven rule there rather than extending the connect gate's page
list: when no host holds the verified tier, no scanned surface may use present-tense
verified-host capability language.

### 0.3 Add the availability caveat to the eight defensible claims

Ten statements take the form "only a verified host can X" — eight in the app, plus
one in the connection markdown and one in a plugin skill file. Each is literally true:
a necessary condition, which is a disclaimer. None says that no host holds the tier
today. Append that sentence.

### 0.4 Resolve the two definitions of "verified"

The connection docs define Verified as a release-gated smoke test at a named client
version. The oversight and evidence pages use it to mean _enforces withheld
delivery_. These are different properties and the second does not follow from the
first.

Rename one of them. The QA milestone should become something like "release-tested",
leaving "verified" for the delivery-control property that no host has. Without this,
0.1 and 0.2 fix the symptom and leave the trap.

### 0.5 Decide what to do about host-enforced mode

Host-enforced review has a schema, a CHECK constraint and an activation gate that
**only ever rejects** — nothing writes the evidence reference it demands. A customer
who asked for it and paid could not be given it.

Two honest options. Either document it as a planned capability with no
implementation, or remove the enforcement mode and its column until a host adapter
exists. Recommend the first: the schema is harmless and correctly fail-closed, and
the gate is good design. What is not acceptable is leaving a paid-sounding capability
that silently cannot be enabled.

### 0.6 Remove the SEC 17a-4 row and the misplaced article citations

The SEC 17a-4(f) framework row claims a fit that a review vendor structurally cannot
supply — it imposes system-level storage, undertakings and production duties on the
record holder. Delete rather than hedge.

Articles 12 and 72 are provider obligations and should not appear in a deployer-facing
mapping; Article 12(3)'s human-verification field is scoped to remote biometric
identification only. Remove both from the compliance table **and** from the OSCAL
component definition, which the claim gate does not scan because it reads only `.tsx`
and `.md`.

Also correct the Article 26(6) row: that duty attaches to logs the high-risk AI
system generates, not to a third-party review vendor's records. A six-month retention
floor _supports_ it and does not satisfy it.

### 0.7 Re-word the EU residency claim

A second false claim of the same species as the verified-host one, found by the
EU-posture research.

The deployment manifest asserts EU residency across eleven resources, and the schema
genuinely cannot represent a non-EU tenant — compute is pinned to Frankfurt, workers
to Amsterdam. But **Vercel's own DPA states its primary processing facilities are in
the United States and that backups are globally replicated.** Region pinning does not
cure a term in the provider's contract, and a buyer's counsel who reads both
documents sees a misrepresentation.

Two further problems sit underneath it. The validator only string-compares
environment variables against manifest constants and then signs the result — it never
asks a provider what region a resource is actually in, and the environment file says
so. And `supportAccess` is declared in the manifest with **no implementing code at
all**: no break-glass approval, no access logging. Support access is the classic
residency-breaker.

Re-word to "EU processing region", with an explicit carve-out for backups and
control-plane data and a note that transfers are covered by standard contractual
clauses. Roughly a day, and it removes the only outright-false statement in the
infrastructure story. Literal residency means leaving Vercel and Railway for an
EU-incorporated host — a re-platform, not a fix.

Also correct the manifest's declared `analytics` processor: no analytics SDK exists
anywhere in the repository. Over-declaring a processor is a smaller error than
under-declaring one, but it is still wrong.

---

## Tier 1 — Route what already exists

The highest value-to-effort work in the plan.

### 1.1 Generate the framework table from the canonical map

The canonical mapping carries five frameworks and twelve rows, each with an explicit
non-claim, and **nothing imports it at runtime**. The public table is hand-maintained
prose and has already drifted, citing AI Act articles the canonical map does not.

Import it. Render the table from data, carry each `nonClaim` into the boundary
column, and add a test asserting the rendered table matches the map. This removes an
entire class of drift and is the cheapest item in this tier. Wire the existing
OSCAL drift check into CI while here — it exists as a script and no workflow calls it.

### 1.2 Publish and document the verification key endpoint

The trust anchor is already served unauthenticated and cacheable. The docs tell
readers to get it from the authenticated workspace key history instead, and nothing
links it.

Link it from the evidence page, name it in the verifier's usage string, and say
plainly that a reader with a packet needs no account to obtain the pin.

### 1.3 Make the verifier isomorphic

Four hundred and five lines, five `node:crypto` touch points, no network I/O, no
chain reads, no exotic curve. Ed25519 is now in every major browser's WebCrypto.

The one real obstacle is that the hash path is synchronous and recursive while
`crypto.subtle.digest` is async. Thread async through the Merkle builder and the
canonicaliser. Keep the CLI on the same core so the two cannot diverge.

### 1.4 Ship a browser verification page

A public page that accepts a pasted or uploaded packet, fetches the trust anchor from
the public endpoint, verifies entirely client-side, and shows what was checked —
digest, both Merkle roots, the recomputed aggregation, the signature — and what was
not, particularly that chain evidence is carried but not independently verified.

Nothing leaves the browser. That is worth stating on the page: a compliance reader
can check a packet without sending a customer's record anywhere.

This turns "run a CLI from a terminal with a pinned key" into a link, and it is the
single highest-leverage item in the plan.

### 1.5 Grant the auditor role

The project-level `auditor` role grants read and export, no write, no manage. It is
CHECK-constrained, supports expiry, and is enforced in two independent places
including raw SQL. The functions that create it are called only from tests.

Add the route and the UI to grant, list, and revoke it. Nothing about the permission
model needs designing — it is finished. This is the missing handle on a built door.

### 1.6 Add an expiring share grant for a record

The one thing genuinely absent: a way to show a specific record to a specific person
with no account. Every token in the system today is an authentication credential.

The pattern to copy is already implemented twice — an opaque capability identifier on
an unauthenticated route, and a public page with `noindex`, `no-referrer` and
server-side narrowing. Follow it: an expiring, revocable, single-record grant that
carries the packet and nothing else, logged as a governed access event.

Do this **after** 1.4, so the thing being shared is verifiable in the browser it
opens in.

---

## Tier 2 — Make failure loud

### 2.1 Fix the fire-and-forget evidence projection

Evidence projection for a terminal private-review decision is called with a catch
that discards everything. The review commits and returns success while its evidence
may never be projected.

Make the failure durable: record it as a work item so the existing retry and
dead-letter machinery owns it. Do not make projection synchronous — that trades a
silent evidence gap for a user-visible failure on a decision that did succeed.

This is the most consequential defect in the plan.

### 2.1b Collapse the five stage-rate tables into one

Found by the verification pass, and it is a code defect rather than a documentation
one. Earlier drafts of these documents asserted the opposite — that a 10% monitoring
floor was drift in old docs — so this item exists partly to retract that.

The adaptive stage-rate table is declared in five places. `adaptiveReview.ts` is
canonical and says `monitoring: 2_500`. The policy-management module, the overview
projection, the registry projection and the oversight-alert module all say
`monitoring: 1_000`, and only the evaluation dashboard imports the canonical
constant.

**The oversight-alert copy is the one that causes harm.** The coverage-floor alert
compares a scope's production floor against its stage rate and warns when the floor
falls below it — at 1,000 where sampling actually runs at 2,500. A workspace with a
floor between those values is under-covered relative to the alert's model of the
world and is never told.

Delete the four copies, import the canonical one, and add a test asserting a single
definition — the same "bind the sites that re-derive a rule" shape as 4.3, which is
what would have caught it.

### 2.2 Name every degraded signal in the health panel

The panel names fifteen signals while the degraded predicate has thirty-six terms.
**Twenty-one terms across thirteen subsystems** can degrade a run and produce an amber
badge with no chips explaining why. A pure-additive change to one array.

Fix in the same commit: the health panel renders `null` when its own fetch fails.

### 2.3 Keep the error message

Only `error.name` survives a processor failure — a plain `Error` is recorded as
`errorCode: "Error"`, with the message and stack discarded. Add a truncated message
or a `sha256:` digest, matching the convention the privacy-failure table already
uses, and log one structured line so all thirty-six units become greppable.

### 2.4 Distinguish "switched off" from "broken"

The core of the problem. Three processors are _legitimately_ off in this profile, so
any alarm keyed on "produced no work" fires constantly and trains operators to ignore
it. The alarm must key on failure and on configuration state, never on throughput.

Add a per-processor health record modelled on the privacy-failure table, which
already has the right shape down to the error digest and an operator alert state.
Give processors a way to declare themselves deliberately disabled. Then the
integrity-epoch producer's disabled result and the top-up reconciler's zeroes stop
being indistinguishable from failure.

### 2.5 Return a non-200 after repeated failure

Once 2.4 has run long enough to confirm the quiet set is exactly the expected
processors, return a distinct status when any processor has failed several
consecutive times. Vercel's cron dashboard surfaces non-2xx, which is the cheapest
push signal available with no new infrastructure.

Gate on repeated failure, not the first — a transient upstream blip on one tick is
expected. Exclude anything declaring itself disabled, or the endpoint fails
permanently on day one.

### 2.6 Stop the Stripe webhook swallowing operator-attention events

It logs and returns 200 so Stripe stops retrying. The only durable signal is an
unadvanced row that nothing reads. Route it into the same per-processor health record
so a stuck billing event is visible without reading deployment logs.

### 2.7 Verify Drata retries and fix the Vanta retry path

Drata's `IN_PROGRESS` session is the signature of an interrupted delivery and must
resume its upload and completion; `ACTIVE` means the session is completed and live.
Keep both boundaries explicit in tests. Vanta currently skips the submit call whenever
a prior upload is found, so a crash between upload and submit makes every retry report
success for a draft the vendor has not accepted. Resume at submit and record delivery
only after that call succeeds.

---

## Tier 3 — Re-aim the regulatory story

### 3.1 Lead with Article 26(2)

The one provision that binds the actual buyer, is about people rather than system
design, and matches shipped code field for field: the statute names competence,
training and authority; the attestation model stores competence basis, training
records, authority scope and expiry.

Article 14 binds the **provider** and requires that systems be _designed so they can
be_ overseen — no evidence artefact, no log, no signature, no minimum panel size, no
independence requirement. Move it under an explicit "if you also build the system,
this binds you too" heading rather than making it the frame.

### 3.2 Replace the checklist form

Five numbered cards keyed to Article 14(4)(a)–(e) and a nine-row requirement table
are a compliance checklist. Every card is hedged; the structure is the claim, and no
phrase-matching gate can catch a structure.

Invert it: describe the control, then note secondarily which duty it can serve.
Consider a gate rule forbidding an article citation within N characters of a
capability noun outside a designated legal-context page.

### 3.3 Promote the lane distinction to the organising frame

The invited-versus-network paragraph is the strongest legal statement in the product
and it is the last section of one page. Every mandate requires the deployer's own
authorised person, and authority is the binding constraint — a stranger on a public
network has none, however competent.

Make it the first thing a regulatory reader sees. It is legally right, commercially
clarifying, and exactly what the code enforces today.

### 3.4 Cite Article 26(3), and add 25(4) as a procurement artefact

Article 26(3) preserves "the deployer's freedom to organise its own resources and
activities" — the best available citation for performing oversight through a third
party. It appears **nowhere in the repository**.

Article 25(4) is real and unclaimed, with four qualifications that must be stated
rather than buried: it binds RateLoop too; it engages only where the customer is a
_provider_; claiming it means claiming integration, which sits awkwardly beside the
product's own line that it operates _around_ the customer's system; and it lands on
the same December 2027 date. Offer the agreement, not a badge.

### 3.5 Sell the runway and correct the timeline copy

Annex III obligations apply from 2 December 2027 under Regulation (EU) 2026/1744, in
force since 27 July 2026 — **fixed, not conditional**. The current copy says "the
Commission currently says", which understates settled law.

Sixteen months, no notified body for points 2–8, and zero harmonised standards
published or cited. The honest pitch is that nobody can tell you today what oversight
evidence must look like and no external party will gate you before December 2027 —
which is exactly why starting now is cheap.

Note also that Article 4 was replaced by the same regulation: the AI-literacy duty
softened from _ensuring_ a level to _taking measures to support_ its development. The
current framing is stale.

### 3.6 Reframe the honesty disclaimers as method

The privacy and evidence notices already say the product does not claim compliance it
has not got and does not market attestations it does not hold. They read as apology.
They are a procurement differentiator, and they will survive diligence that
competitors' pages will not.

---

## Tier 3b — What an EU buyer actually asks for

The product is sold as a compliance solution to EU companies, and the EU buyer's
diligence questions are not the ones the rest of this plan answers.

### 3b.1 Turn on enterprise identity

**SAML 2.0, OIDC and SCIM are already built and well hardened** — deprecated
algorithms rejected, IdP-initiated flows disabled, `InResponseTo` validation on,
domain verification required, and deprovisioning that reaches memberships, sessions,
agent OAuth families and MCP sessions. All of it is gated behind a single boolean.

Test it and turn it on. Probably the cheapest enterprise win available anywhere in
this plan.

### 3b.2 Commit to no model training, because it is already true

**There is no LLM SDK anywhere in the repository** — no OpenAI, Anthropic, AI SDK or
LangChain dependency, and customer output text never reaches a model provider.

State it precisely, because a diligence reader will grep. There are two other
`openai` hits: telemetry metadata the customer's own agent reports, and a marketing
package that calls a text-to-speech endpoint over raw `fetch` to generate voiceover.
Neither touches customer data, but the claim must be worded so that finding them
confirms it rather than contradicting it.

This is a stronger version of the clause every comparable vendor offers, and it is
independently verifiable by anyone reading the dependency manifest. Put it in the
DPA and say why it is checkable.

### 3b.3 Close the DPA's gaps

The DPA maps cleanly to Article 28(3), which most vendors' do not. Four things are
missing and all are drafting rather than engineering: a breach-notification SLA in
hours rather than "without undue delay"; a technical and organisational measures
annex, which the standard contractual clauses require anyway; an encryption-at-rest
statement, since artifacts are envelope-encrypted but nothing says so; and the
no-training clause from 3b.2.

One item is not drafting: **§9 promises "current reports" that do not exist.** Either
produce something or change the sentence.

### 3b.4 Gate customer content by classification before the network lane goes live

Network reviewers receive **decrypted plaintext**, and no data-classification check
prevents restricted or regulated content from reaching them. Reviewer geoblocking
covers sanctions only — a reviewer in any other non-EEA country can lawfully receive
plaintext under the current configuration.

This is the first question an EU security reviewer asks. It costs almost nothing to
fix **now**, while the lane is inert and no reviewer exists to be affected: refuse the
network audience above a configurable classification ceiling, and add an EEA-residency
predicate to the audience policy.

### 3b.5 Consolidate procurement evidence in the existing legal and evidence surfaces

No security attestation exists, so procurement readers need one consistent, dated
answer rather than a marketing badge. The tokenless design of record does not permit a
separate limitations or trust-status product page: incomplete capabilities and release
blockers belong in internal engineering readiness records. Keep the customer-facing
facts in the task where they are needed instead — the DPA and its technical and
organizational measures, the subprocessor and transfer notice, the privacy notice, and
the evidence documentation.

Those surfaces carry the standard security-questionnaire response, the processing
region and transfer boundary from 0.7, the no-training commitment, the absence of
unheld certifications, and the exact evidence-verification boundary. The subprocessor
list includes conditional transparency logging, timestamp authorities, GRC connectors,
and customer-directed object-storage exports. Keep the list and dated legal material
current; do not turn an unmet release gate into a public roadmap claim.

### 3b.6 Buy qualified timestamps

The highest-leverage credibility upgrade available to the evidence product, and it is
a purchase order.

Signed packets carry **no legal presumption** — they are admissible and nothing more,
which leaves the customer proving hash construction, key custody and clock source in
its own litigation, with RateLoop in the witness box. A qualified timestamp under
eIDAS Article 41(2) reverses that burden onto the challenger, and German and French
procedural law key their own presumptions to the same tier.

**ETSI EN 319 422 is a profile of RFC 3161, which the attestation pipeline already
implements.** This is closer to changing a URL and a trust anchor than to building
anything. Roughly €0.50–2.50 per token. Consider a qualified electronic seal under
Article 35(2) alongside it.

Do **not** pursue becoming a qualified trust service provider: conformity assessment,
supervisory approval, biennial audits, and listing is constitutive.

### 3b.7 Keep the scoring deterministic, deliberately

Not a task but a constraint the rest of the roadmap must respect, recorded here so it
is not traded away by accident.

Scoring reviewers, routing by those scores and pausing assignments is Annex III(4)(b)
on its face. The product escapes Chapter III because none of it infers. **Any
inference introduced into scoring, routing or triage risks making RateLoop the
provider of a high-risk system**, and Article 6(3) offers no relief because profiling
always forces high-risk status.

If an inference feature is wanted, ship it as a separately licensed, off-by-default
module and write the Article 3(1) assessment for the core product first.

---

## Tier 4 — Change how fixes are tested

The obvious remedy is not the right one. "Ship a test with every fix" was **already
the practice** — each regression-introducing commit shipped a behavioural test that
proved its own fix and constrained nothing downstream.

### 4.1 Write the rule down

There is no testing guidance in the repository's agent instructions, and the
contributing guide references a script that does not exist plus two CI jobs that do
not exist. One paragraph, encoding what the adversarial passes actually did: **when a fix
changes a rule, find every other site that re-derives that rule and add a test that
binds them.** Free, and it is the precondition for the rest.

### 4.2 Enumerate the terminal sets instead of hardcoding values

The work-item guard excludes terminal reasons by string prefix, but only two of three
terminal code sets emit one. A test that iterates the sets — rather than naming
strings — and forces each to fire on a final attempt would fail today, on a
possibly-paid payment authorisation that can be revived six hours after being
deliberately dead-lettered. **The three sets are module-private, so exporting them is
step one.**

That is a live instance of a bug already fixed once elsewhere. Iterating the sets
also means a fourth terminal code added without a prefix fails immediately.

Apply the same shape to the OAuth token family: one test walking generation N →
N+1 → replay → recovery, asserting the recovered credential is the honest client's.

### 4.3 Bind the cross-module invariants

Every one of the four regressions was an invariant asserted at one of two call sites.
The cluster cap is enforced in two modules that no test file imports together, and
the rule is now open-coded in both — the next divergence is already set up.

Better than a test: extract the rule into one exported function both modules call,
then test the extraction. Where extraction is impractical, write the test that
imports both and asserts they agree across an exhaustive small grid.

### 4.4 Property-test the idempotency keys only

Do not adopt property testing broadly. Adopt it for the one thing it is unbeatable
at: **injectivity of key derivation.** Distinct events must produce distinct keys;
redelivery of one event must produce the same key. Two properties over about six key
functions — the refund key, the work-item key, the GRC session and document keys, the
deletion job keys.

This would have caught the refund collision directly, and it is the only place in the
plan worth a new dependency.

### 4.5 Measure coverage, do not gate it

A one-line change to the test runner with no new dependency. It would not have caught
any of the four regressions — all were on lines already executed — but it would expose
that more than half the modules have no test file at all, and that a nine-hundred-line
OAuth module has five tests.

Report it. Do **not** gate on it: a threshold applied to a suite where roughly a
quarter of files assert source strings would mostly incentivise more of exactly that.

### 4.6 Fix what the harness cannot see

The in-memory test harness makes `transaction()` a passthrough and drops CHECK
constraints and partial unique indexes. **No test in the repository can detect a
missing rollback or a violated database-level uniqueness guard** — precisely the
protection that would have caught the refund collision at the storage layer.

Fixing the harness properly is large. The cheap first step is to document the
limitation where tests will see it, and to route the handful of
uniqueness-critical paths through a real Postgres in CI, which two jobs already
provision.

---

## Deferred, with reasons

**The switched-off marketplace.** Both paid lanes require a hash-bound activation
reference nobody has issued; the unpaid invited lane is unconditionally on. The
research that would settle what to do — whether a contracted external reviewer acting
under a deployer's authority can satisfy the mandates, and how audit independence,
clinical monitoring boards and moderation outsourcing resolve the same tension — did
not complete. **Do not act on this until it does.** It is the question that decides
whether the network lane is a product or a dead limb, and guessing is worse than
waiting.

**A workspace-level read-only role.** There is no central authorisation module;
membership SQL is re-implemented in more than fifteen places. Adding a role means
touching all of them. The project-level auditor role (1.5) serves the same need at a
fraction of the cost.

**A security attestation.** A Type 1 runs roughly $12–40K over three to eight months,
and the customary bridge — a written commitment to Type 2 by a date plus a completed
questionnaire — costs nothing. Take the bridge until a deal actually requires the
report.

**Mutation testing.** Hours per run against a suite this size, with a large
equivalent-mutant backlog to triage. Not for a solo-maintained repository.

**Promoting the collapsed charts.** Cosmetic next to everything above, and a test
pins the disclosure's label and position.

**New features, entirely.** Datasets, version comparison, code evaluators, a CI hook
and the rest are real gaps, but none of them is a defect and none makes an existing
claim true. They belong after this plan, not inside it — see
[evaluation-platform-gaps.md](evaluation-platform-gaps.md). The exception worth
naming here is **LLM-as-judge**, which is not merely deferred: it is constrained by
3b.7, and building it before the Article 3(1) assessment would undo the regulatory
position the rest of this plan depends on.

---

## Sequence

| Order | Items       | Why here                                                                   |
| ----- | ----------- | -------------------------------------------------------------------------- |
| 1     | 0.1 – 0.7   | Every day a false claim ships is exposure. Cheap, and all copy plus tests. |
| 2     | 2.1, 2.1b   | Worst defect found, plus a live sampling bug. Both are one change each.    |
| 3     | 3b.4        | Costs nothing while the network lane is inert. It stops being free later.  |
| 4     | 4.1 – 4.3   | Do these before other fixes, so the fixes below inherit the discipline.    |
| 5     | 3b.1 – 3b.3 | Enterprise identity is a boolean; the DPA items are drafting.              |
| 6     | 1.1 – 1.5   | Routing finished parts. Highest value per hour in the plan.                |
| 7     | 3b.5 – 3b.6 | Procurement disclosures need 0.7's wording; timestamps require a purchase. |
| 8     | 2.2 – 2.7   | Observability, cheapest first. 2.5 waits on 2.4 having run a while.        |
| 9     | 3.1 – 3.6   | Needs Tier 0 to have landed, or it re-aims copy that is still false.       |
| 10    | 1.6         | Wants 1.4 first, so a shared record is verifiable where it opens.          |
| 11    | 4.4 – 4.6   | Real value, no deadline.                                                   |

Tier 0, item 2.1 and item 3b.4 are the ones with a deadline attached — the first two
because they are wrong today, the third because it is free only until the network
lane has a reviewer in it. Item 3b.7 is a standing constraint rather than a task.
Everything else is improvement, and improvement can be sequenced by appetite.
