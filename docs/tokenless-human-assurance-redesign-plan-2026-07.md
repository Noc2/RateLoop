# RateLoop Tokenless: Human-Assurance Redesign Plan

**Date:** 13 July 2026

**Status:** Detailed execution plan. This plan implements the product direction in the [design of record](tokenless-immutable-implementation-plan-2026-07.md), [product-market-fit research](tokenless-product-market-fit-research-2026-07-13.md), and [consulting strategy](ai-consulting-rateloop-integration-strategy-2026-07-13.md). It does not authorize a production deployment.

## Implementation checkpoint — 13 July 2026

- Phase A is implemented and verified: private task visibility fails closed, beacon-failure compensation is hardened,
  vouchers bind the exact audience-policy hash, and v2 human-assurance schemas replace ordered identity tiers.
- Phase B has a usable **unpaid customer-invited foundation**: client-isolated projects, suites/cases/runs, encrypted
  artifacts, assignments and renewable short leases, blinded responses, explicit off-chain completion, descriptive
  per-case aggregation, signed decision packets, and separate client sign-off. The public buyer flow remains a
  suite-setup preview rather than a complete run dashboard.
- Paid, RateLoop-network, and hybrid assurance assignments now fail closed. They must not be re-enabled until the frozen
  assignment policy is carried through voucher issuance, sealed commit, terminal settlement, and a receipt for every
  expected judgment. The existing generic paid settlement primitive is not a substitute for that product integration.
- Identity-provider commits 15 and 16 remain deliberately deferred behind the PMF gates below. Base Account plus
  one-time customer invitations is the active private path; neither World ID nor Self is a production dependency.
- Pipeline and integration foundations are present, but production scheduling, safe artifact upload, settlement
  notifications, earnings, full buyer APIs/UI, compliance operations, browser E2E, and the atomic fresh deployment
  remain open. The isolated web deployment may be published only as an explicitly simulated sandbox meanwhile.

## Decision

Rebuild the tokenless product around this category and promise:

> **Human assurance for AI-enabled workflows.** Compare a proposed AI workflow or release with its baseline using a predefined rubric and relevant human reviewers. Return a private decision packet with reviewer provenance, reasons, limitations, and independently checkable settlement evidence.

The product is not a generic polling market, a social rating network, or a replacement for deterministic software tests. Its repeated workflow is:

```text
project -> versioned suite -> blinded cases -> qualified reviewers
        -> aggregate decision packet -> client sign-off -> recurring regression run
```

Start with AI consultancies and agencies that can reuse the workflow across client-isolated projects, plus a small number of direct design partners. The end customer may be any company with a repeated, consequential AI-assisted workflow; it does not need to be an AI-native software company.

## Product choices to freeze first

### Buyer and use case

- **Primary operator:** AI consultancy, AI/software agency, or an internal AI/workflow owner.
- **Economic buyer:** the partner or end client, tested rather than assumed.
- **Best first workflows:** customer-support drafts, sales/service communication, knowledge answers, marketing or product copy, and assistant behavior.
- **First evaluation shape:** a blinded baseline-versus-candidate comparison across 10–50 representative cases, with a short rubric, written reasons, and a client-approved pass rule.
- **Recurring product:** rerun the frozen suite after a model, prompt, data, or process change and compare it with earlier runs.
- **Initial exclusions:** medical, legal, hiring, credit, safety-critical decisions, raw special-category personal data, and tasks whose quality is fully testable with deterministic assertions.

### Reviewer modes

Keep these modes separate in the data model, UI, report, and pricing:

| Mode | Who reviews | Settlement | Product claim |
|---|---|---|---|
| Customer-invited | Named employees, users, customers, or experts | Off-chain if unpaid; on-chain if paid | Relevant customer-selected reviewers; not independent by default |
| RateLoop network | RateLoop-recruited and qualified reviewers | On-chain paid rounds | External panel with disclosed qualifications and assurance |
| Hybrid | Separate invited and RateLoop sub-panels | Separate results and, when paid, separate rounds | Comparison across sources; never one opaque blended score |
| Sandbox | Simulated responses only | None | Test data, never represented as human evidence |

Customer invitations should be the default private B2B path. A one-time access code proves authorization to a project; it does not prove unique humanity, age, expertise, sanctions clearance, or paid-work eligibility. Every paid reviewer must complete the legal/payout gate before the first voucher, including customer invitees.

