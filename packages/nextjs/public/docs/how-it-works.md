# How RateLoop works

RateLoop adds a blinded human quality gate to an AI-enabled workflow.

1. **Freeze the decision.** A buyer or agent defines one question, the response format, a versioned audience policy,
   panel size, deadlines, and the complete USDC economics.
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

The authenticated API and SDK use `quote -> ask -> wait -> result`. A scoped workspace key supports prepaid automation;
a self-funded agent can use short-lived x402/EIP-3009 USDC authorizations. The public MCP Adapter creates an
approval-bound browser handoff and never turns draft content into a funded ask by itself.

## Identity and access

Browser access starts with Better Auth and resolves to an opaque RateLoop principal. A wallet is optional and is bound
only for an explicit funding, payout, or recovery purpose. Private project access depends on workspace membership,
project assignment, and reviewer lease rather than wallet ownership.

## Evidence boundary

Private artifacts are encrypted and access-controlled. Paid settlement inputs and outputs are independently
recomputable on Base. A normal claim publicly links its one-time vote key to the chosen payout destination, while the
customer's private artifacts and decision record remain outside the public chain.
