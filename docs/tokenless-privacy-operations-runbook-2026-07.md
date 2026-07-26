# Tokenless privacy operations runbook (July 2026)

**Status:** Current operational runbook for the isolated tokenless deployment.

This runbook covers the repository-controlled privacy workflow for the isolated `tokenless` deployment. It does not
replace a controller/processor determination, statutory retention schedule, transfer assessment, or legal advice.

## Intake and authorization

- An authenticated person submits an access, correction, restriction, objection, export, or deletion request through
  `POST /api/account/privacy/subject-requests`. The server binds the request to the RateLoop principal in the HttpOnly
  session; it does not accept an email address or wallet as proof of account authority.
- Workspace owners and administrators export the covered tenant audit chain through
  `GET /api/account/workspaces/{workspaceId}/audit/export`. Export is authorization-checked, marked `no-store`, and
  read-only: browser prefetch or repeated downloads do not grow the audit chain or attestation queue.
- Workspace owners and administrators create or release project legal holds through the project-scoped legal-hold
  routes. Same-origin and service-layer workspace/project authorization are required.
- A signed-in user previews and confirms account deletion through `GET` and `POST /api/account/deletion`. Confirmation
  requires the literal word `DELETE`, the active RateLoop session, and a recent Better Auth session bound to the same
  principal. A workspace owner previews and confirms workspace deletion through
  `GET` and `POST /api/account/workspaces/{workspaceId}/deletion`; confirmation requires the current workspace name.

The self-service account and workspace paths implement their own authorization, blockers, request transitions, and
category-level completion evidence and may process real requests. Authenticated access and export requests are consumed
by scheduled maintenance, produce a category-level lifecycle, and expose a principal-bound download for seven days.
Correction, restriction, objection, exceptional deletion, and manual overrides still require an approved operator
procedure, role, and evidence owner. Compliance actions use a separate operator secret until a production operator
principal and console are available.

Provision `TOKENLESS_COMPLIANCE_OPERATOR_SECRET` as a server-only random credential of at least 32 characters before
deploying. The release preflight rejects a missing, short, reused, or `NEXT_PUBLIC_` copy. An approved operator sends
it as `Authorization: Bearer <credential>` only to the internal sanctions, forecast-appeal, and workspace-fund routes
under `/api/internal/compliance/`. Rotate it through the hosting secret store and preserve the corresponding operator
identity and evidence reference outside application logs; never paste the credential into a request note or audit
metadata.

## Self-service deletion

- Account deletion is blocked while the principal owns a workspace, has accepted work that has not reached its terminal
  path, or has an active managed wallet. Reserved but unaccepted assignments are released. The service revokes sessions,
  API and OAuth access, memberships, workspace reviewer and enterprise SSO links, identity/contact data, rater
  eligibility, and wallet proof state, then tombstones the opaque principal. Settlement- and quality-linked rater rows
  are enumerated honestly as retained rather than described as erased.
- Workspace deletion is owner-only and is blocked by an active subscription; reserved or accepted assignments; open
  asks; or unsettled billing, policy, or usage reservations. If settled, reserved, or available funds remain, confirming
  deletion creates a `blocked_by_funds` subject request and a manual refund-resolution item without changing the ledger
  or forfeiting funds. An authorized compliance operator records an external refund/reference; the same deletion request
  then resumes. On completion, the service revokes workspace credentials and integrations, removes member and reviewer
  access, revokes pending invitations, queues private objects for deletion, and tombstones the workspace.
- Public-chain records and records subject to accounting, payment, fraud/security, dispute, audit, or legal-hold duties
  are retained or anonymized under their applicable schedule. Each retained category must record the reason and review
  or expiry deadline; the deletion result must not describe retained evidence as erased.
- A revoked Better Auth binding is retained for 35 days to prevent an in-flight authentication exchange from recreating
  a deleted principal. Scheduled reconciliation erases the binding after the guard period and records the category
  transition. A later sign-up creates a new principal and does not restore the deleted account.
- Private object and public-question-media workers delete the blob before tombstoning its database reference. Legal
  holds and not-yet-due retention deadlines keep work retryable. Reconciliation completes the deletion job and subject
  request only after all queued media is gone and records category-level evidence exactly once.

## Operational retention and delivery recovery

- Scheduled maintenance deletes expired subject-request exports, expired one-time-code verification rows, expired or
  long-revoked Better Auth and RateLoop sessions, stale eligibility handoffs/expired scopes and completed orphaned
  screening work, and
  terminal notification-delivery telemetry according to the public retention notice. Statutory, settlement,
  legal-hold, deletion-receipt, backup, and public-chain categories are deliberately outside this operational purge.
- A queued sanctions screening is never aged out while it is pending. A confirmed match creates a separate deny record
  containing the source, list-snapshot hash, decision maker, decision time, and retention deadline. New submissions by
  that rater fail closed regardless of the newly supplied name. Match evidence survives account erasure as a restricted
  legal-risk record attached only to the tombstoned rater identifier; the ordinary subject export excludes its
  ciphertext. `TOKENLESS_SANCTIONS_MATCH_RETENTION_DAYS` may be 365–3650 and defaults to 1825. Change the period only
  against the documented legal-basis and retention review; scheduled maintenance removes the deny record at its
  deadline before the now-orphaned encrypted screening can be purged.
