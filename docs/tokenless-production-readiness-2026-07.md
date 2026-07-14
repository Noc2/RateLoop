# RateLoop Tokenless: Production-Readiness Assessment (July 2026)

**Status:** Pre-redesign snapshot of the `tokenless` branch after Phases 1–4 implementation, from a five-lens review (contracts, backend/services, UX-vs-invariants, legal-compliance implementation, deployment/E2E). The [human-assurance redesign plan](tokenless-human-assurance-redesign-plan-2026-07.md) now controls product sequencing; this document remains the blocker register. Companion to the [implementation plan](tokenless-immutable-implementation-plan-2026-07.md) and [legal reference](legal-revenue-assessment-tokenless-design-2026-07.md). Findings are grouped by the gate they block: **testnet E2E**, **real users**, and **real money / scaled launch**.

**13 July deployment update:** the Base Sepolia v1 bundle at block `44083251` is historical. The replacement v2 bundle at
block `44090502` is recorded in `packages/foundry/deployments/tokenless-v2/84532.json`; generated exports and the isolated
Vercel app, Ponder, and keeper are aligned on its complete deployment key. The app remains in explicit sandbox mode, and no
claim is made that the paid live E2E gate or real-money readiness is complete.

**13 July browser-auth update:** thirdweb email, Google, Apple, passkey, and optional Base Account sign-in are implemented
behind RateLoop-owned domain-bound SIWE sessions. Hosted activation remains gated on migration `0016`, the isolated
`rateloop-tokenless` Vercel project, matching auth/origin domains, a public thirdweb client ID, a server-only thirdweb
secret, provider dashboard allowlists, and browser verification. This improves enterprise onboarding but does not provide
SAML, SCIM, domain-based auto-enrolment, or customer-managed identity policy.

## Human-assurance implementation recheck — 13 July 2026

The redesign has changed the status of the pre-redesign findings below. This table is the current summary; the numbered
assessment remains as historical rationale and must not be read as current implementation status.

| Area | Current status | Remaining release gate |
|---|---|---|
| Private task access | Implemented: live content fails closed; cohort assignment, confidentiality acceptance, and short artifact leases control reads | Browser authorization matrix and realistic confidential-artifact red team |
| Artifact privacy | Implemented: private encrypted object storage, tenant commitments, read/export logs, and retention/deletion services | Production key custody, backup/recovery, legal-hold operations, and DPA/subprocessor review |
| Audience and eligibility | Implemented for private unpaid use: exact policy hashes, invited/network/hybrid/sandbox models, capability evidence, and purpose-separated tax/provider/vote domains | Paid, network, and hybrid assurance assignments deliberately fail closed until assignment-specific vouchers, settlement, and receipts are connected; RateLoop-network supply additionally requires the unimplemented World ID 4 adapter, and the current one-provider eligibility row must be split before World plus later Self/legal evidence can compose |
| Incentive and correlation integrity | The disposable v2 core has sealed reports, an 80/20 base/prediction split, provenance checks, exact-response duplicate detection, and pending analytics | The current score is invariant to the rater's own vote and the current `correlationRiskBps` is a count mismatch rather than behavioral clustering. Before real-money network/hybrid use, implement the fixed-base binary RBTS and prospective integrity epochs in the [reintegration plan](tokenless-incentive-integrity-reintegration-plan-2026-07.md) |
| Buyer domain | Implemented foundation: workspaces, projects, suites, cases, runs, frozen manifests, subpanels, one-case private pilot UI, reruns, and aggregation | Full multi-case buyer editor/history/comparison UX and paid funding journey still need browser E2E |
| Reviewer workflow | Implemented for unpaid invited panels: invitation, assignment-only A/B cases, frozen tags, encrypted rationale, server-persisted responses, and lease recovery | Paid assignment/commit/receipt integration, notifications, earnings history, appeals, and live E2E |
| Evidence | Implemented for completed unpaid invited runs: source-derived signed packets, separate reviewer/judgment coverage, per-case descriptive aggregation, separate client decision, and offline verification with a pinned trust anchor | Paid packets fail closed without terminal receipts; operational key publication/rotation, external verifier review, and a live settlement fixture remain |
| Settlement pipeline | Implemented source derivation: caller-supplied outcomes are rejected; Ponder finalization provenance and stored assignment/voucher/response records drive publication and webhooks | Scheduled production worker, monitoring/alerts, and deployment-pinned live exercise |
| Fund-core economics | Implemented and property-tested: exact policy equality, strict reveal/beacon deadline separation, self-reveal fallback, zero-reveal refund, and accepted-valid-work compensation | External real-money contract review, deploy assertion, gas/size report, then a fresh deployment after any later fund-core change |
| Deployment | Disposable Base Sepolia v2 bundle, generated exports, isolated Vercel app, Ponder, and keeper share one complete deployment key; thirdweb browser auth is implemented behind a fail-closed isolated-project/domain guard; app remains sandbox-only | Apply migration `0016`, provision and allowlist thirdweb for preview/production, verify all browser methods, complete paid live E2E and non-sandbox provider/secret configuration, and redeploy atomically after any later fund-core change |
| B2B/legal operations | Workspace trader/VAT/DPA/retention fields exist; public legal copy reflects reviewer modes and evidence limits | Geoblocking, screening operations, invoices/reconciliation, notice/action, KMS, rate limits, runbooks, and German legal review remain blockers to real money |

