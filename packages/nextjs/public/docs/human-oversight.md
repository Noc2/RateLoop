# Human Oversight

Article 26(2) requires deployers of high-risk AI systems to assign oversight to people with the necessary competence,
training, authority, and support. RateLoop can support that configured workflow and record its operation; your
organization selects, authorizes, and supports the people who perform it.

## Start with who has authority

Customer-invited reviewers can be people your organization designates and authorizes for its oversight workflow.
RateLoop records the scope you assign to them, but your organization remains responsible for their competence,
training, authority, and support. A RateLoop-network reviewer is not designated by your organization and has no
authority over your system. Network review is supplementary quality input, not your Article 26(2) oversight.

## Shared responsibility

Your people provide oversight. RateLoop supports the configured workflow and records its evidence.

RateLoop does not determine whether the EU AI Act applies or establish compliance. That depends on your system, role,
context, organization, and operation. RateLoop operates around your AI system; only a verified host integration can
enforce its review state at the output boundary. No host currently holds that tier.

## The deployer's people and process

RateLoop records oversight designations with competence basis, training completed, authority scope, and expiry. It
records the reviews, decisions, overrides, and stops those people make. These records can support your evidence of how
oversight was organized; they do not decide whether the Act applies or establish that the people or process meet
Article 26(2).

## If you also provide the AI system

Article 14 binds the provider of a high-risk AI system. It requires the system to be designed and developed so that
natural persons can effectively oversee it. RateLoop operates around the customer's system and does not by itself
satisfy that provider design duty. The capabilities below may support an oversight process for a system that was
designed to expose the necessary controls and information.

## Controls the workflow exposes

### See operation and exceptions

Your designated people monitor operation from the oversight dashboard: sampling coverage, response latency,
disagreement, and blocked outputs, per scope. In-app, email, and browser alerts flag disagreement spikes,
coverage-floor hits, blocked outputs, failed or expired reviews, and workspace stops, and event webhooks feed your
own monitoring. Per-agent evidence summaries show the declared provider and model alongside observed workflows and
risk tiers — declared metadata labelled host-reported, not independently verified.

You remain responsible for watching those surfaces, understanding the agent's capacities and limitations, and acting
on what they show for your use case.

Legal context: relevant where a provider addresses Article 14(4)(a) monitoring.

### Collect independent judgments

Independent blinded panels judge the output before your decision: sealed answers keep early judgments private, so
reviewers cannot anchor on each other. The decision prompt ships with no preselected choice, disagreement and
calibration signals appear above the decision buttons, and the deciding person's own override-rate trend stays
visible to them.

You remain responsible for staying aware of the pull to over-rely on the system and keeping each decision a
considered one.

Legal context: relevant where a provider addresses Article 14(4)(b) automation bias.

### Put the output in context

The owner case view shows the oversight person the actual output, its source context, reviewer rationales, and
surfaced disagreement before their decision. For workspace-internal cases your workspace owns that data;
public-network cases keep the aggregate-only view.

You remain responsible for correctly interpreting the output within your domain, workflow, and context.

Legal context: relevant where a provider addresses Article 14(4)(c) interpretation.

### Record the human decision

Every go, revise, and stop decision is recorded against the case. Per-output override records carry a required
reasons field and join the workspace audit chain, and the override rate is a first-class metric on the dashboard and
in coverage exports.

You remain responsible for deciding when to disregard, override, or reverse an output.

Legal context: relevant where a provider addresses Article 14(4)(d) disregard, override, or reversal.

### Control intervention and stop

Only a verified host adapter that controls delivery can establish that an eligible output stayed undelivered until a
person decided. No host currently holds that tier. Ordinary Codex, plugin, and MCP integrations are advisory: they
report the review lifecycle but do not verify interception or withheld delivery. RateLoop's workspace stop blocks new review-triggered release
authorizations; a verified host must honor that state at delivery, while an advisory host can bypass it. Releasing the
stop restores no agent grant automatically.

You remain responsible for choosing which outputs are gated, when to intervene, and when to halt.

Legal context: relevant where a provider addresses Article 14(4)(e) intervention or stop controls.

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

The shared-responsibility matrix and the exportable evidence behind each capability live in
[`evidence.md`](./evidence.md). The browser version is [`/docs/human-oversight`](/docs/human-oversight).
