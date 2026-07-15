# Tokenless EU trust and identity implementation plan (15 July 2026)

**Status:** approved implementation amendment for the `tokenless` branch

**Supersedes for browser identity:** the primary-login decision in
[`tokenless-thirdweb-enterprise-auth-plan-2026-07.md`](tokenless-thirdweb-enterprise-auth-plan-2026-07.md). The
immutable fund-core, payment, settlement, claim, and deployment-isolation decisions remain unchanged.

## Outcome

RateLoop will ship the repository-controlled portions of every item classified `EASY_NOW` or `NEAR_TERM` in the
privacy, security, and compliance plan before the first production use. The isolated tokenless application remains a
sandbox until separately provisioned EU resources and external evidence pass their gates.

The release has four hard boundaries:

1. A RateLoop-owned opaque principal is the browser identity. A wallet address is never the durable human identifier.
2. Better Auth owns browser authentication and RateLoop stores the resulting session in its EU-first application
   database. thirdweb is optional wallet infrastructure used only after an authenticated user explicitly requests a
   funding or payout wallet.
3. The application may publish only exact claims present in the versioned trust-claim registry. Implemented controls,
   externally verified claims, and unavailable certifications are presented separately.
4. `EU-hosted data plane`, strict residency, no-training, SSO/SCIM, penetration-test, SOC 2, HIPAA, customer-VPC, and
   similar claims remain disabled until their external evidence is attached and approved.

## Rechecked scope

The original labels mixed repository work with evidence that code cannot create. This plan keeps each label but splits
its completion into a repository gate and, where needed, an external claim gate.

| Capability | Repository implementation in this release | Public wording after this release | Remaining external gate |
|---|---|---|---|
| Versioned trust-claim registry (`EASY_NOW`) | Typed registry, evidence links, review/expiry validation, tests | Only registry entries marked public and current | Security/legal approval for new legal promises |
| `/trust` page (`EASY_NOW`) | Current controls, limitations, dated implementation status, evidence links | `Review RateLoop's implemented controls and current limits.` | External reports only when issued |
| EU deployment manifest and readiness (`EASY_NOW`) | Signed-shape manifest, one-region policy, resource/runtime checks, mixed-region rejection | `EU-first deployment controls are enforced.` | Verified live resource IDs before `EU-hosted` |
| EU-pinned compute/service config (`EASY_NOW`) | Vercel `fra1`; Railway `europe-west4-drams3a`; tests | No residency badge | New EU Postgres, Blob, keys, logs, backups |
| Classification and home region (`EASY_NOW` + `NEAR_TERM`) | Canonical classes/uses, immutable `eu` home region, retention and hold fields, policy enforcement on core ingestion/export paths | `Workspace data is policy-bound by classification, region, retention, and permitted use.` | Migration/restore evidence for a live stack |
| Artifact/evidence authorization (`EASY_NOW`) | Explicit project assignments, deny-by-default authorization, cross-tenant tests | `Private artifacts are encrypted and limited to assigned access.` | Route inventory must remain green |
| Supply-chain checks (`EASY_NOW`) | CodeQL, dependency audit, container build/scan, SBOM, provenance artifact, dependency updates | Listed as engineering controls, not certification | GitHub rules/push protection administration |
| Canonical audit envelope (`NEAR_TERM`) | Integrity-chained workspace and pre-workspace schemas, safe metadata boundary, covered-action instrumentation, tenant export | `Covered identity, wallet, authorization, agent credential, artifact, lifecycle, and export actions produce integrity-chained application records.` | Transactional outbox and write-once external sink before complete or `immutable audit log` claims |
| Structured encryption/KMS boundary (`NEAR_TERM`) | Provider-neutral envelope-vault API, per-record data keys, tenant/region AAD, rotation/rewrap tests, production fail-closed KMS rule | Exact encrypted categories only | Live EU KMS/key ceremony/backfill/recovery |
| Retention, deletion, DSAR, legal hold (`NEAR_TERM`) | Policy graph, hold workflow, subject request/export/deletion records, completion evidence, public-chain exceptions | Exact covered categories only | Counsel schedule, processors, backup-expiry evidence |
| Provider-neutral principal (`NEAR_TERM`) | Better Auth, opaque principal, provider bindings, purpose-scoped wallet bindings, compatibility migration | `Sign in without a wallet; add one only for onchain payments or payouts.` | SAML/SCIM remains a later external gate |