### Evaluation and result model

- Treat one on-chain binary or A/B round as a **case-level settlement primitive**, not the buyer product.
- Freeze cases, artifact versions, rubric, reviewer policy, randomization, and acceptance rule before responses become visible.
- Use pairwise preference plus bounded rubric failure tags and a short rationale in v1. Add multi-axis scoring only after inter-rater reliability and buyer usefulness are measured.
- Replace the current handcrafted `confidenceBps` label. Report preference share, sample size, an appropriate interval, disagreement, missing/invalid cases, and the exact aggregation rule.
- Benchmark the prediction tap and bonus mechanism against equal-pay voting. Keep it only if it materially improves quality, calibration, or resistance to herding without damaging completion.
- Record the client's final `go`, `revise`, or `stop` decision separately from the panel result. RateLoop supplies evidence; the customer owns the deployment decision.

## Identity and audience recommendation

Do not replace World ID with Self, and do not make either provider mandatory for customer-invited reviews. Replace the globally ordered `selfie < passport < orb < presence` product model with a versioned, provider-neutral audience policy.

```text
source: invited | rateloop_network | hybrid | sandbox
cohorts: qualifications, quotas, and source provenance
assurance: required capabilities and acceptable providers
selection: randomized | customer_named
fallbacks: explicit allow or deny
privacy: fields released to buyer and minimum aggregation thresholds
```

The canonical policy is hashed. Paid-round vouchers and terms should bind the exact `admissionPolicyHash`, rather than accepting any numeric tier at or above a threshold. The issuer remains the disclosed admission trust point, but cannot move funds or change accepted commits.

### Keep five concepts separate

1. **Browser identity:** Base Account and SIWE session.
2. **Project access:** invitation, roster membership, assignment, and confidentiality acceptance.
3. **Job qualification:** language, role, experience, customer segment, or manually vetted expertise.
4. **Identity assurance:** liveness, document uniqueness, global uniqueness, document-backed predicates, and freshness.
5. **Paid eligibility:** adulthood, declared residence, tax/DAC7 data, sanctions process, and payout setup before a voucher.

Do not collapse country-related fields:

- `marketCountry` or current location may qualify a cohort and must state whether it is declared, customer-attested, or verified;
- `documentIssuingCountry` and `nationality` are document attributes;
- `declaredResidence` is a user statement;
- `taxResidence` is collected for tax treatment; and
- `sanctionsDecision` is a separate compliance result.

A passport does not prove legal or tax residence. Public receipts should expose only policy satisfaction and privacy-safe aggregates, never raw country or identity fields.

### Provider roles

| Option | Recommended role | Constraints |
|---|---|---|
| Access code / roster | Default for private invited cohorts | Hash one-time tokens, bind redemption to Base Account, expire them, and prevent reuse; no uniqueness claim |
| World ID 4 Proof of Human | Optional global-uniqueness capability for open panels | Use server verification and bind the proof to the RateLoop account/context; do not add World contracts to the Base fund core |
| World passport / NFC | Optional document-uniqueness capability | Coverage and authentication strength vary by document and country |
| World Selfie Check | Optional low-friction liveness signal | It is beta/low assurance and currently uses a legacy proof path while v4 support rolls out; do not market it as global uniqueness |
| World Identity Check | Possible document-attribute capability | It is preview; procurement and production access must be confirmed before planning around it |
| Self | Optional age/document/country-predicate adapter | Prefer backend verification and predicates; avoid name, date of birth, passport number, and direct Base contract integration |

World ID remains the better candidate for a low-friction open-panel path because it combines Proof of Human, passport, and fresh-presence flows. Self is useful when a paid audience policy genuinely needs document-derived age or country predicates. Neither provider should be selected until RateLoop confirms completion rates, coverage, pricing, rate limits, support, data-processing terms, deletion behavior, and production stability. Provider subjects are unique only within their own namespace; do not claim cross-provider deduplication.

## Privacy and evidence architecture

Privacy is a launch prerequisite for this category, not an enterprise add-on.

### Immediate blockers in the current branch

