import {
  PAID_LANE_HASH,
  derivePaidLaneActivationReference,
  paidLaneCodeReleased,
} from "~~/lib/tokenless/paidLaneActivation";

export const HUMAN_REVIEW_AUDIENCES = ["private_invited", "public_network", "hybrid"] as const;
export type HumanReviewAudience = (typeof HUMAN_REVIEW_AUDIENCES)[number];

export const HUMAN_REVIEW_COMPENSATION_MODES = ["unpaid", "usdc"] as const;
export type HumanReviewCompensationMode = (typeof HUMAN_REVIEW_COMPENSATION_MODES)[number];

export const HUMAN_REVIEW_CONTENT_BOUNDARIES = ["private_workspace", "public_or_test"] as const;
export type HumanReviewContentBoundary = (typeof HUMAN_REVIEW_CONTENT_BOUNDARIES)[number];

export const HUMAN_REVIEW_AUTHORITY_LEVELS = ["check_only", "prepare_for_approval", "ask_automatically"] as const;
export type HumanReviewAuthorityLevel = (typeof HUMAN_REVIEW_AUTHORITY_LEVELS)[number];

export type HumanReviewLane =
  | "private_invited_unpaid"
  | "private_invited_paid"
  | "public_paid_network"
  | "hybrid_public_safe";

export type HumanReviewReadiness = {
  evaluation: boolean;
  ownerApproval: boolean;
  autonomousPublishing: boolean;
  privateInvitedUnpaid: boolean;
  privateInvitedPaid: boolean;
  publicPaidNetwork: boolean;
  hybridPublicSafe: boolean;
};

export type HumanReviewLaneReadiness = Pick<
  HumanReviewReadiness,
  "privateInvitedUnpaid" | "privateInvitedPaid" | "publicPaidNetwork" | "hybridPublicSafe"
>;

export type GovernedReviewerExperiment =
  | "public_network"
  | "hybrid"
  | "feedback_bonus"
  | "surprisingly_popular"
  | "crowd_forecast";

export type HumanReviewMutationCapability = {
  available: boolean;
  experiment: GovernedReviewerExperiment | null;
  message: string;
};

/**
 * These capabilities are intentionally separate from the paid-lane deployment
 * gate. A paid-lane activation proves deployment, funding, and compliance
 * readiness; it does not authorize an ordinary customer or agent configuration
 * to become a public-safe benchmark experiment.
 *
 * Persisted, benchmark-scoped activation is available only through the
 * evidence-gated network benchmark service. Ordinary customer configuration
 * remains false even when one exact benchmark is active: its authorized
 * opportunities are enforced separately in PostgreSQL. Crowd Forecast and
 * Surprisingly Popular are implicit network-round mechanics, so keeping the
 * ordinary network control false also keeps them unreachable outside that
 * exact activation.
 */
export const GOVERNED_REVIEWER_EXPERIMENTS = {
  publicNetwork: false,
  hybrid: false,
  feedbackBonus: false,
  surprisinglyPopular: false,
  crowdForecast: false,
} as const;

/**
 * Paid binary panels need a prediction for RBTS settlement. An ordinary
 * private, unpaid review may collect one only when the separately governed
 * Crowd Forecast experiment is available.
 */
export function directPrivateReviewForecastRequired(compensationMode: HumanReviewCompensationMode) {
  return compensationMode === "usdc" || GOVERNED_REVIEWER_EXPERIMENTS.crowdForecast;
}

export function configuredHumanReviewMutationCapability(input: {
  audience: HumanReviewAudience;
  feedbackBonusEnabled: boolean;
}): HumanReviewMutationCapability {
  if (input.audience === "public_network") {
    return {
      available: GOVERNED_REVIEWER_EXPERIMENTS.publicNetwork,
      experiment: "public_network",
      message:
        "RateLoop-network review is reserved for a separately governed public-safe benchmark and is unavailable for ordinary customer or agent configuration.",
    };
  }
  if (input.audience === "hybrid") {
    return {
      available: GOVERNED_REVIEWER_EXPERIMENTS.hybrid,
      experiment: "hybrid",
      message: "Hybrid review is reserved and unavailable in this release.",
    };
  }
  if (input.feedbackBonusEnabled) {
    return {
      available: GOVERNED_REVIEWER_EXPERIMENTS.feedbackBonus,
      experiment: "feedback_bonus",
      message:
        "Feedback Bonus is a separately governed experiment and is unavailable for ordinary customer or agent configuration.",
    };
  }
  return { available: true, experiment: null, message: "This configuration can be saved." };
}

