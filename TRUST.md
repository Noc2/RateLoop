# RateLoop Tokenless Trust Model

This document describes the implemented `tokenless` system and its current limitations. The checked-in Base Sepolia
addresses are historical and do not match the current fund core. Publish new addresses only after the planned contract
changes, a fresh deployment, source verification, and complete deployment-key parity checks. The
[human-assurance redesign plan](docs/tokenless-human-assurance-redesign-plan-2026-07.md) defines the controls required
before private customer artifacts or verifier-ready evidence claims.

## Funds

`TokenlessPanel` is the only fund-holding protocol contract. It is immutable and has no owner, proxy, pause, sweep,
setter, or operator withdrawal path. Funders authorize exact USDC bounty, interface fee, and accepted-work reserve
terms. Zero-commit rounds refund fully. Under-quorum or beacon-failure rounds preserve a paid compensation path for
accepted work. Pull credits prevent a failed recipient transfer from blocking terminal settlement.

USDC retains Circle's freeze/blacklist powers, depeg risk, and contract risk. RateLoop cannot remove those properties.

## Admission

The separate `CredentialIssuer` can rotate epoch signers and therefore admit or censor future voters. It cannot hold
funds, redirect a claim, change an accepted commit, or influence settlement. The server signer, gas-only relayer, keeper,
and prepaid funder use distinct secrets. Paid eligibility—current assurance/age state, residence/tax/DAC7 status,
sanctions screening, and payout setup—must be current before a paid voucher is signed.

The current contract and app use one ordered numeric identity tier. That model does not represent customer invitations,
job qualifications, hybrid cohorts, or non-comparable assurance evidence and contains a known `presence` tier mismatch
between issuance and payment code. The redesign replaces it with exact versioned audience-policy hashes. World ID and
Self are not currently production adapters and will remain optional off-chain assurance sources.

## Votes and privacy

The browser generates one-time vote and payout keys per round. Answers are tlock-encrypted for the configured drand
network; the public commit binds the ciphertext, reveal, payout destination, nullifier, and exact voucher. RateLoop
never receives the vote or payout private key. Recovery exports use PBKDF2-SHA256 (600,000 iterations) and AES-256-GCM
under a user secret.

Before reveal, the one-time vote key is pseudonymous. A normal claim permanently links that vote key to its per-round
payout address. The operator also retains the required off-chain identity-to-voucher mapping for legal and abuse-control
purposes. In the current database, rater/account/provider records can be joined directly to public vote keys and
nullifiers; the planned per-rater encrypted mapping and purpose-separated tax/provider vaults are not implemented. Do not
describe the system as anonymous, cross-round unlinkable, or protected from a database-level deanonymization breach.

The current product stores question and terms JSON in plaintext and does not have an encrypted artifact vault,
assignment-specific content leases, read auditing, or retention/deletion enforcement. Any signed-in rater can currently
list all approved open task content. Do not submit private customer material until task visibility fails closed and the
redesign's artifact/access controls are implemented. Chain data permanently reveals round economics and, after reveal,
individual choices, predictions, response hashes, and eventual claim destinations.

## Liveness and results

Reveal, settlement phases, claims, compensation, and stale-return calls are permissionless. The hosted keeper is a
convenience and pays gas only. A dead hosted service does not gain custody or change settlement inputs.

Ponder publishes deployment-bound chain evidence. The current application records an evidence hash, tier mix,
diversity, issuance, correlation, and answer-fingerprint fields before publishing or delisting the interpretation, but
the internal pipeline accepts those finalized fields and analytics from an authenticated operator caller instead of
deriving them from Ponder/chain and issuer/assignment snapshots. The result is therefore not yet independently
recomputable or verifier-ready. Analytics can suppress a public verdict but cannot reverse chain settlement or an earned
payout. Workspace webhooks are HMAC-signed, idempotent, retried, and store their signing secrets encrypted.

## Deployment policy

The historical Base Sepolia deployment is stale and disposable until a real-money review. Contract changes require a fresh deployment;
no storage, selector, proxy, or address compatibility is promised. App, Ponder, keeper, Postgres schema, deployment
block, and the complete `tokenless-v2:<chain>:<panel>:<issuer>:<adapter>` key must change together. Historical v1 keys
are rejected by every active service. The `tokenless`
branch must never be attached to `rateloop.ai` or the legacy production Railway/Vercel projects.