- The paid-task list exposes every approved open task's plaintext `content_json` to any signed-in rater; access is not assignment- or cohort-bound.
- Questions and terms are stored as plaintext JSON, and predictable unsalted hashes can link identical content across workspaces or support dictionary matching.
- Vote keys, nullifiers, rater IDs, Base accounts, and provider-subject hashes remain joinable in the application database; the promised per-rater encrypted mapping is not implemented.
- Eligibility, provider handoff, and DAC7 material share a keyring rather than separate blast-radius and retention boundaries.
- The internal publication endpoint accepts caller-supplied finalized evidence and analytics. The current result is operator-input, not verifier-recomputed evidence.
- Public chain data exposes response timing, binary votes/predictions after reveal, response hashes, economics, and claim destinations. Product copy and customer previews must show this boundary precisely.

No private customer pilot should use production-like artifacts until the first four items are fixed. No “verifier-ready” or “independently recomputable” claim should ship until the fifth is fixed.

### Target controls

- Store encrypted artifact blobs outside transactional rows; keep only tenant-scoped metadata and object references in Postgres.
- Use separate envelope-key domains for customer artifacts, vote-key mappings, provider evidence, and statutory tax records. Document rotation, recovery, deletion, and legal-hold behavior.
- Deliver the minimum case content through short-lived assignment leases. Log every preview, read, export, and administrative access.
- Use a random per-run hiding salt in `contentId`/manifest commitments so identical private cases cannot be correlated. Keep option labels blinded on-chain.
- Use the pooled prepaid funder as the default B2B rail so a client wallet is not automatically linked to every run; disclose the linkage created by direct wallet and x402 funding.
- Commit the private rationale digest with the response while keeping the rationale encrypted and off-chain.
- Add workspace retention defaults, project overrides, deletion jobs, export, incident access review, and subprocessor/DPA records.
- Lock a client-approved pre-result manifest containing the suite, versions, rubric, reviewer source, selection method, acceptance rule, and responsible parties.
- Derive round events and aggregates from deployment-pinned Ponder/chain data plus issuer and assignment snapshots. Sign the evidence packet and ship an offline verifier/recompute command.
- State what the evidence proves: accepted inputs and settlement were not silently changed. It does not prove unbiased case selection, truthful identity issuance, reviewer expertise, or correctness of the client's final decision.

For invited unpaid reviews, issue a signed private evidence packet but do not claim on-chain settlement. Do not add a new public evidence-anchor contract unless repeated buyer research shows that an anchor materially changes purchase or audit decisions.

If design partners reject public individual votes, timing, or economics even with blinded labels and salted commitments, stop before mainnet and reopen the settlement architecture. Hiding Ponder/API fields cannot hide chain data; materially private ballots would require a separate design such as private responses with a zero-knowledge settlement proof.

## Target product model

Add these versioned off-chain objects:

- **Workspace and client:** billing owner, team, consultant/end-client roles, DPA state, retention defaults.
- **Project:** workflow, decision owner, risk/data classification, client isolation, status.
- **Suite:** reusable set of versioned cases, rubric, objective-check references, and pass rule.
- **Run:** frozen suite version, baseline/candidate versions, reviewer policy, budget, randomization seed commitment, lifecycle, and prior-run baseline.
- **Case and artifact:** blinded content variants, encrypted object references, hashes, MIME metadata, redaction state, and renderer policy.
- **Audience policy and cohort:** source, claims, assurance capabilities, quotas, qualification provenance, fallbacks, and privacy thresholds.
- **Invitation and assignment:** hashed one-time token, account binding, expiry, capacity reservation, confidentiality acceptance, preview/read events, and terminal state.
- **Response:** choice, prediction when enabled, rubric tags, encrypted rationale, response digest, settlement reference, and validity state.
- **Evidence manifest and decision:** frozen provenance, case/round roots, aggregation version, result, limitations, client sign-off, and signed export.

Projects, artifacts, rubrics, raw rationales, cohort membership, identity attributes, and client decisions remain off-chain. The fund core receives only commitments and settlement terms.

## Buyer and rater journeys

### Buyer

1. Create a client-isolated project and classify the data.
2. Import cases by CSV/JSON or add artifacts; run redaction and a reviewer-view preview.
3. Choose a template, rubric, baseline/candidate labels, and pass rule.
4. Choose `Bring your own people`, `RateLoop network`, or `Hybrid`; configure qualifications and assurance separately.
5. Review the exact privacy/on-chain boundary, rater compensation, fee, reserve, time estimate, and frozen manifest.
6. Fund and start. Track assignment, quorum, reveal, settlement, and exceptions without seeing early answers.
7. Receive a decision packet, reasons/disagreement, evidence verifier, and record `go`, `revise`, or `stop`.
8. Schedule or trigger the next regression run through API/webhook integration.

