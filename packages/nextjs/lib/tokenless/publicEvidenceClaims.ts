export const PUBLIC_EVIDENCE_CAPABILITIES = [
  "managed_evidence_signing",
  "published_evidence_signing_key_history",
  "offline_evidence_packet_verifier",
  "evidence_packet_compliance_fields",
  "adaptive_coverage_export",
  "offline_audit_export_verifier",
  "rekor_attestation",
  "rfc3161_timestamping",
  "siem_delivery_exercised",
  "vanta_delivery_exercised",
  "drata_delivery_exercised",
  "otel_genai_ingest",
] as const;

export type PublicEvidenceCapability = (typeof PUBLIC_EVIDENCE_CAPABILITIES)[number];
export type PublicEvidenceCapabilityState = Readonly<Record<PublicEvidenceCapability, boolean>>;

// These flags mean "deployed and exercised for public claims", not merely "code exists".
// They stay fail-closed until the production-readiness evidence for the capability is complete.
export const PUBLIC_EVIDENCE_CAPABILITY_STATE: PublicEvidenceCapabilityState = Object.freeze({
  managed_evidence_signing: false,
  published_evidence_signing_key_history: false,
  offline_evidence_packet_verifier: false,
  evidence_packet_compliance_fields: false,
  adaptive_coverage_export: false,
  offline_audit_export_verifier: false,
  rekor_attestation: false,
  rfc3161_timestamping: false,
  siem_delivery_exercised: false,
  vanta_delivery_exercised: false,
  drata_delivery_exercised: false,
  otel_genai_ingest: false,
});

type PublicEvidenceClaimGate = {
  id: string;
  phrase: string;
  patterns: readonly RegExp[];
  requiredCapabilities: readonly PublicEvidenceCapability[];
  policy: "gated";
};

type ForbiddenPublicEvidenceClaim = {
  id: string;
  phrase: string;
  patterns: readonly RegExp[];
  requiredCapabilities: readonly [];
  policy: "forbidden";
};

export type PublicEvidenceClaimRule = PublicEvidenceClaimGate | ForbiddenPublicEvidenceClaim;

