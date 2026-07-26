import Module from "node:module";
import { createHash } from "node:crypto";

const TEST_PAID_LANE_ENV = {
  TOKENLESS_PAID_LANES_DPIA_APPROVAL_REFERENCE: `sha256:${"a".repeat(64)}`,
  TOKENLESS_PAID_LANES_TRANSFER_INVENTORY_APPROVAL_REFERENCE: `sha256:${"b".repeat(64)}`,
  TOKENLESS_PAID_LANES_FUNDING_VALIDATION_REFERENCE: `sha256:${"c".repeat(64)}`,
  TOKENLESS_INVITED_PAID_ADULTHOOD_APPROVAL_REFERENCE: `sha256:${"d".repeat(64)}`,
  TOKENLESS_PAID_LANES_COMPLIANCE_APPROVED_AT: "2026-07-20T12:00:00.000Z",
  TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED: "true",
  NEXT_PUBLIC_TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED: "true",
  TOKENLESS_NETWORK_PANELS_ENABLED: "true",
  NEXT_PUBLIC_TOKENLESS_NETWORK_PANELS_ENABLED: "true",
  TOKENLESS_HYBRID_REVIEWS_ENABLED: "false",
  NEXT_PUBLIC_TOKENLESS_HYBRID_REVIEWS_ENABLED: "false",
  WORLD_ID_APP_ID: "app_testfixture",
  WORLD_ID_RP_ID: "rp_testfixture",
  WORLD_ID_ENVIRONMENT: "production",
};

Object.assign(process.env, TEST_PAID_LANE_ENV);
const activationPayload = JSON.stringify({
  schemaVersion: "rateloop.paid-lane-activation.v1",
  approvedAt: TEST_PAID_LANE_ENV.TOKENLESS_PAID_LANES_COMPLIANCE_APPROVED_AT,
  dpiaApprovalReference: TEST_PAID_LANE_ENV.TOKENLESS_PAID_LANES_DPIA_APPROVAL_REFERENCE,
  transferInventoryApprovalReference: TEST_PAID_LANE_ENV.TOKENLESS_PAID_LANES_TRANSFER_INVENTORY_APPROVAL_REFERENCE,
  fundedDeploymentReference: TEST_PAID_LANE_ENV.TOKENLESS_PAID_LANES_FUNDING_VALIDATION_REFERENCE,
  invitedPaidAdulthoodApprovalReference: TEST_PAID_LANE_ENV.TOKENLESS_INVITED_PAID_ADULTHOOD_APPROVAL_REFERENCE,
  privatePaidEnabled: TEST_PAID_LANE_ENV.TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED,
  networkPanelsEnabled: TEST_PAID_LANE_ENV.TOKENLESS_NETWORK_PANELS_ENABLED,
  hybridEnabled: TEST_PAID_LANE_ENV.TOKENLESS_HYBRID_REVIEWS_ENABLED,
  worldIdAppId: TEST_PAID_LANE_ENV.WORLD_ID_APP_ID,
  worldIdRpId: TEST_PAID_LANE_ENV.WORLD_ID_RP_ID,
  worldIdEnvironment: TEST_PAID_LANE_ENV.WORLD_ID_ENVIRONMENT,
});
process.env.NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE =
  `sha256:${createHash("sha256").update(activationPayload).digest("hex")}`;

const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "server-only") {
    return {};
  }

  return Reflect.apply(originalLoad, this, [request, parent, isMain]);
};