- A completed DAC7 declaration is copied into a versioned statutory record under the `tax_records` key domain. The
  operational eligibility row retains only that record reference. The record is restricted to reporting and
  compliance operations until 1 January following the tenth full calendar year after collection, so account erasure
  removes the active eligibility link but preserves the encrypted statutory record against the receipt-tombstoned
  rater identifier. Scheduled maintenance expires any remaining active reference before deleting the record at its
  `retained_until` deadline. Never shorten this schedule or decrypt/export a retained record without the documented
  PStTG/AO legal-basis review.
- Paid unlock applies the Vercel-derived country/region geoblock before storing identity or tax data. The subsequent
  plausibility record contains only country/region/locale comparisons and reason codes; wallet screening stores
  provider/list/reference hashes rather than the provider reference or raw wallet. A mismatch or provider review is
  fail-closed for vouchers pending neutral review, while a blocked location or wallet match is ineligible. Risk
  evidence expires before voucher admission and is deleted after one year unless a separately documented legal hold
  applies. Overrides to the default blocked-country/region sets require the same sanctions and geographic-control
  review as the screening provider inventory.
- Subject exports contain the authenticated principal&apos;s account, membership, reviewer-access, eligibility-status,
  crowd-forecast integrity counters and findings, and request-lifecycle categories. They do not contain another
  reviewer&apos;s pair identity, vault ciphertext, encryption material, session credentials, or raw provider evidence.
  Cross-principal and expired downloads return not found.
- Notification email attempts dead-letter after the bounded retry window. A dead letter is automatically reopened after
  an increasing recovery delay, resetting only the attempt counter and preserving a bounded recovery count. After six
  failed recovery cycles it remains a visible terminal dead letter for operator action; a transient provider outage can
  no longer strand the first queue permanently.

## Paid-lane integrity epochs

- Public-network and hybrid paid lanes remain disabled unless production has approval-record hashes for the blockchain
  DPIA and provider-transfer inventory. An approval hash records governance evidence; it is not a substitute for the
  underlying signed assessment, transfer mechanism, processor terms, or pre-work transparency.
- Once `TOKENLESS_INTEGRITY_EPOCH_PRODUCER_ENABLED=true`, the scheduled producer samples only current paid-scope,
  payout-ownership, provider-subject, and unique-human state. It persists HMAC reviewer lookups, HMAC hard-link values,
  encrypted private feature vectors, and aggregate signed manifests. Raw principal IDs, provider subjects, payout
  accounts, device history, network history, and protected attributes are not written to an epoch. Behavioral scoring
  stays disabled pending a separately approved DPIA.
- Private feature rows have a configured 1–365 day expiry and scheduled deletion; aggregate signed manifests remain as
  integrity evidence. Account deletion removes the reviewer from every unexpired epoch before the rater profile is
  tombstoned. Operators must keep every still-referenced lookup-key version in
  `TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEYS_JSON`; missing historical erasure keys block completion rather than issuing
  a false deletion receipt.
- Rotate lookup, pseudonym, vault, and Ed25519 signing keys under the approved key procedure. Retired lookup keys may be
  removed only after no private epoch member references their version. Vault-key removal crypto-shreds any remaining
  ciphertext and must be recorded against the retention schedule. Never put any private key or reviewer identifier in
  an approval record, manifest, log, alert, or public-chain field.

## Request procedure

1. Confirm the request is tied to the authenticated principal and record the request ID, type, receipt time, applicable
   legal regime, owner, and response deadline outside customer-visible notes.
2. Check workspace/project scope, active legal holds, statutory retention, fraud/security needs, public-chain records,
   processor copies, and backup-expiry obligations.
3. Collect only categories within scope. Never place raw content, credentials, email addresses, wallet proofs, or
   decryption material in audit metadata.
4. Record each category as deleted, anonymized, retained under a specific hold/law, pending processor completion,
   pending backup expiry, or public-chain-unerasable. A generic `complete` result is insufficient.
5. Have a second authorized operator review the completion evidence and any denial/extension rationale before the
   response is issued.
6. Deliver the response through an authenticated channel, then record the final transition and next review date.

## Legal holds and deletion

- A hold requires project scope, a reason, the author, a review date, and an eventual release record. Overdue holds
  must be escalated; a hold is not an undeclared indefinite-retention policy.
- Project and workspace object deletion must stop while an active hold exists. When released, delete private object
  ciphertext first, tombstone the database reference, and record category-level completion evidence.
- Public Base Sepolia addresses, commitments, and settlement records cannot be deleted by RateLoop. The response must
  identify that exception without implying that off-chain copies are also exempt.
- Backups and processor copies remain incomplete until their documented expiry/deletion evidence is attached.

## Integrity and incident handling

Workspace audit records are chained against a stored head and detect modified or deleted events within the application
model. Pre-workspace authentication events use a separate chain. These are not a transactional outbox, immutable/WORM
archive, or complete log of every application action. If verification fails, stop export, preserve database and runtime
evidence, open an incident, and do not repair or reseed the chain before independent review.

## Public-statement correction

If implementation, live configuration, processor terms, or evidence no longer supports a public statement:

1. remove or narrow the statement in the product surface and its corresponding technical documentation;
2. record the evidence change, review owner, and next approval gate internally;
3. run the affected source/render tests;
4. publish only to the isolated tokenless deployment and confirm `rateloop.ai` did not move; and
5. record the affected evidence, owner, withdrawal time, customer-notice decision, and remediation gate.

Never keep a claim public merely because a replacement control is planned.
