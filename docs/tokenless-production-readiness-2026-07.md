# RateLoop Tokenless: Production-Readiness Register (July 2026)

**Status:** Internal engineering release register for the `tokenless` branch. This is not customer-facing product copy
and must not be exposed through a public limitations or trust-status page. The
[implementation plan](tokenless-immutable-implementation-plan-2026-07.md) remains the design of record; this document
records the concrete work that must pass before staging or production publication.

## Current baseline — 15 July 2026

| Area                | Verified baseline                                                                                                                                                                                                                       | Release boundary                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract bundle     | Disposable Base Sepolia tokenless-v3 deployment at block `44132668`; complete key `tokenless-v3:84532:0xf97d28e02f7301b4f6cb19160e1176eaf3e4f19a:0x67a89f76ae9a89866a0e62785d7999efe1c5e592:0x8a9b7af03f3cf362ba98180700bc92fbb72fcbc9` | Test-profile deployment with unrestricted test currency; not a mainnet or real-money release                                                                |
| Generated consumers | `@rateloop/contracts`, Ponder, and keeper identify the complete v3 bundle                                                                                                                                                               | Any fund-core change invalidates the artifact and every hosted address until an atomic redeployment                                                         |
| Application data    | Ordered Drizzle journal `0000` through `0047_agent_oauth_device_authorization.sql`                                                                                                                                                      | Every migration must be applied and verified before hosted smoke testing                                                                                    |
| Hosted isolation    | Dedicated Vercel project `rateloop-tokenless`; dedicated Railway project with Postgres, Ponder, and keeper; no `rateloop.ai` alias                                                                                                      | The currently served preview is not a release candidate and must not be promoted as production-ready                                                        |
| Identity            | Better Auth supplies browser authentication and opaque RateLoop principals; wallets are purpose-bound adapters                                                                                                                          | Hosted OTP/passkey verification, optional provider allowlists, managed wallet configuration when enabled, and account-recovery testing remain release gates |
| Release preflight   | Deployment identity, region, secret-role separation, and schema checks fail closed                                                                                                                                                      | `managedSigning` and `paidAssignmentSettlement` remain explicitly unavailable in the production readiness check                                             |

## Hosted-environment invariant

There is no hosted simulation product. Staging uses testnet assets with the same persisted assignment, payment,
settlement, and result path as production. Deterministic results, in-memory stores, simulated payment states, and local
test keys are test-fixture concerns only and must not be selectable through runtime environment variables, public API
schemas, MCP capabilities, database policy values, or product UI.

Until that boundary is implemented completely, hosted publication remains fail-closed. Removing warning copy without
removing the simulation path would misrepresent the service; bypassing production readiness to keep a preview online is
not permitted.

## Gates before the next hosted staging release

1. **Remove the simulation surface end to end.** Delete the runtime mode and in-memory result path; remove the
   `sandbox` reviewer source and simulated-payment vocabulary from SDK/API schemas, MCP, UI, persistence, and tests; add
   a forward migration that rejects or removes obsolete records. Preserve only injected deterministic test fixtures.
2. **Complete managed signing.** Replace hosted hot-key assumptions with reviewed managed signing for credential
   issuance and every chain transaction role. Keep credential issuer, gas-only relayer, prepaid funder, surprise-bonus
   funder, evidence signer, and wallet-JWT signer distinct.
3. **Connect paid assignment to settlement.** A paid run must reserve assignments against the exact policy snapshot,
   issue the bound voucher, commit and settle on the configured v3 deployment, produce terminal receipts, and publish a
   source-derived result. Network and hybrid work must remain unavailable until this path passes.
4. **Provision the signed EU bundle.** Supply matching EU Postgres, private Blob, managed KMS, log, backup, auth,
   support-access, Ponder, keeper, and external-processor evidence. Validate actual provider IDs and runtime regions;
   setting expected strings is not evidence.
5. **Apply and verify migrations.** Run every journal entry through `0047` against the isolated database, verify the
   resulting constraints, and test rollback/recovery procedures without pointing at legacy data.
6. **Exercise the complete paid path.** Run a deployment-pinned Base Sepolia journey:
   `quote -> ask -> fund -> assign -> voucher -> commit -> reveal -> settle -> result -> claim`. Verify the normal,
   under-quorum, beacon-failure, retry, and idempotent-replay paths. No fabricated result may satisfy this gate.
7. **Verify browser and agent journeys.** Cover email OTP, passkeys, optional wallet binding, one-message agent OAuth,
   browser handoff approval, bounded wait/result, reviewer assignment, settlement receipt, and recovery on desktop and
   mobile.
8. **Add operational evidence.** Record alerting, key rotation, backup restore, deletion, legal hold, incident response,
   founder continuity, worker liveness, and deployment rollback exercises for the isolated services.

## Additional gates before real users or real money

- Implement and review the fixed-base binary RBTS and prospective integrity epochs selected by the
  [incentive reintegration plan](tokenless-incentive-integrity-reintegration-plan-2026-07.md). The disposable v0 score is
  not a real-money acceptance criterion.
- Complete World ID 4 Proof of Human enrollment for RateLoop-network supply and keep provider assurance separate from
  paid eligibility, tax, sanctions, wallet, and job qualification.
- Complete multi-case buyer workflows, reviewer notifications and receipts, appeals, failure recovery, and evidence
  packet verification with deployment-pinned source data.
- Complete external contract and privacy review, assert-no-funds-admin verification, gas/code-size reporting, KMS and
  circuit-breaker operations, rate limiting, reconciliation, monitoring, and security testing.
- Complete B2B trader/VAT handling, sanctions and geographic controls, invoices and reconciliation, notice-and-action,
  DAC7 operations, retention/deletion, processor agreements, and German legal review.
- Redeploy the complete stack atomically after any later fund-core change. No old address continuity or mixed v2/v3
  compatibility is required.

## Release and documentation policy

- A push to `tokenless` is not a release. Deployment remains manual and isolated.
- Do not promote the Vercel alias, accept customer data, or enable paid work while any required gate is red.
- Customer-facing docs explain the product, mechanisms, and implemented guarantees. They do not contain an engineering
  backlog, unsupported-capability inventory, or a separate public trust-status page.
- Mandatory legal and privacy disclosures remain in the applicable legal notices. Security, custody, identity, and
  settlement claims must match the deployed system exactly.
- Internal blocker evidence stays in this register, deployment runbooks, issue tracking, and review artifacts.

## Verification before release approval

At minimum, the release owner must record:

- exact Git SHA, contract deployment key, deployment block, Vercel deployment ID, Railway service deployments, and
  database migration head;
- clean schema searches proving removed runtime simulation and public trust-status surfaces are absent;
- package tests, type checks, Foundry tests/invariants, production build/preflight, and browser E2E results;
- signed EU manifest validation plus provider/resource evidence;
- live Ponder and keeper deployment identity;
- the full paid staging transaction and receipt references; and
- confirmation that `origin/main`, `rateloop.ai`, and the legacy Vercel project did not move.

Production readiness means all required gates are evidenced. It is never inferred from a successful build, a healthy
status endpoint, or the removal of preview wording.
