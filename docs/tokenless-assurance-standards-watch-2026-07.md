# Tokenless assurance standards watch

**Owner:** assurance evidence schema maintainers

**Last checked:** 2026-07-16

**Scope:** external standards and EU templates that can change the evidence/export schema. This is an engineering watchlist,
not legal advice or a claim of conformity.

## prEN 18229-1 — AI trustworthiness framework, Part 1: Logging

- **Current state:** public-enquiry draft in 2026. The current part is focused on logging; later parts cover transparency
  and human oversight. Do not describe the draft as a published harmonised standard or as creating a presumption of
  conformity.
- **Primary status sources:** the European Commission's
  [Interoperable Europe standards overview](https://interoperable-europe.ec.europa.eu/collection/ai-public-sector/ai-standards-and-tools-public-services)
  and the applicable CEN/CENELEC national-member enquiry record.
- **Re-check trigger:** end of enquiry, formal vote, publication, or citation in the Official Journal.
- **Required repository action:** compare mandatory event fields, timestamp semantics, actor/source identification,
  retention metadata, integrity evidence, and access/production requirements with
  `rateloop.human-assurance.evidence.v3`, `rateloop.assurance-coverage-export.v1`, and `rateloop-audit-v1`. Update the
  schemas, offline verifiers, OSCAL map, docs, fixtures, and public-claim gates together.

## EU AI Act Article 72 — post-market monitoring plan template

- **Current state:** Article 72 requires a Commission implementing act containing the plan template. Until an adopted
  template is verified, RateLoop exports must not claim template conformance.
- **Primary status sources:** the Commission's
  [Article 72 service-desk record](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-72) and
  [AI Act resources index](https://ai-act-service-desk.ec.europa.eu/en/resources).
- **Re-check trigger:** adopted implementing act, corrected template, or Commission guidance revision.
- **Required repository action:** map the adopted fields to coverage windows, policy versions, exceptions, escalation
  counts, latency, follow-up records, and customer-owned final decisions. Record missing fields as explicit limitations;
  do not invent customer risk-acceptance evidence.

## EU AI Act Article 73 — serious-incident guidance and template

- **Current state:** the Commission published draft high-risk-system guidance and a reporting template for consultation
  in 2025. A GPAI systemic-risk template is a different instrument and must not be substituted.
- **Primary status source:** the Commission's
  [high-risk AI incident consultation and draft template](https://digital-strategy.ec.europa.eu/en/consultations/ai-act-commission-issues-draft-guidance-and-reporting-template-serious-ai-incidents-and-seeks).
- **Re-check trigger:** final guidance/template, material correction, or a new submission channel specification.
- **Required repository action:** compare identifiers, event chronology, severity, causal-link status, corrective action,
  evidence preservation, and authority-production fields with SIEM CloudEvents, audit exports, and signed packets. The
  customer remains responsible for determining reportability and submitting a report.

## Review procedure

1. Record the source version/date and the exact schema delta in a pull request.
2. Update generators before generated OSCAL or documentation artifacts.
3. Add fixture-based verifier tests for every new mandatory field.
4. Keep capability flags false until the changed export is deployed and exercised.
5. Never copy standards text into the repository beyond short, attributed field names or summaries.
