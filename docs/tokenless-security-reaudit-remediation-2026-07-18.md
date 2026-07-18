# RateLoop Tokenless Security Re-audit Remediation — 18 July 2026

**Status:** All 15 findings in the
[18 July re-audit](tokenless-repository-security-reaudit-2026-07-18.md) were independently rechecked, remained valid,
and were fixed on the `tokenless` branch. This is an internal engineering record, not customer-facing product copy.

## Decision and implementation record

Each remediation is isolated in its own commit. No finding was closed by documentation alone.

| ID       | Decision and implemented fix                                                                                                                                                                                                                                                                                                                                  | Commit      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| REAUD-01 | Confirmed. Added the omitted `compensatedRevealCount` to every handwritten v4 `Round` consumer and added canonical encode/local decode sequence tests.                                                                                                                                                                                                        | `bd7bef69a` |
| REAUD-02 | Confirmed. Once timely quorum fixes settlement, late reveals are rejected instead of being accepted into an unpaid state; under-quorum late work remains eligible for compensation. The keeper applies the same rule.                                                                                                                                         | `958fbea33` |
| REAUD-03 | Confirmed. Autonomous x402 execution now requires locally pinned chain, deployment key, panel, submitter, and USDC identities, plus a local atomic spend ceiling and exact quoted/instruction total agreement.                                                                                                                                                | `118a4a2ba` |
| REAUD-04 | Confirmed. An owner cannot approve privacy or submit a handoff until every attached image has loaded and every YouTube attachment has been explicitly opened; media failures block submission.                                                                                                                                                                | `34d49965f` |
| REAUD-05 | Confirmed. Surprise-bounty reservations now expire at the ask's beacon-failure deadline, capacity accounting excludes expired reservations, and lazy cleanup preserves funded/consumed states. Migration `0106` adds the persisted expiry.                                                                                                                    | `983f238c0` |
| REAUD-06 | Confirmed. `RevealAccepted` now carries an explicit scoring-eligibility flag, and Ponder excludes late compensated reveals from scored tallies and finalized evidence.                                                                                                                                                                                        | `1224bb441` |
| REAUD-07 | Confirmed. Sign-in return paths are parsed and allowed only when they remain same-origin relative paths; backslashes, scheme-relative paths, credentials, and cross-origin URLs are rejected.                                                                                                                                                                 | `d660b02b2` |
| REAUD-08 | Confirmed. Setup retries now recover a server-committed advance from the idempotent response and synchronize the local revision instead of remaining permanently stale.                                                                                                                                                                                       | `69a1bbfda` |
| REAUD-09 | Confirmed. Payment POST now requires `payment:submit` and the ask's creator/policy authority; `result:read` remains read-only.                                                                                                                                                                                                                                | `33ff42c80` |
| REAUD-10 | Confirmed. The server signs locally, validates and persists the exact raw transaction and derived hash under its fencing token before RPC I/O, then broadcasts only those bytes. Recovery verifies chain, signer, nonce, destination, calldata, value, and hash; ambiguous legacy nonce-only rows fail closed. Migration `0107` versions the recovery format. | `41be4c31f` |
| REAUD-11 | Confirmed. Assurance deliveries now use a monotonic lease fencing token on claim, success, retry, and failure writes, preventing an expired worker from overwriting its successor. Migration `0105` adds the token.                                                                                                                                           | `24c00322f` |
| REAUD-12 | Confirmed. The webhook destination filter now rejects the local-use NAT64 prefix in addition to the previously covered non-global ranges.                                                                                                                                                                                                                     | `ffb32700f` |
| REAUD-13 | Confirmed. The keeper independently services newly discovered round IDs and a bounded historical cursor, so sustained chain growth cannot starve new rounds or erase historical progress after restart.                                                                                                                                                       | `db5555fe3` |
| REAUD-14 | Confirmed. The browser journey uses the current accessible control and the landing screenshot baseline was deliberately reviewed and updated; all six Playwright checks pass.                                                                                                                                                                                 | `898f6078e` |
| REAUD-15 | Confirmed. Local database readiness now verifies the requested database itself after container startup instead of accepting only server-level readiness.                                                                                                                                                                                                      | `887c2443e` |

## Verification plan

The remediation was implemented in risk order:

1. restore fund-core compensation and exact ABI/indexer agreement;
2. bind autonomous payments and browser approval to locally verifiable intent;
3. close authorization, redirect, SSRF, lease, reservation, and chain-recovery failures;
4. repair retry/scheduling/tooling paths and restore the six-journey browser gate; and
5. run focused fault-injection tests followed by the repository-wide test, lint, type, build, and browser gates.

Focused regression coverage includes canonical tuple round trips, timely-quorum/late-reveal settlement, malicious x402
instructions, unseen or failed media, reservation expiry, late-tally exclusion, redirect variants, lost-response setup
recovery, cross-credential payment mutation, reclaimed webhook leases, NAT64 destinations, sustained keeper growth, and
database restart behavior.

REAUD-10 additionally injects failures before RPC acceptance and after acceptance with a lost response. It proves that
recovery rebroadcasts byte-identical signed bytes, exact-hash reconciliation is required, tampered persisted intent is
rejected, and legacy nonce-only rows stop for explicit reconciliation.

## Integrated verification results

| Gate                                  | Result                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn foundry:test`                   | Passed: 62 tests, including fund-custody and lifecycle invariants.                                                                                |
| `yarn test:packages`                  | Passed: 1,448 tests across contracts, node utilities, SDK, agents, keeper, Ponder, promo video, and Next.js; every package typecheck also passed. |
| `yarn test:node`                      | Passed: 58 repository/tooling tests.                                                                                                              |
| Recovery/setup fault-injection rerun  | Passed: 32 focused tests on the final formatted sources.                                                                                          |
| `yarn lint`                           | Passed with zero errors. One pre-existing formatting warning remains in `feedbackResultSemanticsMigration.test.ts`.                               |
| `yarn next:build`                     | Passed: optimized production compilation, type validation, and 54 static pages.                                                                   |
| `yarn workspace @rateloop/nextjs e2e` | Passed: all six primary browser journeys against an isolated `rateloop_e2e` database.                                                             |
| `yarn security:audit`                 | Passed: the registry returned no production or development audit suggestions.                                                                     |

`git diff --check` also passed. The browser dev server emitted optional-dependency and cross-origin deprecation warnings;
they did not fail the production build or any browser journey and are not regressions from these fixes.

## Remaining release requirements

These fixes close the repository findings; they do not declare the product ready for real users or real money.

- Contract and event changes require one fresh v4 test deployment, a deployment-scoped Ponder schema/reindex, and an
  atomic update of all isolated tokenless services. Older deployment artifacts and addresses remain stale.
- Migrations `0105` through `0107` must be applied before the corresponding application code. A pre-`0107` nonce-only
  execution intentionally requires explicit on-chain reconciliation; it is never replaced automatically.
- The network-integrity producer, real-money controls, operational reconciliation/alerting, key-management exercises,
  and legal/tax gates remain governed by the
  [production-readiness register](tokenless-production-readiness-2026-07.md).
- Media review proves that an owner saw or opened each attachment before approving publication. It does not claim that
  software can determine whether an externally hosted video's semantics match the ask.

No tokenless deployment or production-line change is part of this remediation.
