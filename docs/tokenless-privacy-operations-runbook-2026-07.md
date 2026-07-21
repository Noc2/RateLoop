# Tokenless privacy operations runbook (July 2026)

**Status:** Current operational runbook for the isolated tokenless deployment.

This runbook covers the repository-controlled privacy workflow for the isolated `tokenless` deployment. It does not
replace a controller/processor determination, statutory retention schedule, transfer assessment, or legal advice.

## Intake and authorization

- An authenticated person submits an access, correction, restriction, objection, export, or deletion request through
  `POST /api/account/privacy/subject-requests`. The server binds the request to the RateLoop principal in the HttpOnly
  session; it does not accept an email address or wallet as proof of account authority.
- Workspace owners and administrators export the covered tenant audit chain through
  `GET /api/account/workspaces/{workspaceId}/audit/export`. Export is authorization-checked, marked `no-store`, and is
  itself added to the workspace audit chain after the returned snapshot boundary.
- Workspace owners and administrators create or release project legal holds through the project-scoped legal-hold
  routes. Same-origin and service-layer workspace/project authorization are required.
- A signed-in user previews and confirms account deletion through `GET` and `POST /api/account/deletion`. Confirmation
  requires the literal word `DELETE`, the active RateLoop session, and a recent Better Auth session bound to the same
  principal. A workspace owner previews and confirms workspace deletion through
  `GET` and `POST /api/account/workspaces/{workspaceId}/deletion`; confirmation requires the current workspace name.

The self-service account and workspace paths implement their own authorization, blockers, request transitions, and
category-level completion evidence and may process real requests. A production operator console and authenticated
operator principal are not yet available, so other request types and manual overrides still require an approved
operator procedure, role, and evidence owner.

## Self-service deletion

- Account deletion is blocked while the principal owns a workspace, has accepted work that has not reached its terminal
  path, or has an active managed wallet. Reserved but unaccepted assignments are released. The service revokes sessions,
  API and OAuth access, memberships, identity/contact data, and wallet proof state, then tombstones the opaque principal.
- Workspace deletion is owner-only and is blocked by any settled, reserved, or available funds; an active subscription;
  reserved or accepted assignments; open asks; or unsettled billing, policy, or usage reservations. On confirmation, the
  service revokes workspace credentials and integrations, removes member and reviewer access, revokes pending
  invitations, queues private objects for deletion, and tombstones the workspace.
- Public-chain records and records subject to accounting, payment, fraud/security, dispute, audit, or legal-hold duties
  are retained or anonymized under their applicable schedule. Each retained category must record the reason and review
  or expiry deadline; the deletion result must not describe retained evidence as erased.
- A revoked Better Auth binding is retained for 35 days to prevent an in-flight authentication exchange from recreating
  a deleted principal. Scheduled reconciliation erases the binding after the guard period and records the category
  transition. A later sign-up creates a new principal and does not restore the deleted account.
- Private object and public-question-media workers delete the blob before tombstoning its database reference. Legal
  holds and not-yet-due retention deadlines keep work retryable. Reconciliation completes the deletion job and subject
  request only after all queued media is gone and records category-level evidence exactly once.

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
