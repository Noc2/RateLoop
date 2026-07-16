# Assurance-evidence layer — capability and website plan (July 2026)

**Status:** focused plan for recommendation R1 of the
[enterprise analysis](tokenless-enterprise-analysis-2026-07.md): position RateLoop as the
**assurance-evidence layer** — independent, tamper-evident evidence of sampled human review of AI agent
outputs — with an explicit compliance map, while never claiming to be EU AI Act Article 14 oversight itself.
The [design of record](tokenless-immutable-implementation-plan-2026-07.md) controls product and architecture
decisions; the [production-readiness register](tokenless-production-readiness-2026-07.md) remains the only
release checklist, and its rule applies to every item here: nothing below reaches the website until the
capability is deployed and exercised. Research inputs are cited inline (web research current as of
2026-07-16; repository facts verified against this branch).

## 1. The positioning, stated exactly

**The claim RateLoop makes:** RateLoop produces independent, tamper-evident, independently verifiable
evidence that a defined human-review policy operated over an AI agent's eligible outputs — who was asked,
under which frozen policy and trigger, what they answered, how much they disagreed, what it cost, and how the
review coverage adapted — in formats a customer's auditors, regulators, insurers, and GRC tooling can
consume.

**What RateLoop never claims:** to be the customer's EU AI Act Article 14/26 human oversight (oversight must
be assigned to the deployer's own natural persons with "competence, training and authority" —
[Article 26](https://artificialintelligenceact.eu/article/26/)); to verify what model actually produced an
output (execution provenance is host-reported and labelled so); to make anyone "compliant" by itself; or to
market SOC 2 / ISO / HIPAA / residency attestations RateLoop does not hold (per the readiness register).

This split is not defensive fine print — it is the sales pitch. Auditors reject policy-only oversight and ask
for operating evidence: intervention/override logs, escalation-trigger definitions, reviewer competence
records, and adherence metrics (ISO/IEC 42001 audit practice —
[MHM](https://www.mhmcpa.ca/blog/what-auditors-will-look-for-in-an-isoiec-42001-audit),
[Schellman](https://www.schellman.com/blog/iso-certifications/iso-42001-lessons-learned)); FINRA names
prompt/output logs, model-version tracking, and human-in-the-loop validation as effective practices
([2026 oversight report](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai));
NIST AI RMF MEASURE calls for override and adjudication statistics
([playbook](https://airc.nist.gov/airmf-resources/playbook/measure/)). RateLoop's decision packets are the
closest existing artifact to what those three lists demand; no competitor combines independent human panels,
deterministic recomputable adjudication, and externally anchored tamper evidence (competitive scan, §7 of the
research: Credo AI evidence is attestation-style; LangSmith/Langfuse export raw traces without framework
mapping or tamper evidence).

**Citation hygiene (corrects the enterprise analysis):** ISO/IEC 42001 human-oversight evidence is grounded
in the Annex A **A.6 lifecycle controls (incl. A.6.2.8 event logs) and A.9.2 responsible-use controls**;
"A.8.4 human oversight" is a vendor renumbering and must not appear in customer-facing material. EU AI Act
serious-incident reporting is **Article 73** (not 79). Deployer log retention is **≥ 6 months**
(Art. 26(6)); Annex III high-risk obligations apply from **2027-12-02** after the Digital Omnibus.

## 2. What exists today (verified on this branch)

Strong foundations — most of the evidence layer already exists and only needs to be made compliance-legible:

| Capability | State | Where |
| --- | --- | --- |
| Ed25519-signed assurance evidence packets (verdict, Merkle roots, frozen policy/manifest hashes, k-anonymized aggregation, settlement + chain references, limitations, recomputation inputs) | Exists | `lib/tokenless/evidencePackets.ts`, `/api/account/workspaces/{id}/assurance/runs/{runId}/evidence` |
| Offline packet verifier (same core as server) | Exists | `scripts/verify-assurance-evidence.mjs`, `scripts/assurance-evidence-core.mjs` |
| Signed human-review gate evidence + published trusted keyring (proof a human gate blocked/released an output) | Exists | `lib/tokenless/humanReviewGateEvidence.ts` (`rateloop.stop-gate-trusted-keys.v1`) |
| Hash-chained workspace audit log with integrity-checked export | Exists | `lib/privacy/audit.ts`, `/api/account/workspaces/{id}/audit/export` (`rateloop-audit-v1`) |
| Source-derived on-chain round evidence, deterministic RBTS recomputation, published results | Exists | `lib/tokenless/transparency.ts`, Ponder tables |
| Adaptive-coverage observations (agreement, comparability, latency, cost per scope) | Persisted, **no tenant export** | `lib/tokenless/adaptiveReviewEvidence.ts` |
| Execution provenance (models, tokens, timing, tool spans) | Exists, **host-reported, `independentlyVerified:false`** | `lib/tokenless/agentExecutionProvenance.ts` |
| Audit-chain offline verifier CLI | Absent (server-side only) | — |
| Platform metrics for customers | Keeper Prometheus only; none in app | `packages/keeper/src/metrics.ts` |
| Public trust/limitations page | Deliberately removed; register forbids a trust-status page | readiness register |

Honesty constraints that shape everything below: evidence-signer key custody is not yet production-grade
(managed signing is an open readiness item); the paid path is not yet connected to settlement end-to-end; and
provenance stays host-reported unless a gateway or attestation changes that — so the marketed unit is the
*review evidence*, not verified model provenance.

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
4. **Retention controls.** Configurable workspace evidence/log retention with a floor of 6 months (EU AI Act
   Art. 26(6) deployer minimum), defaulting longer; document the retention basis in the export header.
5. **The compliance map itself** (a docs artifact, §5): RateLoop evidence artifacts ↔ ISO/IEC 42001 A.6/A.9.2
   evidence expectations, EU AI Act Art. 12/26(5–6)/72/73 record-keeping, NIST AI RMF MEASURE/MANAGE, FINRA
   24-09 / Rule 3110 supervision records, SEC 17a-4 audit-trail-alternative. Written with the exact
   non-claims from §1, and kept in lockstep with deployed reality (readiness-register discipline). Track
   **prEN 18229-1** (CEN-CENELEC JTC 21 "logging, transparency and human oversight", publishing ~2026) and
   the Art. 72/73 Commission templates; align the export schema to prEN 18229-1 when its text stabilizes,
   since it will define presumption-of-conformity evidence.

### Phase E2 — independent verifiability and enterprise plumbing

6. **Attestation wrapping (in-toto/DSSE + Sigstore).** Wrap each evidence packet and each audit/coverage
   export head as an in-toto attestation with a RateLoop predicate type
   (`https://rateloop.ai/attestation/review-verdict/v1`), signed and logged to the public **Rekor**
   transparency log via cosign (Apache 2.0 tooling). Add an **RFC 3161 timestamp** countersignature on export
   batch boundaries. Rationale: Base anchoring proves existence/ordering but some auditors discount "the
   vendor's chain," and RFC 3161 carries legal recognition Base does not; chain anchor + Rekor inclusion +
   TSA token is cheap defense-in-depth, and SEC 17a-4's audit-trail alternative gives the combined chain a
   regulated-industry justification. Present all three as "externally anchored tamper evidence," not
   "blockchain."
7. **Assurance metrics endpoint.** Prometheus/OpenMetrics per workspace (reviews requested/completed,
   sampling rate by scope, verdict latency, disagreement rate, blocked/approval-required counts,
   evidence-anchor lag), token-gated like the keeper's endpoint. Ship **Grafana dashboard JSON** as an
   artifact (never embed Grafana — AGPL).
8. **Event streaming for SIEMs.** CloudEvents-wrapped webhooks (`ai.rateloop.review.completed`,
   `ai.rateloop.packet.anchored`, `ai.rateloop.gate.blocked`, …) with an **OCSF Compliance Finding mapping**
   so Splunk/Datadog/Security Lake ingest without custom parsers; every event carries the packet hash and
   chain reference so SIEM records cross-verify against the evidence chain.
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
11. **Compliance-platform push.** A Vanta partner app and a Drata Custom Connection posting nightly
    per-workspace oversight-coverage test records (JSON) and signed packet bundles as document evidence
    mapped to controls; both APIs are documented and feasible today. Credo AI policy-pack evidence and IBM
    watsonx factsheets follow the same connector pattern later.
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

## 4. Dependency and sequencing notes

- E1 items 1–4 depend only on code already on this branch (plus the human-review configuration work in
  flight, which supplies trigger/policy identifiers) — they are the next commits after the current stream.
- E2 item 6 depends on **managed signing** (open readiness item): do not publish Rekor-logged attestations
  from a development key custody; the evidence-signer role must be production-grade first.
- E2 item 9 and E3 item 11 presuppose paid-path settlement receipts where money is claimed — gate on the
  register's `paidAssignmentSettlement` item.
- E3 item 10 is independent and can start any time; the semconv pin is the only caution.
- The website (§5) trails each capability: copy ships in the same release as, never before, the capability.

## 5. Website plan (docs + landing) — after capabilities, claims-gated

Constraints honored: the register forbids a public trust-status page (removed deliberately); the established
design stays unchanged (black rail, mono section labels, gradient headline words, surface cards); every
public claim must match the deployed system exactly.

### Docs (the substance lives here)

1. **New TSX docs page `/docs/evidence`** ("Evidence & Compliance Mapping"), added to `DOCS_NAV` in
   `constants/docsNav.ts`, structured as: what an evidence packet contains (field walk-through with a
   redacted example); how to verify independently (four checks: Ed25519 signature against the published key,
   Merkle/recomputation, chain anchor, Rekor/TSA once E2 ships); the compliance map table (artifact ↔
   ISO 42001 A.6/A.9.2 · EU AI Act Art. 12/26/72/73 · NIST AI RMF MEASURE/MANAGE · FINRA 24-09 · 17a-4)
   with correct citations; and a prominent **"What this is not"** box (the §1 non-claims, verbatim). This is
   product documentation of exact behavior — permitted and expected — not a trust-status page.
2. **Machine-doc mirror** `public/docs/evidence.md` for agent consumption, linked from the connection-intent
   documentation pointer like `agent-connection.md`.
3. **Cross-link updates:** the existing "5. Evidence, not an automatic decision" section of
   `/docs/how-it-works` links to the new page; `/docs/smart-contracts` gains a short "what settlement
   evidence proves (and what it does not)" pointer; the SDK docs document the export endpoints and verifier
   CLIs.

### Landing page (selective, design-preserving)

4. **One new `whyItWorksFeatures` card** in section 03 ("Why It Works"): *"Evidence your auditors can
   check"* — signed decision packets, tamper-evident logs, offline verifiers — chip-linking to
   `/docs/evidence`. This is the minimal-change option and ships first.
5. **Optionally later, a dedicated section** ("0X — Evidence, Not **Trust**") between How-It-Works and
   Why-It-Works using the existing card/rail idiom: three cards — *Decision packets* (signed, recomputable),
   *Tamper-evident by construction* (hash chain + external anchors), *Fits your compliance stack*
   (exports, metrics, GRC/SIEM connectors). Add one FAQ entry: "Can I use RateLoop evidence in an audit?" —
   answered with the §1 claim/non-claim split.
6. **Copy gates.** Each phrase has a capability precondition, register-style:

   | Public phrase | May ship when |
   | --- | --- |
   | "Signed decision packets you can verify offline" | Today (E0 — already true) |
   | "Escalation triggers and coverage statistics in every packet" | E1.1–E1.2 deployed |
   | "Verify our audit exports yourself" | E1.3 shipped |
   | "Independently witnessed (transparency log / RFC 3161)" | E2.6 + managed signing |
   | "Feeds Vanta/Drata/your SIEM" | E2.8/E3.11 live with a real customer exercise |
   | "Works with your OpenTelemetry instrumentation" | E3.10 deployed |
   | Any "compliance-ready/certified" wording | Never (claims-match rule) |

## 6. Risks and guardrails

- **Overclaiming is the existential risk of this positioning.** The mitigations are structural: the
  "What this is not" box travels with every surface; packet `limitations` and `source.independentlyVerified`
  fields stay load-bearing; the copy-gate table above is enforced in review like the readiness register.
- **Provenance honesty:** host-reported execution metadata is never marketed as verified model provenance;
  an integrity upgrade would require a gateway/proxy pattern or provider attestation — out of scope here.
- **Standards drift:** OTel GenAI semconv is pre-stable (pin + shim); prEN 18229-1 and the Art. 72/73
  templates will reshape the export schema — schedule a re-check when each publishes.
- **License discipline:** embedded = Apache-2.0/MIT/spec only; AGPL/ELv2/BSL/Llama-licensed tools remain
  external integration targets (documented in §3).
- **Key custody before publicity:** no Rekor publication, no "independently witnessed" copy, until the
  evidence-signer key is under managed custody.

## 7. Summary

RateLoop already produces most of the evidence the frameworks ask for; the plan is to finish the last export
gaps and field alignments (E1), make the evidence independently witnessed and machine-consumable (E2), meet
customers' existing observability/GRC/SIEM stacks with permissively licensed standards rather than bespoke
integrations (E3), and only then let the website say so — one docs page carrying the substance, one landing
card carrying the message, every claim gated on deployed reality.
