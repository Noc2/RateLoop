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

export const HUMAN_REVIEW_LANE_IMPLEMENTATION = {
  privateInvitedUnpaid: true,
  privateInvitedPaid: true,
  publicPaidNetwork: true,
  hybridPublicSafe: false,
} as const satisfies Pick<
  HumanReviewReadiness,
  "privateInvitedUnpaid" | "privateInvitedPaid" | "publicPaidNetwork" | "hybridPublicSafe"
>;

export const HUMAN_REVIEW_IMPLEMENTATION_READINESS = {
  ownerApproval: true,
  ...HUMAN_REVIEW_LANE_IMPLEMENTATION,
} as const satisfies Pick<
  HumanReviewReadiness,
  "ownerApproval" | "privateInvitedUnpaid" | "privateInvitedPaid" | "publicPaidNetwork" | "hybridPublicSafe"
>;

type HumanReviewLaneImplementationKey = keyof typeof HUMAN_REVIEW_LANE_IMPLEMENTATION;

const HUMAN_REVIEW_LANE_UNAVAILABLE_MESSAGES: Record<HumanReviewLaneImplementationKey, string> = {
  privateInvitedUnpaid: "Invited unpaid review delivery is not implemented yet.",
  privateInvitedPaid: "Invited-review USDC settlement is not implemented yet.",
  publicPaidNetwork: "Paid RateLoop reviewer network delivery is not implemented yet.",
  hybridPublicSafe: "Hybrid invited and public delivery is not implemented yet.",
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
