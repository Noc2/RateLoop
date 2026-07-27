# Tokenless completion review, round 2 — 27 July 2026

**Scope:** re-verification of the 69 commits landed between `63229106e` and `012e2abf9` in response to
[the first review](tokenless-completion-review-2026-07-26.md), plus first review of the platform-secret custody change,
which had none.
**Head reviewed:** `012e2abf9`.
**Method:** three adversarial agents plus direct execution and spot-verification by the coordinating session. Every
finding below was confirmed in source.

---

## 1. Headline

**This round is a clear improvement.** Ground truth is the healthiest it has been:

| Gate | Result |
| --- | --- |
| `next:test` | **1940 pass, 0 fail** (was 1908) |
| `next:check-types` | clean |
| `lint` | 0 errors, **26 prettier warnings** (was clean) |
| `foundry:test` | 77 pass |
| keeper / ponder / sdk / agents | pass |
| `next:build` | **succeeds** |
| migration journal | 156 entries, one declared excision, no orphans, `when` increasing |

Of the first review's findings, **most are genuinely fixed**, several with better designs than proposed. The two
process recommendations were half-adopted: `yarn next:build` is now unconditional in CI — the single most valuable
change — but source-string assertions went **832 → 841**, so the "test must fail on the parent commit" discipline was
not.

Four things need attention:

| # | Finding | Severity |
| --- | --- | --- |
| N1 | **Workspace deletion now aborts on an FK violation** — a fix broke the GDPR erasure path | Critical |
| N2 | The keeper's raw private key must now live in the **Vercel web environment**, and the deployed path's key-distinctness check omits it | High |
| N3 | Hybrid is still unreachable — zero producers of `hybridSplit` | High |
| N4 | Park/unpark livelock retries poison emails forever; `risk_check_id` has no backfill so existing eligible raters are blocked | High |

---

## 2. Confirmed fixed

Verified directly by the coordinating session:

- **P** — the `NODE_ENV` escape is gone from `paidLaneCompliance.ts`, and `reviewCapabilities.ts:67` now compares
  `activationReference === derivePaidLaneActivationReference(env)` rather than testing its format. Both residuals also
  closed: the gate is now on the spend paths, and the preflight validates a lane when *either* flag is true.
- **A** — `payments.ts:941` now includes `workspace_id` in the voucher-round insert.
- **Q** — the voucher bridge has production callers.
- **U** — the aggregation floor is derived from `passRule.minimumValidResponses`, not hard-coded 3.
- **C** — the keeper round loop has a try/catch, and the `fromBlock > toBlock` throw is gone.
- **B** — the fund-resolution control is reachable, and `TOKENLESS_COMPLIANCE_OPERATOR_SECRET` is now in
  `.env.example`, the runbook, the parity doc, and four preflight checks.
- **F** — the `technicalStatus` console is gone (0 call sites).

Verified by agent, with evidence:

- **D** (forecast appeal) — fixed thoroughly and better than specified: the appeal join is removed, accepted appeals
  clear the finding, and the lockout is curable three ways (30-day window, accumulator decay, explicit clearing).
- **H** (sanctions durability) — a real denylist table, enforced pre-write on both paths, with retention excluding
  matches and pending screens.
- **T** — late-reveal now matches the contract exactly; the reveal window default rose 300s → 3600s; and
  `reveal_required` / `claim_expiring` notifications are produced, cron-wired, and consumed.
- **V1/V2** (specialist coverage) — the schema-version-2 writer now has a real UI caller and mount chain, so coverage
  can reach `ready`. This closes the premise error the first review retracted.
- **W1, W2, W3, W6, W7, W8** — connect-another-agent, `haas_` draft persistence, the invitation outbox, worker health
  surfacing, poison-pill handling (full attempts/backoff/dead/claim-generation pattern), and feed starvation.
- **§5 deliverables** — all six now exist: structured place-of-birth TIN, residence-conditional form, an enforced
  plausibility check, geoblock plus wallet screening, an explicit decline path, and DAC7 retention with an
  `ON DELETE RESTRICT` chain across all four deletion paths.
- **§6.3, §6.5, §6.6, §6.7** — rating surfaces fully migrated to the form primitive; receipts persist in both lanes;
  the subject-export UI exists with 7-day and principal binding enforced in SQL; and notification config errors now
  park rather than consume attempts.

---

## 3. N1 — Workspace deletion aborts on a foreign key

