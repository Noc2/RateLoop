import { sha256, stringToBytes } from "viem";

export const PAID_LANE_ACTIVATION_SCHEMA = "rateloop.paid-lane-activation.v1";
export const PAID_LANE_HASH = /^sha256:[0-9a-f]{64}$/u;

export type PaidLane = "private_invited_paid" | "public_paid_network" | "hybrid_public_safe";
type PaidLaneActivationEnv = Readonly<Record<string, string | undefined>>;

function value(env: PaidLaneActivationEnv, name: string) {
  return env[name]?.trim() ?? "";
}

export function derivePaidLaneActivationReference(env: PaidLaneActivationEnv): `sha256:${string}` {
  const payload = JSON.stringify({
    schemaVersion: PAID_LANE_ACTIVATION_SCHEMA,
    approvedAt: value(env, "TOKENLESS_PAID_LANES_COMPLIANCE_APPROVED_AT"),
    dpiaApprovalReference: value(env, "TOKENLESS_PAID_LANES_DPIA_APPROVAL_REFERENCE"),
    transferInventoryApprovalReference: value(env, "TOKENLESS_PAID_LANES_TRANSFER_INVENTORY_APPROVAL_REFERENCE"),
    fundedDeploymentReference: value(env, "TOKENLESS_PAID_LANES_FUNDING_VALIDATION_REFERENCE"),
    invitedPaidAdulthoodApprovalReference: value(env, "TOKENLESS_INVITED_PAID_ADULTHOOD_APPROVAL_REFERENCE"),
    privatePaidEnabled: value(env, "TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED"),
    networkPanelsEnabled: value(env, "TOKENLESS_NETWORK_PANELS_ENABLED"),
    hybridEnabled: value(env, "TOKENLESS_HYBRID_REVIEWS_ENABLED"),
    worldIdAppId: value(env, "WORLD_ID_APP_ID"),
    worldIdRpId: value(env, "WORLD_ID_RP_ID"),
    worldIdEnvironment: value(env, "WORLD_ID_ENVIRONMENT"),
  });
  return `sha256:${sha256(stringToBytes(payload)).slice(2)}`;
}

function requireFlagPair(
  errors: string[],
  env: PaidLaneActivationEnv,
  serverName: string,
  publicName: string,
  required: boolean,
) {
  const server = value(env, serverName);
  const published = value(env, publicName);
  if (!["true", "false"].includes(server) || !["true", "false"].includes(published)) {
    errors.push(`${serverName} and ${publicName} must each be exactly true or false.`);
    return;
  }
  if (server !== published) {
    errors.push(`${serverName} and ${publicName} must match.`);
  }
  if (required && server !== "true") {
    errors.push(`${serverName} must be true before this paid review lane can activate.`);
  }
}

export function validatePaidLaneActivation(lane: PaidLane, env: PaidLaneActivationEnv, now = new Date()): string[] {
  const errors: string[] = [];
  const privateRequired = lane === "private_invited_paid" || lane === "hybrid_public_safe";
  const networkRequired = lane === "public_paid_network" || lane === "hybrid_public_safe";
  requireFlagPair(
    errors,
    env,
    "TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED",
    "NEXT_PUBLIC_TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED",
    privateRequired,
  );
  requireFlagPair(
    errors,
    env,
    "TOKENLESS_NETWORK_PANELS_ENABLED",
    "NEXT_PUBLIC_TOKENLESS_NETWORK_PANELS_ENABLED",
    networkRequired,
  );
  requireFlagPair(
    errors,
    env,
    "TOKENLESS_HYBRID_REVIEWS_ENABLED",
    "NEXT_PUBLIC_TOKENLESS_HYBRID_REVIEWS_ENABLED",
    lane === "hybrid_public_safe",
  );

  for (const name of [
    "TOKENLESS_PAID_LANES_DPIA_APPROVAL_REFERENCE",
    "TOKENLESS_PAID_LANES_TRANSFER_INVENTORY_APPROVAL_REFERENCE",
    "TOKENLESS_PAID_LANES_FUNDING_VALIDATION_REFERENCE",
  ]) {
    if (!PAID_LANE_HASH.test(value(env, name))) errors.push(`${name} must be an exact SHA-256 evidence reference.`);
  }
  if (privateRequired && !PAID_LANE_HASH.test(value(env, "TOKENLESS_INVITED_PAID_ADULTHOOD_APPROVAL_REFERENCE"))) {
    errors.push(
      "TOKENLESS_INVITED_PAID_ADULTHOOD_APPROVAL_REFERENCE must record the invited-rater adulthood decision.",
    );
  }

  const approvedAt = new Date(value(env, "TOKENLESS_PAID_LANES_COMPLIANCE_APPROVED_AT"));
  if (!Number.isFinite(approvedAt.getTime()) || approvedAt > now) {
    errors.push("TOKENLESS_PAID_LANES_COMPLIANCE_APPROVED_AT must be a valid non-future timestamp.");
  }

  if (networkRequired) {
    if (value(env, "WORLD_ID_ENVIRONMENT") !== "production") {
      errors.push("WORLD_ID_ENVIRONMENT must be production before the public reviewer network can activate.");
    }
    if (!/^app_[A-Za-z0-9_-]{8,128}$/u.test(value(env, "WORLD_ID_APP_ID"))) {
      errors.push("WORLD_ID_APP_ID must identify the registered production World ID application.");
    }
    if (!/^rp_[A-Za-z0-9_-]{8,128}$/u.test(value(env, "WORLD_ID_RP_ID"))) {
      errors.push("WORLD_ID_RP_ID must identify the registered production World ID relying party.");
    }
  }

  const publishedReference = value(env, "NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE");
  if (!PAID_LANE_HASH.test(publishedReference) || publishedReference !== derivePaidLaneActivationReference(env)) {
    errors.push(
      "NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE must match the exact server-side activation evidence.",
    );
  }
  return errors;
}
