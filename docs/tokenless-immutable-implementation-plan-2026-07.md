# RateLoop tokenless design of record

**Status:** Current architecture and product baseline for the `tokenless` branch. This document contains current
decisions only. Superseded research, review notes, and implementation sequences remain available in Git history.
Concrete release evidence and blockers live in the [production-readiness register](tokenless-production-readiness-2026-07.md).
Legal and revenue obligations live in the [legal and revenue reference](tokenless-legal-revenue-reference-2026-07.md).

If another document conflicts with this one, this document controls unless the decision is explicitly reopened here.

## Product boundary

RateLoop is **human assurance for AI-enabled workflows**. A workspace owner defines when an agent needs human review,
which humans may participate, what information they may see, and how much the agent may spend. RateLoop returns a
versioned decision packet containing the panel result, reasons, disagreement, reviewer provenance, and settlement
evidence. The customer remains responsible for the final decision.

The product is not a general social network, token-governance system, prediction market, model leaderboard, or public
wallet dashboard. Blockchain and x402 are implementation details for independently checkable funding and settlement;
they do not define the product category or the primary navigation.

## Current baseline

The active package graph is tokenless-only:

- `packages/foundry` contains the immutable fund core, credential issuer, stateless x402 adapter, and deterministic
  RBTS libraries.
- `packages/contracts` exports only the root package and `./tokenless` generated artifacts.
- `packages/ponder` indexes the active tokenless deployment and publishes source-derived evidence.
- `packages/keeper` advances permissionless reveal, settlement, compensation, claims, and stale-return paths.
- `packages/sdk` and `packages/agents` expose the versioned `quote -> ask -> wait -> result` workflow.
- `packages/nextjs` implements Better Auth, workspaces, agent OAuth, reviewer access, payments, privacy controls,
  evidence packets, and the Human Assurance Loop.

The ordered application migration source of truth is
[`packages/nextjs/drizzle/meta/_journal.json`](../packages/nextjs/drizzle/meta/_journal.json); its final entry is the
authoritative head. Read that entry directly rather than trusting a head number copied into prose here, which drifts as
migrations land. The runtime deployment schema is `tokenless-v4`, whose complete identity adds
the Feedback Bonus address as a fifth slot. No v4 contract bundle has been deployed or checked in. The latest historical
Base Sepolia bundle remains the disposable four-slot `tokenless-v3` deployment at block `44132668`, with complete key:

```text
tokenless-v3:84532:0xf97d28e02f7301b4f6cb19160e1176eaf3e4f19a:0x67a89f76ae9a89866a0e62785d7999efe1c5e592:0x8a9b7af03f3cf362ba98180700bc92fbb72fcbc9
```

This is a test-profile deployment, not a compatibility anchor or real-money release. Any fund-core change invalidates
the artifact and every hosted address until contracts and all consumers are redeployed together.

## Trust and authority

The fund-holding core is immutable and has no owner, proxy, pause, sweep, setter, governance, oracle, or operator path
to funds. Its only stateful responsibilities are round funding, voucher-bound commits, deterministic settlement,
compensation, refunds, claims, fee release, and stale-share return.

The separate credential issuer may rotate admission signers by epoch and can admit or censor new commits. A compromised
admission signer can fill remaining seats in open rounds, influence their verdicts, and direct the bounties for those
attacker-controlled reports until the signer is rotated. It still cannot hold funds, redirect another report's claim,
alter an accepted commit, change settlement, or move customer assets. Issuance authority and its open-round blast radius
are therefore disclosed separately from the no-funds-admin custody claim.

USDC retains a separate token-layer authority outside the fund core. Circle can pause or blacklist USDC transfers,
including transfers to or from an escrow contract. The adminless panel removes a RateLoop operator path to funds; it
does not override the token issuer's controls or guarantee that USDC remains transferable.

The operator controls off-chain identity, eligibility, moderation, assignment, correlation analytics, and publication
policy. Those controls can stop future admission or distribution but cannot erase accepted work or change earned pay.
Every customer-facing custody, privacy, identity, and settlement claim must match the deployed system exactly.

## Human Assurance Loop

1. **Owner sets policy.** The owner chooses review rules, risk thresholds, reviewer audience, data boundaries,
   publishing permissions, and spending limits.
