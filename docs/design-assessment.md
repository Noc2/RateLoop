# RateLoop tokenless — strengths and weaknesses

Written 29 July 2026, drawing on a system survey, a legal review, market research,
and several rounds of adversarial code audit. This is an assessment, not a plan.
Claims are the ones that survived being checked; where something is a judgement
rather than a fact, it says so.

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

There is a **machine-enforced claim gate**: a capability map hardcodes fourteen of
seventeen capabilities to false, and a regex matrix blocks matching phrases across
every public page, enforced by a test. Four claims are permanently forbidden,
including "compliance-ready" and "guarantees compliance".

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

The scoring library exists in three implementations with byte-identical arithmetic,
one of which is a fail-closed server-side verifier that rejects the evidence bundle
on mismatch. An independent audit worked the arithmetic by hand against a frozen
vector and found it exact; a suspected rounding asymmetry was investigated and
**refuted** — predictions sit on a grid that makes both branches exact.

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

### 1. The product's deepest asset is unreachable by the person who values it

The compliance reader is **the only persona with no onboarding path**. Reaching the
evidence means a tab inside an engineer's workspace; consuming it means running a
verifier from a terminal with a pinned key.

Meanwhile the product **onboards an engineer and monetises an engineer** at a $99
ceiling, while the evidence machinery is worth most to a buyer who cannot get into
the product and, lacking any security attestation, could not clear procurement
anyway.

**This gap — not the competitive landscape — is the central problem.**

### 2. Half the design is switched off, and one half assumes the other

The paid marketplace is fully implemented and gated behind a five-way evidence lock.
The reviewer surface offers eligibility, earnings, a payout wallet and identity
assurance, all inert. Live statistics read **zero verified humans and zero paid
out**.

So the product is not a two-sided marketplace today; it is a single-sided workflow
tool for a team reviewing its own agent's output. That is a coherent product — but
the mechanism design, the scoring, the timelock commit–reveal and the fund core all
exist to serve the half that is off.

**The hard half was built first.** Whether that was the right order is the open
strategic question in the whole picture.

### 3. Several failures are silent

The pattern recurs often enough to be structural rather than incidental:

- The transparency-log attestation counts jobs as unavailable **while the
  maintenance tick reports success**.
- The integrity-epoch producer returns a disabled result.
- The top-up reconciler returns zeroes.
- The maintenance runner catches every processor error into a failures array and
  returns a zero-valued fallback, so **any of roughly twenty processors can be
  permanently broken while the endpoint returns 200**. It is observable in the run
  summary — but only if read.

Repeated audits found the same shape elsewhere: work that dies and is never retried,
a health signal that goes quiet exactly when a failure becomes permanent, and an
attestation queue that reported pending work forever while reading as healthy.

For a product whose value proposition is _evidence that something happened_, **a
subsystem that silently does nothing is the worst available failure mode.**

### 4. The most exposed claim is one the code contradicts

No host holds the "verified" tier — two are supported, seven experimental, and the
type system pins the verified variant off. The module's own comment says so.

The documentation nonetheless states that a verified host **can prove** an output
stayed undelivered, and names a specific product as "the primary verified path".

This is the one item worth treating as urgent. It offers an unavailable capability
as the answer to the single oversight measure the product cannot otherwise support,
using the verb _prove_, and it is exposed under misleading-advertising law as much
as under the AI Act. The existing tier-honesty test covers only the connection
pages, which is why the language survived elsewhere.

### 5. The regulatory story is aimed at the wrong article, and oversold

Article 14 binds the **provider**, not the deployer, and does not require evidence
that oversight occurred — it requires that systems be designed so they _can_ be
overseen. The per-decision human record the product emits maps to an article that
applies only to one biometric category.

Worse for the sales story: conformity assessment for most high-risk categories is
**internal control with no notified body**, and **zero harmonised standards are
published**. So for most of the interesting market, no external party will ever ask
to see the evidence, and no specification says what it should look like.

The product also structures pages as a requirement-citation checklist paired
one-to-one with features. Each card is hedged; the _form_ is the claim.

Two things are conversely **undersold**: the invited-versus-network distinction,
which is the best legal argument available and sits in a footnote; and Article 25(4),
which requires providers to hold written agreements with third-party service
suppliers — a real, favourable provision describing exactly what RateLoop is, cited
nowhere.

### 6. Documentation drifted far enough to mislead

Before this rewrite: a scope was documented as five dimensions where the schema has
twelve; a monitoring floor was documented at 10% where the code samples at 25%; the
README advertised paid mechanisms with no availability caveat and cited a deployment
a full generation out of date; a CLI command was documented that does not exist.

The four documents asserted by tests did not drift. **Everything not mechanically
checked did.** That is the lesson, and it is why this replacement set is deliberately
small.

### 7. The interface leads with the record and hides the summary

The overview tab is an administration page. All three charts in the product sit
inside a collapsed element labelled "operations and policy details" at the bottom of
another tab. A per-agent performance rollup — endorsement rate with a confidence
bound, review rate, latency, tokens — is computed, served over the wire, and
**rendered by nothing**.

Two tabs share a primary key and expose no link along it. Selection and filter state
lives in React rather than the URL, so **no view can be linked to** — which matters
more here than in most products, because a record that cannot be cited is a poor
evidence artefact.

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