type HumanReviewActivationEnv = Readonly<Record<string, string | undefined>>;
const RUNTIME_HUMAN_REVIEW_ACTIVATION_ENV: HumanReviewActivationEnv = {
  NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE:
    process.env.NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE,
  NEXT_PUBLIC_TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED: process.env.NEXT_PUBLIC_TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED,
  NEXT_PUBLIC_TOKENLESS_NETWORK_PANELS_ENABLED: process.env.NEXT_PUBLIC_TOKENLESS_NETWORK_PANELS_ENABLED,
  NEXT_PUBLIC_TOKENLESS_HYBRID_REVIEWS_ENABLED: process.env.NEXT_PUBLIC_TOKENLESS_HYBRID_REVIEWS_ENABLED,
  TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED: process.env.TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED,
  TOKENLESS_NETWORK_PANELS_ENABLED: process.env.TOKENLESS_NETWORK_PANELS_ENABLED,
  TOKENLESS_HYBRID_REVIEWS_ENABLED: process.env.TOKENLESS_HYBRID_REVIEWS_ENABLED,
  TOKENLESS_PAID_LANES_DPIA_APPROVAL_REFERENCE: process.env.TOKENLESS_PAID_LANES_DPIA_APPROVAL_REFERENCE,
  TOKENLESS_PAID_LANES_TRANSFER_INVENTORY_APPROVAL_REFERENCE:
    process.env.TOKENLESS_PAID_LANES_TRANSFER_INVENTORY_APPROVAL_REFERENCE,
  TOKENLESS_PAID_LANES_FUNDING_VALIDATION_REFERENCE: process.env.TOKENLESS_PAID_LANES_FUNDING_VALIDATION_REFERENCE,
  TOKENLESS_INVITED_PAID_ADULTHOOD_APPROVAL_REFERENCE: process.env.TOKENLESS_INVITED_PAID_ADULTHOOD_APPROVAL_REFERENCE,
  TOKENLESS_PAID_LANES_COMPLIANCE_APPROVED_AT: process.env.TOKENLESS_PAID_LANES_COMPLIANCE_APPROVED_AT,
  WORLD_ID_APP_ID: process.env.WORLD_ID_APP_ID,
  WORLD_ID_RP_ID: process.env.WORLD_ID_RP_ID,
  WORLD_ID_ENVIRONMENT: process.env.WORLD_ID_ENVIRONMENT,
};

/**
 * Public configuration is deliberately only an availability projection. The
 * server independently verifies the matching signed-off activation evidence
 * before any paid reservation, voucher, round, or spend can be created.
 */
export function humanReviewLaneImplementation(
  env: HumanReviewActivationEnv = RUNTIME_HUMAN_REVIEW_ACTIVATION_ENV,
): HumanReviewLaneReadiness {
  const activationReference = env.NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE?.trim() ?? "";
  const activationBound =
    PAID_LANE_HASH.test(activationReference) && activationReference === derivePaidLaneActivationReference(env);
  const privateInvitedPaid =
    paidLaneCodeReleased("private_invited_paid") &&
    activationBound &&
    env.TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED?.trim() === "true" &&
    env.NEXT_PUBLIC_TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED?.trim() === "true";
  const publicPaidNetwork =
    paidLaneCodeReleased("public_paid_network") &&
    activationBound &&
    env.TOKENLESS_NETWORK_PANELS_ENABLED?.trim() === "true" &&
    env.NEXT_PUBLIC_TOKENLESS_NETWORK_PANELS_ENABLED?.trim() === "true";
  return {
    privateInvitedUnpaid: true,
    privateInvitedPaid,
    publicPaidNetwork,
    hybridPublicSafe:
      paidLaneCodeReleased("hybrid_public_safe") &&
      activationBound &&
      env.TOKENLESS_HYBRID_REVIEWS_ENABLED?.trim() === "true" &&
      env.NEXT_PUBLIC_TOKENLESS_HYBRID_REVIEWS_ENABLED?.trim() === "true",
  };
}

// A lane must pass both the immutable code-release rule and its evidence-bound
// hosted activation. Environment flags alone never assert implementation readiness.
export const HUMAN_REVIEW_LANE_IMPLEMENTATION = humanReviewLaneImplementation();

export const HUMAN_REVIEW_IMPLEMENTATION_READINESS = {
  ownerApproval: true,
  ...HUMAN_REVIEW_LANE_IMPLEMENTATION,
} as const satisfies Pick<
  HumanReviewReadiness,
  "ownerApproval" | "privateInvitedUnpaid" | "privateInvitedPaid" | "publicPaidNetwork" | "hybridPublicSafe"
>;