### Rater

1. Enter through an invitation or discover a suitable RateLoop-network task.
2. Sign in with Base Account; accept project-specific confidentiality and confirm relevant qualifications.
3. Complete external identity assurance only if the audience policy requires it. Complete legal/payout eligibility before any paid voucher.
4. Receive only assigned content and see compensation, reserve outcome, deadline, data-use warning, and assurance label before accepting.
5. Compare blinded artifacts, select a choice, add bounded failure tags/rationale, and optionally make the prediction tap.
6. Receive reveal/settlement notifications, a base/bonus receipt, and a recovery path without per-task secret-entry friction.

## Repo-wide surface changes

| Surface | Required change |
|---|---|
| Foundry/contracts | Fix beacon-reserve farming; replace numeric tier admission with exact policy-hash binding; preserve adminless fund custody and terminal-payment invariants |
| Contracts package/deployment | Regenerate only after the final contract commit and a fresh isolated deployment; fail closed on stale/mixed bundles |
| Postgres/services | Add projects, suites, runs, cases, artifacts, policies, cohorts, invites, assignments, responses, access logs, manifests, and decisions in new migrations |
| Storage/privacy | Encrypted object storage, separate key domains, assignment leases, hiding commitments, retention/deletion/export, and access review |
| Ponder/pipeline | Derive evidence from chain data; remove caller-supplied outcome metrics; add deployment/run correlation and reproducible exports |
| Buyer app | Replace the three-field `/ask` demo with project setup, suite import, cohort composer, reviewer preview, run dashboard, result packet, and recurrence |
| Rater app | Assignment-only task feed, correct A/B rendering, rationales/tags, invitations, qualification, notifications, receipts, queue recovery, and appeals |
| SDK/agents/MCP | A thin Streamable HTTP adapter and installable agent skills over versioned run APIs, with draft-first browser approval and quote -> ask -> wait -> result retained as the internal per-round primitive |
| Workspaces/billing | Team invitations, client isolation, partner roles, B2B/trader and VAT controls, prepaid reconciliation, invoices, usage/cost centers |
| Public product | Reposition landing, shell, metadata, docs, static AI files, OG assets, promo video, and examples around human assurance; buyer CTA first, rater CTA second |
| Trust/legal | Update privacy, terms, TRUST, DPA/subprocessor material, evidence limits, identity-provider disclosures, on-chain permanence, and reviewer-source labels |
| Tests/operations | Add browser E2E, privacy/authorization tests, verifier fixtures, provider conformance, runbooks, monitoring, isolated deployment checks, and migration rehearsal |

## Dependency-ordered commit plan

Each numbered item is one intended commit. Keep contract, schema, privacy, product, and deployment concerns separate.

### Phase A — freeze the product and remove unsafe assumptions

1. **`docs: redefine tokenless as human assurance`**
   Make this category, the four reviewer modes, product objects, privacy boundary, evidence claims, success metrics, and non-goals part of the design of record. Reconcile readiness, PMF, consulting, README, TRUST, and deployment-staleness statements.

2. **`fix(privacy): fail closed on task visibility`**
   Stop returning live content to unassigned accounts. Until assignment authorization exists, allow only explicitly public synthetic/sandbox tasks; add authorization-bypass regression tests.

3. **`fix(contracts): harden beacon failure compensation`**
   Close reserve farming, enforce safe deadline separation, extend invariants, and mark all deployment artifacts/hosted addresses stale.

4. **`refactor(contracts): bind vouchers to audience policy hashes`**
   Replace ordered `tierId >= requiredTier` admission with exact `admissionPolicyHash` matching in terms and vouchers. Update issuer/Foundry tests without adding provider contracts to the fund core.

5. **`feat(sdk): define human-assurance schemas`**
   Add versioned project, suite, case, artifact, rubric, audience-policy, run, response, evidence, and client-decision types. Rename or remove unsupported confidence semantics.

### Phase B — private invited-panel product

6. **`feat(db): add projects suites cases and runs`**
   Add new migrations and authorization-tested services; do not rewrite migrations `0000`–`0006`.

7. **`feat(workspaces): add client teams and governance`**
   Add member invitations, consultant/end-client roles, client isolation, decision owners, DPA/trader fields, retention defaults, and cost centers.

