# Agent human-review owner guide

This guide explains the controls a workspace owner uses after connecting an agent. The normative policy model is
[Tokenless agent human-review configuration](tokenless-agent-human-review-configuration.md); the lifecycle and failure
states are defined in the [agent review state machine](tokenless-agent-review-state-machine.md).

## Find and change the configuration

Open **Agents**, select the workspace, and find the connected agent. Its card shows the effective frequency, audience,
response window, compensation, authority, and current review state. To change them, open **Manage**, then **Human
review**. Saving creates new versioned policy, request-profile, and delegation bindings; an active request keeps the
terms it started with.

The same choices belong in setup for a newly connected agent. Setup is not the only place to manage them: the connected
agent card is the durable place to inspect the effective values and reopen the complete editor.

## Choose who answers and what they can see

| Audience          | What it means                                                        | Material boundary                                                     | Compensation                    |
| ----------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------- |
| Invited reviewers | People assigned by the workspace                                     | Private workspace material may use encrypted, assignment-bound access | Unpaid or paid in USDC          |
| RateLoop network  | Eligible public raters                                               | Public, synthetic, or owner-confirmed redacted material only          | Guaranteed USDC bounty required |
| Hybrid            | Separate invited and network cohorts, deduplicated before assignment | Public-safe material only                                             | Guaranteed USDC bounty required |

Choosing an audience never declassifies material. Private, internal, confidential, restricted, and regulated artifacts
cannot be published to the network or converted into a public hybrid request by the agent.

## Choose when review is required

Frequency applies once per **eligible output**, not on a wall-clock timer. An eligible output is a completed response in
the workflow bound to this policy; setup messages, tool chatter, health checks, status updates, and delivery of an
already-recorded result do not count.

- **Adaptive** starts at 100% and reduces only after the configured evidence windows pass; safety overrides can still
  require review.
- **Every eligible output** asks every time.
- **Fixed percentage** uses deterministic sampling at the chosen rate and enforces the configured maximum unreviewed
  gap.
- **Risk rules** asks for configured risk tiers, incomplete metadata, or confidence below the owner threshold.
- **Manual handoff only** never requires review automatically. You start each handoff.

A spend cap, unavailable lane, or missing approval never turns a required review into a skip. It produces an approval or
blocked state that the agent must report.

## Choose the question, panel, and response window

Choose **Use one question** for a stable owner-written question and labels. This is the default and the only mode that
can produce comparable assurance evidence for adaptive review.

Choose **Let the agent ask each time** when each case needs a different feedback question, such as “Would you buy this
product?” or “Do you like this design?” The agent supplies one binary question and two answer labels with the review
request. The first accepted request freezes them, and retries cannot change them. These answers are feedback only: they
are not recorded as agent agreement, approval, correctness, or calibration evidence, and this mode cannot use adaptive
frequency. It is initially limited to RateLoop-network review of public, synthetic, or owner-confirmed redacted
material; private invited and hybrid delivery remain unavailable until their binary question path uses the encrypted
artifact boundary.

In either mode, the owner controls whether written rationale is off, optional, or required. Then choose panel size and
the human response window. The response window is how long assigned humans have to answer; it is frozen when the request
starts. It is separate from protocol-controlled reveal, settlement, claim, and recovery periods.

The standard presets are 20 minutes, 1 hour, 4 hours, and 24 hours. A lane may be unavailable when RateLoop cannot
credibly fill the selected panel within that window. Editing a default does not change an active deadline.

## Configure compensation

**Guaranteed bounty** and **Feedback Bonus** are independent controls:

| Guaranteed bounty | Feedback Bonus | Result                                                                                        |
| ----------------- | -------------- | --------------------------------------------------------------------------------------------- |
| Off               | Off            | Invited unpaid review                                                                         |
| On                | Off            | Accepted review work has guaranteed USDC compensation                                         |
| Off               | On             | Invited review is otherwise unpaid; selected written feedback may receive the prefunded bonus |
| On                | On             | Guaranteed compensation plus a separate possible human-awarded bonus                          |

The guaranteed bounty is optional for invited reviewers and required for the RateLoop network or hybrid audience. It is
not conditional on whether the owner likes the answer. Paid review economics separately include the deterministic
protocol **response quality reward**; that mechanism is not the Feedback Bonus.

The **Feedback Bonus** is optional and off by default. Enabling it sets a separate USDC pool and a human awarder. The
requester is the default awarder, or the requester may designate another authenticated human. If either control can pay
a reviewer, paid eligibility must complete before assignment.

After eligible written feedback arrives, the configured awarder sees **Award Feedback Bonus** on the Agents page. The
awarder chooses **Award this feedback** and enters an amount up to the pool balance. The awarder may make partial and
multiple awards to different eligible feedback; the unawarded remainder returns to the immutable refund recipient after
the disclosed deadline. The connected agent, automatic score, and RateLoop operator cannot select or execute an award.

## Choose the agent's authority

- **Check only** lets the agent evaluate policy and report the exact next action. It cannot assign, publish, or spend.
- **Prepare for approval** saves the exact request and economics for a workspace human to approve. Nothing is assigned,
  published, reserved, or spent before approval.
- **Ask automatically** lets the agent ask only within the active grant's exact workflow, audience, material, timing,
  panel, expiry, and publishing limits. Private invited review with no bounty or Feedback Bonus needs no funding
  permission. A bounty or Feedback Bonus additionally requires the exact funding permission and budget limits.

When **Manual handoff only** is selected, Agent authority is hidden and safely reset to **Check only**. Selecting another
frequency does not restore an earlier automatic grant.

Automatic authority does not override capability readiness, privacy rules, paid eligibility, the workspace kill switch,
or a revoked grant.

## What the connected agent must do

Installing the RateLoop workspace plugin or MCP server does not create a background hook. The host must expose the
workspace tools in the active task, and the agent must call them for each eligible output:

1. `rateloop_get_agent_context`, then `rateloop_verify_connection` when connecting or reconnecting;
2. `rateloop_evaluate_review_requirement` with privacy-safe execution metadata;
3. stop on `approval_required`, `request_ready`, `pending`, or `blocked`, and use `rateloop_request_review` only when the
   returned grant permits it; include one bounded binary question only when the returned question policy requires an
   agent-written question;
4. use `rateloop_wait_for_review`, then `rateloop_get_review_result`; and
5. resume only from the policy-authorized terminal result.

Policy edits do not require a new connection intent: the next `rateloop_get_agent_context` returns the new active
binding. A task started before the workspace plugin was installed may not have the tools yet. Use the host's refresh or
continue action; restart the task or host when it requires that lifecycle. Reconnect with a new RateLoop intent only
when the previous connection was deleted, revoked, or cannot be resumed through the host's supported flow. Never treat a
successful plugin install as a verified workspace connection; `rateloop_verify_connection` must succeed.

## Advisory versus enforced behavior

Generic MCP instructions and ordinary Codex hooks are advisory. They improve compliance but do not prove that candidate
output remained hidden. A deployment may say **host-enforced** only when a verified host adapter exclusively owns the
output boundary, binds signed evidence to the exact candidate and policy versions, blocks release while review is
required, and resumes only from an allowed terminal or owner-authorized result. The agent card must state which boundary
is actually active.
