# Tokenless completion verification — 26 July 2026

This document records the implementation and release truth for
[`tokenless-completion-plan-2026-07-25.md`](tokenless-completion-plan-2026-07-25.md).
It is an engineering control record, not legal advice or a certification of GDPR compliance.

## Release position

- Private invited, unpaid review is available by default.
- Paid private and public-network code paths are implemented but default off. They become reachable only when the exact
  server and public activation flags, evidence-bound activation reference, deployment funding, provider, and compliance
  gates agree. Hybrid remains a reserved schema/foundation path and is deliberately non-activatable until production
  release, child-terminal, expiry, and refund producers exist.
- Production paid processing also requires immutable references to an approved blockchain DPIA and provider-transfer
  inventory. Missing or malformed references stop the request before assignment, publication, reservation, or spend.
- Public-chain processing must follow the necessity, minimisation, off-chain-data, rights, and DPIA controls in the
  [public-chain release gate](tokenless-gdpr-blockchain-dpia-gate-2026-07.md).
- No technical control in this repository substitutes for controller/processor role allocation, executed DPAs,
  current records of processing, transfer assessments, or counsel approval.

## Plan traceability

| Plan area | Implementation evidence |
| --- | --- |
| Phase 0 — deployment, routing, keeper, indexer, maintenance | `7c6381f52`, `20e051321`, `98240112e`, `5c0cc4257`, `7d3121976`, `bcaba95f9`, `39044fa67`, `bf6f2f89b`, `8f5e9feff`, `699f4d319`, `c633f9484`, `018a4bdad`, `91bb576ef`, `57b6c5f9b`, `0619f80ae`, `c8ef41484` |
| Phase 1 — reachable unpaid lane | `cbace5833`, `e56d307a4`, `346012c6a`, `295df93b4`, `b1a96c44f`, `a82bda175`, `31ebbe7cb`, `b1a79000c`, `8e146f326`, `743234249`, `c5f2e34c3`, `f914a5425`, `f33913c4b`, `ad8ab42e9`, `2992a65b1`, `2e734e685` |
| Eligibility redesign | `24f8c6383`, `77160db84` |
| Phase 2 — forms, capabilities, identity, correctness | `ee08eb1d7`, `e6994dfa4`, `07a9e3351`, `119fdb081`, `f5ca63e1d`, `ea04e7469`, `7282163c1`, `ab54aa1e6`, `279dd7986`, `126862ee6`, plus the Phase 0 keeper/indexer fixes above |
| Phase 3 — forecast integrity | `312c07235`, `e8e356ce4`, `d923396be`, `e936bff9f`, `7864fb73a`, `2780c8813`, `72be5d568`, `65b8c2171` |
| Phase 4 — rating, copy, forms, mobile | `a3d95cd54`, `94b08bd8f`, `6e513e1e3`, `8d9ac5cd4`, `a38d37023`, `ab54aa1e6`, `279dd7986`, `126862ee6`, `a82368591`, `d873ce4a7`, `aa7b413ff`, `5839328d9` |
| Phase 5 — recovery, earnings, paid/network/hybrid foundations | `60ad10013`, `d36fa992d`, `2ce58ac2b`, `6c66981ab`, `868b0b6af`, `94234a912`, `0286eb0ca`, `ee958c8de`, `101d690be`, `d7f0af62c`, `a594a99e5`, `76dda126b` through `ba8a116c8`, `abeda238c`, `3c07579f5`, `47533760a`, `01faf36c1`, `b9ff6af3e`, `025504947`, `a0f1f33d0`, `7a610b8ce`, `5839328d9` |
| Phase 6 — adaptive ladder | `9a93fe10d` |
| Claims and agent-host truth | `7282163c1`, `ba2a9b495` |
| Privacy and retention closure | `8a4b8f20a`, `9ef37c5db`, `2f900031d`, `d5ad70613`, `b3794cc29`, `d33dc59ef`, `90fdcb1c3`, `ee805b926`, `eda832e6c`, `6f8cbf93c`, `541c2dc57`, `3524a341e`, `1e24ca9b6`, `9e9be6af3`, `04d55f6f5`, `1f052b7cc` through `96f79bc24` |

### Point-level closure