## Dependency order and commits

Each numbered step is independently reviewed, tested, and committed. Later steps may depend on the schema introduced by
earlier commits but must not be folded into the same commit.

### 1. Freeze this implementation contract

- Add this plan and update the design-of-record references.
- Record the exact claim boundaries and release gates.
- Do not change runtime code in this commit.

### 2. Trust registry and public surfaces

- Add `packages/nextjs/content/trustClaims.ts` as the only source for public security/privacy statements.
- Validate unique keys, exact text, evidence, approval state, effective date, review date, and claim kind.
- Add `/trust`, link it from the homepage privacy card and global footer, and cover it with source and render tests.
- Show unavailable certifications without logos or language implying completion.
- Keep the homepage copy concrete: encrypted private artifacts, short assigned leases, scoped agent credentials, and
  public-chain limits.

### 3. EU deployment contract

- Add a machine-readable EU manifest covering compute, Postgres, object storage, KMS, workers, logs/backups, auth,
  email, billing, RPC, support access, and public-chain exceptions.
- Pin Vercel functions to `fra1` and Railway services to `europe-west4-drams3a`.
- Extend build/readiness checks to require `eu`, matching region/resource identifiers, and a private EU Blob store.
- Fail closed on mixed-region configuration or legacy tokenless/production project identifiers.
- Do not activate the `EU-hosted data plane` claim merely because configuration is pinned.

### 4. Project assignment authorization

- Add explicit project access assignments for workspace administrators, contributors, auditors, and reviewers.
- Centralize artifact/evidence authorization decisions and enforce them inside the data query.
- Preserve reviewer assignment and lease requirements for blinded content.
- Add same-project, wrong-project, wrong-workspace, revoked-assignment, billing-role, and unassigned denial tests.

### 5. Data classification and lifecycle policy

- Add canonical `public`, `synthetic`, `internal`, `confidential`, `restricted`, and `regulated` classifications.
- Add immutable `home_region`, `retention_policy_id`, `legal_hold_state`, and `data_use_policy_version` fields to
  workspaces/projects and relevant credentials.
- Default new private workspaces/projects to `eu`; reject regulated data unless an explicitly enabled contract mode
  exists.
- Enforce credential classification, deployment region, visibility, reviewer source, export, and retention policy in
  the shared service layer so browser, agent, and worker callers cannot bypass it.

### 6. Vault/KMS boundary

- Introduce `lib/privacy/vault` with provider-neutral wrap/unwrap interfaces.
- Use random per-record data keys, AES-256-GCM content encryption, tenant/region/purpose AAD, and versioned wrapping
  keys.
- Allow a deterministic local test provider only in non-production/sandbox mode.
- Require a managed-KMS provider and resource identifier for non-sandbox production.
- Migrate new customer-bearing structured payloads to encrypted envelopes while keeping minimal indexed metadata.

### 7. Retention, DSAR, deletion, and legal hold

- Define table/category retention actions and public-chain/statutory exceptions.
- Add authenticated subject-request intake and state transitions for access, correction, restriction, objection,
  export, and deletion.
- Add scoped legal holds with reason, author, review date, release, and audit record.
- Produce a completion record distinguishing deleted, anonymized, retained by law/hold, pending backup expiry, and
  public-chain-unerasable data.
- Prevent holds from becoming an undeclared indefinite-retention mechanism.

### 8. Canonical audit envelope

