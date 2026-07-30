# RateLoop tokenless — strengths and weaknesses

Written 29 July 2026, drawing on a system survey, a legal review, market research,
and several rounds of adversarial code audit. This is an assessment, not a plan; the
plan is [remediation-plan.md](remediation-plan.md).

Revised twice on the same day. A second research pass verified each weakness against
the code: six of the eight were wrong in some respect, and two — the dashboard and
the compliance reader — were wrong in their central claim. A third, adversarial pass
then found that **the corrections had themselves introduced new errors**, including
two counts that were right before being "fixed", and one case where correcting a
documented defect away concealed a live bug.

All of it is recorded in place rather than quietly removed, because the pattern is
the finding, and it turned out to have two halves. Every first-round mistake came
from describing a survey instead of the code. Every second-round mistake came from
trusting a correction without re-deriving it. **Prefer a number you can regenerate
with a command over a number someone checked once.**

---

## The one-line verdict

**The engineering is unusually principled and the product built the hard half
first. What is missing is not capability but reachability** — of the metrics, of
the evidence, of the buyer, and of the reviewer supply that half the design assumes.

---

## Strengths

### 1. The trust model is designed, not asserted

Most products in this space claim integrity properties. This one enforces them
structurally, and the difference shows up in places nobody would check.

The fund contract has **no owner, no proxy, no pause, no sweep, no upgrade path**.
It has exactly one access-controlled function — cancelling an empty round — and
because the commit count only increases, **a single commit permanently closes the
funder's exit**. The no-cancellation-after-commit rule is a property of the code,
not a policy someone could revise.

Value leaves only through a claim to an address fixed by an on-chain preimage, or a
withdrawal of the caller's own credit. Solvency is validated when a round is
created, so the refund arithmetic cannot underflow. The credential issuer signs
nothing — it verifies against a digest the panel builds, and holds no token
reference at all.

Identity follows the same discipline. Principals are opaque and deliberately not
derived from wallets; wallet sign-in endpoints return 410 Gone; a principal with no
wallet can own a workspace; wallet proofs are purpose-bound, and the signed
challenge ends with a line stating it does not authorise account access. Operator
power is split across four separately credentialed surfaces, none of which grants
authority over another.

### 2. Honesty is mechanised

This is the most unusual thing about the codebase and deserves to be named as a
strength rather than a curiosity.

There is a **machine-enforced claim gate**: a capability map lists seventeen
capabilities and hardcodes fourteen to false, while the three it derives are false in
practice because the paid lanes require a hash-bound activation reference nobody has
issued. A fifteen-rule regex matrix then blocks matching phrases, enforced by a test
that walks every public page, every component those pages transitively import, every
machine-readable doc and every plugin markdown file. **Five claims are permanently
forbidden** and no capability can ever unlock them, including "compliance-ready",
"guarantees compliance", and "RateLoop verifies which model produced an output".

Agent execution evidence is typed such that "independently verified" can only ever
be false, and the parser rejects any other value. **There is no code path that can
mark an execution as independently verified** — which is exactly why that claim is
forbidden publicly.

Four documents are asserted by tests, so a claim in them cannot silently drift from
the code.

The privacy notice says the product does not claim launch-level data-protection
compliance, does not claim database-level anonymity, and does not market
attestations it does not hold. **That candour will survive procurement diligence
that competitors' pages will not.** It currently reads as apology; it should read as
method.

### 3. The mechanism design is real work

Deterministic sampling, verifiable after the fact: the bucket is an HMAC over scope
and opportunity identity, and the full digest is persisted so the draw can be
checked. A missing key fails closed rather than falling back to chance.

The scoring arithmetic exists in two production implementations — Solidity and
TypeScript — plus a JavaScript script, with a separate Solidity test oracle for the
sort and selection steps. One of the two is a fail-closed server-side verifier that
rejects the evidence bundle on mismatch. An independent audit worked the arithmetic by hand against a frozen vector and found
it exact, and grid-exactness tests exist for both branches. (The narrative that a
suspected rounding asymmetry was investigated and refuted is not recorded anywhere in
the repository; treat it as unverified.)

Beacon proofs are verified on chain with real pairing operations rather than
trusted. Where they cannot be, the fallback takes **no entropy at all** and pays
everyone the unconditional portion, rather than inventing a score.

### 4. Nobody else emits verifiable evidence

Across evaluation tooling, labelling platforms, governance suites and content
moderation — four adjacent markets, upwards of thirty vendors examined — **not one
emits cryptographically signed or tamper-evident evidence of human review
decisions.** The state of the art is a mutable application log plus an export.