| Plan point | Closure |
| --- | --- |
| 0.1 deployment secrets | Required by `7c6381f52`; production/test readiness checks fail closed. |
| 0.2 paid acceptance | `c633f9484` branches by compensation mode and requires the paid settlement preparation. |
| 0.3 capability truth | `018a4bdad`, `91bb576ef`, `c8ef41484`, `7282163c1`, and `ba2a9b495` make unavailable lanes absent or blocked across UI, protocol, host, and packaged agent claims. |
| 0.4 keeper starvation/scoring gate | `20e051321` and `0619f80ae`. |
| 0.5 maintenance isolation/retry | `bf6f2f89b`. |
| 0.6 hybrid policy emission | `8f5e9feff`. |
| 0.7 dead surfaces | `699f4d319`; superseded routes and empty route surfaces were removed. |
| 0.8 provider registration | External activation input; production preflight and capability gates prevent this being mistaken for completed deployment configuration. |
| 1.1 decision packet | `31ebbe7cb` projects terminal private-review evidence into the owner run/packet surfaces. |
| 1.2 agent-independent termination | `cbace5833` schedules deadline, audience, reservation, and inconclusive projection processing. |
| 1.3 reviewer notification | `e56d307a4`. |
| 1.4 delivered invitations | `346012c6a` adds canonical URLs and email delivery. |
| 1.5 reviewer membership | `346012c6a`, `ad8ab42e9`, `2992a65b1`, and `2e734e685` bind canonical setup invitations to same-ID hidden private-group provenance, create or restore exact membership on redemption, revoke it with reviewer access, and prove expiry, replay, wrong-recipient, removal, and unrelated-group denial. |
| 1.6 draft survival | `295df93b4`. |
| 1.7 settings/second agent/API credentials | `b1a96c44f`, `b1a79000c`, and `8e146f326`. |
| 1.8 route behavior tests | `a82bda175`, `743234249`, `c5f2e34c3`, `f914a5425`, and `f33913c4b`; touched rater, reviewer, assignment, event, and compliance handlers are executed with authenticated success and denial paths. |
| 2.1 validation primitives | `e6994dfa4`, `07a9e3351`, `119fdb081`, `f5ca63e1d`, and `ea04e7469`. |
| 2.2 capability registry/claims sweep | `7282163c1` and `ba2a9b495`. |
| 2.3 explicit evidence identity | `ee08eb1d7`. |
| 2.4 keeper/indexer correctness | `98240112e`, `5c0cc4257`, `7d3121976`, `57b6c5f9b`, `bcaba95f9`, and `39044fa67`. |
| 3.1–3.4 statistics, detectors, appeals | `d923396be`, `e936bff9f`, `7864fb73a`, `ee805b926`; only bounded accumulators are retained, payout effect is none, and open appeals suspend consequences. |
| 3.5 explicit forecast | `e8e356ce4`; the control is mandatory because the accumulator and detector shipped with it, and it starts unset. |
| 3.6 provenance rename | `ee08eb1d7`; finalized evidence uses `assignmentProvenanceGapBps`. |
| 4 rating/receipt/copy/mobile | `94b08bd8f`, `119fdb081`, `8d9ac5cd4`, `a3d95cd54`, `a38d37023`, `ab54aa1e6`, `279dd7986`, `126862ee6`, `a82368591`, `d873ce4a7`, `aa7b413ff`, and `5839328d9`; the desktop and Pixel 7 journeys exercise funded-task acceptance, real private routing provenance, exact private artifacts, accessible heading order, responsive media, failed mobile sharing, successful recovery confirmation, and current visual baselines. |
| 5.1 recovery | `60ad10013` provides authenticated self-reveal/claim status and recovery transaction material without accepting preimages server-side. |
| 5.2 earnings | `d36fa992d`. |
| 5.3 paid/network/hybrid foundations | Eligibility, terminal settlement, frozen network selection, integrity epochs, durable public-network bindings, two-round hybrid foundations, invited-wins exclusions, and retention/erasure are in the Phase 5 commits above. Private-paid and public-network lanes default false and have evidence-bound activation gates. Hybrid is not activatable because its production release, child-terminal, expiry, and refund producers are incomplete. `a0f1f33d0` and `7a610b8ce` prove the ask/foundation ordering and no-specialist network path in the reachable adaptive flow. |
| 6 adaptive ladder | `9a93fe10d` ships the 25% floor/cap, periodic recalibration, corrected reset ordering, observed agreement, and the honest default/recommended labeling. |

## GDPR-by-design controls