The decisive remaining boundary is therefore narrower but still important: the isolated application can be published in
explicit sandbox mode for product review, and an unpaid invited pilot can be rehearsed after migrations and operational
privacy review. Paid testnet work requires the missing assurance settlement integration and complete non-sandbox
provider/secret configuration; the current v2 bundle may be used unless a later fund-core change invalidates it.
Real-money launch remains blocked by the controls listed in the final row.

## Headline

The build is real and honest. Test health is clean (26/26 Foundry incl. stateful invariant suites; ~140 TS unit tests across 8 workspaces; typechecks pass), the adminless-funds claim genuinely holds on-chain (no owner/pause/sweep/upgrade path; issuer firewalled from funds and from accepted commits, proven by test), the copy discipline is excellent (no "reviews", no "fully keyless"/"unlinkable"/"zero deposits" overclaims — the honest formulations are used consistently), and the strongest compliance mechanics (DAC7 gating before the first voucher, checkout itemization, envelope-encrypted nullifier seeds, user-controlled payout-key recovery) are correctly built.

**The settlement substrate and unpaid invited human-assurance foundation are implemented, but the paid assurance stack
is intentionally disabled.** The access, storage, response, and unpaid evidence blockers identified in the snapshot
were addressed in source. The remaining gates are assignment-specific paid settlement, live end-to-end validation,
operational key/privacy controls, fuller buyer and reviewer loops, B2B legal/payment operations, external review, and
atomic redeployment after any later fund-core change.

## Historical pre-redesign human-assurance blockers

0a. **Live task content is not access-controlled.** Any signed-in rater can receive every approved open task's `content_json`; there is no project, cohort, invitation, assignment, assurance, or confidentiality filter. Fail closed on live content before any private pilot, then issue short-lived assignment-specific reads.

0b. **Customer artifacts and public commitments are not private enough.** Question and terms JSON are plaintext database columns with no artifact vault, read log, retention, or deletion state. Unsalted predictable hashes can link identical material or support dictionary matching. Add encrypted object storage, separate key domains, access auditing, and random per-run hiding commitments.

0c. **The database can directly map public votes to identities.** Account/provider/rater records join to vote keys and nullifiers stored beside public commits; the promised per-rater encrypted mapping is absent, and provider/DAC7/nullifier material shares a keyring. Separate the operational, identity-linkage, customer-artifact, and statutory vaults.

0d. **Published evidence is operator-supplied.** The internal bearer-token endpoint accepts finalized evidence and analytics rather than deriving them from deployment-pinned Ponder/chain data and issuer/assignment snapshots. The current output must not be called verifier-ready or independently recomputable.

0e. **The buyer domain model is missing.** There are no projects, suites, cases, artifacts, rubrics, reviewer sources, cohorts, frozen acceptance rules, provenance manifests, aggregate run results, or client decisions. The one-question API and UI are a settlement demo, not the target product.

## Blocks testnet E2E (mechanical — do these first)

1. **Deployment identity — resolved for the current disposable bundle.** `deployments/tokenless-v1/84532.json` remains historical. The v2 artifact at block `44090502`, generated package, isolated Vercel production environment, Ponder, and keeper now share one complete deployment key. Treat all of them as stale again after any fund-core change, and repeat the atomic redeployment before further live testing.
2. **The assert-no-funds-admin script doesn't exist.** The plan mandates a post-deploy script proving no role can reach fund-moving functions; there is only NatSpec. Add a viem/cast assertion chained into artifact generation — it's the deploy-time gate for the whole adminless claim.
3. **E2E harness deleted, never rebuilt.** `e2e/{tests,fixtures,…}` are empty; no Playwright config, no CI E2E job. "Live E2E verification" is currently 100% manual with no checklist. Rebuild at least one Sepolia smoke journey (fund → voucher → tlock commit → reveal/settle → claim), or commit a written manual verification script.
4. **Secret/provider provisioning.** The non-sandbox bundle still needs the issuer signer, distinct relayer + prepaid-funder keys, pipeline/webhook/keeper-work tokens, two Postgres URLs, and the eligibility-provider bundle. Browser authentication additionally requires `NEXT_PUBLIC_THIRDWEB_CLIENT_ID`, `NEXT_PUBLIC_THIRDWEB_AUTH_DOMAIN`, and server-only `THIRDWEB_SECRET_KEY`, plus the thirdweb dashboard origin/provider configuration. Decide what fills the eligibility-provider slots on testnet and apply drizzle migrations `0000`–`0016` before `TOKENLESS_SANDBOX_MODE=false`.
5. **No automated pipeline driver.** `publish_finalized_round` / `deliver_webhooks` are reachable only by manual bearer-token POST — no cron, no keeper hook, nothing calls them, so finalized rounds stay `pending` forever and webhooks never fire. Even a testnet E2E of the agent result flow needs a scheduled worker watching Ponder for `RoundFinalized`. (This finding predates the versioned post-round integrity scorer; the remaining blocker is automated pipeline execution.)

