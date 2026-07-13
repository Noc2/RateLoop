# RateLoop Tokenless Trust Model

This document describes the implemented `tokenless` system and its current limitations. The checked-in Base Sepolia
addresses are historical and do not match the current fund core. Publish new addresses only after the planned contract
changes, a fresh deployment, source verification, and complete deployment-key parity checks. The
[human-assurance redesign plan](docs/tokenless-human-assurance-redesign-plan-2026-07.md) defines the remaining product,
pilot, real-money, identity-provider, and deployment gates.

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

The contract binds every paid voucher to the exact hash of a versioned audience policy. Customer invitations, job
qualifications, reviewer source, assurance capabilities, provider allowlists, and fallbacks are not collapsed into an
ordered identity tier. The private human-assurance workflow currently fails closed for paid, network, and hybrid
assignments until the frozen assignment policy is carried through voucher issuance, commit, settlement, and receipt.
The strictly unpaid customer-invited path and simulated sandbox remain available; the generic paid settlement primitive
is not presented as a completed assurance workflow.

Customer invitations are one-time, hashed, Base-Account-bound access credentials. They do not prove unique humanity,
age, expertise, residence, sanctions clearance, or paid eligibility. World ID and Self are not production adapters.
The current provider boundary is capability-based so a provider can be added later without changing fund custody, but
no provider is a default until pilot conversion, coverage, procurement, privacy, and reliability gates are met.

## Votes and privacy

The browser generates one-time vote and payout keys per round. Answers are tlock-encrypted for the configured drand
network; the public commit binds the ciphertext, reveal, payout destination, nullifier, and exact voucher. RateLoop
never receives the vote or payout private key. Recovery exports use PBKDF2-SHA256 (600,000 iterations) and AES-256-GCM
under a user secret.

Before reveal, the one-time vote key is pseudonymous. A normal claim permanently links that vote key to its per-round
payout address. The operator also retains the required off-chain identity-to-voucher mapping for legal and abuse-control
purposes. In the current database, rater/account/provider records can be joined directly to public vote keys and
nullifiers. Provider evidence, statutory tax data, and the nullifier seed now use purpose-separated encryption domains,
but the voucher/commit rows are not a per-rater encrypted mapping. Do not describe the system as anonymous, cross-round
unlinkable, or protected from a database-level deanonymization breach.

Customer artifacts are AES-256-GCM encrypted before private object storage. Database rows keep opaque object references,
tenant-scoped commitments, and metadata. Access is assignment-bound through short leases; previews, reads, exports, and
administrative access are logged. Workspace/project retention and deletion controls apply off-chain, subject to legal
hold and statutory retention. Reviewer rationales use a separate encryption domain, and run-scoped reviewer pseudonyms
use a separate keyed-hash domain.

These controls do not make paid reviewers anonymous to RateLoop. Voucher and commit operations still retain joinable
rater, vote-key, and nullifier records needed for eligibility, abuse control, and payment operations. A database-level
breach could therefore link a paid reviewer to public settlement activity. Chain data permanently reveals round
economics and, after reveal, individual choices, predictions, response hashes, and eventual claim destinations.

## Liveness and results

Reveal, settlement phases, claims, compensation, and stale-return calls are permissionless. The hosted keeper is a
convenience and pays gas only. A dead hosted service does not gain custody or change settlement inputs.

Ponder records the deployment-bound round, commits, and finalization transaction/block provenance. The publication
worker accepts only an operation key and derives the result from pinned Ponder data plus frozen terms, voucher,
assignment, and response records; callers cannot supply outcome metrics. Analytics can suppress a public
interpretation but cannot reverse chain settlement or an earned payout.

Completed unpaid invited assurance runs can produce a signed private decision packet containing frozen manifests,
reviewer coverage, expected and submitted case-judgment counts, per-case descriptive results, limitations, and a clear
statement that no on-chain settlement occurred. Paid packet generation remains fail-closed unless every expected valid
judgment has a receipt and every case has deployment-pinned terminal settlement evidence. Its offline verifier
recomputes roots and aggregates and requires a separately trusted signing-key or key-id pin; trusting the key embedded
in a packet alone is not sufficient. Client
`go`, `revise`, or `stop` sign-off is recorded separately. This evidence shows that accepted inputs and measured records
were not silently changed; it does not prove unbiased case selection, reviewer expertise, truthful identity issuance,
or correctness of the client's decision. Workspace webhooks are HMAC-signed, idempotent, retried, and store signing
secrets encrypted.

## Deployment policy

The historical Base Sepolia deployment is stale and disposable until a real-money review. Contract changes require a fresh deployment;
no storage, selector, proxy, or address compatibility is promised. App, Ponder, keeper, Postgres schema, deployment
block, and the complete `tokenless-v2:<chain>:<panel>:<issuer>:<adapter>` key must change together. Historical v1 keys
are rejected by every active service. The `tokenless`
branch must never be attached to `rateloop.ai` or the legacy production Railway/Vercel projects.