8. **`feat(privacy): encrypt artifacts and audit access`**
   Add authenticated uploads, encrypted object storage, separate key domains, salted commitments, assignment leases, read/export logs, and retention/deletion jobs. Remove confidential payloads from the public quote path.

9. **`feat(audience): add cohorts invitations and assignments`**
   Implement invited, network, hybrid, and sandbox sources; hashed single-use codes; account-bound redemption; quotas; capacity reservations; confidentiality acceptance; and assignment-only content access.

10. **`refactor(eligibility): separate access assurance and paid compliance`**
   Replace the single identity tier record with capability evidence, split all country meanings, isolate DAC7/provider key domains, and keep paid eligibility before vouchers.

11. **`feat(runs): orchestrate blinded evaluation suites`**
    Implement CSV/JSON import, artifact variants, deterministic checks, randomization, frozen rubrics/pass rules, case-to-round orchestration, reruns, and aggregate state.

12. **`feat(rater): complete assigned human reviews`**
    Build invitation entry, renderer-safe A/B tasks, rubric tags/rationales, response commitments, qualification/practice, queue recovery, failure copy, notifications, receipts, and appeals.

13. **`feat(evidence): add decision packets and offline verification`**
    Derive measured fields from Ponder/chain and assignment/issuer snapshots; add signed manifests, reasons/disagreement, limitations, settlement links, private exports, recompute tooling, and separate client sign-off.

14. **`feat(buyer): build projects runs and quality loops`**
    Replace `/ask` with templates, suite editor, reviewer preview, cohort composer, funding review, phased waiting room, project/run history, result comparison, retention controls, and recurring runs.

### Phase C — external network and integrations

15. **`feat(identity): add a World ID 4 assurance adapter`**
    Add backend RP signing/verification, account/context binding, session continuity, Proof of Human and passport capability mapping, and provider replay/outage tests. Keep Selfie Check beta/legacy-gated and Identity Check behind confirmed production access.

16. **`feat(identity): add optional Self document predicates`**
    Only after procurement and conversion tests justify it, add backend verification for minimum-age/document/country predicates. Minimize disclosure; add no Self/Celo dependency to `TokenlessPanel`.

17. **`feat(pipeline): automate settlement receipts and webhooks`**
    Replace the manual operator-input publication path with a deployment-pinned worker, deterministic analytics, signed webhook delivery, rater earnings, buyer/rater notifications, and retry/alerting.

18. **`feat(mcp): restore privacy-safe agent handoffs`**
    Add a fresh tokenless MCP adapter rather than reviving the legacy tool graph. Expose exactly capabilities, create browser handoff, handoff status, and result. Keep quote, ask, payment, upload, and bounded wait in the browser or authenticated API. Bundle a Codex skill that requires explicit approval of the exact outbound public, synthetic, or safely redacted payload. The hosted MCP processes that approved payload without persisting it and returns a bearer URL whose fragment holds the draft through browser review. The browser stores the reviewed question and panel terms only when the user requests an exact quote, and submits the ask only through a second explicit action. Keep sandbox output explicitly simulated. Do not expose private artifact upload until owner/admin approval has server-recorded provenance and an access-log event.

19. **`feat(integrations): expose authenticated assurance runs`**
    Add project/run endpoints, owner-approved artifact uploads, batch status/results, signed webhooks, OAuth for interactive MCP clients, scoped API keys for server integrations, and examples for one eval platform and one consulting workflow. A workspace may preauthorize bounded audience, budget, classification, and retention policies; otherwise submission continues through the browser handoff.

20. **`docs(marketing): reposition every public surface`**
    Update landing, navigation, docs, metadata, manifests, static AI files, OG assets, promo video, examples, and snapshots. Remove “Level Up Your Agent,” AI-rater, Reputation, generic-question, and unsupported privacy claims.

21. **`feat(compliance): close B2B money and data controls`**
    Add trader/VAT gating, funder screening/geoblocking, invoices and reconciliation, German legal furniture, DPA/subprocessors, notice/action, retention/export, KMS roles, rate limits, monitoring, and continuity runbooks.

22. **`test(e2e): verify human-assurance golden paths`**
    Cover invited unpaid, invited paid, external paid, hybrid, confidential artifact, provider failure, quota race, replay, no-post-commit cancellation, failed quorum compensation, evidence verification, deletion, and access-log review in CI.