`lib/privacy/workspaceDeletion.ts:778` deletes `tokenless_paid_eligibility_scopes`. Migration
`0149_lane_scoped_legal_eligibility.sql:9` makes `tokenless_legal_eligibility.scope_id` reference that table
`ON DELETE RESTRICT`. And `workspaceDeletion.ts` **never touches `tokenless_legal_eligibility`** — confirmed, zero
occurrences in the file.

So deleting a workspace that has any invited paid-eligibility scope raises a foreign-key violation and **aborts the
whole deletion job**. This is a new regression introduced by the eligibility fix, landing in the same GDPR erasure path
that finding B was about. It is untested.

**Sibling missed in the same file:** `:783` deletes sanctions screenings with no `status <> 'match'` filter, destroying
match evidence — the exact filter that *was* correctly added at `accountDeletion.ts:1183`.

**Fix:** delete or re-point `tokenless_legal_eligibility` before the scopes, add the match filter, and add a test that
deletes a workspace with an invited paid scope.

---

## 4. N2 — The platform-secret custody change

This had no prior review. The honest verdict is nuanced:

**For the environment that actually deploys, this is lateral.** The preflight branches to
`validateTokenlessTestDeployment` for any ref other than `main`, and that path always accepted raw
`TOKENLESS_*_PRIVATE_KEY` values. The AWS KMS requirements lived exclusively in the `main` path, which the isolation
policy forbids running — so the boundary removed was never active on the deployed system, and the old privacy page said
so. **For the aspirational production posture it is a real downgrade** from HSM-backed custody to environment
variables, and it is documented as such rather than hidden.

**What is genuinely good:** tenant binding survives correctly — per-tenant HKDF derivation with AAD bound into AES-GCM
on both wrap and unwrap, built from the caller's authorized scope rather than the stored row, with cross-tenant unwrap
rejected and tested. Runtime distinctness for the four web roles compares actual key values pairwise and pins each
derived address at boot. The AWS package removal is clean with zero remaining imports. The attestation path *improved*
— it previously resolved long-lived static AWS access keys from an env var and hand-rolled SigV4. **And no
customer-facing claim overstates custody**; the privacy page, machine docs, and design of record were all updated to
say "application-managed encryption, not a customer-held-key or HSM boundary."

**What needs fixing:**

1. **The keeper's raw private key is now required in the Vercel web environment** (`PLATFORM_EVM_SIGNERS` includes
   `KEEPER` with `privateKey: "TOKENLESS_KEEPER_PRIVATE_KEY"`) — for a service that runs on Railway and that the web
   app never signs for. Under KMS the web env held only an ARN and expected address. Every Next.js server function and
   everyone with Vercel project access can now read the settlement signer's key.
2. **The deployed path's distinctness check omits it.** The tokenless-path loop covers five names and excludes
   `TOKENLESS_KEEPER_PRIVATE_KEY` and `TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY`. So setting the keeper key equal to the
   prepaid funder key is not caught — while `tokenless-environment-parity.md:131-132` claims key reuse is rejected.
   That claim is false for the branch that deploys.
3. **Keeper address pinning is self-referential.** `expectedSignerAddress` defaults to the address derived from the
   same key, so the check cannot fail; nothing requires `TOKENLESS_KEEPER_EXPECTED_ADDRESS` in production; and the
   legacy dev variable `KEEPER_PRIVATE_KEY` is now a valid production input — the old code forbade it.
4. **Attestation and evidence keys may be the same.** The attestation signer only needs to appear as `current` in a
   keyring that the evidence key auto-publishes into, so reusing one key is the simplest passing configuration and
   nothing forbids it.
5. **Vault residency guards were deleted**, leaving only a literal `RUNTIME_REGION === "eu"` string check; the EU
   manifest test was removed outright. Nothing now binds artifact key material to the EU.
6. **The decision-packet verification keyring may be empty at runtime** — `allowEmpty` is now always true on the
   platform-secret signer, so packets can be signed with a key that is not published for verification.
7. Test coverage around signing shrank: 9 → 2 tests for the account, 7 → 0 for the keeper account (partly replaced by
   4 elsewhere), and the vault EU-manifest test deleted.

---

## 5. Remaining and new issues

**Still open from round 1:**

- **R / hybrid** — `hybridSplit` still has exactly three non-test hits: one type declaration and two consumers, **zero
  producers**. Hybrid remains unreachable, not "default off."
- **E / claims sweep** — derivation is genuinely fixed (`publicEvidenceClaims.ts` now reads `reviewCapabilities.ts`),
  but only 3 of 6 missed strings gained matcher coverage and the other 3 were deleted. All five new patterns are
  verbatim snapshots of simultaneously-deleted sentences and match nothing across the 130-file corpus. The sweep is
  still tautological; a green result still is not evidence.