Every incumbent's annotation output is designed as _engineering input_: reference
examples, ground-truth datasets, evaluator calibration. **Nobody's output is
designed to be handed to a regulator.**

That gap is real and unoccupied. The caveat belongs in the weaknesses.

### 5. The invited lane is legally the right shape, by accident or otherwise

Every legal regime that mandates human review — data protection, the two US regimes
landing in January 2027, financial communications rules, and the AI Act's deployer
duty — requires the deployer's **own** qualified, authorised person.

The invited lane is exactly that. The product's attestation model already records
competence basis, training records and authority scope with expiry, which is a close
match to the statutory language.

---

## Weaknesses

### 1. The compliance reader's machinery is built and left unrouted

A first draft of this section called the compliance reader "the only persona with no
onboarding path". Investigation showed that is too strong, and the truth is more
useful: **this is a packaging problem, not a capability problem.** Three pieces of
exactly what that persona needs exist, work, and are wired to nothing.

- **A project `auditor` role that no code path can create.** It grants read and
  export, no write, no manage — precisely an auditor. It is CHECK-constrained,
  supports expiry, and is enforced in two independent places including raw SQL. The
  functions that would grant it are called only from tests. A finished door with no
  handle fitted.
- **The verification key is already published**, unauthenticated and cacheable, at a
  public endpoint. The docs tell readers to get the pin from the authenticated
  workspace key history instead, and the endpoint is linked from nowhere.
- **The canonical framework map is imported by nothing at runtime.** It carries five
  frameworks and twelve rows, each with an explicit non-claim. The public table is
  hand-maintained prose — and has **already drifted**, citing AI Act articles the
  canonical map does not.

Browser-side verification is likewise closer than it looks. The verifier does no
network I/O, no chain reads and needs no exotic curve: it is four hundred and five lines with
five `node:crypto` touch points, and Ed25519 became available in every major
browser's WebCrypto in 2026. The one real friction is that its hash path is
synchronous while the browser's is not.

**What is genuinely missing is one thing:** a way to show a specific record to a
specific person who has no account. There is no share table, no expiring read grant,
and no token in the system that is not an authentication credential.

Two real constraints remain. The evidence tab does not exist until an engineer has
connected an agent, and reading a packet requires workspace `member` or above — so
the surface is still gated behind someone else's onboarding. And the product holds no
SOC 2, ISO or HIPAA attestation. That last one is smaller than it sounds: a Type 1
runs roughly $12–40K over three to eight months, and the customary bridge is a
written commitment to Type 2 by a date, plus a completed questionnaire.

### 2. Half the design is switched off, and one half assumes the other

The paid marketplace is fully implemented and gated behind a five-way evidence lock.
The reviewer surface offers eligibility, earnings, a payout wallet and identity
assurance, all inert. The landing statistics for verified humans and amounts paid are
zero — and are **never rendered**, because the social-proof projection filters out
zero values and omits the strip entirely, which a test pins.

So the product is not a two-sided marketplace today; it is a single-sided workflow
tool for a team reviewing its own agent's output. That is a coherent product — but
the mechanism design, the scoring, the timelock commit–reveal and the fund core all
exist to serve the half that is off.

**The hard half was built first.** Whether that was the right order is the open
strategic question in the whole picture.

### 3. Several failures are silent

The pattern is real, though a first draft of this section mislocated it. The
transparency-log attestation is **not** an example — its unavailable count does force
a degraded run and does reach the operator panel. What is true:

- **The worst instance is on the evidence path itself.** Evidence projection for a
  _terminal_ private-review decision is called fire-and-forget with a catch that
  discards everything. The review commits and returns success while its decision
  evidence may never be projected. On a product whose proposition is evidence, this
  outranks everything else in this document.
- **The integrity-epoch producer's disabled result is invisible in both directions.**
  It is absent from the degraded predicate and absent from the health panel's signal
  list, so `disabled`, `empty`, `created` and `failed` are equally unobservable.
- **The top-up reconciler returns `{0,0,0}` for three distinct states** — switched
  off, ran and found nothing, and threw. The failing case is un-credited customer
  money.
- **The runner isolates thirty-six units, not twenty**, and returns **HTTP 200 for
  any number of failures**. The run record is more honest than the transport: status
  does flip to degraded and the failures are persisted. But only `error.name`
  survives — message and stack are discarded, so a plain `Error` records as
  `errorCode: "Error"`.
- **The Stripe webhook logs "needs operator attention" and then returns 200** so
  Stripe stops retrying. The only durable signal is an unadvanced row.