- Add one append API containing tenant, region, actor, assurance method, action, target, purpose/reason, request
  correlation, result, and timestamp.
- Chain canonical event digests per workspace and support JSON export.
- Cover the actions implemented in this release: login/logout/failure, session and wallet binding, project access,
  agent pairing/approval/rotation/revocation, private-artifact reads, tenant export, and lifecycle/hold/deletion actions.
- Keep unsupported operator access unavailable. Treat complete membership, billing, KMS-operation, and operator-action
  coverage as a later transactional-outbox inventory, not as an implemented claim.
- Describe the result as integrity-chained application audit records, not an immutable/WORM audit log.

### 9. Better Auth primary identity

- Self-host Better Auth against the isolated tokenless Postgres connection.
- Support email OTP and passkeys first; configure Google/Apple only when their server-only credentials exist.
- Store a RateLoop `principal_id` independently from Better Auth's provider subject and independently from any wallet.
- Continue using RateLoop-owned authorization checks for every protected route; middleware is not an authorization
  boundary.
- Keep login build-safe when auth/email/social variables are absent and fail closed with useful configuration errors.

### 10. Optional thirdweb wallet binding

The explicit wallet journey is:

1. The user signs in with Better Auth and receives a RateLoop session bound to an opaque `principal_id`.
2. Enterprise workspace activity, invited unpaid reviewing, and API-key agent use require no wallet.
3. Paid-task unlock or wallet-funded USDC checkout displays an explicit `Add payout wallet` or `Add funding wallet`
   decision.
4. The user may connect an existing self-custodial wallet or explicitly create an app-scoped thirdweb wallet.
5. For thirdweb, RateLoop issues a short-lived, audience-bound, one-time JWT containing only the opaque principal
   subject. thirdweb verifies RateLoop's JWKS and creates/retrieves the app-scoped wallet.
6. The wallet signs a domain-, chain-, principal-, purpose-, nonce-, and expiry-bound challenge.
7. RateLoop stores a revocable wallet binding with purpose `funding`, `payout`, or `recovery`; browser/workspace
   authorization never follows merely from the wallet.

Website and privacy copy must explain the explicit creation step, thirdweb's processor role, on-chain visibility,
recovery/export responsibilities, and that the public destination can link paid activity.

### 11. Supply chain and operational documentation

- Add TypeScript CodeQL, container vulnerability scanning, dependency updates, SBOM creation, and build provenance.
- Add operational runbooks for EU manifest verification, KMS recovery, identity-provider outage, wallet-provider outage,
  backup/restore, deletion, and claim withdrawal.
- Update `.env.example`, README, public docs, privacy notice, `llms.txt`, and SDK/agent docs to use provider-neutral
  principal language.

### 12. Release verification and isolated publish

- Run focused migration, authorization, privacy, auth, trust-copy, readiness, lint, type, package, and production-build
  gates.
- Run the React review checklist for all changed TSX components.
- Verify homepage, `/trust`, `/sign-in`, protected navigation, and wallet-binding UI locally and on the deployment with
  browser error/console checks.
- Immediately before push, require `tokenless` + `origin/tokenless`, record `origin/main` and `origin/tokenless`, and
  push only `git push origin HEAD:tokenless`.
- Before deployment, require Vercel project `rateloop-tokenless` / `prj_H6C2pfWKEAupFroHbLfzhquaNCLm`.
- Record the deployment serving both `rateloop-tokenless.vercel.app` and `rateloop.ai` before and after. Only the
  tokenless deployment may move.

## Release claim gate

The release is complete only when:

- repository implementation and tests for every row above pass;
- the deployed trust page matches the current registry;
- unverified external claims remain visibly disabled;
- Better Auth works without creating a wallet;
- wallet creation is explicit, purpose-bound, and optional;
- non-sandbox production still refuses to start without verified EU resources and managed KMS; and
- `main`, `rate-loop-nextjs`, `rateloop.ai`, and the legacy deployment ID remain unchanged.
