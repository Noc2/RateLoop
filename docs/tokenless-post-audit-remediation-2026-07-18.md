# RateLoop Tokenless Post-audit Remediation — 18 July 2026

**Status:** All 16 findings in the
[post-remediation bug and security audit](tokenless-post-remediation-security-audit-2026-07-18.md) were rechecked
against the current `tokenless` source, remained valid, and were fixed. This is an internal engineering record, not
customer-facing product copy or a real-money release approval.

## Revalidation and implementation plan

The findings were revalidated before implementation rather than accepted from the report by default. Work then
proceeded in four risk-ordered lanes:

1. close custody-intent, account-isolation, and connector-revocation failures;
2. restore keeper, attestation, scheduled-worker, and chain-execution liveness with deterministic fencing;
3. harden quote, rate-limit, release-readiness, deployment-health, and indexer availability boundaries; and
4. repair the browser media handoff, run focused adversarial schedules, then run the integrated repository gates.

Independent fixes were committed separately. No finding was closed by documentation alone.

## Decision and implementation record

| ID      | Decision and implemented fix                                                                                                                                                                                                                      | Commit      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| POST-01 | Confirmed. Autonomous x402 approval now derives a canonical local quote intent and pins content, audience, economics, policy, fee recipient, timing, and beacon facts before either signature. Same-total substitution tests cover each boundary.     | `7cc3da09d` |
| POST-02 | Confirmed. Device recovery records are principal-scoped, omit the unwrap secret from browser storage, revalidate the live session, reject cross-account imports, and require a downloaded, account-revalidated backup before any voucher or commit.      | `5843a0287`, `2d3cacd31` |
| POST-03 | Confirmed. GRC reconciliation claims now carry a monotonic lease generation; connector pause/update supersedes in-flight work, pre-I/O authorization is rechecked, and every terminal/connector write is fenced. Migration `0108` adds the fence.     | `72e89dee5` |
| POST-04 | Confirmed. The keeper verifies zero-address, payout, and full reveal commitments locally, quarantines permanently invalid payloads, and continues servicing unrelated commits and rounds.                                                          | `183c3aa8c` |
| POST-05 | Confirmed. The keeper ABI includes the expected contract errors and race classification uses decoded causes and raw selectors rather than display-string assumptions.                                                                             | `e5f259dd8` |
| POST-06 | Confirmed. New and historical round lanes receive fair bounded service, including a one-slot alternation policy, proving historical progress when arrivals equal or exceed the tick budget.                                                        | `955912cf0` |
| POST-07 | Confirmed. Attestation jobs bind the selected signer and a monotonic generation to the claim, pre-publication check, terminal write, and worker summary. Migration `0109` adds the fence.                                                         | `66a9a8014` |
| POST-08 | Confirmed. Quote bodies are bounded and rate-limited; non-public quotes require tenant authentication, safe public anonymous quotes remain available, expired unreferenced rows are swept, and the CLI refuses private quotes without credentials.     | `fa0f90d8f`, `0ab2052b6` |
| POST-09 | Confirmed. Private drafts use session storage, an opaque-principal namespace, account-change purging, and artifact-lease expiry. Proven account changes purge all private task state and fence stale asynchronous responses; transient session errors do not destroy recoverable work. | `9730a37d6`, `ad0b62f90` |
| POST-10 | Confirmed. Staged image uploads issue a short-lived capability bound to the exact asset, digest, and expiry. Only an authorized workspace browser may preview it, and the grant is consumed only by the final atomic ask attachment so conflicts and downstream failures roll back safely. | `4ab01f70d` |
| POST-11 | Confirmed. Hosted rate limiting trusts Vercel's spoof-resistant forwarded identity, rejects ambiguous hosted identity, and no longer lets an unverified provider header partition quotas.                                                         | `192825a5c` |
| POST-12 | Confirmed. Scheduled maintenance recovers initiated server-funded executions, reconciles the exact persisted hash before replay, reuses only stored signed bytes, fences reclaimed work, and exposes bounded dead-letter health. Migration `0110`. | `f5bada3c1` |
| POST-13 | Confirmed. Ponder and keeper startup/readiness prove chain ID, bytecode, deployment block, immutable panel/issuer/USDC/constants, Feedback Bonus wiring, adapter wiring, and index progress before reporting healthy.                                | `931c225fb` |
| POST-14 | Confirmed. Public Ponder status uses database `COUNT`, grouped counts, and `SUM` with a short cache rather than loading complete deployment history into application memory.                                                                       | `d040e6697` |
| POST-15 | Confirmed. Hosted preflight and the earlier tokenless deployment gate both require and parse the active gold-injection key, forbid public variants, and enforce role separation from every other server secret.                                       | `23932f360`, `9077351cf` |
| POST-16 | Confirmed. The event-derived keeper feed no longer emits unverifiable `open_reveal` work, repairs implicit state on accepted reveals, filters due rows before a bounded result, and uses keyset pagination so later rounds remain reachable.       | `52ff96ef4` |

Three integrated-suite expectations were also corrected after the behavior they guarded intentionally changed:
authenticated agent quotes now assert their bearer credential (`d8d0397de`), the environment-parity guide names the
actual `0110_scheduled_chain_recovery` journal head (`54d11966b`), and the browser draft-restoration journey expects
the new backup-first action rather than a pre-backup submit control (`edd5eeca5`).

## Verification record

Focused regressions cover same-total signed-intent substitution, two principals sharing a browser, stale connector and
attestation workers, malformed keeper payloads, raw custom-error selectors, sustained round growth, anonymous quote
flood/retention, private-draft account switch and expiry, exact-hash chain recovery without a second client request,
mixed contract bundles, bounded Ponder status, and stale/paginated keeper feeds.

The final integrated verification results are:

| Gate                          | Result                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundry                       | Passed: 62 tests; invariant campaigns completed 256 runs / 12,800 calls with zero reverts.                                                                                |
| Full package matrix           | Passed with all typechecks: contracts 8, node-utils 6, SDK 34, agents 101, keeper 41, Ponder 39, promo-video 2, and Next.js 1,280 tests.                                  |
| Repository/tooling node tests | Passed: 58 tests.                                                                                                                                                         |
| Focused browser safety tests  | Passed: 10 recovery-flow tests, 6 account-change interaction tests, 82 media/server regressions, and 34 SDK regressions.                                                  |
| Browser journeys              | Passed: 6/6 Playwright journeys against a reset, isolated PostgreSQL `rateloop_e2e` database. The temporary database was stopped after verification.                      |
| Dependency audit              | Passed: no production or development audit suggestions.                                                                                                                  |
| Lint and production build     | Passed: repository lint, Next.js type validation, and the optimized Next.js 15.5.18 production build.                                                                    |
| Source hygiene                | Passed: `git diff --check`; the pre-existing unrelated feedback-migration formatting edit remained excluded from every remediation commit.                               |

## Remaining release requirements

Closing these repository findings does not make the branch suitable for real users or real money.

- Migrations `0108` through `0110` must be applied before their application code.
- The contracts require a fresh v4 test deployment, a deployment-scoped Ponder reindex, and an atomic isolated-service
  configuration update; the checked-in historical artifact and hosted addresses remain stale.
- The network-integrity producer, operational/key-management exercises, legal/tax gates, and other blockers remain
  governed by the [production-readiness register](tokenless-production-readiness-2026-07.md).
- No deployment, `main` update, legacy project mutation, or `rateloop.ai` change is part of this remediation.