## Blocks real users (product is a transactional demo, not a two-sided loop)

6. **The rater loop is severed after submit.** After "Sealed response submitted" there is nothing — no reveal/settlement notification, no base+bonus receipt, no earnings history, no rolling 30-day stat (`app/api/notifications/` is an empty dir). The entire habit mechanism the UX invariant relies on is unbuilt. Build an earnings/receipts screen fed by settlement data + a reveal/settled notification channel.
7. **The advisory/probation tier does not exist.** No advisory task feed, no counterfactual "you would have earned $X," no rater tier-ladder — yet copy repeatedly promises "browsing and advisory calibration require no tax form," and `/api/rater/tasks` requires a session even to list. Required before opening the top of the rater funnel.
8. **The funder waiting room is one static sentence.** No commit/quorum progress, no settlement-phase display, no reserve-exposure figure, no watermarked provisional score. Poll round state and render the phased waiting room.
9. **Result artifact is minimal and leaks machine strings.** The headline can render literally `under_quorum_compensated`; no plain-language confidence statement, no layered card, no self-verifying "Panel Verdict" share artifact, and the fee is missing from the result breakdown. Humanize verdict states; add the share artifact (which is also the compliant way to publicize results).
10. **Per-task friction violates "answer + one tap."** Every paid submission requires typing a fresh 12+-char recovery secret in a field below the submit button that errors only after tap. Move recovery-secret setup into the one-time unlock step (or derive per-round secrets from one user secret); explain the linkability tradeoff inline before the first paid submit.
11. **Failure-state matrix mostly unimplemented.** The relayer-down IndexedDB queue is never drained by any UI consumer (an offline rater's commit silently dies before its deadline); voucher-denied shows raw messages instead of re-verify/appeal/neutral-legal branches; quorum-miss and gold-appeal states are absent. Wire the client queue retry loop + queued-commit UI, and map server reason codes to designed copy.
12. **German-language + § 312j + PWA basics.** Everything is `lang="en"` including the DAC7 sheet and legal copy, for a German launch jurisdiction; the pay button reads "Fund and start panel" (not an unambiguous obligation-to-pay label — the no-contract-but-USDC-moved risk); the PWA ships a single 128px icon with no service worker despite the offline-sensitive commit queue. Also: head-to-head A/B is advertised but broken end-to-end (rater UI hardcodes Yes/No; funder UI can only create binary).

## Blocks real money / scaled launch

**Contracts (audit scope):**
13. **Reserve farming — a real economic bug, not a trust assumption.** Beacon-failure compensation pays every committer with no reveal or validity requirement, and the contract can't distinguish a dead beacon from all-garbage payloads; `beaconFailureDeadline` can equal `revealDeadline`. An attacker with `maximumCommits` vouchers fills capacity at open, locks out honest raters, never reveals, and deterministically drains the funder's reserve. Gate compensation on proof of beacon-liveness failure (or a validity signal), and enforce a hard `beaconFailureDeadline > revealDeadline` minimum.
14. **The issuer key is the single point of total control** and is currently a hot EOA in an env var with no on-chain caps, issuance ledger, alarms, or wired circuit breaker. Compromise = control of every verdict and, via majority capture, the bounty. This is the headline audit item: KMS/hardware custody, an issuance-counters table with per-identity caps, a DB-backed circuit-breaker checked before signing, and `maximumCommits` sized so one issuer can't swing verdicts undetected.
15. **Honest-limit disclosures to add to TRUST.md:** a Circle-blacklisted rater payout address makes that rater's earnings permanently unclaimable (inherent to bind-at-commit); the current tier-numbering monotonicity is an unenforced deployment invariant that the redesign must remove through exact policy-hash binding; the v0 "accuracy bonus" is squared-error consensus-prediction, not true RBTS (fine if labeled, but don't call it an accuracy signal publicly). Also add the assert script (#2) and `forge snapshot` gas/code-size benchmarks before the audit.

**Backend/privacy/ops:**
16. **The DPIA headline mitigation is unimplemented.** The vote-key↔rater mapping (`tokenless_paid_vouchers`, `tokenless_rater_commits`) is stored in plaintext — a DB dump is a standing deanonymization key for the immutable public record. Envelope-encrypt the voteKey/nullifier↔rater link under per-rater keys; keep only hashes for uniqueness constraints. (Current encryption is a global keyring, not the per-rater-key design the DPIA scenario assumes.)
17. **Issuer/relayer/prepaid keys are all hot env-var keys; prepaid balances pool in an operator wallet** — the exact thing the legal reference forbids at scale, with no ledger↔wallet reconciliation. Move to KMS signing and regulated-partner custody (or at minimum reconciliation alarms) before third-party money.
18. **No rate limiting anywhere**, DAC7 vault shares the eligibility keyring with no retention/deletion/export machinery, no sanctions notice-response endpoint (keeper auto-claims every decryptable commit with no denylist), keeper scan cost grows unboundedly, and there are minor hardening items (non-timing-safe token compares, webhook SSRF DNS-rebinding TOCTOU, non-versioned webhook key). No alerting hooks, runbooks, or founder-continuity mechanism exists.

**Legal furniture (the pre-real-money list, item by item):**
19. **Missing entirely:** geoblocking (RU/BY/IR/KP/SY/CU + occupied territories — strict liability, on the plan's own blocklist); funder-side wallet screening; the B2B gate (trader self-declaration + VAT-ID at workspace creation; machine-readable trader flag in the 402 offer — the whole consumer-law posture assumes B2B-only, yet any consumer can fund today); funder ToS paid-panel clauses + the disclosure stamp on the share artifact (UWG blacklist exposure); DSA Arts. 11/12/16/17 contact points + notice-and-action + statement-of-reasons + TCO contact (applicable day one, what German enforcement actually pursues); DAC7 quarterly-consideration reporting model + structured place-of-birth field; the VAT/receipt layer (post-settlement itemized invoices with disclosed-intermediary language); DPIA + Art. 30 records + retention/deletion code.
20. **Partial:** German AGB (only an English skeleton — no Vermittler/who-owes-performance/choice-of-law/CoI clauses); the § 25 TDDDG position (cookieless analytics is defensible but undocumented and undisclosed in the privacy notice); the eligibility-provider is generic/env-configured with none actually named or integrated.

## What's already right (don't re-litigate)

Adminless fund core verified by test (no operator path to funds; issuer never consulted after commit acceptance); conservation, restart-safe paginated settlement, cursor retry-safety, and all four terminal-refund classes (quorum-miss, beacon-dead, zero-commit, normal) covered by a stateful invariant suite; pull-based credit so a blocked funder can't brick terminalization; the commit pipeline (EIP-712 voucher, nullifier dedupe, vote-key signature with `msg.sender` ignored, epoch/grace rotation, expiry); domain-bound thirdweb SIWE verified into hashed `__Host-` sessions, with hash-only API keys for direct callers; idempotency across quotes/asks/vouchers/commits/payments; fail-closed deployment-identity verification and code-enforced Vercel/Railway isolation (no `rateloop.ai` leakage); a genuinely complete agent API (free quote, idempotency, bounded long-poll, webhooks, sandbox, versioned schema, full verdict-status enum, SLO fields, policy-bound API keys with prepaid or self-funded x402 modes); DAC7 unlock genuinely enforced before the first voucher; honest refund/tier/claim-linkability copy throughout; drand quicknet with multi-relay failover; Impressum, privacy notice with on-chain-permanence and sign-in disclosures, and a published TRUST.md with the Circle and claim-link caveats.

## Recommended sequence

1. **Fail closed before private data** (0a–0d): restrict task visibility, introduce assignment authorization, encrypt customer artifacts and identity linkage under separate key domains, and replace operator-supplied results with source-derived evidence.
2. **Build the human-assurance domain and loops** (0e, 6–12) using the [redesign plan](tokenless-human-assurance-redesign-plan-2026-07.md): projects/suites/runs, invited and external cohorts, frozen manifests, complete buyer/rater journeys, decision packets, receipts, and failure states.
3. **Before any real money**, fix reserve farming (#13), stand up issuer-key KMS + caps + circuit breaker (#14), complete encrypted mapping and legal/data controls (#16–20), benchmark the mechanism, and pass privacy/contract review.
4. **Redeploy after any further fund-core change:** create one fresh Base Sepolia deployment and move the isolated app, package, Ponder, keeper, database, and configuration together; the current checked-in v2 bundle is stale for the payment-authorization changes and cannot gate a live autonomous run.

This preserves build-first iteration without exposing customer data or turning a historical deployment into an accidental compatibility constraint.
