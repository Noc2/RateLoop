# Private artifact boundary

Human-assurance artifacts are encrypted before they leave the application server and are written to a private Vercel
Blob store. Postgres keeps tenant-scoped metadata, an HMAC commitment, envelope metadata, retention state, leases, and
an append-only access log; it does not keep artifact plaintext.

- `TOKENLESS_ARTIFACT_MASTER_KEY` is a 32-byte server-only wrapping key. Each artifact gets a random AES-256-GCM data
  key and independent nonces. `TOKENLESS_ARTIFACT_KEY_VERSION` selects the available wrapping-key version.
- The blob pathname contains opaque workspace, project, and object IDs only. The Vercel object is private and contains
  ciphertext only.
- A workspace member can read an artifact. A reviewer can read only with a short-lived, Base-Account-bound artifact
  lease; exports require an owner or admin role.
- Creation, lease, preview, read, export, and deletion events are logged. Reviewer accounts are stored in the audit log
  as keyed references rather than raw addresses.
- Project retention schedules the object for deletion. Customer deletion requests can shorten, but never extend, the
  retention deadline. A retry-safe job deletes the blob and tombstones its database reference.

The current adapter keeps the wrapping key in a server environment secret. Before real customer data, move this key to
a managed KMS, document rotation/recovery/legal-hold procedures, and provision a dedicated private Blob store in the
isolated `rateloop-tokenless` project. Do not reuse eligibility, provider-evidence, vote-mapping, webhook, or tax keys.
