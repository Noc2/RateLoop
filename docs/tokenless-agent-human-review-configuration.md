# Tokenless agent human-review configuration

Status: design of record for the agent Human review journey. This document refines the agent-connection and adaptive-review sections of
[`tokenless-immutable-implementation-plan-2026-07.md`](./tokenless-immutable-implementation-plan-2026-07.md).

The normative opportunity lifecycle and terminal behavior are defined in
[`tokenless-agent-review-state-machine.md`](./tokenless-agent-review-state-machine.md).

## Product contract

The owner configures one **Human review** journey. The implementation keeps three independently versioned and auditable objects:

1. a **selection policy** decides whether an eligible output needs review;
2. a **request profile** freezes who may see the case, what they answer, how long they have, the panel size, and compensation defaults; and
3. a **delegation grant** decides whether the connected agent may only check policy, prepare an owner-approved request,
   or send automatically within exact publishing limits and, when payment is enabled, funding limits.

Changing one object never widens another. A request is authorized only when the exact active versions are bound to the integration. Active opportunities and funded rounds retain their frozen versions when a future policy is edited.

## Eligible outputs

An eligible output is a completed response in a workflow explicitly bound to the policy. Setup messages, tool chatter, health checks, review-status messages, and resumed delivery of an already-recorded opportunity are not eligible outputs. The host supplies an idempotent external opportunity ID and privacy-safe execution metadata. RateLoop never accepts hidden reasoning, raw prompts, tool payloads, or an unapproved private-to-public projection.

## Selection choices

| Choice | Behavior |
| --- | --- |
| Adaptive | Starts at 100% and may move to 50%, 25%, and the 10% monitoring floor only after the frozen evidence windows pass. |
| Every eligible output | Requires review for every eligible output. |
| Fixed percentage | Uses deterministic sampling at the configured rate and forces review when the maximum unreviewed gap is reached. |
| Risk rules | Requires review for configured risk tiers, incomplete metadata, or confidence below the owner threshold. |
| Manual handoff only | Never requires review automatically. The owner or host starts each handoff. |

Critical-risk and incomplete-metadata safety rules override sampling. A request or spend cap never converts a required decision into `skip`; it yields `approval_required` or `blocked`.

## Audience and data matrix

Audience and material sensitivity are separate dimensions.

| Audience | Permitted material | Compensation | Initial availability |
| --- | --- | --- | --- |
| Invited reviewers | Private workspace material through encrypted, assignment-bound leases; public-safe material is also allowed | Unpaid or USDC-paid | Unpaid ships first; paid stays hidden until voucher settlement is ready |
| RateLoop network | Public, synthetic, or owner-confirmed redacted material only | USDC-paid | Available only when public paid-panel readiness passes |
| Hybrid | Public-safe material only; invited and network cohorts remain separate and deduplicated | USDC-paid | Hidden until both lanes and aggregation pass readiness |

`private`, `internal`, `confidential`, `restricted`, and `regulated` artifacts never enter public question records. Hybrid review cannot autonomously derive a public projection from private material.

## Question authority and rationale

The owner chooses who writes the binary question:

- **Use one question** freezes an owner-written criterion and two answer labels in the request profile. Results use
  `assurance` semantics and may contribute to adaptive agreement only when every other comparability gate passes.
- **Let the agent ask each time** lets the connected agent supply one bounded binary question and two answer labels for
  each required review. Results use `feedback` semantics: they report the selected answer and distribution, never
  agent agreement, correctness, approval, or audit calibration.

Question authority never delegates audience, material classification, timing, panel size, compensation, rationale, or
spending. Written rationale remains owner-controlled as `off`, `optional`, or `required`. The first valid review request
freezes the exact question, labels, author, semantics, and hash before approval, publication, assignment, reservation,
or spend. An idempotent retry must match that snapshot; changed wording or labels fail with a conflict.

Agent-written questions are binary-only, are treated as reviewer-facing data rather than instructions, and must obey the
same material boundary as the reviewed case. They are incompatible with adaptive selection because feedback answers are
not comparable evidence and must never reduce later review coverage. The initial release permits this mode only for the
RateLoop network with public, synthetic, or owner-confirmed redacted material. Invited and hybrid lanes fail closed until
private binary-question delivery stores and leases the question under the encrypted artifact boundary.

## Timing and panel

The owner selects a bounded `responseWindowSeconds` and requested panel size. The response window freezes the commit deadline. Reveal, beacon-failure, claim, and settlement grace windows remain protocol-controlled. Existing policy backfills retain the prior effective defaults: 3,600 seconds for public or hybrid requests and 1,800 seconds for invited requests.

Recommended new-policy presets are 20 minutes, 1 hour, 4 hours, and 24 hours. Production availability checks may reject a window that cannot credibly fill the requested panel. Active rounds never change when policy defaults change.

## Compensation and authority

Invited private review may be unpaid or USDC-paid. Public-network and hybrid review require USDC. Owners choose the per-seat bounty and panel size; RateLoop derives fee, attempt reserve, minimum reveals, and the maximum funded amount before consent.

Paid tokenless responses retain the immutable 80% fixed-base and up-to-20% deterministic RBTS quality allocation. That allocation is described as the automatic **response quality reward**, not as the Feedback Bonus.

The [Feedback Bonus](./tokenless-feedback-bonus-v1-spec.md) is a second, independent control. It is optional, off by default, separately prefunded in USDC, and can be enabled whether the guaranteed bounty is on or off. After the feedback window, the requester or another designated human awarder may pay selected eligible written feedback from that pool. The agent and automatic quality machinery may never select or execute an award. If either control can pay a reviewer, paid eligibility completes before assignment. A later usefulness judgment cannot reduce guaranteed compensation.

Delegation has exactly three owner-visible levels:

- **Check only** — evaluate policy and report the required next action.
- **Prepare for approval** — persist the exact request for browser approval; no assignment, publication, or spend occurs beforehand.
- **Ask automatically** — send only within the exact workflow, audience, material, timing, panel, expiry, and publishing
  limits of the active grant. A private invited request with no bounty or Feedback Bonus needs no funding permission;
  any bounty or Feedback Bonus additionally requires the exact funding permission and budget limits.

**Manual handoff only** makes delegation inapplicable: the effective authority is **Check only**, enforcement is
advisory, and no publishing or funding grant is retained. Returning to an automatic frequency starts from **Check
only** so an earlier hidden delegation cannot reactivate.

## Capability truthfulness

Setup and management query effective hosted readiness. A recognized schema value is not evidence that a lane works. Unavailable lanes are absent from the primary path; an existing policy whose capability becomes unavailable shows the blocking reason and safe recovery action.

Generic MCP and ordinary Codex plugin behavior are advisory. They may never be labelled host-enforced. Host enforcement requires a verified adapter that owns the output boundary, records signed/versioned enforcement evidence, blocks release on a required review, and resumes only from a terminal or owner-authorized result.

## Owner-facing summary

Every connected-agent card exposes, without opening an advanced disclosure:

- effective frequency and current adaptive rate;
- reviewers and material boundary;
- response window and panel size;
- guaranteed compensation, automatic quality reward, and optional Feedback Bonus as separate values;
- authority, spend cap, and kill-switch state;
- last policy check, last request, pending review, and last result; and
- advisory or verified host-enforced status.

Advanced statistical thresholds, immutable version history, technical commitments, and raw audit identifiers remain progressively disclosed.
