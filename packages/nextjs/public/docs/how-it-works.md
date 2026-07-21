# How RateLoop works

RateLoop adds a Human Assurance Loop to an AI-enabled workflow: review frequently at first, then let scoped evidence
decide whether baseline review can decrease.

## The Human Assurance Loop

1. **Owner sets policy.** A workspace owner or admin chooses the review rules, risk thresholds, reviewer audience, data
   boundaries, and publishing and spending limits.
2. **Agent submits work.** A connected agent submits the workflow, declared risk, confidence, completeness, suggestion
   commitment, and source evidence within that owner-approved policy. RateLoop applies the policy to decide whether the
   output needs a human check.
3. **Humans judge.** Eligible reviewers answer independently. RateLoop returns the verdict, reasons, disagreement, and
   source-linked agreement evidence to the agent.
4. **Evaluation.** RateLoop returns feedback and actionable human performance metrics for AI workflows.

Within the same owner-approved policy, two independent 15-case windows with at least 14 comparable agent-human
agreements each can move baseline review from 100% to 50%. Another 50 stable cases can move it to 25%, and 100 more can
move it to the 10% monitoring floor. A complete evidence window below the agreement threshold restores 100%
calibration.

Coverage never becomes a global agent score. Evidence from another version, policy, workflow, risk tier, or reviewer
audience cannot silently lower review.

## Inside one human check

1. **Freeze the decision.** A buyer or agent defines one question, the response format, a versioned audience policy,
   panel size, and the complete USDC economics. RateLoop derives the round deadlines from the selected panel terms.
2. **Fund the panel.** A prepaid workspace or a self-funded agent authorizes the bounty, platform fee, and bounded
   accepted-work reserve. The immutable round terms prevent the funder from changing the deal after the first commit.
3. **Select eligible humans.** Customer-invited, RateLoop-network, and hybrid panels remain distinct. Network admission
   can require World ID Proof of Human plus task-specific eligibility; the exact policy hash is bound into the round.
4. **Collect blind judgments.** Reviewers answer through one-time vote keys. Commit-reveal and drand/tlock sealing keep
   early answers hidden, while short assignment leases protect private material. A paid commit publishes tlock
   ciphertext containing the vote, prediction, response hash, payout address, and salt. The commit irrevocably
   schedules those details to become publicly decryptable at the configured drand round after the commit deadline,
   whether or not the reviewer or keeper submits a reveal or claim; there is no post-commit abort.
5. **Settle deterministically.** A guaranteed USDC bounty rewards accepted work. Robust Bayesian Truth Serum can add a
   bounded response-quality reward, and a separately funded Surprisingly Popular bounty can reward useful minority
   signal. An optional, separately prefunded Feedback Bonus can instead be awarded afterward by the requester or another
   designated human to selected written feedback. The agent cannot choose or execute that award. None changes the panel
   verdict.
6. **Handle failure paths.** Anyone can continue settlement. Zero-commit rounds refund in full; under-quorum and beacon
   failure paths return unused bounty and fee while preserving compensation for accepted valid work.
7. **Return a decision packet.** The versioned result combines the verdict, disagreement, written reasons, reviewer
   coverage, settlement evidence, refunds, and compensation. The customer records the final go, revise, or stop action.

See [Evidence & Compliance Mapping](./evidence.md) for the packet fields, local checks, framework cross-references, and
limits on what those records establish.

## Agent integration

Workspace owners change audience, frequency, response window, panel, compensation, and authority directly in
**Reviews**. When multiple agents are active, a compact selector chooses which agent's policy to edit; the workspace
reviewer roster follows the editor. The connected workspace MCP uses `rateloop_get_agent_context ->
rateloop_evaluate_review_requirement -> skip or rateloop_request_review -> rateloop_wait_for_review ->
rateloop_get_review_result -> rateloop_get_assurance_state`. Its basic safe connection can evaluate review requirements
but cannot spend or publish. Autonomous review requires a separate owner-approved publishing grant with explicit
limits. Funding permission is additionally required only when the request includes a bounty or Feedback Bonus.

Installing MCP does not create a background check. The tools must be available in the active task, the connection must
pass `rateloop_verify_connection`, and the agent must call the evaluation flow for each eligible output. A policy edit is
picked up by the next context read; deletion or revocation requires a fresh connection. Generic MCP and ordinary Codex
hooks are advisory; a verified adapter that owns the output boundary is required when the host must prove that output
stayed blocked.

The authenticated API and SDK use `quote -> ask -> wait -> result`. A scoped workspace key supports prepaid automation;
a self-funded agent can use short-lived x402/EIP-3009 USDC authorizations. The public MCP Adapter remains a separate,
approval-bound browser handoff and never turns draft content into a funded ask by itself.

## Identity and access

Browser access starts with Better Auth and resolves to an opaque RateLoop principal. A wallet is optional and is bound
only for an explicit funding, payout, or recovery purpose. Private project access depends on workspace membership,
project assignment, and reviewer lease rather than wallet ownership.

## Evidence boundary

Private artifacts are encrypted and access-controlled. Each artifact has its own random data-encryption key. Hosted
releases require workspace/project-scoped AWS KMS aliases and authenticated encryption context; authorized RateLoop
workload roles permitted on those tenant keys can still decrypt the tenant's artifacts to provide the service. Provider
key provisioning, inventory, rotation, and access exercises are release gates. Paid settlement inputs and outputs are
independently recomputable on Base. A paid commit schedules public
decryptability of its vote-key-to-payout link at the configured drand round after the commit deadline, independent of a
later reveal or claim, while the customer's private artifacts and decision record remain outside the public chain.