- **I / shared eligibility row** — the key is fixed, but `getPaidEligibility()` still joins on `rater_id` alone with
  `ORDER BY updated_at DESC LIMIT 1`, and it gates `/api/rater/tasks`. An invited submission still knocks the network
  lane out of `ready` in the UI.
- **S / integrity epochs** — the write site is fixed and fails closed, but the producer is off by default, no preflight
  requires it, it is gated on paid-lane compliance while the consumer fires for *any* non-private audience including
  unpaid, and no endpoint exposes the current epoch. The producer's `"created"` path is untested.
- **§6.1 / focus management** — effectively dead. `useFormErrors` resolves by `getElementById(field)` or `[name]`, but
  `Field` defaults its id to `useId()`. Only **4 of 81** bound controls can receive focus. Its interaction test is
  green against a hand-rolled input that no production `Field` usage resembles.
- **§6.2 / server `field` discriminator** — flat at 10.5% (244 of 2303).

**New defects introduced by this round's remediation**, beyond N1:

- `clearAcceptedForecastFinding` zeroes the whole accumulator regardless of reason code, so accepting one appeal clears
  unrelated findings — and the new test asserts this, having dropped the old test named "appeals suspend only their
  exact active findings."
- `ORDER BY source_observation_count DESC` plus the appeal's reset-to-0 keeps selecting the cleared finding, buying a
  window of blanket immunity.
- **Park/unpark livelock in both email workers.** A Resend `400`/`401`/`403` is classed as a configuration error and
  parks the delivery *without incrementing `attempt_count`*, but the unpark at the top of the next cycle is
  unconditional and gated only on a global config check that cannot detect an invalid key — let alone a per-recipient
  400. So: park → unpark → send → 400 → park, forever, burning a real API call per stuck delivery each cycle.
  `MAX_ATTEMPTS` is never reached and retention only purges terminal states, so the row is immortal. The same defect
  reaches the invitation outbox through a key-version mismatch, so rotating the artifact key version puts every queued
  invitation into the loop. The tests run only one cycle, so CI cannot see it.
- `app/(public)/page.tsx:85-88` appends " Hybrid is unavailable." unconditionally after a sentence that conditionally
  includes hybrid.
- `V3` — one of three invitation issue points still omits the group binding, and is now *worse* than before because
  membership derives solely from the private-group invitation row, so that path can never produce membership.
- `W5` — the false tie alarm was removed without adding a tie classifier, so a 1-1 split on the default panel of 2 went
  from a misleading alert to **silence**.

**Further new defects from the regression sweep:**

- **`risk_check_id` has no backfill, and no recovery path.** `0152` adds the column nullable, the only writer is
  `submitPaidEligibility`, and the preflight now requires `riskCurrent` in its AND-chain. Every previously-eligible
  paid reviewer is blocked until they resubmit from scratch, and a screening queued before the migration can only ever
  resolve to `review`, never `eligible`. Fail-closed, but with no operator route or re-screening worker.
- **The configurable sanctions source is looser than the DB constraint.** The env value is validated against a broad
  regex and written to two columns constrained to exactly `('manual:v1','opensanctions:v1')`. Configuring any other
  provider turns every paid-eligibility submission into a 500. The only test uses an allowed value.
- **A 370-day wallet-screening expiry violates the new 365-day CHECK**, rolling back the whole eligibility submission
  with an untyped DB error. 370 was chosen as "a bit over a year" tolerance, which is exactly the breaking window.
- **The readiness gate is weaker than the code requires.** Wallet-screening provider vars are demanded only when a
  paid-lane flag is true, but the eligibility route calls the screener unconditionally with no lane gate — so a
  deployment can pass readiness and still 503 on every submission.
- **The new worker-health endpoint returns platform-global state to any workspace admin.** It authorizes on workspace
  membership then queries scheduled runs with no workspace predicate, exposing other tenants' run ids, statuses, and
  failure counts. The scheduler is a singleton so per-tenant filtering is not possible — but this is a new disclosure
  surface, not a fix.
- **Dead evidence projections have no recovery path.** Retries bound at 8 then write `dead` permanently, with no
  unpark, operator route, or retention cleanup — unlike notifications, which have exactly that. A private review
  decision can end with a permanently missing evidence packet, surfaced as a one-cycle `degraded` blip.
- **Keeper feed prioritization is now largely decorative.** The feed page size dropped from 500 to roughly half the
  tick budget; the `finalize_scoring_seed`-first sort still runs, but sorting a one-or-two item page is a no-op, so an
  urgent seed on a low round id waits for the whole descending walk. The rotation itself is correct and does not stall.
