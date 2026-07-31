import { TOKENLESS_HOST_CAPABILITIES, type TokenlessHostDeliveryEnforcement } from "~~/lib/tokenless/hostCapabilities";
import { type HumanReviewLaneReadiness, humanReviewLaneImplementation } from "~~/lib/tokenless/reviewCapabilities";

export const PUBLIC_EVIDENCE_CAPABILITIES = [
  "managed_evidence_signing",
  "published_evidence_signing_key_history",
  "offline_evidence_packet_verifier",
  "evidence_packet_compliance_fields",
  "adaptive_coverage_export",
  "design_weighted_population_estimate",
  "method_reviewed_population_interval",
  "offline_audit_export_verifier",
  "rekor_attestation",
  "rfc3161_timestamping",
  "siem_delivery_exercised",
  "vanta_delivery_exercised",
  "drata_delivery_exercised",
  "otel_genai_ingest",
  "paid_private_review_lane",
  "public_network_review_lane",
  "hybrid_review_lane",
  "gdpr_blockchain_dpia",
  "provider_transfer_inventory",
] as const;

export type PublicEvidenceCapability = (typeof PUBLIC_EVIDENCE_CAPABILITIES)[number];
export type PublicEvidenceCapabilityState = Readonly<Record<PublicEvidenceCapability, boolean>>;

// These flags mean "deployed and exercised for public claims", not merely
// "code exists". Paid-lane claims use the same activation-bound projection as
// routing so public copy cannot drift from the lanes the deployment can serve.
export function derivePublicEvidenceCapabilityState(
  lanes: HumanReviewLaneReadiness = humanReviewLaneImplementation(),
): PublicEvidenceCapabilityState {
  return Object.freeze({
    managed_evidence_signing: false,
    published_evidence_signing_key_history: false,
    offline_evidence_packet_verifier: false,
    evidence_packet_compliance_fields: false,
    adaptive_coverage_export: false,
    design_weighted_population_estimate: false,
    method_reviewed_population_interval: false,
    offline_audit_export_verifier: false,
    rekor_attestation: false,
    rfc3161_timestamping: false,
    siem_delivery_exercised: false,
    vanta_delivery_exercised: false,
    drata_delivery_exercised: false,
    otel_genai_ingest: false,
    paid_private_review_lane: lanes.privateInvitedPaid,
    public_network_review_lane: lanes.publicPaidNetwork,
    hybrid_review_lane: lanes.hybridPublicSafe,
    gdpr_blockchain_dpia: false,
    provider_transfer_inventory: false,
  });
}