export const PUBLIC_EVIDENCE_CLAIMS_MATRIX = [
  {
    id: "signed_decision_packets_offline",
    phrase: "Signed decision packets you can verify offline",
    patterns: [
      /signed decision packets?/iu,
      /signed decision packets? (?:that (?:customers?|auditors?) can |you can )?verify offline/iu,
      /verify signed decision packets? offline/iu,
      /offline (?:evidence )?packet verifier/iu,
    ],
    requiredCapabilities: [
      "managed_evidence_signing",
      "published_evidence_signing_key_history",
      "offline_evidence_packet_verifier",
    ],
    policy: "gated",
  },
  {
    id: "packet_escalation_and_coverage",
    phrase: "Escalation triggers and coverage statistics in every packet",
    patterns: [/escalation triggers? and coverage statistics? (?:are )?(?:included )?in every (?:decision )?packet/iu],
    requiredCapabilities: ["evidence_packet_compliance_fields", "adaptive_coverage_export"],
    policy: "gated",
  },
  {
    id: "audit_export_offline_verification",
    phrase: "Verify our audit exports yourself",
    patterns: [
      /verify (?:our|RateLoop(?:'s)?) audit exports? (?:yourself|offline)/iu,
      /audit exports? (?:that |you can )?verify (?:yourself|offline)/iu,
      /offline audit(?:-chain| chain)? verifier/iu,
      /tamper-evident (?:audit )?(?:logs?|exports?)/iu,
    ],
    requiredCapabilities: ["offline_audit_export_verifier"],
    policy: "gated",
  },
  {
    id: "independent_witnessing",
    phrase: "Independently witnessed through a transparency log or RFC 3161 timestamp",
    patterns: [
      /independently witnessed/iu,
      /(?:Rekor|transparency log).{0,100}RFC\s+3161.{0,100}(?:anchor|timestamp|witness|verif)/isu,
      /RFC\s+3161.{0,100}(?:Rekor|transparency log).{0,100}(?:anchor|timestamp|witness|verif)/isu,
    ],
    requiredCapabilities: ["managed_evidence_signing", "rekor_attestation", "rfc3161_timestamping"],
    policy: "gated",
  },
  {
    id: "grc_and_siem_delivery",
    phrase: "Feeds Vanta, Drata, and your SIEM",
    patterns: [
      /feeds?.{0,40}\bVanta\b.{0,40}\bDrata\b.{0,40}\bSIEM\b/isu,
      /feeds?.{0,40}\bDrata\b.{0,40}\bVanta\b.{0,40}\bSIEM\b/isu,
      /(?:send|stream|deliver)s? (?:evidence |exports? )?(?:to |into )?(?:Vanta|Drata|(?:your )?SIEM)\b/iu,
    ],
    requiredCapabilities: ["vanta_delivery_exercised", "drata_delivery_exercised", "siem_delivery_exercised"],
    policy: "gated",
  },
  {
    id: "otel_instrumentation",
    phrase: "Works with your OpenTelemetry instrumentation",
    patterns: [/works? with (?:your )?OpenTelemetry instrumentation/iu],
    requiredCapabilities: ["otel_genai_ingest"],
    policy: "gated",
  },
  {
    id: "compliance_ready",
    phrase: "Compliance-ready",
    patterns: [/\bcompliance[- ]ready\b/iu],
    requiredCapabilities: [],
    policy: "forbidden",
  },
  {
    id: "automatic_compliance",
    phrase: "RateLoop makes or keeps a customer compliant",
    patterns: [
      /\b(?:RateLoop|our evidence|the evidence) (?:makes?|keeps?) (?:you|customers?|an? (?:company|organization)) compliant\b/iu,
      /\b(?:guarantees?|ensures?) compliance\b/iu,
    ],
    requiredCapabilities: [],
    policy: "forbidden",
  },
  {
    id: "unheld_certification",
    phrase: "RateLoop is certified or compliant with an unheld certification",
    patterns: [
      /\bRateLoop is (?:SOC\s*2|ISO(?:\/IEC)?\s*42001|HIPAA)?[- ]?(?:certified|compliant|attested)\b/iu,
      /\b(?:SOC\s*2|ISO(?:\/IEC)?\s*42001|HIPAA)[- ](?:certified|compliant) RateLoop\b/iu,
    ],
    requiredCapabilities: [],
    policy: "forbidden",
  },
  {
    id: "customer_human_oversight",
    phrase: "RateLoop constitutes the customer's EU AI Act human oversight",
    patterns: [
      /\bRateLoop (?:is|provides|delivers|constitutes) (?:the |your )?(?:EU AI Act(?: Article (?:14|26))? )?human oversight\b/iu,
    ],
    requiredCapabilities: [],
    policy: "forbidden",
  },
  {
    id: "verified_model_provenance",
    phrase: "RateLoop verifies which model produced an output",
    patterns: [
      /\bRateLoop verif(?:y|ies|ied) (?:the )?(?:actual )?model(?: provenance)? (?:that )?produced/iu,
      /\bverified model provenance\b/iu,
    ],
    requiredCapabilities: [],
    policy: "forbidden",
  },
] as const satisfies readonly PublicEvidenceClaimRule[];

export type PublicEvidenceClaimViolation = {
  claimId: string;
  matchedText: string;
  missingCapabilities: PublicEvidenceCapability[];
  phrase: string;
  policy: PublicEvidenceClaimRule["policy"];
};

export function findPublicEvidenceClaimViolations(
  source: string,
  capabilities: PublicEvidenceCapabilityState = PUBLIC_EVIDENCE_CAPABILITY_STATE,
): PublicEvidenceClaimViolation[] {
  const searchableSource = source.replace(/\s+/gu, " ");
  return PUBLIC_EVIDENCE_CLAIMS_MATRIX.flatMap(rule => {
    const match = rule.patterns
      .map(pattern => searchableSource.match(pattern))
      .find((value): value is RegExpMatchArray => Boolean(value));
    if (!match) return [];

    const missingCapabilities = rule.requiredCapabilities.filter(capability => !capabilities[capability]);
    if (rule.policy === "gated" && missingCapabilities.length === 0) return [];

    return [
      {
        claimId: rule.id,
        matchedText: match[0],
        missingCapabilities: [...missingCapabilities],
        phrase: rule.phrase,
        policy: rule.policy,
      },
    ];
  });
}