- **The health panel renders `null` when its own fetch fails.** The surface built to
  reveal silent failure fails silently.

Underneath all of it is a reporting gap: the panel names fifteen signals while the
degraded predicate has thirty-six terms, so **twenty-one terms across thirteen
subsystems** can degrade a run and produce an amber badge with **no chips saying
why**.

For a product whose value proposition is _evidence that something happened_, **a
subsystem that silently does nothing is the worst available failure mode.**

### 4. The most exposed claim is one the code contradicts

No host holds the "verified" tier — two are supported, seven experimental. The type
system does **not** pin the verified variant off, as a first draft of this section
claimed; the union permits it and merely couples it to mandatory evidence fields.
What holds the count at zero is a runtime test assertion and a comment. The
distinction matters: promoting a host means deleting a test line, not defeating the
type checker.

The documentation nonetheless states that a verified host **can prove** an output
stayed undelivered, and names a specific product as "the primary verified path" — a
sentence flatly contradicted by the support matrix two files away.

**The capability is not merely unbuilt, it is structurally unreachable.**
Host-enforced mode has a full schema, a database CHECK constraint and an activation
gate that rejects any attempt to enable it without an evidence reference — and
nothing in the repository ever writes that reference. The gate only ever refuses. A
customer who asked for host enforcement and paid could not be given it.

There is also a collision worth naming: **"verified" carries two incompatible
definitions.** In the connection docs it is a QA smoke-test milestone. In the
oversight and evidence pages it means _enforces withheld delivery_ — a regulatory
capability. Even if a host passed the smoke test tomorrow, the oversight claims still
would not be licensed.

This is the one item worth treating as urgent. It offers an unavailable capability
as the answer to the single oversight measure the product cannot otherwise support,
using the verb _prove_, and it is exposed under misleading-advertising law as much
as under the AI Act. The tier-honesty test covers only the two connection pages,
which is why the language survived everywhere else — and four other test files
currently assert the false copy as contract.

### 5. The regulatory story is aimed at the wrong article, and oversold

Article 14 binds the **provider**, not the deployer, and does not require evidence
that oversight occurred — it requires that systems be designed so they _can_ be
overseen. The per-decision human record the product emits maps to an article that
applies only to one biometric category.

Worse for the sales story: conformity assessment for Annex III points 2–8 is
**internal control with no notified body**, and **zero harmonised standards are
published or cited in the Official Journal**. One qualification to a first draft of
this section: "no external party will ever ask" is an overreach. No _ex ante
gatekeeper_ will. Technical documentation and a quality management system are still
required, market surveillance authorities can demand both, and customers, insurers
and litigants ask regardless. The accurate version is narrower and still fatal to a
checklist sales motion: **there is no gatekeeper and no published specification of
what oversight evidence should look like, so there is nothing to sell against.**

The product also structures pages as a requirement-citation checklist paired
one-to-one with features — five numbered cards keyed to Article 14(4)(a)–(e), then a
nine-row table. Each card is hedged; the _form_ is the claim. Nothing in the claim
gate detects this, because the gate matches phrases and the problem is a structure.

Two things are conversely **undersold**. The invited-versus-network distinction is
the best legal argument available and appears as the last section of one page.
Article 26(3) — which preserves "the deployer's freedom to organise its own resources
and activities", the strongest citation for performing oversight through a third
party — appears **nowhere in the repository**.

Article 25(4) is real and cited nowhere, but it needs more qualification than a first
draft gave it. It binds RateLoop as much as the customer; it engages only where the
customer is a _provider_, whereas the docs address deployers throughout; claiming it
means claiming to be "integrated in" the high-risk system, which sits awkwardly
beside the product's own line that it operates _around_ your AI system; and it lands
on the same December 2027 date as the rest. It is a procurement artefact — "here is
our Article 25(4)-ready supplier agreement" — not a badge.

The correctly aimed story is **Article 26(2)**, which binds the actual buyer, is
about people rather than system design, and matches shipped code field for field: the
statute names competence, training and authority, and the attestation model stores
competence basis, training records, authority scope and expiry.

### 6. Documentation drifted far enough to mislead

Before this rewrite: a scope was documented as five dimensions where the constraint
has twelve and the identity hash uses fourteen; the README advertised paid mechanisms
with no availability caveat and cited a deployment a full generation out of date; a
CLI command was documented that does not exist.

One item originally listed here proved to be a code defect rather than documentation
drift. Older documents described a 10% monitoring floor while runtime sampling and
reporting modules re-derived different values. The implementation now has one shared
stage-rate definition: monitoring is 10%, and runtime decisions, owner UI, projections,
and coverage alerts all consume that rule.