2. **Agent submits work.** The connected agent provides the work, declared risk, confidence, completeness, suggestion
   commitment, and source evidence within that policy.
3. **Humans judge.** Eligible reviewers answer independently. RateLoop returns the verdict, reasons, disagreement, and
   source-linked agreement evidence.
4. **Evaluation.** The result updates evidence for the exact agent version, policy, workflow, risk tier, and reviewer
   audience. Evidence never becomes a global agent score.

Review begins at 100%. Within the same scope, two independent windows of at least 15 comparable cases may reduce the
baseline to 50% only when each window's Wilson lower confidence bound meets the policy agreement threshold (7,000 bps
by default), the completion, human-agreement, latency, and drift gates pass, no severe disagreement remains open, and
at least 30 comparable cases have completed. Fifty more stable cases may reduce review to 25%; 100 more may reduce it
to the 10% monitoring floor. A completed window that fails a reset gate restores 100% calibration. Critical-risk rules,
the maximum-unreviewed gap, incomplete metadata, and explicit owner requirements always override the adaptive baseline.
Until drift and severe-disagreement gates are backed by persisted scope evidence, adaptive review reports
`safety_gates_unavailable`, remains at 100%, and resets any previously reduced scope to calibration.

The owner separately chooses question authority. An owner-fixed binary question uses `assurance` semantics and may
produce comparable evidence. An agent-per-request binary question uses `feedback` semantics so a preference such as
“Would you buy this?” cannot be misread as agreement with the agent. The exact agent-written question is frozen before
any consequential review action, cannot change on retry, and never creates adaptive observations, calibration labels,
coverage reductions, disagreement alerts, or correctness claims. Agent-written mode is incompatible with adaptive
selection. Its initial availability is restricted to public-safe RateLoop-network review; private and hybrid delivery
remain fail-closed until the question itself uses the encrypted private artifact boundary.

## Workspace and agent setup

The detailed owner-facing policy choices, audience and material matrix, timing, compensation, and delegation semantics are frozen in
[`tokenless-agent-human-review-configuration.md`](./tokenless-agent-human-review-configuration.md). If a generic setup or management surface conflicts with that document, the narrower human-review configuration controls.

A first workspace uses one resumable setup flow:

1. name the workspace;
2. connect an agent;
3. confirm the agent identity and declaration;
4. choose review behavior, public/private material boundaries, and safe spending defaults; and
5. invite people or prepare one-use invitation codes when an invited reviewer lane is needed.

The flow shows the current stage, permits backward navigation, persists progress per workspace, and hides the normal
Agents management menu until setup is completed or the workspace is grandfathered. The global product shell remains
available. Downstream registries, evaluation history, billing, group management, and technical identifiers appear only
when their prerequisite exists and the user requests that capability.

A basic agent connection is deliberately safe: it may read its bound context and assurance state, verify connection
health, and record an idempotent review-requirement decision under the owner policy. It cannot publish a review, spend,
read private artifacts, or administer the workspace. Publishing and paid review require a separate, versioned owner
approval with exact scopes, policy hashes, audience rules, project binding, budget limits, expiry, and revocation state.

## Agent connection and integration

The supported connection flow uses one short-lived, single-use intent. The copied message contains no durable bearer or
workspace API credential. OAuth 2.1 with PKCE, or device authorization for approved headless clients, delivers
operational credentials to host-controlled secure storage. Install, consent, reload, retry, and a host-required new task
preserve the original intent so the owner is not asked to paste again.

The authenticated workspace MCP keeps a stable tool contract. A new connection calls
`rateloop_get_agent_context -> rateloop_verify_connection`; verification is non-mutating and never creates a synthetic
review. The assurance workflow uses
`evaluate_review_requirement -> skip or request_review -> wait_for_review -> get_review_result -> get_assurance_state`.
Generic MCP is advisory; a host-enforced integration is required when the host must prove that output remained blocked.

The authenticated API and SDK use `quote -> ask -> wait -> result`. Scoped workspace credentials support prepaid
automation. A self-funded agent may use short-lived x402/EIP-3009 USDC authorizations from a local encrypted signer;
the gas-only relayer never receives the spend key. The public MCP remains a separate, approval-bound browser handoff and
cannot silently turn draft content into a funded ask.

