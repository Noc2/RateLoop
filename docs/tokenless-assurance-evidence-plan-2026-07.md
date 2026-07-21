# Assurance-evidence layer — capability and website plan (July 2026)

**Status:** implementation record for recommendation R1 of the
[enterprise analysis](tokenless-enterprise-analysis-2026-07.md): position RateLoop as the
**assurance-evidence layer** — independent, tamper-evident evidence of sampled human review of AI agent
outputs — with an explicit compliance map, while never claiming to be EU AI Act Article 14 oversight itself.
The [design of record](tokenless-immutable-implementation-plan-2026-07.md) controls product and architecture
decisions; the [production-readiness register](tokenless-production-readiness-2026-07.md) remains the only
release checklist. The code paths and tokenless-only test UI described below are implemented on this branch. Public
production claims remain fail-closed until the corresponding capability is deployed and exercised; a tokenless preview
is not production evidence. Research inputs are cited inline (web research current as of 2026-07-16; repository facts
re-verified against this branch after implementation).

## 1. The positioning, stated exactly

**The claim RateLoop makes:** RateLoop produces independent, tamper-evident, independently verifiable
evidence that a defined human-review policy operated over an AI agent's eligible outputs. The combined packet,
coverage, audit, and settlement evidence records who was asked, the frozen policy and trigger, privacy-safe outcomes and
disagreement, available cost/settlement references, and how review coverage adapted, in formats a customer's auditors,
regulators, insurers, and GRC tooling can consume. No single packet is claimed to contain every field from that combined
evidence set.

**What RateLoop never claims:** to independently verify that the reported model produced an output. RateLoop records
the model identity reported by the connected host for each execution and labels it host-reported. RateLoop neither
claims to make anyone "compliant" by itself nor markets SOC 2 / ISO / HIPAA / residency attestations it does not hold
(per the readiness register). On Article 14/26 human oversight the framing is shared responsibility, per the
[human-oversight plan](tokenless-human-oversight-plan-2026-07.md): oversight is performed by the deployer's
own natural persons with "competence, training and authority"
([official Article 26 text](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-26)) — in the invited
lane those persons are the customer's personnel, and RateLoop is the instrument they use to monitor,
interpret, override, and stop, plus the evidence of each step. RateLoop itself is never the oversight, and
the anonymous public network does not by itself discharge Article 26(2).

