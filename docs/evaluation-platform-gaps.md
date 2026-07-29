# What RateLoop is missing as an evaluation platform

Written 29 July 2026, from a reading of Humanloop's product against RateLoop's code.

## Why Humanloop, and what it actually proves

Anthropic acquired Humanloop in August 2025. Two details matter before drawing any
lesson from it: it was a **talent acquisition that did not include the assets or
IP**, and the platform was **sunset later that year**. Three co-founders and around a
dozen engineers joined; the product stopped.

So what was validated is the team and the problem framing — that evaluation and human
feedback are the bottleneck in shipping LLM applications, and that the workflow
deserves a first-class tool. What was _not_ validated is the business. Copy the
workflow design; do not infer commercial proof.

## Humanloop's model in five primitives

| Primitive       | What it is                                                       |
| --------------- | ---------------------------------------------------------------- |
| **Prompt**      | The versioned unit under test                                    |
| **Dataset**     | Datapoints: inputs, optionally with expected results             |
| **Evaluator**   | A function over a log returning a judgment — code, LLM, or human |
| **Log / Trace** | What the application actually produced                           |
| **Evaluation**  | Dataset × Evaluators × versions, run offline or online           |

Around them: a prompt editor, version control over prompts, datasets and evaluators,
CI/CD integration, online evaluators on live traffic, tracing with replay, alerting,
and three named personas — product manager, engineer, domain expert.

**The structural insight worth stealing is that the evaluator is one abstraction with
three implementations.** Code, model and human are interchangeable at the interface.
That is what lets a team run everything cheaply and continuously, then escalate only
the uncertain cases to a person.

## What RateLoop already has

Versioned agents, runs and outputs, assurance scopes partitioned across twelve
dimensions, and human review with panels, blinding and consensus measurement.

And two things Humanloop never had: an **adaptive coverage ladder** that moves a scope
between review rates as confidence accumulates, and **cryptographically signed
evidence** of what the humans decided.

## The gaps, ranked

### 1. There is no dataset primitive — the largest structural gap

Nothing in the schema represents a curated set of inputs with expected results. Every
run is production traffic.

Without it there is no pre-deployment testing, so the product can only tell a customer
how an agent behaved **after** it was released. For a compliance product this is the
wrong side of the event: an EU deployer's diligence story is that it tested before
deploying and can show what it tested against.

The compliance framing also makes the feature more valuable than its evaluation-tool
framing. A golden set becomes "the fixed benchmark this agent is measured against,
versioned, with human verdicts attached" — evidence of pre-market testing rather than
a developer convenience.

### 2. There is no version comparison

The product records that version 7 was reviewed. It cannot say whether version 7 is
better or worse than version 6.

This is the single most requested thing in every evaluation tool, and here it maps
directly onto a deployer obligation: when you change a system in production you are
expected to know what changed. Combined with the dataset primitive, it produces the
artefact a customer actually wants to hand over — _we changed the agent, here is the
human-judged difference._

Cheaper than it sounds: the scope rollup already computes endorsement with a Wilson
lower bound and sample size per version. The comparison is largely a view over data
that exists.

### 3. There is no CI hook

No way to run a check on a pull request, gate a deploy, or fail a build. Humanloop
treated this as core, and it is what makes an evaluation tool stick to the engineer
who installs it — the one persona RateLoop already serves best.

The honest version for a human-review product is asynchronous: open a review gate, and
either block the deployment until decisions land or report the last known posture for
that scope. The second is more useful and much easier.

### 4. Traces, not just outputs

RateLoop reviews a candidate output. Agents are multi-step, and when a reviewer
rejects an output the useful question is _which step went wrong_. Telemetry ingestion
already exists; the reviewer surface does not show a trace.

Large, and worth scoping carefully. But "the human saw the reasoning, not just the
answer" is a materially stronger oversight claim than "the human saw the answer" —
Article 14(4)(c) is about interpreting output correctly.