An EIP-3009 nonce observed as used is never treated as permission to request, sign, or relay a replacement payment.
The server first reconciles the standard `AuthorizationUsed` event and exact matching `RoundCreated` receipt, including
a complete round-state read. If that proof is unavailable, the operation becomes `possibly_paid`, chain mutation stops,
and the recovery item is dead-lettered for manual reconciliation rather than retried.

## Execution provenance and evaluation

A connection identity such as Codex identifies the client or host. It is not the identity of every model the host may
run. A logical agent version identifies a versioned workflow and configuration; changing the model for one task does not
rename the connection or create a new logical agent version.

Every output eligible for assurance evidence records one execution and a trace containing one or more generation spans.
The trace preserves parent/child relationships for multi-model work, subagents, and tool use. Each generation records
privacy-safe provenance: provider, requested model or alias, resolved model and provider snapshot when available,
reasoning-effort setting, service tier, request and response timestamps, time to first output, token usage, and tool count
and duration. This provenance layer stores no raw prompts, outputs, tool payloads, or hidden reasoning. Metadata is
host-reported unless a separately identified provider or cryptographic attestation proves otherwise; reported values are
never presented as independently verified.

Each execution has an exact canonical manifest hash for that run and a stable evaluation-profile hash derived from the
output-affecting workflow/configuration and normalized generation profile, including the contributing model set and
orchestration mode. Timing, token, and cost measurements remain observations rather than profile partition keys.
Adaptive evidence is partitioned by evaluation-profile hash in addition to agent version, policy, workflow, risk tier,
and reviewer audience. An unknown profile is its own scope and never inherits evidence from a known profile. Quality,
latency, effort, and cost comparisons remain contextual to comparable work; RateLoop does not produce a global agent or
model score.

## Identity, audience, and privacy

Better Auth is the primary browser authentication layer. Email OTP and passkeys are first; Google and Apple appear only
when complete credential pairs exist. Authentication resolves to a RateLoop-owned opaque principal and a hashed,
HttpOnly session. A client-reported profile, provider token, email domain, or wallet is never authorization.

Wallets are optional, purpose-bound adapters for funding, payout, or recovery. Existing self-custodial wallets and an
optional thirdweb-created wallet use the same explicit proof boundary. Browser identity, workspace role, project
assignment, reviewer qualification, assurance evidence, paid eligibility, and wallet authority remain separate.

Audience policies are versioned and distinguish customer-invited, RateLoop-network, and hybrid reviewers. The exact
policy hash is bound into paid round terms and vouchers. World ID Proof of Human may supply provider-scoped uniqueness
for RateLoop-network admission; it does not prove expertise, residence, independence, or paid eligibility. Paid-task
eligibility—including adulthood, residence/tax information where applicable, sanctions screening, and payout setup—must
finish before the first paid voucher. Browsing and advisory calibration require none of those paid-task fields.

Private artifacts are encrypted before storage and released only through workspace membership, project assignment, and
short reviewer leases. Public, private, and sensitive-material decisions are separate policy dimensions. Each customer
artifact has a random data-encryption key, but those keys currently wrap to an operator-controlled server/KMS wrapping
authority shared by tenant artifacts within a key domain. Authorized operator systems can therefore decrypt customer
artifacts in that domain. Per-tenant or per-project wrapping keys remain a privacy-hardening and real-customer release
gate, not a deployed property.

On-chain data contains commitments and settlement evidence, never private customer payloads or plaintext URLs. A paid
commit publishes tlock ciphertext containing the vote, prediction, response hash, payout address, and salt. Committing
irrevocably schedules that material to become publicly decryptable at the configured drand round after the commit
deadline, whether or not the reviewer or keeper submits a reveal or claim; there is no post-commit abort. Reusing a
payout destination can link rounds. The operator never possesses a rater spend key, and the public drand/tlock reveal
lane needs no operator-held universal reveal key; that statement does not apply to the customer-artifact vault authority
described above.

Account and workspace deletion is a first-class authenticated lifecycle, not a support-only operation. Before accepting
a deletion, RateLoop shows the exact blockers and consequences. A workspace cannot be deleted while it owns available
or reserved funds, accepted paid work, an unsettled round, or another obligation that would strand assets or prevent an
earned terminal payment. A principal cannot delete its account while it is the sole owner of a workspace, has accepted
paid work, or has a managed wallet that still requires recovery. Final account deletion requires a recent primary-auth
session in addition to the active RateLoop session.

