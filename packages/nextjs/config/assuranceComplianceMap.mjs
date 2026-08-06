export const RATELOOP_OSCAL_NAMESPACE = "https://rateloop.ai/ns/oscal";

export const assuranceComplianceMap = Object.freeze({
  mappingVersion: "rateloop.assurance-compliance-map.v1",
  published: "2026-07-16T00:00:00Z",
  lastModified: "2026-07-31T00:00:00Z",
  oscalVersion: "1.2.2",
  claimBoundary:
    "These mappings identify evidence RateLoop artifacts can support. They do not establish certification, legal compliance, control effectiveness, or discharge a customer's duties.",
  evidenceArtifacts: [
    {
      id: "signed-assurance-evidence-packet",
      title: "Signed assurance evidence packet",
      schemaVersion: "rateloop.human-assurance.evidence.v4",
      description:
        "A signed, hash-bound packet containing frozen assurance-input commitments, privacy-safe aggregation, limitations, and available settlement or chain references.",
      sourceLocations: [
        "packages/nextjs/lib/tokenless/evidencePackets.ts",
        "packages/nextjs/scripts/assurance-evidence-core.mjs",
        "packages/nextjs/scripts/verify-assurance-evidence.mjs",
      ],
    },
    {
      id: "adaptive-coverage-export",
      title: "Adaptive assurance coverage export",
      schemaVersion: "rateloop.assurance-coverage-export.v2",
      description:
        "A hash-bound workspace export of policy snapshots, sampling decisions, forced-review rules, human-result observations, design-weighted population estimates or typed coverage gaps, coverage rollups, and stage transitions for a bounded period.",
      sourceLocations: ["packages/nextjs/lib/tokenless/adaptiveCoverageExport.ts"],
    },
    {
      id: "workspace-audit-export",
      title: "Workspace audit-chain export",
      schemaVersion: "rateloop-audit-v1",
      description:
        "A workspace-scoped, hash-chained audit export whose sequence and head digest can be checked with the offline verifier.",
      sourceLocations: ["packages/nextjs/lib/privacy/audit.ts", "packages/nextjs/scripts/verify-audit-export.mjs"],
    },
    {
      id: "human-review-gate-evidence",
      title: "Human-review gate evidence",
      schemaVersion: "rateloop.human-review-gate-evidence.v1",
      description:
        "Signed evidence binding a review requirement to the stop-gate state and the exact release decision without exposing private review material.",
      sourceLocations: ["packages/nextjs/lib/tokenless/humanReviewGateEvidence.ts"],
    },
    {
      id: "host-reported-execution-evidence",
      title: "Host-reported execution evidence",
      schemaVersion: "rateloop.execution-evidence.v1",
      description:
        "A canonical commitment to model identity and execution metadata reported by the connected host. It is explicitly marked independentlyVerified:false and does not independently verify that the reported model produced the output.",
      sourceLocations: [
        "packages/nextjs/lib/tokenless/agentExecutionEvidence.ts",
        "packages/nextjs/lib/tokenless/agentExecutionProvenance.ts",
      ],
    },
      ],
  frameworks: [
    {
      id: "iso-iec-42001",
      title: "ISO/IEC 42001:2023",
      namespace: "https://www.iso.org/standard/81230.html#",
      citation:
        "ISO/IEC 42001:2023 official standard record. Access to the complete standard may require a licence from ISO or a national standards body.",
      sources: [
        {
          href: "https://www.iso.org/standard/81230.html",
          mediaType: "text/html",
        },
      ],
    },
    {
      id: "nist-ai-rmf",
      title: "NIST AI Risk Management Framework",
      namespace: "https://airc.nist.gov/airmf-resources/airmf/",
      citation:
        "NIST AI RMF Core and Playbook resources maintained by the U.S. National Institute of Standards and Technology.",
      sources: [
        {
          href: "https://airc.nist.gov/airmf-resources/airmf/5-sec-core/",
          mediaType: "text/html",
        },
        {
          href: "https://airc.nist.gov/airmf-resources/playbook/",
          mediaType: "text/html",
        },
      ],
    },
    {
      id: "eu-ai-act",
      title: "Regulation (EU) 2024/1689 (EU AI Act)",
      namespace: "http://data.europa.eu/eli/reg/2024/1689/oj#",
      citation:
        "Official Journal text of Regulation (EU) 2024/1689 on harmonised rules on artificial intelligence, as amended by Regulation (EU) 2026/1744 (Digital Omnibus on AI, OJ L, 2026/1744, 24 July 2026, in force 27 July 2026). The amendment leaves the text of the mapped provisions unchanged and postpones Chapter III, Section 3 to 2 December 2027 for Annex III high-risk systems and to 2 August 2028 for Annex I high-risk systems.",
      sources: [
        {
          href: "https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng",
          mediaType: "text/html",
        },
      ],
    },
    {
      id: "finra",
      title: "FINRA supervision rules and generative-AI guidance",
      namespace: "https://www.finra.org/rules-guidance/",
      citation:
        "FINRA Rule 3110 with Supplementary Material .07, Regulatory Notice 24-09 (27 June 2024), and the GenAI section of the 2026 FINRA Annual Regulatory Oversight Report (9 December 2025). Notice 24-09 states that it creates no new requirements, and the report presents practices a firm may want to consider. The mapping does not constitute FINRA approval or legal advice.",
      sources: [
        {
          href: "https://www.finra.org/rules-guidance/rulebooks/finra-rules/3110",
          mediaType: "text/html",
        },
        {
          href: "https://www.finra.org/rules-guidance/notices/24-09",
          mediaType: "text/html",
        },
        {
          href: "https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai",
          mediaType: "text/html",
        },
      ],
    },
  ],
  mappings: [
    {
      id: "iso-iec-42001-a-6-2-6",
      frameworkId: "iso-iec-42001",
      reference: "A.6.2.6",
      evidencePurpose:
        "operation-and-monitoring records for a deployed AI system, including the frozen review policy in force, sampling decisions, human results, coverage rollups, and stage transitions for a bounded period",
      evidenceArtifactIds: [
        "signed-assurance-evidence-packet",
        "adaptive-coverage-export",
        "host-reported-execution-evidence",
      ],
      nonClaim:
        "This mapping does not demonstrate that a customer has implemented the A.6.2.6 control or that RateLoop is ISO/IEC 42001 certified.",
    },
    {
      id: "iso-iec-42001-a-6-2-8",
      frameworkId: "iso-iec-42001",
      reference: "A.6.2.8",
      evidencePurpose:
        "event-log evidence about review decisions, policy context, gate state, and integrity-checkable audit history",
      evidenceArtifactIds: ["workspace-audit-export", "signed-assurance-evidence-packet", "human-review-gate-evidence"],
      nonClaim:
        "This mapping does not establish completeness of a customer's wider AI-system event logging or retention programme.",
    },
    {
      id: "iso-iec-42001-a-9-2",
      frameworkId: "iso-iec-42001",
      reference: "A.9.2",
      evidencePurpose:
        "responsible-use records showing configured review rules, human judgments, coverage, escalation, and release-gate evidence",
      evidenceArtifactIds: [
        "signed-assurance-evidence-packet",
        "adaptive-coverage-export",
        "human-review-gate-evidence",
      ],
      nonClaim:
        "This mapping does not assign customer responsibility, competence, training, authority, or approval obligations to RateLoop.",
    },
    {
      id: "nist-ai-rmf-measure-2-8",
      frameworkId: "nist-ai-rmf",
      reference: "MEASURE 2.8",
      evidencePurpose:
        "documented examination of transparency and accountability limits, including privacy-safe aggregation, the stated limitations of each packet, and execution metadata recorded as host-reported and not independently verified",
      evidenceArtifactIds: ["signed-assurance-evidence-packet", "host-reported-execution-evidence"],
      nonClaim:
        "This mapping is an evidence cross-reference and does not represent a NIST assessment, endorsement, or determination of risk acceptability.",
    },
    {
      id: "nist-ai-rmf-measure-4-2",
      frameworkId: "nist-ai-rmf",
      reference: "MEASURE 4.2",
      evidencePurpose:
        "documented measurement results informed by invited domain-expert reviewers, covering sampling, human agreement and disagreement, latency, and design-weighted population estimates or typed coverage gaps",
      evidenceArtifactIds: ["adaptive-coverage-export", "signed-assurance-evidence-packet"],
      nonClaim:
        "This mapping is an evidence cross-reference and does not represent a NIST assessment or endorsement, and an invitation to review is not proof of a reviewer's expertise or independence.",
    },
    {
      id: "nist-ai-rmf-manage-2-4",
      frameworkId: "nist-ai-rmf",
      reference: "MANAGE 2.4",
      evidencePurpose:
        "records binding a configured review requirement to the stop-gate state and the exact release decision for a single reviewed output",
      evidenceArtifactIds: ["human-review-gate-evidence", "workspace-audit-export"],
      nonClaim:
        "RateLoop records a hold-or-release decision for a single reviewed output and does not supersede, disengage, or deactivate the customer's AI system; current integrations are advisory and do not physically withhold an output.",
    },
    {
      id: "nist-ai-rmf-manage-4-1",
      frameworkId: "nist-ai-rmf",
      reference: "MANAGE 4.1",
      evidencePurpose:
        "post-deployment monitoring records covering human override of an AI result, re-baselining to full coverage after a model, prompt, tool, or workflow change, and integrity-checkable follow-up history",
      evidenceArtifactIds: ["human-review-gate-evidence", "workspace-audit-export", "signed-assurance-evidence-packet"],
      nonClaim:
        "This mapping does not make or replace the customer's risk treatment, acceptance, response, or governance decisions.",
    },
    {
      id: "eu-ai-act-article-26-5-6",
      frameworkId: "eu-ai-act",
      reference: "Article 26(5)-(6)",
      evidencePurpose:
        "monitoring records, review-policy operation, and export history that may support a deployer's monitoring evidence and retention process for logs generated by its high-risk AI system",
      evidenceArtifactIds: ["adaptive-coverage-export", "signed-assurance-evidence-packet", "workspace-audit-export"],
      nonClaim:
        "RateLoop is not the deployer's assigned human oversight. Its six-month floor applies to RateLoop review records, not the logs generated by the customer's high-risk AI system, and does not satisfy Article 26(6) or any monitoring, authority, competence, or reporting duty.",
    },
    {
      id: "eu-ai-act-article-73",
      frameworkId: "eu-ai-act",
      reference: "Article 73",
      evidencePurpose:
        "preserving review decisions, gate outcomes, and audit history that may support a customer's serious-incident investigation and report preparation",
      evidenceArtifactIds: ["signed-assurance-evidence-packet", "human-review-gate-evidence", "workspace-audit-export"],
      nonClaim:
        "RateLoop does not determine whether an event is a serious incident and does not perform the customer's regulatory notification.",
    },
    {
      id: "finra-regulatory-notice-24-09",
      frameworkId: "finra",
      reference: "Regulatory Notice 24-09",
      evidencePurpose:
        "technology-governance records for a supervisory system that uses generative AI, including the review policy in force, host-reported model and version metadata, and integrity-checkable review history",
      evidenceArtifactIds: [
        "signed-assurance-evidence-packet",
        "host-reported-execution-evidence",
        "workspace-audit-export",
      ],
      nonClaim:
        "Regulatory Notice 24-09 states that it creates no new requirements and sets no human-review obligation; this mapping does not determine which FINRA rules apply, approve a member firm's supervisory system, or constitute legal advice.",
    },
    {
      id: "finra-rule-3110",
      frameworkId: "finra",
      reference: "Rule 3110",
      evidencePurpose:
        "documented review policies, exceptions, escalations, release decisions, and audit history that may be incorporated into a member firm's supervisory records",
      evidenceArtifactIds: ["adaptive-coverage-export", "human-review-gate-evidence", "workspace-audit-export"],
      nonClaim:
        "RateLoop does not establish, maintain, or certify the member firm's supervisory system or written supervisory procedures.",
    },
    {
      id: "finra-rule-3110-07",
      frameworkId: "finra",
      reference: "Rule 3110.07",
      evidencePurpose:
        "review records that chronicle the reviewing account, the item reviewed, the date of review, and the action taken, in a form a member firm can retain alongside its supervisory records",
      evidenceArtifactIds: ["workspace-audit-export", "human-review-gate-evidence", "signed-assurance-evidence-packet"],
      nonClaim:
        "Rule 3110.07 governs evidence of review of internal communications and correspondence rather than AI output, and this mapping does not establish, maintain, or certify the member firm's supervisory system or written supervisory procedures.",
    },
    {
      id: "finra-oversight-report-2026-genai",
      frameworkId: "finra",
      reference: "2026 Annual Regulatory Oversight Report, GenAI: Continuing and Emerging Trends",
      evidencePurpose:
        "records of human-in-the-loop review of model output, the formal review and approval process in force, and tracking of which model version was used and when",
      evidenceArtifactIds: [
        "signed-assurance-evidence-packet",
        "adaptive-coverage-export",
        "host-reported-execution-evidence",
      ],
      nonClaim:
        "The report presents these as practices a firm may want to consider rather than as FINRA requirements, and this mapping does not establish that a member firm has adopted them or that its supervisory system is adequate.",
    },
  ],
});
