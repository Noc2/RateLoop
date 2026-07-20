# RateLoop Tokenless: Production-Readiness Register (July 2026)

**Status:** Internal engineering release register for the `tokenless` branch. This is not customer-facing product copy
and must not be exposed through a public limitations or trust-status page. The
[implementation plan](tokenless-immutable-implementation-plan-2026-07.md) remains the design of record; this document
records the concrete work that must pass once `tokenless` is integrated into `main` for a production release.

## Current baseline — 20 July 2026

| Area                | Verified baseline                                                                                                                                                                                                                       | Release boundary                                                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract bundle     | Disposable Base Sepolia tokenless-v4 deployment at block `44390557`; complete key `tokenless-v4:84532:0x377f8631030a06e997cee78bdf649106a90bba46:0xe7f214be85002a6776874e6b624f7cfee98b89d9:0xa33f747ca2e83b12cb67ca407aa4999bf7e68dcc:0xa0c1f730aad6b7cb78eaeaca39743f6430dc57b0` | Test-profile deployment with unrestricted test currency; not a mainnet or real-money release                                                                                                                |
| Generated consumers | `@rateloop/contracts` identifies the complete v4 bundle; the isolated Vercel app, Ponder, and keeper must use that exact key, block, verifier, and five contract addresses                                                                   | Any fund-core change invalidates the artifact and every hosted address until an atomic redeployment                                                                                                         |
| Application data    | Ordered Drizzle journal from `0000` through the current head, whose authoritative value is the final entry of `packages/nextjs/drizzle/meta/_journal.json`                                                                              | Every migration must be applied and verified before hosted smoke testing                                                                                                                                    |
| Hosted isolation    | Dedicated Vercel project `rateloop-tokenless`; dedicated Railway project with Postgres, Ponder, and keeper; no `rateloop.ai` alias                                                                                                      | The currently served preview is not a release candidate and must not be promoted as production-ready                                                                                                        |
| Identity            | Better Auth supplies browser authentication and opaque RateLoop principals; wallets are purpose-bound adapters                                                                                                                          | Hosted OTP/passkey verification, optional provider allowlists, self-custodial wallet client verification, and account-recovery testing remain release gates                                                 |
| Release preflight   | Deployment identity, region, secret-role separation, schema checks, and managed-signing code paths fail closed                                                                                                                          | The `managedSigning` release capability remains `false` until independent remediation review, signed IAM-policy evidence, and a live provider exercise pass; `paidAssignmentSettlement` remains unavailable |

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
deployment is not evidence that managed-signer provisioning and exercises, paid assignment settlement, EU infrastructure, migration verification,
or end-to-end paid-path testing is complete.

## Completed in this branch

- Removed the hosted runtime mode, in-memory result path, fabricated payment/result states, and reviewer source from
  the application, SDK, agents, MCP, database schema, and product UI.
- Removed hosted bypasses from application, identity, vault, EU-resource, keeper, and Ponder readiness checks. Preview
  and production deployments now require the same persisted workflow and complete resource evidence.
- Removed the public limitations page and registry. Customer-facing copy now explains the product mechanisms and links
  technical terms to their detailed documentation; engineering blockers remain in this internal register.
- Implemented production-gated workload-identity AWS KMS code paths for every enabled application and keeper role, and
  tenant-scoped KMS wrapping for private artifacts. The isolated deployment is not managed-custody evidence; KMS
  provisioning and live exercises remain open. Optional managed app-wallet creation remains disabled until externally
  verifiable export and recovery exist.
- Made private quote identifiers opaque and owner-bound, with migration-time invalidation of legacy unbound private
  capabilities and retention-aware deletion handling.
- Kept private-paid, public-network, and hybrid review lanes unavailable while their complete settlement and
  source-derived integrity-epoch requirements remain open.

## Design-review remediation — 20 July 2026

