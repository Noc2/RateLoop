# Tokenless Security Re-audit Remediation — 19 July 2026

**Status:** Internal engineering remediation record for the findings in
[`tokenless-repository-security-reaudit-2026-07-19.md`](tokenless-repository-security-reaudit-2026-07-19.md). This is
source-level evidence, not a deployment attestation, real-money approval, or customer-facing security claim.

## Revalidation result

All 18 findings were rechecked against the current source and deterministic reproductions before implementation. All
18 remained actionable at their reported severity: **2 high and 16 medium**. No finding was dropped or downgraded.
The fixes preserve the tokenless trust split and do not add an operator or administrator path to fund-core assets.

## Implemented plan

The work followed the audit's dependency order:

1. Stop unintended and unconfirmed reviewer actions.
2. Bind browser state, local drafts, retries, and sign-in continuation to the current principal.
3. Repair caller scoping, deployment identity, sponsored-commit bounds, and exact transaction recovery.
4. Replace privacy and retention shortcuts with keyed references and retryable deletion.
5. Bound keeper RPC and memory growth, coalesce public aggregates, and align readiness and unsubscribe behavior with
   their runtime and protocol boundaries.

Each independent finding was committed separately. `TLRA-11` received a second independent commit after the final
fault-schedule review showed that a submitted transaction still needed autonomous receipt reconciliation and a
compare-and-set retry transition.

| ID | Severity | Resolution | Commit |
| --- | --- | --- | --- |
| TLRA-01 | High | Gives one active review shell shortcut ownership and ignores link/interactive targets. | `2aa1ec95e` |
| TLRA-02 | High | Adds backward editing, a final summary, and an explicit confirmation distinct from navigation. | `d74c46e3c` |
| TLRA-03 | Medium | Purges private client state on principal change and fences stale asynchronous responses. | `06e4af588` |
| TLRA-04 | Medium | Principal-scopes review drafts and IndexedDB relay retries; legacy ownerless records fail closed. | `281eaeade` |
| TLRA-05 | Medium | Consumes only due retries, records backoff, and removes or explains expired work. | `97a71429e` |
| TLRA-06 | Medium | Carries normalized local return paths through signed-out review gates and uses a neutral fallback. | `4da6aaf58` |
| TLRA-07 | Medium | Handles rejected Better Auth actions and always releases busy state. | `66f80a824` |
| TLRA-08 | Medium | Scopes ask and rater-commit idempotency to their caller/workspace or voucher owner. | `c0090a2c7` |
| TLRA-09 | Medium | Binds hosted migrations to an immutable, credential-independent database identity. | `40a6a1675` |
| TLRA-10 | Medium | Enforces the keeper-compatible 16,384-byte ciphertext maximum in service and fund core. | `64206a69f` |
| TLRA-11 | Medium | Persists exact signed transaction bytes/hash before broadcast and recovers them through fenced scheduled work. | `f15b5bc9d`, `2e9a845e0` |
| TLRA-12 | Medium | Replaces stable SHA-256 generic-provider references with versioned domain-separated HMAC references. | `4ec80d161` |
| TLRA-13 | Medium | Keeps failed staged-blob deletion retryable and reports deletion only after the object is gone. | `01c9725ef` |
| TLRA-14 | Medium | Scans commit logs newest-first in provider-safe bounded chunks and stops at the expected count. | `530fbaf5d` |
| TLRA-15 | Medium | Replaces unbounded reveal caches with one capacity-limited LRU for valid and invalid entries. | `1e8077d44` |
| TLRA-16 | Medium | Adds an origin TTL and in-flight coalescing for public stats aggregation. | `f1f8fe29b` |
| TLRA-17 | Medium | Rejects every runtime-forbidden public variable during hosted preflight. | `60ae7efae` |
| TLRA-18 | Medium | Makes manual GET non-mutating and requires confirmation while retaining signed idempotent POST. | `9c5ee9fe1` |

## Verification

The exact reproduced schedules now have regression coverage, including multiple mounted review shells, last-case batch
navigation, principal changes with deferred responses, cross-account draft/retry restoration, retry deadlines,
cross-tenant idempotency preclaims, wrong database identity, 16,384/16,385-byte ciphertext boundaries,
accepted-then-throw relay recovery, low-entropy eligibility identifiers, failed-then-successful blob deletion, provider-rejected log
ranges, LRU eviction, concurrent cache-busting stats requests, public runtime variables, and scanner-fetched unsubscribe
links.

| Check | Result |
| --- | --- |
| Full package matrix | Passed at `a7d4de304`: package type checks and tests, including 1,320 Next.js tests |
| Focused client regressions | Passed: 55 tests plus affected Next.js type checking and ESLint |
| Focused server/recovery regressions | Passed: caller scoping, migration identity, media, eligibility, readiness, and 28 rater/scheduled-maintenance tests |
| Keeper and Ponder regressions | Passed: 45 keeper tests and 41 Ponder tests with package type checks |
| Foundry | Passed: 63 tests, including 256-run invariant campaigns and the ciphertext boundary |
| Dependency audit | Passed: no production or development audit suggestions |
| Repository lint | Passed; unrelated in-progress source produced warnings but no lint errors |
| Production build | Passed with hosted preflight and database migration correctly skipped outside Vercel production |
| Post-matrix review UI follow-up | Passed: 28 focused tests after `65e491591` |

## Deployment consequence

`TLRA-10` changes the fund-holding core. Under the tokenless branch implementation rules, the checked-in Base Sepolia
artifact and every hosted address derived from the earlier bundle are now stale. The change was intentionally **not**
deployed as part of this source remediation. A release requires a complete fresh Base Sepolia deployment key and a
coordinated update of the isolated `rateloop-tokenless` web, Ponder, and keeper services. No legacy project,
`rateloop.ai`, or `main` deployment may be updated by that operation.

Closing these 18 source findings does not close the separate deployment, operational privacy, legal, key-management,
or real-money hardening gates in the production-readiness register.