- **Notification counters became global.** They now count the whole table's backlog rather than the cycle's outcomes,
  while the health check still treats any non-zero as degradation — so one permanently dead delivery pins every future
  run to `degraded`. This compounds with the livelock above, since parked rows are now immortal.

**Migration renames — checked and clean.** `a318a120e` renumbered four migrations (0152–0155 → 0149–0152), which looked
like an immutability violation. It is not: against the base, `git diff --name-status -M` over `drizzle/` shows only
additions plus the journal, and the renumbered files were themselves *created within this same commit range* and had
never shipped. No already-applied migration filename, body, or `when` was touched. Journal integrity confirmed at 156
entries, idx 0–156, single pre-existing excision at 66, every tag prefix matching its idx, `when` strictly increasing,
no orphans either direction.

**But `0151` can still abort a real deploy.** `0151_dac7_statutory_records.sql` backfills only
`WHERE dac7_status='complete' AND tax_vault_ciphertext IS NOT NULL`, then adds a CHECK requiring
`dac7_status='complete'` to imply a non-null record id. Any pre-existing row with `complete` status and a null
ciphertext fails the CHECK and aborts the migration. Not reachable in CI, because the in-memory harness skips both
backfill statements for this file.

**Lint regression.** 26 `prettier/prettier` warnings, all auto-fixable, concentrated in the new platform-secret code —
so `yarn format` was not run on that batch.

---

## 6. Process

The single most valuable change was adopted: **`yarn next:build` is now unconditional in CI**, which would have caught
both of the previous round's build blockers.

The second was not, and a dedicated test-quality pass over this batch found the problem is broader than five tests.

**Ten tests in this range would pass unchanged on their own parent commit** — they encode rather than detect. The
clearest cases: three new `check-tokenless-production-readiness` custody gates were added **only to the valid fixture**
with no negative assertion anywhere, so deleting the whole check block would fail nothing; two maintenance-health
fixtures added `parked: 0` / `dead: 0` to both the stub *and* the assertion that compares against that same stub, so
the `> 0 → degraded` branch is never executed; a `Field` test asserts ids that the parent already emitted; and a
binary screenshot baseline was refreshed under a `test(e2e)` label, silently ratifying a visual change.

**A commit labelled `test(...)` made a production change that removed a gate from coverage.** `86d0e6b80` converts
`requirePaidLaneComplianceApproval("hybrid_public_safe")` in `hybridHumanReviewAdapter.ts` into an injectable
`dependencies.requireCompliance()`, and all six hybrid tests then inject a no-op. The default still calls through, so
production behaviour is preserved — but the hybrid paid-lane compliance gate is now exercised by **no test**, in the
same batch that made hybrid unconditionally fail-closed.

**Coverage was also deleted during the custody migration**: `local_production_vault_forbidden`, `kms_region_mismatch`,
`invalid_managed_kms`, the EU-manifest inventory test, an RPC-fallback HTTPS check, and error-message scrubbing
assertions all went, and a real `artifact_kms_adapter_unavailable` negative assertion was replaced by a bare
`assert.doesNotThrow`.

**The systemic cause is the house style.** `readFileSync` + `assert.match` over source text appears in ~180 test files
repo-wide. A source regex written *after* an edit always discriminates against the parent while proving nothing about
runtime behaviour — so this failure mode is structurally easy to reach, and hard to see in review.

Five tests additionally assert prior or incorrect behaviour:
the keeper feed-starvation test is byte-identical to baseline and still asserts a round is dropped; `mechanismHealth`
still asserts the SQL string with only the literal changed; the `useFormErrors` interaction test is green against
markup no consumer produces; `AgentConnectionPanel` is still verified by regex over component source; and two claims
tests hard-code the all-lanes-off state and will fail the moment a lane is legitimately activated.

Two scope notes worth recording: the new owner decision-packet E2E stubs all 24 API responses via `page.route`, so it
exercises UI rendering against a fabricated packet rather than real projection; and
`__setPaidEligibilityOverridesForTests` is exported with no `NODE_ENV` guard, so it can null out the risk check, DAC7
policy, and provider.

---

## 7. Suggested order

1. **N1** — workspace deletion FK abort, plus the sanctions-match sibling in the same file.
2. **N2.2** — add the keeper and evidence keys to the deployed path's distinctness check, or correct the parity doc.
3. **N2.1/N2.3** — reconsider requiring the keeper key in the web environment; make the expected address and key
   version mandatory in production and drop `KEEPER_PRIVATE_KEY` as a production input.
