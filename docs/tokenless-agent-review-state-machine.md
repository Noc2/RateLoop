# Tokenless agent review state machine

Status: normative lifecycle for review opportunities created under
[`tokenless-agent-human-review-configuration.md`](./tokenless-agent-human-review-configuration.md).

## Identity and frozen bindings

An opportunity is uniquely addressed by `(workspace_id, integration_id, external_opportunity_id)`. Repeating the same identifier with different content, execution metadata, or policy bindings fails with a conflict. The first accepted evaluation freezes:

- agent and agent-version IDs;
- selection-policy ID and version;
- request-profile ID and version;
- delegation-grant ID and version, when present;
- workflow, risk tier, audience-policy hash, and privacy classification;
- question authority and result semantics;
- source and suggestion commitments; and
- the deterministic sampling proof.

No later policy edit mutates that snapshot. For a required review, the first valid request also freezes the exact binary
question, labels, owner-controlled rationale mode, author, schema version, and canonical hash before any approval,
publication, assignment, reservation, or spend. A retry with different question content fails with
`review_question_conflict`. Agent-written feedback questions never enter the metadata-only policy-evaluation call.

## States

| State | Meaning | Permitted next states |
| --- | --- | --- |
| `evaluating` | The idempotent decision is being created under locked policy and scope counters. | `skipped`, `approval_required`, `request_ready`, `blocked` |
| `skipped` | The frozen policy produced a legitimate skip. | Terminal |
| `approval_required` | Review is required but autonomous publication or spend is unavailable or outside the grant. | `request_ready`, `blocked`, `cancelled_before_commit` |
| `request_ready` | Exact request terms are frozen and authorized. | `pending`, `blocked`, `cancelled_before_commit` |
| `pending` | Assignment or funded-round work is active. | `completed`, `inconclusive`, `failed_terminal` |
| `blocked` | Review remains required and output release is not authorized. | `approval_required`, `request_ready` after an explicit owner action; otherwise terminal for the host attempt |
| `completed` | A bounded result was finalized. Comparable assurance results also finalize exactly one adaptive observation; feedback results do not. | Terminal |
| `inconclusive` | The lane reached a valid under-quorum or no-verdict terminal result. Assurance requests finalize one inconclusive observation; feedback requests do not. | Terminal |
| `failed_terminal` | The lane exhausted its specified recovery path. Accepted work has already reached its paid terminal path. | Terminal |
| `cancelled_before_commit` | The owner cancelled before any paid rater commit or accepted invited assignment. | Terminal |

`required` is a decision, not a terminal state. A cap, unavailable lane, expired grant, or missing host evidence cannot translate `required` to `skipped`.

## Evaluation transaction

The evaluator locks the active policy bundle and evaluation scope, derives the deterministic bucket, applies critical-risk and incomplete-metadata overrides, updates the unreviewed-gap counter exactly once, and inserts the opportunity before returning. Concurrent retries return the same decision snapshot. A conflicting retry changes nothing.

Decision mapping:

1. a legitimate negative selection becomes `skipped`;
2. a required selection with no publication grant becomes `approval_required`;
3. a required selection within an active grant and ready lane becomes `request_ready`;
4. a required selection whose safe prerequisite cannot be recovered by the current actor becomes `blocked`.

## Approval

An approval record contains the exact prepared request profile, frozen question hash, author and result semantics,
content commitments, derived economics, maximum charge, expiry, and owner decision. Preparing a request may stage
encrypted private bytes, but cannot assign reviewers, publish a public question, reserve workspace funds, or submit
chain payment.

Approval is single-use. Editing creates a new immutable revision and invalidates the prior approval target. Denial records the owner decision; it never records a policy skip. A host that requires enforcement keeps the output blocked unless its separately configured owner-override rules permit release.

## Lane adapters

All adapters consume the same frozen opportunity and return the same bounded result envelope.

- `public_paid_network` uses quote, funding, immutable public round, rater queue, settlement, and public result.
- `private_invited_unpaid` uses encrypted assurance artifacts, an exact invited-group snapshot, assignment leases, response aggregation, and private result.
- `private_invited_paid` adds pre-assignment eligibility and voucher-bound settlement.
- `hybrid_public_safe` creates separate invited and network subpanels, prevents reviewer duplication, preserves cohort evidence, and aggregates only after both subpanels reach specified terminal states.

Capability readiness chooses whether an adapter can be entered. Schema support alone is insufficient.

## Long-running continuation

Human windows exceed synchronous MCP calls. Entering `pending` returns a durable opaque continuation with the opportunity ID, bounded retry guidance, and latest safe status. `wait` may block only for the protocol maximum; clients later call list/resume/result or receive a host-supported notification. No server or skill creates an unbounded polling loop.

The continuation is scoped to the bound integration. Caller-supplied workspace, agent, policy, operation, run, or reviewer identity is never trusted.

## Result and observation finalization

Every adapter returns:

- terminal status and reason codes;
- yes/no/abstain counts and bounded verdict;
- responding-human count and cohort breakdown when permitted;
- human-human agreement and latency when available;
- exact cost and compensation state;
- source, suggestion, policy, audience, and result commitments; and
- the frozen question hash, author, result semantics, and selected answer label; and
- public evidence references or private opaque references appropriate to the lane.

For `assurance` semantics, one transaction inserts the evaluation observation, updates the scope stage and counters,
records any policy-stage event, and marks the opportunity terminal. For `feedback` semantics, finalization stores the
bounded result but creates no adaptive observation, changes no calibration counter or coverage stage, and exports no
human correctness label. The unique opportunity constraint makes duplicate finalization harmless. Private payloads,
private question text, and reviewer identity never enter the adaptive rollup.

## Failure and compensation

The adapter specifications cover zero response, under-quorum, no invited capacity, expired reservations, eligibility failure before work, moderation, takedown, beacon failure, infrastructure loss, and retry exhaustion.

No paid assignment is offered before eligibility is complete. After a rater commit or accepted paid assignment, cancellation is unavailable and accepted work reaches a paid terminal path even when quorum, beacon, moderation, or platform infrastructure fails. Operator actions cannot redirect or seize funds.

## Host release semantics

Advisory hosts may report a missed or unavailable review but cannot claim output blocking. A verified host-enforced adapter owns the release boundary:

1. it records the eligible output commitment;
2. it obtains the RateLoop decision;
3. it blocks release for `approval_required`, `request_ready`, `pending`, or `blocked`;
4. it resumes only from an allowed terminal result or signed owner override; and
5. it submits verifiable enforcement evidence bound to the integration and policy versions.

Plugin presence, MCP availability, or a prompt instruction alone never changes an integration to host-enforced.
