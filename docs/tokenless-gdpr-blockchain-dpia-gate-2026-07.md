# Tokenless public-chain GDPR/DPIA release gate — July 2026

**Status:** Mandatory pre-production control record. This document is a repository-owned DPIA input and release
checklist; it is not a signed DPIA, legal advice, or approval to process real customer or reviewer data.

**Applies to:** every paid review lane that writes to a public chain (`private_invited` + `usdc`,
`public_paid_network`, and `hybrid_public_safe`). The invited-unpaid lane remains the non-chain alternative.

## Current authority and release rule

This gate implements the final European Data Protection Board **Guidelines 02/2025 on processing of personal data
through blockchain technologies, version 2.0, adopted 7 July 2026**, especially its recommendations on documented
necessity, off-chain storage, pre-commit information, minimisation, privacy by design, finite retention, security,
DPIAs, and effective data-subject rights:

- <https://www.edpb.europa.eu/documents/guideline/guidelines-on-processing-of-personal-data-through-blockchain-technologies_en>
- <https://eur-lex.europa.eu/eli/reg/2016/679/oj>

No paid/public capability may be advertised as production-ready merely because its code path passes. Before enabling
one for EEA data subjects or real customer material, the accountable controller must approve a current DPIA and the
operator must attach the evidence listed below. A feature flag or environment value is evidence of configuration, not
evidence of approval.

## Processing and necessity record

RateLoop uses Base settlement for a narrow purpose: funding a frozen paid-review round, proving its public terms,
making earned USDC claimable without RateLoop holding a reviewer spend key, and allowing independent verification of
the terminal settlement. The chain is not used to store customer artifacts, account profiles, tax declarations,
eligibility evidence, private rationales, email addresses, names, or workspace membership.

The controller must document why these settlement guarantees are necessary and proportionate for the exact launched
lane. The assessment must compare at least:

1. the existing invited-unpaid, entirely off-chain lane;
2. a conventional processor-controlled off-chain payout ledger;
3. a permissioned or otherwise less public ledger; and
4. the selected public-chain design and its global replication.

If the purpose can reasonably be achieved with a less privacy-invasive design carrying materially lower risk, the
public-chain lane stays disabled.

## Exact data boundary

### Public and effectively indefinite

A paid commit publishes transaction metadata, one-time vote-key and funding/payout-related addresses, round and
settlement terms, commitments, and timelock ciphertext. The ciphertext contains the vote, crowd forecast, response
hash, per-round payout address, and salt. It is scheduled to become publicly decryptable after the configured drand
deadline even when the reviewer changes their mind or RateLoop's keeper is unavailable. A reveal transaction also
publishes the plaintext reveal calldata. Public nodes, indexers, explorers, RPC providers, and independent third
parties may replicate these records globally.

Wallet addresses, vote keys, opinions, forecasts, transaction metadata, and keyed or salted values remain personal
data whenever a natural person can reasonably be identified or singled out. The product must never describe these
records as anonymous or promise that RateLoop can erase them from the chain.

### Off-chain and purpose-separated

Account identities, workspace/customer artifacts, rubrics, rationales, reviewer membership, provider assertions,
sanctions decisions, DAC7/tax declarations, invitation bindings, vote-key mappings, recovery material, and subject
request records remain off-chain. Private artifacts and designated private fields use authenticated encryption under
purpose-separated server-only key domains. Forecast integrity keeps running aggregates only; a terminal private
forecast is removed from the response row after its aggregate update.

The mapping from a RateLoop principal to a vote key, voucher, eligibility evidence, and settlement record is
restricted to the minimum operational and statutory purpose. It is not an anonymity boundary.

### Hybrid review parent and child evidence

`hybrid_public_safe` persists one parent and exactly two child settlement records: invited and network. Those records
contain purpose-bound hashes, exact round coordinates, lifecycle counters, and append-only receipt hashes. They do not
store reviewer principals, names, emails, payout accounts, raw customer content, raw rationales, or raw receipt JSON.
Reviewer identity normally remains in the purpose-specific invited-seat or network-assignment record and is not copied
into the hybrid parent or child. One ephemeral invited-wins exclusion table necessarily copies the invited reviewers'
principal IDs and payout accounts into the network binding scope to prevent self-review and duplicate payment. Those
direct links are restricted selection data, not settlement evidence.

Authenticated subject exports apply the following minimum-disclosure rule:

- a workspace member may export both child statuses and the parent evidence for that workspace;
- an invited reviewer may export only the invited child that is bound to their exact paid-assignment seat;
- a network reviewer may export only the network child that is bound through their exact network assignment and rater
  principal; and
- a reviewer may export only their own hybrid network-exclusion record, never a peer's principal or payout account; and
- reviewer exports redact the workspace ID, opportunity ID, parent evidence hashes, and the other cohort's receipt
  count. A subject with no exact membership or assignment receives no hybrid row.

Account erasure irreversibly unlinks identity in the underlying seat, assignment, and rater records and deletes the
exact subject's ephemeral exclusion rows. Workspace deletion receipts any temporarily retained exclusion links under
the settlement-and-audit deadline. Its legal-hold-aware expiry transaction deletes those links before their public
network binding and retains only the parent/child commitment evidence needed for accepted or payable claims.