4. **V3** — pass the group binding at the third issue point; that path currently mints permanently group-less invitations.
5. **S** — enable the epoch producer or decouple it from paid-lane compliance so unpaid network review can produce epochs.
6. **I** — lane-scope `getPaidEligibility`, or have `/api/rater/tasks` pass the lane.
7. **§6.1** — give `Field` consumers a `name`, or key the lookup off the generated id; retest against a real `Field`.
8. **D residuals** — scope the accumulator clear to the appealed reason code; fix the ordering immunity window.
9. **E** — replace verbatim-snapshot matchers with structural ones, or stop citing the sweep.
10. **R / hybrid** — build a split producer, or state plainly that hybrid is unreachable rather than default-off.

---

## 8. Method and limits

Three adversarial agents: platform-secret custody, finding re-verification, and a regression sweep. Every finding above
was independently confirmed in source by the coordinating session before inclusion.

**Not covered:** no `yarn e2e` execution; two delegated sub-audits (the forms-unification area and a dedicated test-quality pass) did not report. No deployed environment inspected, so nothing here speaks to whether the
required secrets are set — and `vercel.json` still has `"deploymentEnabled": { "tokenless": false }`, so nothing is
live. The regression-sweep stream had not reported when this document was written; its area is represented by the


Nothing here is a release approval, and no technical control substitutes for the counsel review the legal reference
requires.

---

## 9. Addendum — forms-unification regressions

A delegated sub-audit of the forms-unification commits (`30633741a`, `67ff294d5`, `68f9a033d`, `50ed217e1`,
`bfcb646ab`, `7b99d2b1b`, `7d6b64698`, `569490767`) reported after this document was first written. Its two most
serious findings are verified.

### A1 — Non-EU raters can hit an unrecoverable dead end in paid eligibility

The client hardcodes an EU-27 set (`lib/tokenless/paidEligibilityForm.ts:1`) and uses it to decide both whether to
render the DAC7 fields and whether to emit the `dac7` key at all. The server reads
`TOKENLESS_DAC7_POLICY` from the environment (`lib/tokenless/paidEligibility.ts:902`), supporting `all`, `eu`, and
`configured`.

Under `all` — or `configured` with any non-EU-27 entry such as `NO` or `GB` — a non-EU resident's payload omits `dac7`,
the server rejects with `dac7_required`, and **the user cannot fix it**, because the inputs are never rendered for
them. Before this commit the client always sent the full block, so this is a new regression. `.env.example` defaults to
`eu`, which masks it in the default configuration only.

**Related:** non-EU residents can no longer declare a divergent tax residence, since that field renders only inside the
DAC7 branch and the form forces `taxResidenceCountry = declaredResidenceCountry`. That makes the server's
`residence_tax_review` path unreachable for them and opens a DAC7 escape — a US-resident / DE-tax-resident reviewer now
reports `US` and skips DAC7 entirely.

### A2 — Duplicate DOM ids in the per-task rating card

`PublicQuestionCard` renders once per queued task (`AnswerPageClient.tsx:263`), but `bfcb646ab` added two hardcoded
ids inside it: `id="public-review-terms"` (`:801`) and `id="public-review-recovery-confirmed"` (`:1031`). With two
queued tasks in the relevant state, `<label for>` binds to the first element in tree order — so **clicking the second
card's checkbox label toggles the first card's checkbox**, in a money-bearing confirmation step. The same file already
demonstrates the correct convention two dozen lines away (`id={`public-records-${task.roundId}`}`).

### A3 — Smaller, still real

- **Three toggles are visually broken.** `ChoiceInput` unconditionally adds the daisyUI `checkbox` class, and the three
  call sites that pass a `toggle` className now carry both. `toggle` wins on layout but never resets `checkbox`'s
  `:before` rules, so the knob is invisible when off and renders as a rotated checkmark sliver when on.
- **The primitives discard a caller-supplied `aria-describedby`.** The computed value is written after the props
  spread, so `undefined` clobbers it — orphaning three real descriptions, including "This value is shown once. It
  cannot be recovered."
- **Auto-focus is inert, and can focus a `<meta>` tag.** The fallback scans the whole document for `[name]`, and
  `<meta name="description">` in the root layout wins for a `description` field error. More broadly the feature
  resolves for only **4 of 92** error-wired controls, because the rest rely on `useId()`-generated ids — and two of
  this batch's commits removed stable ids that previously worked. This is the same §6.1 finding, now quantified.

**Clean:** no lost accessible names, no `required`/`name` regressions, no controlled↔uncontrolled flips, no orphaned
CSS or components.