type HumanReviewLaneImplementationKey = keyof typeof HUMAN_REVIEW_LANE_IMPLEMENTATION;
export type HumanReviewAudienceSource = "customer_invited" | "rateloop_network" | "hybrid";

const HUMAN_REVIEW_LANE_UNAVAILABLE_MESSAGES: Record<HumanReviewLaneImplementationKey, string> = {
  privateInvitedUnpaid: "Invited unpaid review is unavailable on this deployment.",
  privateInvitedPaid:
    "Invited-review USDC settlement is unavailable in this release until its private task, identity, recovery, decision-binding, and terminal-evidence paths are complete.",
  publicPaidNetwork:
    "Paid RateLoop network review is implemented but unavailable until identity, funding, deployment, and compliance activation are validated.",
  hybridPublicSafe:
    "Hybrid review is unavailable in this release until both child paths have durable release, terminal, expiry, and refund processing.",
};

export function configuredHumanReviewLaneMessage(lane: HumanReviewLaneImplementationKey) {
  return HUMAN_REVIEW_LANE_IMPLEMENTATION[lane]
    ? "Implemented on this deployment."
    : HUMAN_REVIEW_LANE_UNAVAILABLE_MESSAGES[lane];
}

export function configuredHumanReviewLanes() {
  return {
    privateInvitedUnpaid: {
      available: HUMAN_REVIEW_LANE_IMPLEMENTATION.privateInvitedUnpaid,
      message: configuredHumanReviewLaneMessage("privateInvitedUnpaid"),
    },
    privateInvitedPaid: {
      available: HUMAN_REVIEW_LANE_IMPLEMENTATION.privateInvitedPaid,
      message: configuredHumanReviewLaneMessage("privateInvitedPaid"),
    },
    publicPaidNetwork: {
      available: HUMAN_REVIEW_LANE_IMPLEMENTATION.publicPaidNetwork,
      message: configuredHumanReviewLaneMessage("publicPaidNetwork"),
    },
    hybridPublicSafe: {
      available: HUMAN_REVIEW_LANE_IMPLEMENTATION.hybridPublicSafe,
      message: configuredHumanReviewLaneMessage("hybridPublicSafe"),
    },
  } as const;
}

export function configuredHumanReviewLaneForSelection(
  audience: HumanReviewAudience,
  compensationMode: HumanReviewCompensationMode,
) {
  const key: HumanReviewLaneImplementationKey =
    audience === "public_network"
      ? "publicPaidNetwork"
      : audience === "hybrid"
        ? "hybridPublicSafe"
        : compensationMode === "usdc"
          ? "privateInvitedPaid"
          : "privateInvitedUnpaid";
  return { key, ...configuredHumanReviewLanes()[key] };
}

export function configuredHumanReviewAudienceSources(): readonly HumanReviewAudienceSource[] {
  const sources: HumanReviewAudienceSource[] = [];
  if (HUMAN_REVIEW_LANE_IMPLEMENTATION.privateInvitedUnpaid || HUMAN_REVIEW_LANE_IMPLEMENTATION.privateInvitedPaid) {
    sources.push("customer_invited");
  }
  if (HUMAN_REVIEW_LANE_IMPLEMENTATION.publicPaidNetwork) sources.push("rateloop_network");
  if (HUMAN_REVIEW_LANE_IMPLEMENTATION.hybridPublicSafe) sources.push("hybrid");
  return sources;
}

export function deployedHumanReviewReadiness(
  runtime: Pick<HumanReviewReadiness, "evaluation" | "autonomousPublishing">,
): HumanReviewReadiness {
  return { ...runtime, ...HUMAN_REVIEW_IMPLEMENTATION_READINESS };
}

export type HumanReviewCapabilityInput = {
  audience: HumanReviewAudience;
  compensationMode: HumanReviewCompensationMode;
  contentBoundary: HumanReviewContentBoundary;
  authority: HumanReviewAuthorityLevel;
};

export type HumanReviewCapability = {
  available: boolean;
  code:
    | "ready"
    | "evaluation_unavailable"
    | "public_material_required"
    | "paid_network_required"
    | "private_unpaid_unavailable"
    | "private_paid_unavailable"
    | "public_network_unavailable"
    | "hybrid_unavailable"
    | "owner_approval_unavailable"
    | "autonomous_publishing_unavailable";
  lane: HumanReviewLane;
  message: string;
};

const READY: Pick<HumanReviewCapability, "available" | "code" | "message"> = {
  available: true,
  code: "ready",
  message: "This review path is ready.",
};