The four documents asserted by tests did not drift. **Everything not mechanically
checked did.** That is the lesson, and it is why this replacement set is deliberately
small — and why "the docs are stale" should be a hypothesis to test against the code,
not a conclusion.

### 7. Some dashboard state is served but never rendered

A first draft of this section was substantially wrong, and the correction is worth
recording because of _how_ it was wrong. It described an overview tab that was an
administration page, three charts buried in a collapsed disclosure, a performance
rollup rendered by nothing, two tabs with no link between them, and state that lived
in React rather than the URL. **Four of those five had already been fixed before this
document was written.** The overview leads with headline cards, a version table,
trend charts and a review-quality panel; the rollup renders with a Wilson lower bound
and its sample size; and three hand-written modules keep filters and selection in the
query string.

The lesson is the one in weakness 6, turned on this document: **an assessment written
from a survey rather than from the code at hand will describe a state of the world
that has passed.** A third pass then caught the correction itself drifting — the
Evidence tab has since been **deleted**, so a claim here that it and Results "link
both ways" described a two-tab relationship that no longer exists. Both panels now
sit on Results and the run links survive as same-page anchors.

What actually remains is narrow, and narrower than the correction claimed. Of five
visualisations, **two are top-level and three sit inside a collapsed "operations and
policy details" disclosure** whose label and position a test pins. The per-scope
rollup is partly consumed — a summary component reduces it to five headline totals —
so the dead payload is the per-scope detail rather than the whole object. Only one of
the three URL modules uses `pushState`, so Back does **not** undo run selection or
overview filtering in the other two. Overview filters are parsed only on the client,
so a shared link renders the default view before hydration corrects it. And the
scheduled-worker health panel is the last piece of operations plumbing on a
performance tab.

One constraint any future work inherits: **there is no charting library.** Every
chart is hand-rolled inline SVG with `role="img"`, a title and description, and a
redundant text summary. That convention is a genuine accessibility asset and should
be followed rather than replaced.

### 8. Fixes have repeatedly introduced new defects

Worth recording because it is a process observation, not a code one. Across two
rounds of adversarial review, changes made to close findings introduced: a recovery
path that handed a connection to whoever replayed a token; a refund key collision
that silently dropped every partial refund after the first; a revival rule that
resurrected work deliberately dead-lettered for operator attention; and a cluster
cap that turned a refusal at reservation time into a round that gets paid for and
then delisted.

Every one was caught by an adversarial pass rather than by the test suite. **The
practice of reviewing fixes as hostilely as the original code is doing real work
here and should continue.**

The obvious remedy is not the right one. "Ship a test with every fix" was **already
the practice** — each of those three commits shipped a behavioural test that
correctly proved its own fix, and none of them constrained the consequence. All four
failures share one shape: **an invariant that spans two call sites was asserted at
only one of them.** The cluster cap is enforced in two modules that no single test
file imports together, and the rule is now open-coded in both. The refund key was
never tested for injectivity. The work-item guard excludes terminal reasons by string
prefix while only two of three terminal code sets emit one — which is why a third
instance of that same bug is still open today, on a possibly-paid payment
authorisation.

Two related facts are worth recording. The source-string test style is real but
**concentrated where it matters least**: the evidence, billing and authentication
modules are essentially free of it, and their weakness is case count rather than
assertion style — five tests for nine hundred lines of OAuth, twelve for an
eighteen-hundred-line authentication surface. And the pg-mem harness makes
`transaction()` a passthrough while dropping CHECK constraints and partial unique
indexes, so **no test in the repository can detect a missing rollback or a violated
database-level uniqueness guard** — precisely the protection that would have caught
the refund collision at the storage layer.

---

## The three questions this assessment cannot answer

1. **Was building the hard half first correct?** The mechanism design, contracts and
   settlement machinery are the strongest engineering in the product and serve the
   lane that is switched off. The lane that runs needs almost none of it.

2. **Is the category real enough to sell into?** The operational budget for humans
   checking AI output is large and growing. The compliance-evidence budget is small,
   unnamed by analysts, and not yet triggered. The strongest datapoint in favour
   comes from a different regulation than the one the product leads with.

3. **Can the reviewer marketplace be both independent and compliant?** Independence
   is the deepest moat — every incumbent's reviewer is the customer's own employee
   scoring their employer's system on a mutable record. But every legal mandate
   requires the deployer's own authorised person. **The two properties that make the
   network lane valuable and the properties that make it compliant are in direct
   tension**, and the resolution is probably to stop selling them as one product.
