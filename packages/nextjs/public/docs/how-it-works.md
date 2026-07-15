# How RateLoop works

RateLoop adds a Human Assurance Loop to an AI-enabled workflow: review frequently at first, then let scoped evidence
decide whether baseline review can decrease.

## The Human Assurance Loop

1. **Agent prepares.** A connected agent reads its owner-approved policy, then describes the workflow, risk, declared
   confidence, completeness, suggestion commitment, and source evidence for the next eligible output.
2. **RateLoop decides.** The exact agent-version, policy-version, workflow, risk-tier, and reviewer-audience scope starts
   at 100% review. Critical risk, missing context, and maximum review gaps can force a human check.
3. **Humans judge.** Eligible reviewers answer independently. RateLoop returns the verdict, reasons, disagreement, and
   source-linked agreement evidence to the agent.
4. **Evidence adapts.** Under the default policy, two independent 15-case windows with at least 14 comparable
   agent-human agreements each can move baseline review from 100% to 50%. Another 50 stable cases can move it to 25%,
   and 100 more can move it to the 10% monitoring floor. A complete evidence window below the agreement threshold
   restores 100% calibration.

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
   early answers hidden, while short assignment leases protect private material.
5. **Settle deterministically.** Base pay rewards accepted work. Robust Bayesian Truth Serum can add a bounded reporting
   bonus, and a separately funded Surprisingly Popular bounty can reward useful minority signal. Neither changes the
   panel verdict.
6. **Handle failure paths.** Anyone can continue settlement. Zero-commit rounds refund in full; under-quorum and beacon
   failure paths return unused bounty and fee while preserving compensation for accepted valid work.
7. **Return a decision packet.** The versioned result combines the verdict, disagreement, written reasons, reviewer
   coverage, settlement evidence, refunds, and compensation. The customer records the final go, revise, or stop action.

## Agent integration

The connected workspace MCP uses `get_agent_context -> evaluate_review_requirement -> skip or request_review ->
wait_for_review -> get_review_result -> get_assurance_state`. Its safe connection can evaluate review requirements but
cannot spend or publish. Paid review requires a separate owner-approved publishing step-up with explicit limits. Generic
MCP is advisory; a host-enforced integration is required when the host must prove that output stayed blocked.

The authenticated API and SDK use `quote -> ask -> wait -> result`. A scoped workspace key supports prepaid automation;
a self-funded agent can use short-lived x402/EIP-3009 USDC authorizations. The public MCP Adapter remains a separate,
approval-bound browser handoff and never turns draft content into a funded ask by itself.

## Identity and access

Browser access starts with Better Auth and resolves to an opaque RateLoop principal. A wallet is optional and is bound
only for an explicit funding, payout, or recovery purpose. Private project access depends on workspace membership,
project assignment, and reviewer lease rather than wallet ownership.

## Evidence boundary

Private artifacts are encrypted and access-controlled. Paid settlement inputs and outputs are independently
recomputable on Base. A normal claim publicly links its one-time vote key to the chosen payout destination, while the
customer's private artifacts and decision record remain outside the public chain.