### 5. Code evaluators — cheap, and safe

Deterministic assertions over an output: schema validity, forbidden strings, required
citations, length and format bounds. Humanloop's cheapest evaluator class.

These fit RateLoop without any regulatory complication, because they infer nothing.
They compose naturally with the adaptive sampler as a pre-filter: everything failing a
deterministic check is worth a human look, and everything passing can be sampled
normally.

### 6. User feedback capture on live output

Humanloop captured end-user signals on production traffic and fed them back as an
online evaluator. RateLoop has no channel for "the customer's own users said this
output was wrong", which is the highest-value review signal available and is free.

### 7. Alerting

Humanloop shipped alerts and guardrails. RateLoop's attention list is a page someone
must open. The observability work already planned builds most of the machinery; the
customer-facing half is a small addition on top.

## The one to be careful with: LLM-as-judge

The obvious lesson from Humanloop is to add a model evaluator, and it is genuinely
attractive here. The plan's quotas imply about a thousand reviewable outputs a month;
a model triage layer would let scarce human attention go to the cases that need it,
which is exactly what the adaptive ladder is trying to do with less information.

**It is also the one feature that could make RateLoop a regulated high-risk provider.**
Scoring reviewers, routing by those scores and pausing assignments is Annex III(4)(b)
of the AI Act on its face. The product escapes Chapter III today for one reason only:
nothing in it infers. Classification is assessed on the system as placed on the
market, so an inference feature anywhere plausibly makes the whole product an AI
system — and Article 6(3) offers no relief, because profiling always forces high-risk
status.

Article 50 compounds it. Transparency obligations apply from **2 August 2026** and were
not deferred. A model-written summary shown to a reviewer is synthetic content
requiring machine-readable marking, and a conversational reviewer surface requires an
AI-interaction disclosure.

None of this forbids the feature. It means:

- ship it as a **separately licensed, off-by-default module**, not a core capability
- write the Article 3(1) assessment for the core product **first**
- keep the evidence pipeline and reviewer scoring strictly deterministic
- let the model decide only **what a human looks at**, never the outcome — the human
  stays the decision-maker, which is what the compliance story rests on

## What not to copy

**The prompt editor, the playground, and multi-model routing.** That is an LLM
development tool. Building it would put RateLoop into a crowded fight where it has no
advantage, against products whose teams are larger, and would dilute the one thing
nobody else does. RateLoop's customer already has a prompt tool; what it does not have
is signed evidence that a qualified person reviewed the output.

## Where Humanloop was unambiguously ahead, and it is not a feature

SOC 2 Type 2, GDPR and HIPAA, VPC deployment, EU and US hosting options, RBAC, custom
SSO/SAML, third-party penetration testing, and a commitment that data is never used
for model training.

That is the enterprise-readiness surface, and it is the actual entry ticket for the EU
buyer this product is aimed at. RateLoop holds none of the attestations — but SSO,
SAML and SCIM are already built and switched off, and the no-training commitment is
**already true and independently verifiable**, because there is no LLM SDK anywhere in
the repository. Those items are in
[remediation-plan.md](remediation-plan.md) under Tier 3b.

## Suggested order

| Order | Item                      | Why                                                  |
| ----- | ------------------------- | ---------------------------------------------------- |
| 1     | Code evaluators (5)       | Cheap, no regulatory complication, feeds the sampler |
| 2     | Datasets (1)              | Unlocks 2, and reframes as pre-deployment evidence   |
| 3     | Version comparison (2)    | Mostly a view over data already computed             |
| 4     | User feedback capture (6) | Highest-value signal available, and free             |
| 5     | CI hook (3)               | Sticks the product to the engineer who installs it   |
| 6     | Alerting (7)              | Rides on the observability work already planned      |
| 7     | Traces (4)                | Large; strongest oversight claim of the set          |
| —     | LLM-as-judge              | Only after the Article 3(1) assessment, and modular  |
| —     | Prompt editor             | Do not build                                         |
