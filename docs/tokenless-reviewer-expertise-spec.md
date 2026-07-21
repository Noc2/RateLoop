# Tokenless reviewer-expertise specification

Reviewer expertise is a private admission qualification, not a public profile claim. A workspace owner defines
what knowledge a review needs in **Reviews** and establishes who can satisfy it in the reviewer roster there. RateLoop
may show common examples, but suggestions are never selected, granted, or required without an explicit owner action.

## Definitions and frozen requirements

RateLoop maintains versioned global definitions for its supported network credentials. The initial definitions
are TypeScript code review, application security review, broker-dealer supervision, investment advisory,
privacy compliance, and customer-support operations. Workspace owners may also create concise workspace-only
definitions for invited reviewers. A definition has an immutable ID, version, content hash, name, and qualifying
description. Editing creates a new version; retirement prevents future selection without changing a frozen
request or qualification.

A request profile freezes each exact definition ID, version, hash, and required seat count in its semantic hash.
Legacy key requirements retain their original all-seat meaning when migrated. Workspace definitions can never
become RateLoop-network credentials or be used to imply platform verification.

Private invited panels support minimum-seat coverage per definition. One reviewer may satisfy several
requirements, but the selected panel must contain at least the frozen number of qualified seats for every
requirement. RateLoop-network review remains all-seat: every network reviewer must hold every selected global
qualification because the current public voucher lane freezes one admission policy for the whole panel.
Heterogeneous public specialist seats require separately frozen seat-class admission policies and are not
available until that mechanism exists. Hybrid policies preserve these lane boundaries; workspace definitions
may be satisfied only by invited seats.

## Workspace setup

**Reviews** answers only whether specialist knowledge is required and freezes the definitions and seat counts.
It does not block on a reviewer pool that the owner has not yet created. The default is no specialist
requirement; adding one is explicit, and the confirmation view shows human-readable names and seat counts.

The **Reviewers** section in **Reviews** shows live coverage for each frozen requirement, separated into confirmed
reviewers and pending invitations. It is where an owner invites reviewers, confirms expertise, sets qualification
expiry, and recovers from insufficient coverage. Pending, expired, revoked, removed, or unconfirmed people never count
as coverage. Network coverage is read-only and includes only active platform-verified global credentials.

An invitation may record the expertise the owner intends to confirm, but it is not a qualification. Redemption
creates workspace reviewer access only. It never grants workspace membership. After redemption, the owner must
explicitly attest the signed-in reviewer's workspace qualifications; a transferable invitation token, email binding,
or reviewer self-declaration can never grant expertise. An owner cannot grant a global network credential.

Setup may finish while invitations or confirmations are pending, with specialist readiness shown as
`action_required`. That state blocks preparing, publishing, funding, or assigning a matching review. It does not
weaken the saved review policy and is not silently downgraded to unqualified reviewers.

## Qualification and enforcement

`tokenless_reviewer_qualifications` is the canonical qualification record. Invited expertise is workspace-scoped,
owner-attested, revocable, and expires within two years. Network expertise is globally scoped, backed by a
platform-verified evidence commitment, revocable, and expires within two years. Gold-derived expertise may be
tenant-scoped but owner evidence cannot create a global credential.

Private assignment provenance is a self-contained projection of canonical qualifications for assignment evidence,
not a second grant. Projection and reviewer-access refreshes must merge active expertise rather than erase it and
may never extend the canonical qualification or reviewer-access expiry.

Coverage and assignment evaluate membership and qualification validity through the frozen response deadline,
not merely at setup or assignment time. The chosen private panel is checked transactionally against every
minimum-seat requirement. The network lane checks the sufficient verified pool, the exact all-seat admission
rules, and each voucher admission before funding. Revocation or expiry blocks future assignments but cannot
cancel accepted work or an earned payment.

## Privacy and evidence

Workspace definitions, attestations, member identities, and pending invitations are visible only to authorized
workspace managers and the affected reviewer where needed to understand or exercise access. They are not added
to public user profiles. Reviewers receive the exact qualifying description needed to understand an assignment;
unrelated evidence and workspace qualifications are not disclosed.

Credential evidence is referenced by a SHA-256 commitment. Assignment snapshots bind the exact definition
versions, qualification provenance, expiry cutoff, and satisfied seat coverage. Public evidence exposes only
k-anonymized aggregate qualification-tier counts. The operator verification queue remains hash-chained and
admission-only: operators cannot alter work, verdicts, settlement, earned payouts, or optional Feedback Bonus
awards.
