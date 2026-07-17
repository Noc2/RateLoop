# Stop and safe state

**Scope:** semantics of the fail-closed output gate and the workspace stop control, exactly as implemented on
this branch. Copy on any public surface must match this document; this document must match the code.

## The output gate's safe state is "held undelivered"

For host-enforced integrations, an eligible agent output is held undelivered by default: the host may release
it only after RateLoop's signed gate evidence shows a releasable lifecycle state. Nothing needs to be recalled
or interrupted, because nothing ships until a decision exists. Advisory integrations record the same lifecycle
but do not prove that the host blocked output — only a verified adapter that owns the downstream output
boundary may be described as host-enforced.

## Workspace stop

`engageWorkspaceStop` (owner/admin only, reason required, audit-chained, idempotent) is one action that:

1. records the engaged stop state — who engaged it, why, and when;
2. revokes every unrevoked automatic publishing grant in the workspace (the same primitive as the per-agent
   kill switch), so no agent retains automatic ask-and-release authority;
3. revokes every active human-review continuation, so in-flight resumption credentials die.

While the stop is engaged:

- every new `evaluate_review_requirement` opportunity is recorded with the lifecycle state `blocked` and the
  reason `workspace_stopped` — including outputs the policy would otherwise skip;
- every review-triggered release path (`rateloop_request_review` routing) returns `blocked` with code
  `workspace_stopped`;
- stop-gate evidence issued for new requests therefore reflects the blocked state: outputs stay in the safe
  state, held undelivered.

Opportunities that reached a terminal state before the stop are historical records and are not rewritten.

## Release resumes nothing automatically

`releaseWorkspaceStop` (owner/admin only, audit-chained, idempotent) only ends the workspace-wide block on new
evaluations and requests. It does **not** restore any authority:

- revoked publishing grants stay revoked — each agent resumes only when a manager grants it a fresh publishing
  grant through the human-review configuration;
- revoked continuations stay revoked — agents re-enter through the normal evaluation flow.

This is deliberate: a stop is presumed to reflect a problem, so re-enabling is a per-agent human decision, not
a side effect of the release.

## Claims discipline

These capabilities may be described as a fail-closed output gate plus a workspace-wide stop control. They must
not be described as making a deployment compliant with any law, or as satisfying any specific legal article;
whether a specific deployment meets a legal requirement depends on the customer's system, context, and
organization.
