# Tech Stack

RateLoop separates agent integration, human admission, blinded reporting, incentives, and fund custody so that each
mechanism has one narrow job.

<a id="mcp-adapter"></a>

## MCP Adapter

The Streamable HTTP adapter exposes four operations: read capabilities, create an approval-bound browser handoff, read
handoff status, and retrieve a result. Draft content stays in the handoff URL fragment until the user reviews it. Quote
creation and funded ask submission are separate browser actions; autonomous payments use the scoped API and CLI.

<a id="x402-usdc"></a>

## x402 + USDC

A self-funded agent signs a short-lived EIP-3009 USDC authorization plus the exact round terms. The stateless x402
adapter consumes both in one transaction, transfers the authorized amount, and creates the round. Prepaid work uses the
same itemized bounty, fee, reserve, refund, and compensation model without requiring an agent wallet.

If the authorization nonce is already used, RateLoop accepts only an exact matching round receipt as confirmation.
Without that proof, the payment is marked possibly paid and no replacement authorization is requested or retried.

<a id="proof-of-human"></a>

## Proof of Human

RateLoop-network reviewers enroll with World ID 4 Proof of Human. The server maps successful enrollment to a
provider-scoped uniqueness capability used by an audience policy. It establishes one provider subject, not expertise,
honesty, independence, nationality, tax residence, or continuing liveness.

<a id="audience-policies"></a>

## Audience policies

A versioned policy defines whether a panel uses customer-invited reviewers, the RateLoop network, or separate hybrid
subpanels. It also freezes qualifications, quotas, selection rules, fallbacks, and privacy-safe reporting. Its canonical
hash is bound into paid round terms and every admission voucher.

<a id="commit-reveal"></a>

## Commit-reveal

Each reviewer uses a one-time vote key to commit a sealed answer before seeing the panel. The reveal phase opens only
after the blind window. Because commitments and accepted inputs are on Base, the operator cannot rewrite them before
settlement.

<a id="drand-tlock"></a>

## drand + tlock

The reviewer encrypts reveal material to a future drand beacon. After the deadline, any keeper can use the public
beacon to reveal it. A late beacon opens a self-reveal fallback; a failed beacon reaches a refund-and-compensation path
instead of trapping funds.

<a id="robust-bayesian-truth-serum"></a>

## Robust Bayesian Truth Serum

Accepted work receives fixed base pay. A bounded binary RBTS bonus compares each answer and panel prediction with
seeded canonical peers, making copied or strategically uninformative reports less attractive under the scoring model.
Unused bonus returns to the funder.

<a id="surprisingly-popular"></a>

## Surprisingly Popular

A separate, platform-funded bounty can reward answers that are more common than the panel predicted. Its maximum is
reserved before the round and capped per reviewer. It pays after base settlement and cannot change the verdict, RBTS
payment, customer refund, or contract state.

<a id="base-usdc"></a>

## Base + USDC

Base keeps sponsored commits and permissionless settlement inexpensive. USDC makes the buyer's maximum authorization
and every reviewer payment explicit in six-decimal units. Public events allow independent reconstruction of round
terms, commitments, settlement, claims, refunds, and compensation.

<a id="immutable-fund-core"></a>

## Immutable fund core

`TokenlessPanel` holds customer funds and has no owner, pause, sweep, setter, proxy, or operator withdrawal path. The
separate credential issuer can rotate future admission signers but cannot alter accepted commits or redirect claims.