export const PUBLIC_EVIDENCE_CAPABILITY_STATE = derivePublicEvidenceCapabilityState();

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
    id: "design_weighted_population_estimate",
    phrase: "RateLoop publishes a design-weighted population point estimate",
    patterns: [
      /\bRateLoop (?:publishes?|provides?|reports?|delivers?) (?:a |the )?(?:design[- ]weighted|self[- ]normalized sequential[- ]IPW) (?:population )?(?:point )?estimate\b/iu,
      /\bRateLoop (?:veröffentlicht|liefert|berichtet)(?: eine)? (?:designgewichtete|selbstnormalisierte sequenzielle IPW[- ])\s+(?:Populations[- ])?Punktschätzung\b/iu,
    ],
    requiredCapabilities: ["design_weighted_population_estimate"],
    policy: "gated",
  },
  {
    id: "method_reviewed_population_interval",
    phrase: "RateLoop publishes a method-reviewed population confidence interval",
    patterns: [
      /\bRateLoop (?:publishes?|provides?|reports?|delivers?) (?:a |the )?(?:method[- ]reviewed )?(?:population )?(?:confidence|uncertainty) interval\b/iu,
      /\bRateLoop (?:veröffentlicht|liefert|berichtet)(?: ein)? (?:methodengeprüftes )?(?:Populations[- ])?Konfidenzintervall\b/iu,
    ],
    requiredCapabilities: ["design_weighted_population_estimate", "method_reviewed_population_interval"],
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
    id: "paid_private_review",
    phrase: "Private invited review is USDC-paid",
    patterns: [
      /\bprivate invited review (?:is|remains) (?:available )?(?:with )?USDC[- ]paid\b/iu,
      /\bUSDC[- ]paid private invited review (?:is|remains) available\b/iu,
    ],
    requiredCapabilities: ["paid_private_review_lane"],
    policy: "gated",
  },
  {
    id: "public_network_review",
    phrase: "Public RateLoop network review is USDC-paid",
    patterns: [
      /\bpublic RateLoop network review (?:is|remains|runs as) USDC[- ]paid\b/iu,
      /\bUSDC[- ]paid public RateLoop network review (?:is|remains) available\b/iu,
      /\byour invited reviewers.{0,120}\bRateLoop(?:'s)? World ID[- ]backed network\b/isu,
      /\bcustomer[- ]invited reviewers.{0,120}\bthe RateLoop network\b/isu,
      /\bA RateLoop network or hybrid panel\b/iu,
    ],
    requiredCapabilities: ["public_network_review_lane"],
    policy: "gated",
  },
  {
    id: "hybrid_review",
    phrase: "Hybrid review is available",
    patterns: [
      /\bhybrid review (?:is|remains) (?:active|available|enabled|live)\b/iu,
      /\b(?:or|and) clearly separated hybrid panels\b/iu,
      /\bthe RateLoop network, or separate hybrid subpanels\b/iu,
      /\bInvited and hybrid panels\b/iu,
      /\bA RateLoop network or hybrid panel\b/iu,
    ],
    requiredCapabilities: ["hybrid_review_lane"],
    policy: "gated",
  },
  {
    id: "gdpr_launch_compliance",
    phrase: "RateLoop is GDPR-compliant",
    patterns: [
      /\bRateLoop (?:is|remains) GDPR[- ]compliant\b/iu,
      /\bGDPR[- ]compliant RateLoop (?:service|platform|deployment)\b/iu,
    ],
    requiredCapabilities: ["gdpr_blockchain_dpia", "provider_transfer_inventory"],
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

const NEGATED_CERTIFICATION_DISCLAIMERS = [
  /\bdoes not (?:claim|demonstrate|establish|mean|show)[\s\S]{0,400}\bRateLoop is (?:SOC\s*2|ISO(?:\/IEC)?\s*42001|HIPAA)?[- ]?(?:certified|compliant|attested)/giu,
  /\bweist weder[\s\S]{0,400}\bnoch dass RateLoop[\s\S]{0,160}(?:zertifiziert|konform)/giu,
] as const;

const UNEARNED_VERIFIED_HOST_CLAIMS = [
  /\bverified host enforcement can\b/giu,
  /\bverified hosts? honors?\b/giu,
  /\b(?:is|remains)\s+(?:the\s+)?(?:primary|preferred)\s+verified\s+(?:path|host|integration)\b/giu,
  /\buse a verified host-enforced integration\b/giu,
] as const;

const VERIFIED_HOST_NECESSARY_CONDITIONS = [
  /\b(?:the active agent or |only )?a verified host (?:adapter|integration)[^.]{0,240}\b(?:can|must|may|owns?|controls?|enforces?|honors?|holds?|blocks?|keeps?)\b[^.]*\./giu,
  /\b(?:only )?a verified adapter[^.]{0,240}\b(?:is required|may be described)\b[^.]*\./giu,
  /\bhost-enforced\b[^.]{0,160}\bseparately verified adapter\b[^.]*\./giu,
] as const;

/**
 * Registry-driven guard for the delivery-control meaning of "verified".
 * Necessary-condition disclaimers remain useful, but while no adapter has
 * verification evidence they must state current unavailability beside the
 * claim. Unearned affirmative capability statements are always rejected.
 */
export function findVerifiedHostTierClaimViolations(source: string): PublicEvidenceClaimViolation[] {
  if (
    TOKENLESS_HOST_CAPABILITIES.some(
      host => (host.deliveryEnforcement as TokenlessHostDeliveryEnforcement) === "verified",
    )
  ) {
    return [];
  }

  const searchableSource = source.replace(/\s+/gu, " ");
  const violations: PublicEvidenceClaimViolation[] = [];
  const record = (matchedText: string) => {
    violations.push({
      claimId: "verified_host_delivery_enforcement",
      matchedText,
      missingCapabilities: [],
      phrase: "Verified host delivery enforcement is currently available",
      policy: "forbidden",
    });
  };

  for (const pattern of UNEARNED_VERIFIED_HOST_CLAIMS) {
    for (const match of searchableSource.matchAll(pattern)) record(match[0]);
  }

  const caveat = /\bno (?:available )?host currently (?:holds that tier|provides verified delivery enforcement)\b/iu;
  for (const pattern of VERIFIED_HOST_NECESSARY_CONDITIONS) {
    for (const match of searchableSource.matchAll(pattern)) {
      const index = match.index ?? 0;
      const nearby = searchableSource.slice(Math.max(0, index - 420), index + match[0].length + 420);
      if (!caveat.test(nearby)) record(match[0]);
    }
  }

  return violations;
}

export function findPublicEvidenceClaimViolations(
  source: string,
  capabilities: PublicEvidenceCapabilityState = PUBLIC_EVIDENCE_CAPABILITY_STATE,
): PublicEvidenceClaimViolation[] {
  const searchableSource = source.replace(/\s+/gu, " ");
  return PUBLIC_EVIDENCE_CLAIMS_MATRIX.flatMap(rule => {
    const ruleSource =
      rule.id === "unheld_certification"
        ? NEGATED_CERTIFICATION_DISCLAIMERS.reduce((value, pattern) => value.replace(pattern, " "), searchableSource)
        : searchableSource;
    const match = rule.patterns
      .map(pattern => ruleSource.match(pattern))
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