This split is not defensive fine print — it is the sales pitch. Auditors reject policy-only oversight and ask
for operating evidence: intervention/override logs, escalation-trigger definitions, reviewer competence
records, and adherence metrics (ISO/IEC 42001 audit practice —
[MHM](https://www.mhmcpa.ca/blog/what-auditors-will-look-for-in-an-isoiec-42001-audit),
[Schellman](https://www.schellman.com/blog/iso-certifications/iso-42001-lessons-learned)); FINRA names
prompt/output logs, model-version tracking, and human-in-the-loop validation as effective practices
([2026 oversight report](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai));
NIST AI RMF MEASURE calls for override and adjudication statistics
([playbook](https://airc.nist.gov/airmf-resources/playbook/measure/)). RateLoop's decision packets are the
product's direct response to those evidence needs. Its intended differentiation is to combine independent human panels,
deterministic recomputable adjudication, and externally witnessed tamper evidence; that is a product strategy, not an
exhaustive or permanent claim that no other product has comparable capabilities.

**Citation hygiene (corrects the enterprise analysis):** ISO/IEC 42001 human-oversight evidence is grounded
in the Annex A **A.6 lifecycle controls (incl. A.6.2.8 event logs) and A.9.2 responsible-use controls**;
"A.8.4 human oversight" is a vendor renumbering and must not appear in customer-facing material. EU AI Act
serious-incident reporting is **Article 73** (not 79). Deployer log retention is **≥ 6 months**
(Art. 26(6)) only for automatically generated high-risk-system logs under the deployer's control, subject to other
applicable law. Following the 2026 political agreement on the Digital Omnibus, the Commission reports that relevant
stand-alone high-risk-system rules apply from **2027-12-02**
([Commission timeline](https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-high-risk-systems)).

## 2. What exists today (re-verified after implementation)

Strong foundations — most of the evidence layer already exists and only needs to be made compliance-legible:

| Capability | State | Where |
| --- | --- | --- |
| Ed25519-signed assurance evidence packets (verdict, Merkle roots, frozen policy/manifest hashes, k-anonymized aggregation, settlement + chain references, limitations, recomputation inputs) | Exists | `lib/tokenless/evidencePackets.ts`, `/api/account/workspaces/{id}/assurance/runs/{runId}/evidence` |
| Offline packet verifier (same core as server) | Exists | `scripts/verify-assurance-evidence.mjs`, `scripts/assurance-evidence-core.mjs` |
| Signed human-review gate evidence + published trusted keyring (records RateLoop's blocked/released gate state; host enforcement is not independently proven) | Exists | `lib/tokenless/humanReviewGateEvidence.ts` (`rateloop.stop-gate-trusted-keys.v1`) |
| Hash-chained workspace audit log with integrity-checked export | Exists | `lib/privacy/audit.ts`, `/api/account/workspaces/{id}/audit/export` (`rateloop-audit-v1`) |
| Source-derived on-chain round evidence, deterministic RBTS recomputation, published results | Exists | `lib/tokenless/transparency.ts`, Ponder tables |
| Adaptive-coverage observations (agreement, comparability, latency, cost per scope) | Exists with canonical tenant export and offline-retention basis | `lib/tokenless/adaptiveReviewEvidence.ts`, `lib/tokenless/adaptiveCoverageExport.ts`, `/assurance/coverage/export` |
| Execution provenance (models, tokens, timing, tool spans) | Exists, **host-reported, `independentlyVerified:false`** | `lib/tokenless/agentExecutionProvenance.ts` |
| Audit-chain offline verifier CLI | Exists | `scripts/verify-audit-export.mjs` |
| Workspace assurance metrics | Exists with scoped scrape credentials, app summary, and downloadable Grafana JSON | `lib/tokenless/assuranceMetrics.ts`, `EvaluationDashboardPanel` |
| DSSE/Rekor/RFC 3161 external witnessing | Implemented with a managed AWS KMS Ed25519 runtime; **not a public live claim until provider exercise** | `assuranceAttestation*`, `verify-assurance-attestation.mjs` |
| SIEM, S3 Object Lock, Vanta/Drata-style GRC, and OTLP integrations | Implemented; **individual provider/customer exercise gates remain false** | `assuranceEventStreaming.ts`, `assuranceWormExports.ts`, `assuranceGrcConnectors.ts`, `otlpTraceIngest.ts` |
| Automated-eval escalation and labeled-result exchange | Exists for Promptfoo, NeMo Guardrails, Inspect, and Langfuse | `automatedEvalReceipts.ts`; `packages/agents/src/automatedEval.ts`, `promptfooAutomatedEval.ts`, `inspectAutomatedEval.ts`, `langfuseHumanLabels.ts` |
| Public trust/limitations page | Deliberately removed; register forbids a trust-status page | readiness register |

Honesty constraints that shape everything below: the managed external-witness signer exists, but provider configuration
and exercise are still open production gates; the primary packet signer remains a distinct service role covered by the
broader managed-signing readiness item; the paid path is not yet connected to settlement end-to-end; and provenance
stays host-reported unless a gateway or provider attestation changes that. The marketed unit is the *review evidence*,
not verified model provenance.

## 3. Capability plan (before any website change)

Three phases, ordered so each ships value alone. Open-source choices follow the licensing rule: only
Apache-2.0/MIT/spec-level components are embedded; AGPL (Grafana core, CISO Assistant), Elastic 2.0 (Phoenix
server), BSL (immudb), and Llama-license artifacts are integration targets at most, never embedded.

### Phase E1 — make existing evidence compliance-legible (no new trust machinery)

1. **Decision-packet field completion.** Add to the evidence-packet schema (new schema version): the
   sampling/escalation trigger that caused review (`adaptive_sample`, `critical_risk`, `maximum_gap`,
   `owner_required`, guardrail escalation — auditors ask for documented escalation triggers *operating*);
   the exact policy/profile versions in force (hashes already exist — surface them as fields); reviewer
   qualification-tier counts alongside the existing `customer_invited`/`rateloop_network` provenance counts;
   gate type (`blocking` vs `advisory`, from the stop-gate evidence); and period coverage/latency statistics.
   This is field-by-field alignment with the ISO 42001 / FINRA / NIST MEASURE evidence lists.
2. **Adaptive-coverage export endpoint.** A tenant export (`…/assurance/coverage/export`) mirroring the audit
   export: per scope, the observation series, window outcomes, stage transitions (100→50→25→10%), and current
   forced-review rules — the "reviewer adherence metrics" auditors sample. This closes the one obvious gap in
   an otherwise complete evidence chain.
3. **Audit-chain offline verifier.** Extend the existing verifier-CLI pattern to the audit export (recompute
   the sha256 chain and head). Cheap, and it upgrades "tamper-evident" from a server claim to a
   customer-checkable property, matching the evidence-packet story.
4. **Retention controls.** Configurable workspace evidence/log retention with a product floor of 6 months, defaulting
   longer; document the retention basis in the export header. The floor can support a customer that must retain
   deployer-controlled high-risk-system logs under EU AI Act Art. 26(6), but does not determine whether that rule applies
   or replace the customer's legal schedule. Scheduled
   enforcement prunes due private artifact content and access logs unless a legal hold applies. It preserves
   non-decryptable artifact digests, signed packets, external-witness/WORM receipts, and the canonical audit chain so
   deleting content cannot silently rewrite integrity history.
5. **The compliance map itself** (a docs artifact, §5): RateLoop evidence artifacts ↔ ISO/IEC 42001 A.6/A.9.2
   evidence expectations, EU AI Act Art. 12/26(5–6)/72/73 record-keeping, NIST AI RMF MEASURE/MANAGE, FINRA
   24-09 / Rule 3110 supervision records, SEC 17a-4 audit-trail-alternative. Written with the exact
   non-claims from §1, and kept in lockstep with deployed reality (readiness-register discipline). Track
   **prEN 18229-1** (CEN-CENELEC JTC 21 "logging, transparency and human oversight", publishing ~2026) and
   the Art. 72/73 Commission templates; align the export schema to prEN 18229-1 when its text stabilizes,
   since it may later support presumption-of-conformity evidence if adopted and cited. The maintained
   [standards watch](tokenless-assurance-standards-watch-2026-07.md) records current draft/template status, re-check
   triggers, and the required schema-change procedure.

### Phase E2 — independent verifiability and enterprise plumbing

6. **Attestation wrapping (in-toto/DSSE + Sigstore).** Wrap each evidence packet and each audit/coverage
   export head as an in-toto attestation with a RateLoop predicate type
   (`https://rateloop.ai/attestation/review-verdict/v1`), signed by a managed Ed25519 key and logged to a
   **Rekor** transparency log with cosign-compatible DSSE semantics. Serverless publication uses the Rekor API directly
   and locally verifies the signed entry timestamp and inclusion proof. Add an **RFC 3161 timestamp** countersignature on
   export batch boundaries. Source-derived Base settlement references are not an anchor for the packet or export digest;
   Rekor inclusion and the TSA token are the external witness evidence. Present that evidence as "externally witnessed"
   only after the managed runtime is exercised, and never collapse settlement references and artifact witnessing into a
   generic "blockchain" claim.
7. **Assurance metrics endpoint.** Prometheus/OpenMetrics per workspace (reviews requested/completed,
   sampling rate by scope, verdict latency, disagreement rate, blocked/approval-required counts,
   evidence-anchor lag), token-gated like the keeper's endpoint. Ship **Grafana dashboard JSON** as an
   artifact (never embed Grafana — AGPL).
8. **Event streaming for SIEMs.** CloudEvents-wrapped webhooks (`ai.rateloop.review.completed`,
   `ai.rateloop.packet.anchored`, `ai.rateloop.gate.blocked`, …) with an **OCSF Compliance Finding mapping**
   so Splunk/Datadog/Security Lake ingest without custom parsers. Every event carries a typed evidence digest and audit
   chain reference. Completed/anchored events carry a decision-packet digest; a pre-run blocked gate carries its
   append-only lifecycle-transition commitment and must not pretend that a decision packet exists.
9. **17a-4/WORM export target.** An S3 Object-Lock-compatible delivery option for exports plus a short
   supervision-report view (coverage of AI outputs, exceptions, escalations per period) for
   broker-dealer/RIA customers — the FINRA wedge identified in the enterprise analysis.

### Phase E3 — meet customers' existing stacks

10. **OTel GenAI ingest (dual-path with MCP).** An OTLP endpoint consuming OpenTelemetry GenAI semantic
    conventions (`invoke_agent`/`execute_tool` spans, `gen_ai.*` attributes, MCP conventions), so
    eligible-output detection and provenance can come from instrumentation customers already run
    (OpenLLMetry, OpenInference — both Apache 2.0) instead of bespoke reporting. Version-pin the semconv
    (still "Development" stability) behind a mapping shim. Honesty note: OTel traces are host-reported just
    like MCP metadata — no integrity upgrade, same labelling.
11. **Compliance-platform push.** The implemented Drata adapter posts deterministic per-workspace records through a
    customer-configured Custom Connection session; the customer must have the required entitlement, schema, monitor,
    and control association. The implemented Vanta path is a customer-owned Manage Vanta document-export connector, not
    a public partner app. Vanta public apps cannot create the customer's Custom Test/control mapping, and a marketplace
    app additionally requires vendor approval, Developer Console credentials, customer authorization, and review. Keep
    that public-app path externally blocked rather than adding OAuth machinery that cannot satisfy the control-mapping
    requirement. Credo AI policy-pack evidence and IBM watsonx factsheets remain later connector-pattern candidates.
12. **OSCAL component definition.** Ship the §5 compliance map additionally as a machine-readable OSCAL
    component definition (NIST AI RMF + ISO 42001 first) that customers import into GRC tooling; encode the
    review-policy semantics customers see as versioned, hashed artifacts referenced from every packet.
13. **Guardrails/eval escalation integrations.** RateLoop as the human tier above automated checks:
    a Promptfoo provider/assertion (MIT; absorbing the deprecated OpenAI Evals base), a NeMo Guardrails
    custom action (Apache 2.0) routing rail-uncertain outputs into the sampling queue, and Inspect (UK AISI,
    MIT) eval-log ingest as review-task bundles. Verdicts flow back as labeled data; optionally export
    verdicts as Langfuse scores (MIT core) for customers who live there.

### UI integration (workspace, not marketing)

- An **Evidence** tab per workspace/agent: list of packets with verdicts and anchors, one-click signed
  export, and copy-paste offline verification instructions (packet verifier, audit-chain verifier, Rekor
  lookup, TSA check); the trusted keyring surfaced with rotation history.
- The agents-page summary strip (from the human-review work in flight) gains one line: last evidence packet,
  coverage stage, anchor status.
- A **Compliance export** panel: audit + coverage export, retention setting, WORM/SIEM/Vanta/Drata delivery
  configuration, supervision-report view.
- Dashboards embed nothing external: metrics render in existing panels (`EvaluationDashboardPanel`), Grafana
  JSON is a download.

### Implementation ledger

| Plan item | Tokenless branch state | Production/public boundary |
| --- | --- | --- |
| E1.1 packet fields | Implemented: persisted manual/adaptive/critical/maximum-gap/policy-rule/guardrail trigger context, exact selection-policy/request-profile/audience/admission linkage, policy enforcement mode, lifecycle commitment, privacy-safe qualification categories, coverage, and latency | Qualification keys are categories, not a fabricated global tier hierarchy; host-enforcement policy is recorded but host blocking is not independently proven |
| E1.2 coverage export | Implemented and offline-checkable | Public flag remains false until deployed/exercised |
| E1.3 audit verifier | Implemented with optional independently pinned head | Public flag remains false until deployed/exercised |
| E1.4 retention | Implemented as versioned policy, export basis, legal-hold-aware scheduled pruning of private artifact content/access logs, and a durable enforcement ledger | Artifact digests, signed packets, attestations, WORM receipts, and the canonical audit chain are deliberately preserved; the workspace floor does not determine the customer's legal schedule |
| E1.5 compliance map/watch | Implemented in TSX, machine Markdown, OSCAL 1.2.2, and the maintained standards watch | Cross-reference only; never certification or legal advice |
| E2.6 external witness | Implemented with in-toto/DSSE, managed AWS KMS Ed25519, Rekor receipt verification, RFC 3161 verification, public digest-only bundle, and offline verifier | Rekor/TSA/provider exercise and the broader production managed-signing gate remain open; capability flags stay false |
| E2.7 metrics | Implemented with scoped credentials, OpenMetrics, app summary, anchor lag, and Grafana JSON | No embedded Grafana service |
| E2.8 SIEM | Implemented with CloudEvents v2, typed evidence references, OCSF, retries, and pre-run blocked events | No customer/provider exercise claim |
| E2.9 WORM | Implemented with integrity preflight, S3 Object Lock delivery, provider receipts, and supervision report | This is a delivery target, not a complete Rule 17a-4 recordkeeping system |
| E3.10 OTLP | Implemented with pinned mapping, host-reported provenance, review evaluation, and fail-closed scope ordering | No provenance-integrity upgrade; no public live claim |
| E3.11 GRC | Drata Custom Connection and customer-owned Vanta document delivery implemented | Vendor/customer prerequisites above remain external; both exercise flags stay false |
| E3.12 OSCAL | Implemented and generated deterministically | Mapping says `supports evidence for`, never `satisfies` |
| E3.13 eval escalation | Implemented for Promptfoo, NeMo Guardrails, Inspect, and Langfuse result/score exchange | Automated signals remain distinct from human verdicts |
| Workspace UI | Evidence Center, agent summary, metrics, retention, WORM, SIEM, GRC, packet/key/attestation downloads and explicit trust-pin verifier commands implemented | Non-managers see restricted/unknown anchor state, not false negatives |
| Public docs/landing | Evidence guide, machine mirror, cross-links, search entry, OSCAL download, and one design-preserving landing card implemented for tokenless testing | Main-only release gates and capability flags prevent promotion of unexercised claims; the optional larger landing section remains intentionally deferred |

## 4. Dependency and sequencing notes

- E1 is implemented. A packet for an agent-triggered run fails closed when its persisted policy/profile/lifecycle linkage
  is incomplete; a manual run is labeled `owner_required` and `not_applicable` rather than assigned a fake stop gate.
- E2.6 code uses managed KMS custody for the external witness. Do not turn on public Rekor/RFC 3161 claims until the
  configured providers, published keys, rotation/recovery path, and offline verification have been exercised. The
  primary packet signer remains part of the broader managed-signing readiness gate.
- E2.9 and E3.11 emit only the settlement references actually present. Paid-path claims remain gated on the readiness
  register's complete settlement exercise.
- E3.10 pins the unstable OpenTelemetry mapping behind `rateloop.otlp-review-attributes.v1`; changing upstream semantic
  conventions requires a new mapping version and fixtures.
- Tokenless docs/UI are available for isolated testing. Main deployment preflight and public capability flags remain the
  release boundary; a branch deployment does not turn a capability into a public production claim.

## 5. Website plan (docs + landing) — after capabilities, claims-gated

Constraints honored: the register forbids a public trust-status page (removed deliberately); the established
design stays unchanged (black rail, mono section labels, gradient headline words, surface cards); every
public claim must match the deployed system exactly.

### Docs (implemented; the substance lives here)

1. **New TSX docs page `/docs/evidence`** ("Evidence & Compliance Mapping"), added to `DOCS_NAV` in
   `constants/docsNav.ts`, structured as: what an evidence packet contains (field walk-through with a
   redacted example); how to verify independently (four checks: Ed25519 signature against the published key,
   Merkle/recomputation, source-derived settlement references where present, Rekor/TSA witness evidence once exercised);
   the compliance map table (artifact ↔
   ISO 42001 A.6/A.9.2 · EU AI Act Art. 12/26/72/73 · NIST AI RMF MEASURE/MANAGE · FINRA 24-09 · 17a-4)
   with correct citations; and a prominent **"What this is not"** box (the §1 non-claims, verbatim). The box
   was later replaced by the shared-responsibility matrix per the
   [human-oversight plan](tokenless-human-oversight-plan-2026-07.md) O2.1; the remaining true non-claims stay
   as ordinary factual sentences. This is product documentation of exact behavior — permitted and expected —
   not a trust-status page.
2. **Machine-doc mirror** `public/docs/evidence.md` for agent consumption, linked from the connection-intent
   documentation pointer like `agent-connection.md`.
3. **Cross-link updates:** the existing "5. Evidence, not an automatic decision" section of
   `/docs/how-it-works` links to the new page; `/docs/smart-contracts` gains a short "what settlement
   evidence proves (and what it does not)" pointer; the SDK docs document the export endpoints and verifier
   CLIs.

### Landing page (selective, design-preserving)

4. **Implemented:** one new `whyItWorksFeatures` card in section 03 ("Why It Works"): *"Evidence your auditors can
   check"* — tracing review policy, human judgments, coverage, and available settlement references — chip-linking to
   `/docs/evidence`. This deliberately narrower copy does not imply that production signing or offline-verifier
   capability gates have passed. The card was later retitled *"Human oversight, operationalized"* with the
   shared-responsibility line and a `/docs/human-oversight` chip, per the
   [human-oversight plan](tokenless-human-oversight-plan-2026-07.md) O2.3.
5. **Intentionally deferred:** a dedicated section ("0X — Evidence, Not **Trust**") between How-It-Works and
   Why-It-Works using the existing card/rail idiom: three cards — *Decision packets* (signed, recomputable),
   *Tamper-evident by construction* (hash chain + external anchors), *Fits your compliance stack*
   (exports, metrics, GRC/SIEM connectors). Add one FAQ entry: "Can I use RateLoop evidence in an audit?" —
   answered with the §1 claim/non-claim split.
6. **Copy gates.** Each phrase has a capability precondition, register-style. The flags mean deployed and exercised on
   the production line; they therefore remain false after an isolated tokenless deployment:

   | Public phrase | May ship when |
   | --- | --- |
   | "Signed decision packets you can verify offline" | Managed evidence signing, published signing-key history, and the offline packet verifier deployed and exercised |
   | "Escalation triggers and coverage statistics in every packet" | E1.1–E1.2 deployed |
   | "Verify our audit exports yourself" | E1.3 shipped |
   | "Independently witnessed (transparency log / RFC 3161)" | E2.6 + managed signing |
   | "Feeds Vanta/Drata/your SIEM" | E2.8/E3.11 live with a real customer exercise |
   | "Works with your OpenTelemetry instrumentation" | E3.10 deployed |
   | Any "compliance-ready/certified" wording | Never (claims-match rule) |

## 6. Risks and guardrails

- **Overclaiming is the existential risk of this positioning.** The mitigations are structural: the full "What this is
  not" boundary appears wherever evidence behavior is explained in public docs; compact surfaces link to it instead of
  repeating legal copy; packet `limitations` and `source.independentlyVerified` fields stay load-bearing; and the
  copy-gate table above is enforced across the public app, its transitive reusable components, and machine docs alongside
  the readiness register.
- **Provenance honesty:** host-reported execution metadata is never marketed as verified model provenance;
  an integrity upgrade would require a gateway/proxy pattern or provider attestation — out of scope here.
- **Standards drift:** OTel GenAI semconv is pre-stable (pin + shim); prEN 18229-1 and the Art. 72/73
  templates will reshape the export schema — schedule a re-check when each publishes.
- **License discipline:** embedded = Apache-2.0/MIT/spec only; AGPL/ELv2/BSL/Llama-licensed tools remain
  external integration targets (documented in §3).
- **Key custody before publicity:** no "independently witnessed" copy until the managed external-witness signer,
  Rekor, TSA, published trust anchors, and recovery/rotation path are exercised together. The primary packet signer
  remains a separate managed-signing readiness item.

## 7. Summary

The AI-implementable E1–E3 paths are now present on `tokenless`, including offline verification, retention enforcement,
external-witness adapters, metrics, SIEM/WORM delivery, OTLP ingest, OSCAL, GRC export paths, automated-eval escalation,
and the Evidence Center. The remaining work is external proof: managed-role review, real provider/customer exercises,
complete paid settlement, and production release approval. One docs page carries the substance, one landing card carries
the message, and every production claim remains gated on deployed and exercised reality.