Deletion immediately revokes product and agent access, removes reusable authentication and contact data, and makes the
workspace or account inaccessible. A later sign-up with the same email creates a new Better Auth user and a new opaque
RateLoop principal; it never reconnects the deleted identity. Data that can be erased safely is deleted or queued for
deletion by category. Records required for settlement, fraud prevention, legal claims, accounting, or an active legal
hold remain under an irreversible tombstone for their documented retention period. Public-chain commitments cannot be
erased. Every deletion produces category-level evidence stating whether data was erased, retained with a basis and
deadline, or is externally immutable; the receipt contains no raw personal data.

## Funding, incentives, and terminal paths

Round terms freeze the bounty, platform fee, accepted-work reserve, minimum reveals, deadlines, audience-policy hash,
scoring version, and content commitments. The funder cannot cancel or edit a paid round after the first accepted commit.

Every valid reveal earns fixed base compensation. The current binary
[RBTS v1 specification](tokenless-rbts-v1-spec.md) adds a bounded, non-negative reporting bonus without changing the
majority verdict. The separately funded [Surprisingly Popular bounty](tokenless-surprise-bounty-v1-spec.md) may reward
useful minority signal after finalization; it cannot alter customer-funded settlement or contract state.

The optional [Feedback Bonus](tokenless-feedback-bonus-v1-spec.md) is also separate from those mechanisms and from the
guaranteed review bounty. It may be configured with or without guaranteed compensation, is prefunded before delivery,
and can be awarded afterward only by the requester or another designated human to selected eligible written feedback.
The agent, automatic scoring, moderation, and operator cannot select an award. When either guaranteed compensation or a
Feedback Bonus is possible, paid eligibility completes before assignment.

Settlement freezes the reveal set, processes deterministic evidence in restart-safe pages, and enables claims only
after conservation checks pass. Any caller may continue the state machine. Zero-commit rounds refund in full. Under-
quorum, beacon-failure, takedown, and infrastructure-failure paths preserve compensation for accepted valid work and
return unused customer funds. Unclaimed shares return to the funder after the stale grace.

Workspace subscriptions are conventional B2B billing and remain separate from panel economics. They are disabled
unless the complete Stripe configuration and readiness checks are present. Panel quotes and receipts continue to
itemize bounty, platform fee, reserve, refunds, and compensation.

## Deployment and operations

`tokenless` and `main` are separate products and deployment lines. Tokenless code may target only the dedicated Vercel
project `rateloop-tokenless`, its Vercel-provided domain, and the isolated Railway/Postgres/Ponder/keeper resources. It
must never move `main`, the legacy `rate-loop-nextjs` project, `rateloop.ai`, or `www.rateloop.ai`.

Hosted environments have no simulation mode. Staging uses testnet assets with the same persisted assignment, payment,
settlement, and result machinery as production. Deterministic fixtures and local signing keys are test-only. Deployment
identity, database head, EU resource evidence, signing roles, and chain addresses fail closed on a complete deployment
key; mixed address bundles are invalid.

Operational instructions are intentionally separate from product design:

- [environment parity](tokenless-environment-parity.md);
- [EU deployment](tokenless-eu-deployment-runbook.md);
- [identity and optional wallet provisioning](tokenless-identity-and-wallet-runbook-2026-07.md);
- [privacy operations](tokenless-privacy-operations-runbook-2026-07.md); and
- [supply-chain controls](tokenless-supply-chain-controls.md).

## Remaining release phases

1. **Hosted staging:** managed signing, complete paid assignment-to-settlement wiring, signed EU resource evidence,
   migration verification through the head recorded in `_journal.json`, and deployment-pinned end-to-end exercises.
2. **Real users and money:** external contract/privacy review, paid eligibility and DAC7 operations, sanctions and B2B
   controls, reviewer appeals/recovery, operational drills, security testing, and evidence-packet verification.
3. **Hardening at traction:** audit the small immutable core, run a public bounty and soak period, deploy the final
   adminless-funds mainnet bundle, and publish verified addresses plus recomputation and keeper instructions.

The [production-readiness register](tokenless-production-readiness-2026-07.md) is the only current release checklist.
A successful build or push is never release approval.
