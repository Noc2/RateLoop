# Private artifact boundary

Human-assurance artifacts are encrypted before they leave the application server and are written to a private Vercel
Blob store. Postgres keeps tenant-scoped metadata, an HMAC commitment, envelope metadata, retention state, leases, and
an append-only access log; it does not keep artifact plaintext.

- Each artifact gets a random AES-256-GCM data key and independent nonces. Hosted wrapping uses the version selected by
  `TOKENLESS_ARTIFACT_WRAPPING_KEY_VERSION` from the server-only `TOKENLESS_ARTIFACT_WRAPPING_KEYS` keyring. During
  migration, the existing 32-byte `TOKENLESS_ARTIFACT_MASTER_KEY` is accepted as a single retained root. HKDF derives
  tenant-scoped workspace/project wrapping keys, and every wrap and unwrap supplies authenticated workspace, project,
  artifact, and key-version context. Authorized RateLoop workloads can still decrypt that tenant's artifacts to provide
  the service.
- The blob pathname contains opaque workspace, project, and object IDs only. The Vercel object is private and contains
  ciphertext only.
- A workspace member can read an artifact. A reviewer can read only with a short-lived, Base-Account-bound artifact
  lease; exports require an owner or admin role.
- Creation, lease, preview, read, export, and deletion events are logged. Reviewer accounts are stored in the audit log
  as keyed references rather than raw addresses.
- Project retention schedules the object for deletion. Customer deletion requests can shorten, but never extend, the
  retention deadline. A retry-safe job deletes the blob and tombstones its database reference.

Hosted operation uses the configured platform-secret keyring and tenant-scoped derived wrapping keys. Key provisioning
and inventory, rotation and rewrap, recovery/legal-hold procedures, workload access exercises, and a dedicated private
Blob store in the isolated `rateloop-tokenless` project remain real-customer release gates. Retired roots remain
available only until every dependent envelope has been rewrapped and verified. Do not reuse eligibility,
provider-evidence, vote-mapping, webhook, or tax keys.