The new findings from the
[round-two review of 20 July 2026](tokenless-design-review-round-2-remediation-2026-07-20.md) have a separate
source-remediation record. Its remaining verifier-audit, v4 deployment, managed-signing, L1-liveness, CloudTrail,
legacy-nonce, and mechanism/economics boundaries are release gates in this register; source fixes do not satisfy them.

## Design-review remediation — 19 July 2026

The findings in [Tokenless design review — 18 July 2026](tokenless-design-review-2026-07.md) were re-checked against
the current branch before implementation. The following disposition is part of the internal release record; a code or
test fix is not evidence that a remaining economics, provider, or live-operations gate has passed.

| Finding                         | Implemented disposition                                                                                                                                                                                                                                                                                        | Remaining release boundary                                                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1 adaptive safety gates        | Adaptive coverage is fail-closed at 100% while drift and severe-disagreement evidence is unavailable; reduced legacy scopes reset, comparable human agreement requires at least two respondents, and the default agreement threshold is aligned to the documented 7,000 bps policy.                            | Do not re-enable the coverage ladder until source-derived drift and disagreement gates, detection-latency evidence, and an owner-reviewed rollout exist.      |
| W2 lazy/collusive equilibrium   | Reduced review is disabled and the attack benchmark now includes a unilateral constant reporter against an honest population.                                                                                                                                                                                  | Platform-synthetic gold, cross-round correlation analytics, qualified-reviewer economics, and the preregistered real-money acceptance review remain blocking. |
| W3 disclosure timing            | Legal, privacy, product, and design copy now states that a commit irrevocably schedules public vote, prediction, salt, and payout disclosure at the beacon round, independent of reveal or claim. Artifact-wrapping and issuer/token authority claims were narrowed to the implemented boundaries.             | Any future claim-time-only or cross-round-unlinkability claim requires a new protocol and tested recovery flow.                                               |
| W4 late-reveal indexing         | Indexed tallies use the contract's scoring-eligibility signal and evidence recomputation is pinned to the frozen scoring set.                                                                                                                                                                                  | Keep the late-reveal regression in every Ponder/contract compatibility run.                                                                                   |
| W5 keeper liveness              | Keeper consumes the authenticated targeted work feed, prioritizes seed finalization, and falls back safely. Ponder exposes bounded index lag/age; keeper readiness covers run freshness, progress, errors, and gas balance; maintenance degrades stale evidence work.                                          | Multiple independent operators, alert delivery exercises, and incentive-backed continuation remain live-operations gates.                                     |
| W6 x402 signer/reconciliation   | The autonomous signer pins deployment identity, quote economics, exact terms, and a local spend ceiling. Used EIP-3009 authorizations require exact round-receipt reconciliation and otherwise stop in a `possibly_paid` state without replacement signing.                                                    | Exercise used-nonce, timeout-after-submit, and provider-failover recovery against the isolated chain before real value.                                       |
| W7 advisory self-reporting      | Agent context exposes the advisory enforcement boundary and owner copy states that risk, confidence, metadata, and output occurrence are host/agent supplied.                                                                                                                                                  | Silent under-reporting detection, a cadence expectation model, and a verified host-enforced adapter remain required for stronger assurance claims.            |
| W8 deletion completeness        | Paid-rater identity is principal-bound; deletion erases World ID/provider linkage, severs the rater profile into a settlement-safe receipt tombstone, records measured category evidence, emits one honest atomic completion event, and permits fresh re-enrollment without reconnecting the deleted identity. | Complete the live deletion/provider exercise and retention/legal review before real users.                                                                    |
| W9 surprise-bounty extraction   | Unanimous panels are ineligible and frozen per-round liability is capped by fee revenue and report capacity. The benchmark includes manufactured-surprise farming and records that a near-unanimous coalition can still have a positive incentive under the cap.                                               | Treat the bounty as experimental and disabled for real money until the remaining 14/15 farming incentive is removed or accepted through the economics review. |
| W10 adaptive statistics         | Owner-facing defaults no longer imply an impossible 8,000 bps lower-bound setting, Wilson reset logic is tested, and adaptive reduction is disabled pending real safety signals.                                                                                                                               | A sequential or larger-window design needs power and regression-latency evidence before reduced review.                                                       |
| W11 sybil/collusion trust       | Customer claims continue to describe issuer/operator admission authority rather than presenting one-human-one-seat as a protocol property.                                                                                                                                                                     | Cross-round reviewer, timing, and payout-linkage analytics plus the gold-task gate remain mandatory before paid public panels.                                |
| W12 wallet-keyed rater identity | Rater, eligibility, World ID, voucher, task, commit, and assignment access are keyed to the opaque principal; payout wallets are mutable ownership-tracked attributes and paid records freeze payout snapshots.                                                                                                | Run wallet rotation and recovery against the isolated hosted database and chain before real users.                                                            |

