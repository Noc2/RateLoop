# Human Oversight

RateLoop can support a deployer's configured human oversight of AI agent outputs: monitor, interpret, override, and
stop, with records of each step. This page maps Article 14(4) measures to relevant RateLoop capabilities and the duties
that remain with the deployer.

## Shared responsibility

Your people provide oversight. RateLoop supports the configured workflow and records its evidence.

RateLoop does not determine whether the EU AI Act applies or establish compliance. That depends on your system, role,
context, organization, and operation. RateLoop operates around your AI system; only a verified host integration can
enforce its review state at the output boundary.

## The five Article 14(4) measures

### 1. Monitor operation — Article 14(4)(a)

Your designated people monitor operation from the oversight dashboard: sampling coverage, response latency,
disagreement, and blocked outputs, per scope. In-app, email, and browser alerts flag disagreement spikes,
coverage-floor hits, blocked outputs, failed or expired reviews, and workspace stops, and event webhooks feed your
own monitoring. Per-agent evidence summaries show the declared provider and model alongside observed workflows and
risk tiers — declared metadata labelled host-reported, not independently verified.

You remain responsible for watching those surfaces, understanding the agent's capacities and limitations, and acting
on what they show for your use case.

### 2. Counter automation bias — Article 14(4)(b)

Independent blinded panels judge the output before your decision: sealed answers keep early judgments private, so
reviewers cannot anchor on each other. The decision prompt ships with no preselected choice, disagreement and
calibration signals appear above the decision buttons, and the deciding person's own override-rate trend stays
visible to them.

You remain responsible for staying aware of the pull to over-rely on the system and keeping each decision a
considered one.

### 3. Correctly interpret the output — Article 14(4)(c)

The owner case view shows the oversight person the actual output, its source context, reviewer rationales, and
surfaced disagreement before their decision. For workspace-internal cases your workspace owns that data;
public-network cases keep the aggregate-only view.

You remain responsible for correctly interpreting the output within your domain, workflow, and context.

### 4. Disregard, override, or reverse — Article 14(4)(d)

Every go, revise, and stop decision is recorded against the case. Per-output override records carry a required
reasons field and join the workspace audit chain, and the override rate is a first-class metric on the dashboard and
in coverage exports.

You remain responsible for deciding when to disregard, override, or reverse an output.

### 5. Intervene or stop — Article 14(4)(e)

Only a verified host adapter that controls delivery can establish that an eligible output stayed undelivered until a
person decided. Ordinary Codex, plugin, and MCP integrations are advisory: they report the review lifecycle but do not
verify interception or withheld delivery. RateLoop's workspace stop blocks new review-triggered release
authorizations; a verified host must honor that state at delivery, while an advisory host can bypass it. Releasing the
stop restores no agent grant automatically.

You remain responsible for choosing which outputs are gated, when to intervene, and when to halt.

## Designation, competence, and literacy

Article 26(2) requires oversight to be assigned to natural persons with competence, training, and authority. RateLoop
records oversight designations with attestation records — competence basis, training completed, and authority granted
— exportable as an assignment record, and emits audit events on every role assignment and change. Reviewer and
oversight-person training and calibration records can be exported as evidence relevant to Article 4 AI-literacy
duties. Choosing those people, and ensuring their competence, training, and authority, remains yours.

Audit and evidence exports map to the Commission's draft Article 73 serious-incident reporting template — labelled
draft-aligned until the template is final — and the workspace's oversight configuration exports as a factual
description of the implemented oversight measures, usable as input for an Article 27 fundamental-rights impact
assessment.

## Which reviewer lane carries this

Invited reviewers are your personnel: the people your organization designates, whose competence, training, and
authority you attest. That lane can support your configured oversight workflow. The public network is supplementary
review capacity and an independent quality signal; neither lane by itself establishes that Article 14 or Article 26
duties are met.

The shared-responsibility matrix and the exportable evidence behind each capability live in
[`evidence.md`](./evidence.md). The browser version is [`/docs/human-oversight`](/docs/human-oversight).
