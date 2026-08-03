import assert from "node:assert/strict";
import test from "node:test";
import {
  PAID_LANE_CODE_RELEASED,
  derivePaidLaneActivationReference,
  validatePaidLaneActivation,
} from "~~/lib/tokenless/paidLaneActivation";

const hash = (character: string) => `sha256:${character.repeat(64)}`;

function activeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    TOKENLESS_PAID_LANES_DPIA_APPROVAL_REFERENCE: hash("a"),
    TOKENLESS_PAID_LANES_TRANSFER_INVENTORY_APPROVAL_REFERENCE: hash("b"),
    TOKENLESS_PAID_LANES_FUNDING_VALIDATION_REFERENCE: hash("c"),
    TOKENLESS_INVITED_PAID_ADULTHOOD_APPROVAL_REFERENCE: hash("d"),
    TOKENLESS_PAID_LANES_COMPLIANCE_APPROVED_AT: "2026-07-20T12:00:00.000Z",
    TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED: "false",
    NEXT_PUBLIC_TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED: "false",
    TOKENLESS_NETWORK_PANELS_ENABLED: "true",
    NEXT_PUBLIC_TOKENLESS_NETWORK_PANELS_ENABLED: "true",
    TOKENLESS_HYBRID_REVIEWS_ENABLED: "false",
    NEXT_PUBLIC_TOKENLESS_HYBRID_REVIEWS_ENABLED: "false",
    WORLD_ID_APP_ID: "app_production123",
    WORLD_ID_RP_ID: "rp_production123",
    WORLD_ID_ENVIRONMENT: "production",
  };
  env.NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE = derivePaidLaneActivationReference(env);
  return env;
}

test("exact external evidence activates only lanes released in code", () => {
  const env = activeEnv();
  const now = new Date("2026-07-26T12:00:00.000Z");
  assert.deepEqual(validatePaidLaneActivation("public_paid_network", env, now), []);
  assert.match(
    validatePaidLaneActivation("private_invited_paid", env, now).join("\n"),
    /unavailable.*encrypted task.*post-commit response recovery.*under-quorum evidence/u,
  );
  assert.match(validatePaidLaneActivation("hybrid_public_safe", env, now).join("\n"), /unavailable.*terminal.*refund/u);
  assert.deepEqual(PAID_LANE_CODE_RELEASED, {
    private_invited_paid: false,
    public_paid_network: true,
    hybrid_public_safe: false,
  });
});

test("public flags cannot activate a server lane or counterfeit its evidence reference", () => {
  const env = activeEnv();
  env.TOKENLESS_NETWORK_PANELS_ENABLED = "false";
  assert.match(
    validatePaidLaneActivation("public_paid_network", env).join("\n"),
    /must match|must be true|must match the exact server-side activation evidence/u,
  );

  const forged = activeEnv();
  forged.NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE = hash("f");
  assert.match(
    validatePaidLaneActivation("public_paid_network", forged).join("\n"),
    /must match the exact server-side/u,
  );
});

test("unreleased lanes fail closed even when every flag and external dependency is enabled", () => {
  const forged = activeEnv();
  forged.TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED = "true";
  forged.NEXT_PUBLIC_TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED = "true";
  forged.TOKENLESS_HYBRID_REVIEWS_ENABLED = "true";
  forged.NEXT_PUBLIC_TOKENLESS_HYBRID_REVIEWS_ENABLED = "true";
  forged.NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE = derivePaidLaneActivationReference(forged);
  assert.deepEqual(validatePaidLaneActivation("hybrid_public_safe", forged), [
    "hybrid_public_safe is unavailable until both child paths have production release, terminal, expiry, and refund processing.",
  ]);
  assert.match(validatePaidLaneActivation("private_invited_paid", forged).join("\n"), /unavailable.*decision binding/u);
});