The effective workspace evidence-retention period is frozen on the hybrid parent when preparation begins. A terminal
or safely cancelled parent, both children, and their hash-only receipts are deleted after that deadline only when no
workspace legal hold is active. The retention worker records counts plus one aggregate SHA-256 deletion digest in the
restricted audit trail; the digest includes the exclusion commitment but no reviewer principal or payout account. It
does not retain the deleted operation references or receipt payloads. An active hold defers the entire hybrid parent so
one cohort cannot be erased while the other remains evidentially incomplete.

## Mandatory technical controls

- **Pre-commit information:** before any voucher or chain commit is requested, the reviewer sees the exact public data
  list, inevitable timelock disclosure, global replication, absence of a post-commit abort, ordinary inability to erase,
  and the risk that reusing an address links rounds. The action is separate from accepting an assignment.
- **No direct identity on-chain:** names, emails, RateLoop principals, workspace IDs, customer artifact locations, raw
  provider subjects, tax fields, and private rationales are rejected from transaction payloads and public event
  metadata. Commitments must be domain-separated and non-enumerable.
- **Off-chain minimisation:** raw eligibility/provider handoffs expire; sessions, verification rows, delivery telemetry,
  subject exports, and private objects follow enforced schedules. Statutory/settlement records are restricted and
  enumerated honestly rather than reported as erased.
- **Cross-round linkage reduction:** one-time vote keys are mandatory. A reusable payout destination is disclosed as a
  linkage risk; no cross-round-unlinkability claim is allowed until a tested user-controlled per-round destination and
  recovery flow is the enforced default.
- **Data-subject rights:** authenticated access/export and deletion workflows cover account, reviewer, eligibility,
  workspace, enterprise identity, and mapping categories. Erasure removes or irreversibly unlinks off-chain data where
  lawful; retained and public-chain exceptions are listed by category and legal purpose. Reviewers can contest
  eligibility and forecast-integrity findings, and an open forecast appeal suspends automated assignment consequences.
- **No solely automated legal/significant decision without safeguards:** any processing within Article 22 scope must
  provide meaningful human intervention, a contest path, and authority to change the off-chain consequence.
- **Security and crypto lifecycle:** chain/deployment identity fails closed; exact events and confirmations are checked;
  signer nonces and replacements are reconciled; secrets are server-only; cryptographic algorithms, key rotation,
  incident response, vulnerability disclosure, and migration/exit plans have named owners and tested procedures.
- **Purpose isolation:** invited-workspace forecast aggregates use a workspace-scoped HMAC identity and are never
  consumed for global network admission. Network admission uses its separate rater domain.
- **Capability truth:** an unavailable lane is absent from API/MCP/plugin claims and disabled in owner configuration.
  External registrations or credentials do not, by themselves, open a lane.
- **Hybrid release gate:** implementation, passing tests, or a configured settlement producer does not enable
  `hybrid_public_safe`. The capability remains false until the signed DPIA, Article 30 record, controller/processor
  allocation, retention approval, transfer analysis, pre-commit UX evidence, and accountable release approval all
  match the deployed hybrid data flow.

## Approval evidence required before real-data launch

| Evidence | Minimum acceptance condition |
| --- | --- |
| Signed DPIA and necessity decision | Names controller, processing/lane, purposes, legal bases, data flows, public-chain model, risks, measures, residual risk, review date, and accountable approver |
| Article 30 record | Covers controller/processor roles, data categories, recipients, transfers, retention, and Article 32 measures |
| Public-chain transfer analysis | Identifies Base validators/nodes, RPC/indexer/explorer exposure, global replication, applicable Chapter V position, and residual risk |
| Provider inventory | Matches the enabled production configuration; includes hosting, database, email, billing, wallet, identity, RPC, drand, observability, regions, transfer mechanisms, DPAs, and deletion evidence |
| Customer DPA and instructions | Executed terms for processor activity; controller instructions expressly separate private processing from a public-chain action |
| Retention schedule | Category-specific purpose, legal basis, duration, restriction, deletion/anonymisation method, backup schedule, owner, and review date |
| Rights exercise | Tested authenticated access/export, correction/restriction procedure, account/workspace erasure, appeal/human review, processor-copy tracking, and accurate chain exception |
| Security exercise | Current threat model, chain/deployment identity tests, signer/key rotation, vulnerability and incident runbook, recovery drill, and cryptographic-agility owner |
| Pre-commit UX evidence | Screenshots and tests for the exact disclosure on every paid lane and confirmation that no voucher/commit request precedes it |
| Counsel/DPO decisions | Invited-paid adulthood posture, sanctions workflow, DAC7/BZSt posture, lawful bases, Article 22 assessment, public-chain necessity, transfers, and residual-risk acceptance |

Any missing, expired, or configuration-mismatched item keeps the affected paid/public lane unavailable. The signed
record must be reviewed when the chain, contract, public payload, identity/payout design, purpose, provider, region,
retention schedule, or risk materially changes, and at the review date recorded in the DPIA.

## Verification owned by this repository

At minimum, a release candidate runs:

```text
yarn test:packages
yarn foundry:test
yarn workspace @rateloop/nextjs auth:check
yarn workspace @rateloop/nextjs evidence:verify
yarn workspace @rateloop/nextjs audit:verify
```

The release evidence must also include the browser pre-commit disclosure test, subject export/deletion tests,
retention purge tests (including hybrid legal-hold release and aggregate deletion digest), owner/invited/network
subject-export non-disclosure tests, account/workspace zero-postconditions, forecast appeal suspension, chain identity
checks, settlement receipt verification, and the production-readiness preflight. Passing tests establishes
implementation evidence only; the accountable controller still owns the DPIA, legal bases, provider contracts, and
final risk decision.