function unavailable(
  lane: HumanReviewLane,
  code: Exclude<HumanReviewCapability["code"], "ready">,
  message: string,
): HumanReviewCapability {
  return { available: false, code, lane, message };
}

function resolveLane(input: HumanReviewCapabilityInput): HumanReviewCapability | HumanReviewLane {
  if (input.audience === "public_network") {
    if (input.contentBoundary !== "public_or_test") {
      return unavailable(
        "public_paid_network",
        "public_material_required",
        "RateLoop network reviews accept only public, synthetic, or owner-confirmed redacted material.",
      );
    }
    if (input.compensationMode !== "usdc") {
      return unavailable(
        "public_paid_network",
        "paid_network_required",
        "RateLoop network reviewers must be paid in USDC.",
      );
    }
    return "public_paid_network";
  }
  if (input.audience === "hybrid") {
    if (input.contentBoundary !== "public_or_test") {
      return unavailable(
        "hybrid_public_safe",
        "public_material_required",
        "Hybrid review accepts only material approved for both invited and public-network reviewers.",
      );
    }
    if (input.compensationMode !== "usdc") {
      return unavailable(
        "hybrid_public_safe",
        "paid_network_required",
        "Hybrid review must fund the RateLoop network cohort in USDC.",
      );
    }
    return "hybrid_public_safe";
  }
  return input.compensationMode === "usdc" ? "private_invited_paid" : "private_invited_unpaid";
}

export function resolveHumanReviewCapability(
  input: HumanReviewCapabilityInput,
  readiness: HumanReviewReadiness,
): HumanReviewCapability {
  const resolvedLane = resolveLane(input);
  if (typeof resolvedLane !== "string") return resolvedLane;
  const lane = resolvedLane;
  if (!readiness.evaluation) {
    return unavailable(lane, "evaluation_unavailable", "The connected host cannot evaluate review requirements.");
  }
  if (input.authority === "prepare_for_approval" && !readiness.ownerApproval) {
    return unavailable(lane, "owner_approval_unavailable", "Owner approval handoffs are not ready for this workspace.");
  }
  if (input.authority === "ask_automatically" && !readiness.autonomousPublishing) {
    return unavailable(
      lane,
      "autonomous_publishing_unavailable",
      "Autonomous publishing is not ready for this workspace.",
    );
  }
  if (lane === "private_invited_unpaid" && !readiness.privateInvitedUnpaid) {
    return unavailable(lane, "private_unpaid_unavailable", "Invited unpaid review delivery is not ready.");
  }
  if (lane === "private_invited_paid" && !readiness.privateInvitedPaid) {
    return unavailable(lane, "private_paid_unavailable", "Invited paid review delivery is not ready.");
  }
  if (lane === "public_paid_network" && !readiness.publicPaidNetwork) {
    return unavailable(lane, "public_network_unavailable", "The paid RateLoop reviewer network is not ready.");
  }
  if (lane === "hybrid_public_safe" && !readiness.hybridPublicSafe) {
    return unavailable(lane, "hybrid_unavailable", "Hybrid review delivery is not ready.");
  }
  return { ...READY, lane };
}

export const HUMAN_REVIEW_CAPABILITY_CASES: ReadonlyArray<{
  input: HumanReviewCapabilityInput;
  lane: HumanReviewLane;
  structurallyValid: boolean;
}> = [
  {
    input: {
      audience: "private_invited",
      authority: "check_only",
      compensationMode: "unpaid",
      contentBoundary: "private_workspace",
    },
    lane: "private_invited_unpaid",
    structurallyValid: true,
  },
  {
    input: {
      audience: "private_invited",
      authority: "check_only",
      compensationMode: "usdc",
      contentBoundary: "private_workspace",
    },
    lane: "private_invited_paid",
    structurallyValid: true,
  },
  {
    input: {
      audience: "public_network",
      authority: "check_only",
      compensationMode: "usdc",
      contentBoundary: "public_or_test",
    },
    lane: "public_paid_network",
    structurallyValid: true,
  },
  {
    input: {
      audience: "hybrid",
      authority: "check_only",
      compensationMode: "usdc",
      contentBoundary: "public_or_test",
    },
    lane: "hybrid_public_safe",
    structurallyValid: true,
  },
  {
    input: {
      audience: "public_network",
      authority: "check_only",
      compensationMode: "unpaid",
      contentBoundary: "public_or_test",
    },
    lane: "public_paid_network",
    structurallyValid: false,
  },
  {
    input: {
      audience: "hybrid",
      authority: "check_only",
      compensationMode: "usdc",
      contentBoundary: "private_workspace",
    },
    lane: "hybrid_public_safe",
    structurallyValid: false,
  },
];
