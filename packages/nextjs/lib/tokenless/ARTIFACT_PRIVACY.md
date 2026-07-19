# Private artifact boundary

Human-assurance artifacts are encrypted before they leave the application server and are written to a private Vercel
Blob store. Postgres keeps tenant-scoped metadata, an HMAC commitment, envelope metadata, retention state, leases, and
an append-only access log; it does not keep artifact plaintext.

- Each artifact gets a random AES-256-GCM data key and independent nonces. Local tests may use the 32-byte server-only
  `TOKENLESS_ARTIFACT_MASTER_KEY`; hosted releases forbid it. Hosted wrapping requires `TOKENLESS_KMS_KEY_RESOURCE` to
  be a workspace/project-scoped AWS KMS alias template. Every wrap and unwrap supplies authenticated workspace, project,
  artifact, and key-version context. A RateLoop workload role permitted to invoke the resolved tenant key can still
  decrypt that tenant's artifacts to provide the service.
- The blob pathname contains opaque workspace, project, and object IDs only. The Vercel object is private and contains
  ciphertext only.
- A workspace member can read an artifact. A reviewer can read only with a short-lived, Base-Account-bound artifact
  lease; exports require an owner or admin role.
- Creation, lease, preview, read, export, and deletion events are logged. Reviewer accounts are stored in the audit log
  as keyed references rather than raw addresses.
- Project retention schedules the object for deletion. Customer deletion requests can shorten, but never extend, the
  retention deadline. A retry-safe job deletes the blob and tombstones its database reference.

The current adapter supports a server environment secret for local tests; hosted operation must use the configured
managed-KMS adapter and tenant-scoped alias template. Key provisioning and inventory, rotation and rewrap,
recovery/legal-hold procedures, workload-role access exercises, and a dedicated private Blob store in the isolated
`rateloop-tokenless` project remain real-customer release gates. Do not reuse eligibility, provider-evidence,
vote-mapping, webhook, or tax keys.
