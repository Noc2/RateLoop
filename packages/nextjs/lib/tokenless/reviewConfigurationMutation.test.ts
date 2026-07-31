import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  GOVERNED_REVIEWER_EXPERIMENTS,
  configuredHumanReviewMutationCapability,
} from "~~/lib/tokenless/reviewCapabilities";
import { assertHumanReviewMutationAvailable } from "~~/lib/tokenless/reviewConfigurationMutation";
import { normalizeManagedReviewPolicyInput } from "~~/lib/tokenless/reviewPolicyManagement";
import { normalizeReviewRequestProfileInput } from "~~/lib/tokenless/reviewRequestProfiles";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const profileSource = readFileSync(new URL("./reviewRequestProfiles.ts", import.meta.url), "utf8");
const policySource = readFileSync(new URL("./reviewPolicyManagement.ts", import.meta.url), "utf8");
const configurationSource = readFileSync(new URL("./humanReviewConfiguration.ts", import.meta.url), "utf8");

const PRIVATE_PROFILE = {
  agentId: "agent_mutation_boundary",
  agentVersionId: "agent_version_mutation_boundary",
  questionAuthority: "owner_fixed",
  criterion: "Is this response safe?",
  positiveLabel: "Yes",
  negativeLabel: "No",
  rationaleMode: "optional",
  audience: "private_invited",
  contentBoundary: "private_workspace",
  privateSensitivity: "internal",
  privateGroupId: "group_mutation_boundary",
  privateGroupPolicyVersion: 1,
  privateGroupPolicyHash: `sha256:${"a".repeat(64)}`,
  responseWindowSeconds: 3_600,
  panelSize: 2,
  compensationMode: "unpaid",
  bountyPerSeatAtomic: null,
  feedbackBonusEnabled: false,
  feedbackBonusPoolAtomic: null,
  feedbackBonusAwarderKind: "requester",
  feedbackBonusAwarderAccount: null,
  feedbackBonusAwardWindowSeconds: null,
} as const;

function unavailable(action: () => unknown, experiment: string) {
  assert.throws(
    action,
    (error: unknown) =>
      error instanceof TokenlessServiceError &&
      error.status === 409 &&
      error.code === "human_review_experiment_unavailable" &&
      configuredHumanReviewMutationCapability({
        audience: experiment === "feedback_bonus" ? "private_invited" : (experiment as "public_network" | "hybrid"),
        feedbackBonusEnabled: experiment === "feedback_bonus",
      }).message === error.message,
  );
}

test("all review-configuration consumers share the closed experiment boundary", () => {
  const privateProfile = normalizeReviewRequestProfileInput(PRIVATE_PROFILE);
  assert.equal(assertHumanReviewMutationAvailable(privateProfile).available, true);

  const publicProfile = normalizeReviewRequestProfileInput({
    ...PRIVATE_PROFILE,
    audience: "public_network",
    contentBoundary: "public_or_test",
    privateSensitivity: null,
    privateGroupId: null,
    privateGroupPolicyVersion: null,
    privateGroupPolicyHash: null,
    panelSize: 3,
    compensationMode: "usdc",
    bountyPerSeatAtomic: "1000000",
  });
  unavailable(() => assertHumanReviewMutationAvailable(publicProfile), "public_network");

  const hybridProfile = normalizeReviewRequestProfileInput({
    ...PRIVATE_PROFILE,
    audience: "hybrid",
    contentBoundary: "public_or_test",
    privateSensitivity: null,
    panelSize: 4,
    compensationMode: "usdc",
    bountyPerSeatAtomic: "1000000",
  });
  unavailable(() => assertHumanReviewMutationAvailable(hybridProfile), "hybrid");

  const feedbackProfile = normalizeReviewRequestProfileInput({
    ...PRIVATE_PROFILE,
    feedbackBonusEnabled: true,
    feedbackBonusPoolAtomic: "2000000",
    feedbackBonusAwardWindowSeconds: 604_800,
  });
  unavailable(() => assertHumanReviewMutationAvailable(feedbackProfile), "feedback_bonus");

  const publicPolicy = normalizeManagedReviewPolicyInput({
    agentId: "agent_mutation_boundary",
    agentVersionId: "agent_version_mutation_boundary",
    mode: "always",
    enforcementMode: "advisory",
    agreementThresholdBps: 8_000,
    productionFloorBps: 10_000,
    maximumUnreviewedGap: 1,
    requiredRiskTiers: [],
    criticalRiskTiers: [],
    audience: "public_network",
  });
  unavailable(
    () => assertHumanReviewMutationAvailable({ audience: publicPolicy.audience, feedbackBonusEnabled: false }),
    "public_network",
  );

  for (const source of [profileSource, policySource, configurationSource]) {
    assert.match(source, /assertHumanReviewMutationAvailable\(/u);
  }
});

test("network mechanics stay unreachable until their own benchmark evidence exists", () => {
  assert.deepEqual(GOVERNED_REVIEWER_EXPERIMENTS, {
    publicNetwork: false,
    hybrid: false,
    feedbackBonus: false,
    surprisinglyPopular: false,
    crowdForecast: false,
  });
});
