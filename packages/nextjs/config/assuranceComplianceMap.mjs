export const RATELOOP_OSCAL_NAMESPACE = "https://rateloop.ai/ns/oscal";

export const assuranceComplianceMap = Object.freeze({
  mappingVersion: "rateloop.assurance-compliance-map.v1",
  published: "2026-07-16T00:00:00Z",
  lastModified: "2026-07-21T00:00:00Z",
  oscalVersion: "1.2.2",
  claimBoundary:
    "These mappings identify evidence RateLoop artifacts can support. They do not establish certification, legal compliance, control effectiveness, or discharge a customer's duties.",
  evidenceArtifacts: [
    {
      id: "signed-assurance-evidence-packet",
      title: "Signed assurance evidence packet",
      schemaVersion: "rateloop.human-assurance.evidence.v3",
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
      schemaVersion: "rateloop.assurance-coverage-export.v1",
      description:
        "A hash-bound workspace export of policy snapshots, sampling decisions, forced-review rules, human-result observations, coverage rollups, and stage transitions for a bounded period.",
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
    {
      id: "s3-object-lock-delivery-receipt",
      title: "S3 Object Lock delivery receipt",
      schemaVersion: "rateloop.assurance-worm-provider-receipt.v1",
      description:
        "A provider receipt for an integrity-checked export delivered to a customer-controlled S3 Object Lock destination with the configured retention mode and deadline.",
      sourceLocations: ["packages/nextjs/lib/tokenless/assuranceWormExports.ts"],
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
      citation: "Official Journal text of Regulation (EU) 2024/1689 on harmonised rules on artificial intelligence.",
      sources: [
        {
          href: "https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng",
          mediaType: "text/html",
        },
      ],
    },
    {
      id: "finra",
      title: "FINRA supervision guidance and Rule 3110",
      namespace: "https://www.finra.org/rules-guidance/",
      citation:
        "FINRA Regulatory Notice 24-09 and FINRA Rule 3110 official sources. The mapping does not constitute FINRA approval or legal advice.",
      sources: [
        {
          href: "https://www.finra.org/rules-guidance/notices/24-09",
          mediaType: "text/html",
        },
        {
          href: "https://www.finra.org/rules-guidance/rulebooks/finra-rules/3110",
          mediaType: "text/html",
        },
      ],
    },
    {
      id: "sec-exchange-act-records",
      title: "SEC Exchange Act Rule 17a-4",
      namespace: "https://www.ecfr.gov/current/title-17/chapter-II/part-240/section-240.17a-4#",
      citation:
        "Official electronic Code of Federal Regulations text for 17 CFR 240.17a-4. RateLoop can deliver exports to a customer-controlled S3 Object Lock target, but does not provide the broker-dealer's required recordkeeping system.",
      sources: [
        {
          href: "https://www.ecfr.gov/current/title-17/chapter-II/part-240/section-240.17a-4",
          mediaType: "text/html",
        },
      ],
    },
  ],
  mappings: [
    {
      id: "iso-iec-42001-a-6",
      frameworkId: "iso-iec-42001",
      reference: "A.6",
      evidencePurpose:
        "documenting review-policy operation, frozen lifecycle context, sampled human review, and resulting evidence across an AI-system lifecycle",
      evidenceArtifactIds: [
        "signed-assurance-evidence-packet",
        "adaptive-coverage-export",
        "host-reported-execution-evidence",
      ],
      nonClaim:
        "This mapping does not demonstrate that a customer has implemented the A.6 controls or that RateLoop is ISO/IEC 42001 certified.",
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
      id: "nist-ai-rmf-measure",
      frameworkId: "nist-ai-rmf",
      reference: "MEASURE",
      evidencePurpose:
        "measurement of review sampling, human agreement and disagreement, latency, escalation triggers, and policy adherence over time",
      evidenceArtifactIds: ["adaptive-coverage-export", "signed-assurance-evidence-packet"],
      nonClaim:
        "This mapping is an evidence cross-reference and does not represent a NIST assessment, endorsement, or determination of risk acceptability.",
    },
    {
      id: "nist-ai-rmf-manage",
      frameworkId: "nist-ai-rmf",
      reference: "MANAGE",
      evidencePurpose:
        "documenting configured escalation, human-review gate outcomes, exceptions, and integrity-checkable follow-up records",
      evidenceArtifactIds: ["human-review-gate-evidence", "workspace-audit-export", "signed-assurance-evidence-packet"],
      nonClaim:
        "This mapping does not make or replace the customer's risk treatment, acceptance, response, or governance decisions.",
    },
    {
      id: "eu-ai-act-article-12",
      frameworkId: "eu-ai-act",
      reference: "Article 12",
      evidencePurpose:
        "integrity-checkable records of RateLoop review activity and host-reported execution context that may form one input to a customer's logging evidence",
      evidenceArtifactIds: [
        "workspace-audit-export",
        "signed-assurance-evidence-packet",
        "host-reported-execution-evidence",
      ],
      nonClaim:
        "RateLoop does not verify model provenance or establish that the customer's high-risk AI system fulfils Article 12 logging requirements.",
    },
    {
      id: "eu-ai-act-article-26-5-6",
      frameworkId: "eu-ai-act",
      reference: "Article 26(5)-(6)",
      evidencePurpose:
        "monitoring records, review-policy operation, and export history that a deployer may retain under its own applicable retention schedule",
      evidenceArtifactIds: ["adaptive-coverage-export", "signed-assurance-evidence-packet", "workspace-audit-export"],
      nonClaim:
        "RateLoop is not the deployer's assigned human oversight and does not by itself satisfy monitoring, authority, competence, reporting, or statutory retention duties.",
    },
    {
      id: "eu-ai-act-article-72",
      frameworkId: "eu-ai-act",
      reference: "Article 72",
      evidencePurpose:
        "periodic review-coverage and outcome evidence that may inform a provider's post-market monitoring inputs",
      evidenceArtifactIds: ["adaptive-coverage-export", "signed-assurance-evidence-packet"],
      nonClaim:
        "RateLoop does not operate or replace the provider's post-market monitoring system or determine the Article 72 plan and methods.",
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
        "records of human review, configured escalation, model metadata reported by the host, and review outcomes for a member firm's supervision analysis",
      evidenceArtifactIds: [
        "signed-assurance-evidence-packet",
        "adaptive-coverage-export",
        "host-reported-execution-evidence",
      ],
      nonClaim:
        "This mapping does not determine which FINRA rules apply, approve a member firm's supervisory system, or constitute legal advice.",
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
      id: "sec-rule-17a-4-f",
      frameworkId: "sec-exchange-act-records",
      reference: "17 CFR 240.17a-4(f)",
      evidencePurpose:
        "integrity-checkable review and audit exports that may be delivered into a broker-dealer's separately compliant electronic recordkeeping system",
      evidenceArtifactIds: [
        "workspace-audit-export",
        "signed-assurance-evidence-packet",
        "s3-object-lock-delivery-receipt",
      ],
      nonClaim:
        "An S3 Object Lock delivery target does not by itself provide the broker-dealer's Rule 17a-4 recordkeeping system, audit-trail alternative, undertakings, or required production process.",
    },
  ],
});