The control design follows the final [EDPB Guidelines 02/2025 on processing personal data through blockchain
technologies](https://www.edpb.europa.eu/documents/guideline/guidelines-on-processing-of-personal-data-through-blockchain-technologies_en)
and the [official GDPR text](https://eur-lex.europa.eu/eli/reg/2016/679/oj). In particular, public-chain use is
necessity-gated, application data remains off-chain where possible, immutable evidence is commitment-based, and
data-subject rights are implemented against the authoritative off-chain records.

| Control objective | Repository control |
| --- | --- |
| Lawful, bounded public-chain use | Paid-lane compliance gate and public-chain DPIA release checklist; personal data stays out of immutable evidence by default |
| Transparency | Updated privacy notice, cookie notice, DPA, subprocessor register, forecast disclosure, pre-commit public-record disclosure, and post-submit receipt |
| Data minimisation | Lane-specific eligibility, no document/biometric requirement, privacy-bounded running forecast statistics, pseudonymous integrity epochs, and bounded reviewer exports |
| Access and portability | Expanded data-subject export with category manifest and explicit unavailable/withheld categories |
| Erasure | Account/workspace deletion processors cover product identities, access grants, assignments, forecast subjects, and reservation release with zero-postcondition checks |
| Retention | Scheduled category expiry plus operational retention runbook; expired notifications and recovery artifacts are bounded and retryable |
| Accuracy and contestability | Reviewer counters, append-only findings, appeals, and suspension of eligibility consequences while an appeal is open |
| Integrity and confidentiality | Encrypted private artifacts, assignment-bound leases, non-mutating audit export, secret/key preflight, historical HMAC-key retention, and fail-closed key rotation |
| Processor governance | Published DPA and subprocessor register; analytics without a disclosed processor was removed |
| Automated decisions | Forecast signals have `payoutEffect: "none"` and do not enter adaptive scoring arithmetic; material consequences are explainable and appealable |

## Open-decision disposition

| Plan decision | Disposition |
| --- | --- |
| D1 invited-paid adulthood | Remains an owner/counsel activation decision. The lane is fail-closed; an invitation-side adulthood attestation cannot be misrepresented as independently verified age. |
| D2 network panels on test deployment | The former unconditional prohibition is replaced by a bounded permission. Default-off succeeds; activation succeeds only with matching server/public flags, production World ID registration, funded-deployment evidence, compliance/adulthood evidence where applicable, and the derived public activation reference. |
| D3 adaptive floor | Resolved at 25%, with a cap and periodic recalibration block (`9a93fe10d`). |
| D4 funded-workspace deletion | Resolved as verified refund-before-erasure, never forfeiture (`8a4b8f20a`); the same deletion request resumes after the external refund reference is recorded. |
| D5 sanctions latency | Manual and pluggable screening is represented as an asynchronous pending state; paid admission fails closed until a clear decision and list-snapshot evidence exist. |
| D6 subject-request route | Access/export are fulfilled through bounded authenticated downloads. Unsupported self-service types are rejected without creating a request or due date and are directed to the published manual channel (`9e9be6af3`). |
| D7 `forecastRequired` | Kept mandatory because the accumulator, low-effort detectors, appeal path, and explicit unset/touched control shipped together. |
| D8 paid copy | Claims are tied to the capability registry and pre-commit/receipt disclosures; disabled lanes are not advertised as available. |

## Activation gates that code cannot satisfy

The following are release inputs, not unfinished repository work:

1. Complete and approve the blockchain DPIA and international/provider transfer inventory, then configure their
   `sha256:` references and approval timestamp.
2. Execute the required DPAs and transfer assessments for the providers actually enabled in a deployment.
3. Register and validate the World ID application before enabling network reviewer identity.
4. Fund and validate the exact Base Sepolia USDC settlement path. A live Stripe secret is rejected on the test
   deployment.
5. Record the owner/counsel decision for invited-paid adulthood and the selected sanctions-screening operating model.
6. Configure delivery credentials such as Resend and verify the resulting operational alerts and invitation delivery.
7. Enable network and integrity-producer flags only after the above gates and their runbook checks pass.

Paid-lane deployment activation uses these exact controls:

- `TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED` and `TOKENLESS_NETWORK_PANELS_ENABLED`, with matching `NEXT_PUBLIC_`
  flags. Hybrid server/public flags must remain false.
- `TOKENLESS_PAID_LANES_DPIA_APPROVAL_REFERENCE`,
  `TOKENLESS_PAID_LANES_TRANSFER_INVENTORY_APPROVAL_REFERENCE`,
  `TOKENLESS_PAID_LANES_FUNDING_VALIDATION_REFERENCE`, and
  `TOKENLESS_PAID_LANES_COMPLIANCE_APPROVED_AT`.
- `TOKENLESS_INVITED_PAID_ADULTHOOD_APPROVAL_REFERENCE` for private-paid activation.
- `NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE`, derived from the exact server-side bundle.

## Verification

The final release candidate must have a clean worktree and pass:

```text
yarn workspace @rateloop/nextjs test
yarn workspace @rateloop/nextjs check-types
yarn workspace @rateloop/nextjs lint --max-warnings 0
yarn test:packages
yarn foundry:test
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/rateloop_e2e \
  yarn workspace @rateloop/nextjs e2e
```

The checked migration journal terminates at `0148_subject_export_v4.sql`.

### Recorded results

| Check | Result |
| --- | --- |
| Next.js test suite | 1,908/1,908 passed |
| Cross-package suite | Passed: contracts 9, node utilities 11, SDK 38, agents 118, keeper 84, Ponder 51, promo 2, Next.js 1,908; package type checks passed |
| Foundry suite | 77/77 passed, including fuzz and invariant tests |
| Browser suite | 8/8 passed across desktop Chromium and Pixel 7/mobile Chromium, including axe and visual checks |
| Strict Next.js lint | Passed with zero warnings |
| Next.js type check | Passed |
| Change-integrity check | `git diff --check` passed |

The Playwright development server emitted existing non-failing warnings for the locally installed Node 26 runtime
(the repository supports Node 24), optional `pino-pretty`, and third-party `ox` dynamic imports. No test or build check
failed because of those warnings.
