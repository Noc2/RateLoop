# RateLoop Tokenless Trust Model

This document describes the implemented `tokenless` system. It is not a claim that the previous Base Sepolia addresses
match the current source. Publish new addresses only after a fresh deployment, source verification, and complete
deployment-key parity checks.

## Funds

`TokenlessPanel` is the only fund-holding protocol contract. It is immutable and has no owner, proxy, pause, sweep,
setter, or operator withdrawal path. Funders authorize exact USDC bounty, interface fee, and accepted-work reserve
terms. Zero-commit rounds refund fully. Under-quorum or beacon-failure rounds preserve a paid compensation path for
accepted work. Pull credits prevent a failed recipient transfer from blocking terminal settlement.

USDC retains Circle's freeze/blacklist powers, depeg risk, and contract risk. RateLoop cannot remove those properties.

## Admission

The separate `CredentialIssuer` can rotate epoch signers and therefore admit or censor future voters. It cannot hold
funds, redirect a claim, change an accepted commit, or influence settlement. The server signer, gas-only relayer, keeper,
and prepaid funder use distinct secrets. Paid eligibility—identity/age tier, residence/tax/DAC7 status, sanctions
screening, and Base Account ownership—must be current before a paid voucher is signed.

## Votes and privacy

The browser generates one-time vote and payout keys per round. Answers are tlock-encrypted for the configured drand
network; the public commit binds the ciphertext, reveal, payout destination, nullifier, and exact voucher. RateLoop
never receives the vote or payout private key. Recovery exports use PBKDF2-SHA256 (600,000 iterations) and AES-256-GCM
under a user secret.

Before reveal, the one-time vote key is pseudonymous. A normal claim permanently links that vote key to its per-round
payout address. The operator also retains the required off-chain identity-to-voucher mapping for legal and abuse-control
purposes. Do not describe the system as anonymous or as hiding the claim link.

## Liveness and results

Reveal, settlement phases, claims, compensation, and stale-return calls are permissionless. The hosted keeper is a
convenience and pays gas only. A dead hosted service does not gain custody or change settlement inputs.

Ponder publishes deployment-bound chain evidence. The application records an append-only evidence hash, tier mix,
diversity, issuance, correlation, and answer-fingerprint metrics before publishing or delisting the interpretation.
Analytics can suppress a public verdict but cannot reverse chain settlement or an earned payout. Workspace webhooks are
HMAC-signed, idempotent, retried, and store their signing secrets encrypted.

## Deployment policy

The Base Sepolia deployment remains disposable until a real-money review. Contract changes require a fresh deployment;
no storage, selector, proxy, or address compatibility is promised. App, Ponder, keeper, Postgres schema, deployment
block, and the complete `tokenless-v1:<chain>:<panel>:<issuer>:<adapter>` key must change together. The `tokenless`
branch must never be attached to `rateloop.ai` or the legacy production Railway/Vercel projects.