Cross-cutting fixes also enforce immutable migration history (including the declared journal excision), default-deny
browser mutation origins, shared Better Auth cookie names, conditional enterprise identity plugins, exact owner approval
for redacted publication, open-review rediscovery, conservative evidence
finality, ordered server-side RPC failover, exact managed-KMS inventory, a non-root keeper image, and a normative
500-seat settlement gas benchmark.

The source now includes Feedback Bonus remainder pull credits, immutable verifier-bound post-reveal beacon entropy
separate from the earlier tlock disclosure round, a bounded base-only fallback, and O(n log n) canonical scoring
assignment. These fund-core changes remain release gates until an
audited verifier and complete v4 contract/service bundle are deployed atomically and exercised. Other gates include
a multisig or equivalent hardened issuer-rotation authority for any real-value deployment;
per-tenant KMS wrapping authorities; managed custody and rotation
for every hosted signer; named-host verification; live alert, backup, deletion, and incident exercises; and the full
economics/gold/correlation acceptance package. None may be inferred from the isolated Vercel deployment.

Post-closure scoring additionally requires evidence that at least 3,600 canonical Ethereum L1 blocks were produced
during each pinned 24-hour scoring margin. That margin is twice the OP Stack sequencing window's nominal duration; it
is an explicit L1-liveness assumption, not an unconditional wall-clock guarantee. Alerting must block the associated
post-closure assurance claim if the condition is not met while preserving keeper progression to the paid base-only fallback.

The public Vercel review deployment may retain its existing isolated, persisted test-vault key only when the immutable
tokenless project ID, review origin, production target, and tokenless Git ref all match. It cannot claim managed-KMS
residency, cannot share that key with another role, and cannot satisfy the main release gate. The next hosted staging
release must use the signed managed-KMS inventory below; no placeholder resource identifier counts as provisioning.

## Gates before the next hosted staging release

1. **Provision and exercise managed signing.** The source now requires workload-identity AWS KMS signing for the
   credential issuer, gas-only relayer, prepaid funder, surprise-bonus funder, and evidence signer, with distinct roles
   and keys. Provision the exact EU resources, validate their public identities, and run
   rotation/failure exercises; source implementation alone is not provider evidence.
2. **Connect paid assignment to settlement.** A paid run must reserve assignments against the exact policy snapshot,
   issue the bound voucher, commit and settle on a fresh complete v4 deployment, produce terminal receipts, and publish a
   source-derived result. Network and hybrid work must remain unavailable until this path passes.
3. **Provision the signed EU bundle.** Supply matching EU Postgres, private Blob, managed KMS, log, backup, auth,
   support-access, Ponder, keeper, and external-processor evidence. Validate actual provider IDs and runtime regions;
   setting expected strings is not evidence.
4. **Apply and verify migrations.** Run every journal entry through the current head — the final entry of
   `packages/nextjs/drizzle/meta/_journal.json` is authoritative — against the isolated database, verify the resulting
   constraints, and test rollback/recovery procedures without pointing at legacy data.
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
- Redeploy the complete stack atomically after any later fund-core change. No historical-address continuity or
  mixed-version bundle compatibility is required.

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