23. **`chore(deploy): publish a fresh isolated tokenless stack`**
    Deploy the final contract set once, regenerate addresses/ABIs, migrate isolated Postgres, update Ponder/keeper/app atomically, run live smoke journeys, and verify `origin/main` and `rateloop.ai` did not move.

## Product-market-fit gates

Do not treat completion of the commits as PMF. Use these evidence gates:

### Before commit 15 (identity-provider expansion)

- At least 5 paid workflow pilots across at least 3 organizations.
- At least 2 partners reuse the same suite/run/report model for a second client or workflow.
- At least 50% of completed pilots schedule or buy a second run within 60 days.
- Buyers can explain the decision packet's value without leading with blockchain or tokenless technology.
- Invited-review conversion and completion identify whether Base Account onboarding is acceptable.

### Before broad RateLoop-network recruitment

- Three repeatable cohort definitions have signed demand and known fill-time/cost.
- A clear buyer preference exists for independent external reviewers versus customer-selected reviewers.
- The prediction mechanism beats or justifies itself against equal-pay voting on completion, reliability, manipulation, and buyer comprehension.
- Private-artifact, assignment, evidence-verifier, and paid-eligibility threat models have passed internal red-team tests.

### Primary metrics

- paid pilots and repeat paid runs, not sign-ups;
- time from frozen manifest to decision packet;
- cost per valid case and cohort fill time;
- invite -> assignment -> valid response conversion;
- inter-rater reliability, invalid rate, and rationale usefulness;
- percentage of results that change or document a real `go/revise/stop` decision;
- suite reuse across releases and, for partners, across client-isolated projects; and
- buyer trust in provenance/evidence versus a conventional database report.

## Things not to build yet

- a consumer-funded general polling marketplace;
- white-label/reseller administration before a partner repeats paid client work;
- broad expert marketplaces or regulated-review claims;
- a public artifact gallery or public rationales;
- a universal cross-provider identity graph;
- exact country/name/date-of-birth collection when a predicate or customer invitation is enough;
- multi-chain identity or settlement contracts;
- an unpaid-run evidence-anchor contract without demonstrated buyer demand; or
- a new scoring mechanism presented as truth or statistical confidence before benchmarking.

## Verification and release gates

- Unit/property tests for schemas, policy canonicalization, authorization, token replay, quota races, encryption boundaries, retention, and evidence recomputation.
- Foundry invariants for conservation, admission-policy equality, issuer inability to affect accepted commits, no post-commit cancellation, and every terminal payout path.
- Browser E2E for the buyer, invited reviewer, external paid reviewer, hybrid report, failure, deletion, and recovery journeys.
- Privacy review using realistic confidential artifacts; verify no content or identifying cohort fields reach logs, analytics, webhooks, chain data, or unauthorized raters.
- Provider contract/DPA/security/commercial review and measured completion before a provider becomes a default.
- A fresh Base Sepolia deployment only after all fund-core changes, with app, Ponder, keeper, generated package, and database updated under one deployment key.
- Real-money gates in the [readiness assessment](tokenless-production-readiness-2026-07.md) remain controlling, followed by external contract/privacy review and the final isolated deployment.

## Research basis

- [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/) calls for context-relevant evaluation, documented measures, human oversight, relevant users/domain experts, and independent assessment where appropriate.
- [NIST Generative AI Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence) reinforces lifecycle evaluation rather than a one-time generic model score.
- [World ID credential configuration](https://docs.world.org/world-id/idkit/credentials) documents World ID 4 Proof of Human and passport presets, a legacy Selfie Check path while v4 support rolls out, preview Identity Check attributes, and optional fresh presence.
- [World ID NFC credentials](https://docs.world.org/world-id/credentials/9303) provide document-level uniqueness, with coverage and authentication strength varying by document/country.
- [World ID 4 migration](https://docs.world.org/world-id/4-0-migration) separates one-time uniqueness proofs from continuity sessions and changes backend verification/state handling.
- [Self disclosures](https://docs.self.xyz/use-self/disclosures) support minimum-age, excluded-country, OFAC, and optional document disclosures while recommending data minimization.
- [Self backend verification](https://docs.self.xyz/backend-integration/selfbackendverifier-api-reference) can validate document proofs and bind a UUID or hex identifier without adding Self verification to RateLoop's Base fund core.
