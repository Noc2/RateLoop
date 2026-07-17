# RateLoop Tokenless: Production-Readiness Register (July 2026)

**Status:** Internal engineering release register for the `tokenless` branch. This is not customer-facing product copy
and must not be exposed through a public limitations or trust-status page. The
[implementation plan](tokenless-immutable-implementation-plan-2026-07.md) remains the design of record; this document
records the concrete work that must pass once `tokenless` is integrated into `main` for a production release.

## Current baseline — 16 July 2026

| Area                | Verified baseline                                                                                                                                                                                                                       | Release boundary                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract bundle     | Disposable Base Sepolia tokenless-v3 deployment at block `44132668`; complete key `tokenless-v3:84532:0xf97d28e02f7301b4f6cb19160e1176eaf3e4f19a:0x67a89f76ae9a89866a0e62785d7999efe1c5e592:0x8a9b7af03f3cf362ba98180700bc92fbb72fcbc9` | Test-profile deployment with unrestricted test currency; not a mainnet or real-money release                                                                |
| Generated consumers | `@rateloop/contracts`, Ponder, and keeper identify the historical complete v3 bundle; runtime configuration now requires a five-slot `tokenless-v4` identity, but no v4 deployment exists                                               | Any fund-core change invalidates the artifact and every hosted address until an atomic redeployment                                                         |
| Application data    | Ordered Drizzle journal `0000` through migration `0091`                                                                                                                                                                                 | Every migration must be applied and verified before hosted smoke testing                                                                                    |
| Hosted isolation    | Dedicated Vercel project `rateloop-tokenless`; dedicated Railway project with Postgres, Ponder, and keeper; no `rateloop.ai` alias                                                                                                      | The currently served preview is not a release candidate and must not be promoted as production-ready                                                        |
| Identity            | Better Auth supplies browser authentication and opaque RateLoop principals; wallets are purpose-bound adapters                                                                                                                          | Hosted OTP/passkey verification, optional provider allowlists, managed wallet configuration when enabled, and account-recovery testing remain release gates |
| Release preflight   | Deployment identity, region, secret-role separation, and schema checks fail closed                                                                                                                                                      | `managedSigning` and `paidAssignmentSettlement` remain explicitly unavailable in the production readiness check                                             |

## Hosted-environment invariant

There is no hosted simulation product. Staging uses testnet assets with the same persisted assignment, payment,
settlement, and result path as production. Deterministic results, in-memory stores, simulated payment states, and local
test keys are test-fixture concerns only and must not be selectable through runtime environment variables, public API
schemas, MCP capabilities, database policy values, or product UI.

That boundary is now enforced across runtime configuration, API and MCP schemas, reviewer sources, persistence, and
product UI. Migration `0048` removes obsolete hosted-preview data and constraints. While the work remains on the
`tokenless` branch, its isolated hosted deployment is a test environment and does not run the production release gates
below.

### Isolated tokenless test deployment

`rateloop-tokenless.vercel.app` may be updated from the `tokenless` branch without satisfying the production release
gates. The build automatically uses the isolated test-deployment checks for every branch other than `main`; no manual
review-deployment flag is required. Those checks require Vercel project
`prj_H6C2pfWKEAupFroHbLfzhquaNCLm` (`rateloop-tokenless`), the exact tokenless origin, public network panels disabled,
and no public secret exposure. They must never authorize `rate-loop-nextjs`, `rateloop.ai`, or `www.rateloop.ai`.

Once this work is merged into `main`, hosted builds automatically activate the complete production preflight and must
satisfy every release gate in this register before integration with `rateloop.ai`. A successful isolated tokenless test
deployment is not evidence that managed signing, paid assignment settlement, EU infrastructure, migration verification,
or end-to-end paid-path testing is complete.

## Completed in this branch

- Removed the hosted runtime mode, in-memory result path, fabricated payment/result states, and reviewer source from
  the application, SDK, agents, MCP, database schema, and product UI.
- Removed hosted bypasses from application, identity, vault, EU-resource, keeper, and Ponder readiness checks. Preview
  and production deployments now require the same persisted workflow and complete resource evidence.
- Removed the public limitations page and registry. Customer-facing copy now explains the product mechanisms and links
  technical terms to their detailed documentation; engineering blockers remain in this internal register.

## Gates before the next hosted staging release

1. **Complete managed signing.** Replace hosted hot-key assumptions with reviewed managed signing for credential
   issuance and every chain transaction role. Keep credential issuer, gas-only relayer, prepaid funder, surprise-bonus
   funder, evidence signer, and wallet-JWT signer distinct.
2. **Connect paid assignment to settlement.** A paid run must reserve assignments against the exact policy snapshot,
   issue the bound voucher, commit and settle on the configured v3 deployment, produce terminal receipts, and publish a
   source-derived result. Network and hybrid work must remain unavailable until this path passes.
3. **Provision the signed EU bundle.** Supply matching EU Postgres, private Blob, managed KMS, log, backup, auth,
   support-access, Ponder, keeper, and external-processor evidence. Validate actual provider IDs and runtime regions;
   setting expected strings is not evidence.
4. **Apply and verify migrations.** Run every journal entry through the current head (now `0091`) against the isolated
   database, verify the resulting constraints, and test rollback/recovery procedures without pointing at legacy data.
5. **Exercise the complete paid path.** Run a deployment-pinned Base Sepolia journey:
   `quote -> ask -> fund -> assign -> voucher -> commit -> reveal -> settle -> result -> claim`. Verify the normal,
   under-quorum, beacon-failure, retry, and idempotent-replay paths. No fabricated result may satisfy this gate.
6. **Verify browser and agent journeys.** Cover email OTP, passkeys, optional wallet binding, one-message agent OAuth,
   browser handoff approval, bounded wait/result, reviewer assignment, settlement receipt, and recovery on desktop and
   mobile. The deterministic browser gate is `yarn workspace @rateloop/nextjs e2e`; its Playwright journeys cover
   workspace setup, review configuration, public and private answers, approval and Feedback Bonus handoff, automated
   axe checks, and landing/hub visual baselines in `packages/nextjs/e2e/`. Keep live identity, wallet-signing,
   settlement, recovery, and mobile evidence attached to this gate before enabling real users or real money.
7. **Add operational evidence.** Record alerting, key rotation, backup restore, deletion, legal hold, incident response,
   founder continuity, worker liveness, and deployment rollback exercises for the isolated services. Exercise the
   configured KMS/Rekor/TSA witness, S3 Object Lock destination, SIEM webhook, OTLP ingest, and each enabled GRC
   connector before enabling its public capability flag. Drata additionally requires the customer's Custom Connection
   entitlement/schema/monitor/control association. The current Vanta path requires a customer-owned Manage Vanta
   credential and pre-existing document/control workflow; a public Vanta marketplace app remains blocked on vendor
   approval and customer-authored Custom Test/control mapping.

## Additional gates before real users or real money

- Complete the real-money security and economics acceptance review for the implemented fixed-base
  [binary RBTS mechanism](tokenless-rbts-v1-spec.md), its attack benchmark, and prospective integrity epochs. Source
  implementation and a disposable test deployment are evidence, not approval for real-money panels.
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
- Do not attach `rateloop.ai`, accept customer data, or enable real paid work while any required production gate is red.
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
