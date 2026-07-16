import type { AgentSetupReviewDraft } from "~~/lib/tokenless/workspaceAgentSetup";

type ReviewRequestProfile = AgentSetupReviewDraft["requestProfile"];
type ReviewRequestProfileInput = Omit<ReviewRequestProfile, "configurationStatus">;

export type ReviewAudienceFormValues = {
  audience: ReviewRequestProfile["audience"];
  privateSensitivity: Exclude<ReviewRequestProfile["privateSensitivity"], null>;
};

export const DEFAULT_PUBLIC_BOUNTY_PER_SEAT_ATOMIC = "1000000";

const POSITIVE_ATOMIC_PATTERN = /^[1-9][0-9]*$/u;
const PRIVATE_SENSITIVITY_ORDER = ["internal", "confidential", "restricted", "regulated"] as const;

export function reviewAudienceFormValues(profile: ReviewRequestProfile | null | undefined): ReviewAudienceFormValues {
  return {
    audience: profile?.audience ?? "private_invited",
    privateSensitivity: profile?.privateSensitivity ?? "confidential",
  };
}

export function privateClassificationsThrough(
  sensitivity: ReviewAudienceFormValues["privateSensitivity"],
): ReviewAudienceFormValues["privateSensitivity"][] {
  const maximum = PRIVATE_SENSITIVITY_ORDER.indexOf(sensitivity);
  if (maximum < 0) throw new Error("Choose a valid private-material sensitivity.");
  return PRIVATE_SENSITIVITY_ORDER.slice(0, maximum + 1);
}

export function buildReviewAudienceRequestProfile(
  profile: ReviewRequestProfile,
  values: ReviewAudienceFormValues,
): ReviewRequestProfileInput {
  const { configurationStatus: _configurationStatus, ...input } = profile;
  void _configurationStatus;
  if (values.audience === "private_invited") {
    return {
      ...input,
      audience: "private_invited",
      contentBoundary: "private_workspace",
      privateSensitivity: values.privateSensitivity,
    };
  }

  return {
    ...input,
    audience: values.audience,
    contentBoundary: "public_or_test",
    privateSensitivity: null,
    privateGroupId: values.audience === "public_network" ? null : profile.privateGroupId,
    panelSize: Math.max(profile.panelSize ?? 0, 3),
    compensationMode: "usdc",
    bountyPerSeatAtomic:
      typeof profile.bountyPerSeatAtomic === "string" && POSITIVE_ATOMIC_PATTERN.test(profile.bountyPerSeatAtomic)
        ? profile.bountyPerSeatAtomic
        : DEFAULT_PUBLIC_BOUNTY_PER_SEAT_ATOMIC,
  };
}
