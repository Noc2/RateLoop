# Tokenless reviewer-expertise specification

Reviewer expertise is an admission qualification, not a public profile. RateLoop stores only controlled keys
needed to route a review:

- `code-review:typescript`
- `code-review:security`
- `finance:broker-dealer-supervision`
- `finance:investment-advisory`
- `legal:privacy-compliance`
- `operations:customer-support`

Invited reviewers may receive workspace-scoped, owner-attested expertise with an expiry of at most two years.
The attestation cannot extend an existing membership or qualification expiry. Network expertise requires a
platform-verified evidence commitment, is globally scoped, expires within two years, and can be revoked. Gold-
derived expertise is permitted by the schema but owner gold remains tenant-scoped and cannot create a global
network credential.

`tokenless_reviewer_qualifications` is the canonical record. For an invited cohort, the service projects the
same keys and expiry into that cohort reviewer's private provenance JSON so assignment snapshots remain
self-contained; the projection is not a second grant and may never outlive the canonical/admission expiry.

Every selected key enters the request-profile semantic hash. The private adapter merges those requirements
into the frozen cohort binding and checks every named reviewer's unexpired provenance. The public adapter
requires both a sufficient verified pool and the same keys in the exact frozen admission policy; voucher
issuance re-evaluates that policy. Missing capacity blocks the request before funding—there is no silent
downgrade.

Setup shows an eligible-pool count before confirmation. Evidence packets disclose only k-anonymized aggregate
qualification-tier counts. Credential evidence is referenced by a SHA-256 commitment, and the operator queue
uses a hash-chained audit log. Operator authority is admission-only: it cannot alter work, verdicts, settlement,
earned payouts, or optional Feedback Bonus awards.
