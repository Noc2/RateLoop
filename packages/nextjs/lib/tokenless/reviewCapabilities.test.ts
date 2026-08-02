import {
  HUMAN_REVIEW_CAPABILITY_CASES,
  HUMAN_REVIEW_IMPLEMENTATION_READINESS,
  type HumanReviewReadiness,
  configuredHumanReviewAudienceSources,
  configuredHumanReviewLaneForSelection,
  configuredHumanReviewLanes,
  deployedHumanReviewReadiness,
  directPrivateReviewForecastRequired,
  humanReviewLaneImplementation,
  resolveHumanReviewCapability,
} from "./reviewCapabilities";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { derivePaidLaneActivationReference } from "~~/lib/tokenless/paidLaneActivation";

const allReady: HumanReviewReadiness = {
  autonomousPublishing: true,
  evaluation: true,
  hybridPublicSafe: true,
  ownerApproval: true,
  privateInvitedPaid: true,
  privateInvitedUnpaid: true,
  publicPaidNetwork: true,
};

test("the canonical audience, privacy, and compensation matrix is frozen", () => {
  for (const entry of HUMAN_REVIEW_CAPABILITY_CASES) {
    const capability = resolveHumanReviewCapability(entry.input, allReady);
    assert.equal(capability.lane, entry.lane);
    assert.equal(capability.available, entry.structurallyValid);
  }
});

test("forecast collection stays off for ordinary unpaid review and on for paid RBTS settlement", () => {
  assert.equal(directPrivateReviewForecastRequired("unpaid"), false);
  assert.equal(directPrivateReviewForecastRequired("usdc"), true);
});

test("network and hybrid review reject unpaid or private material", () => {
  assert.equal(
    resolveHumanReviewCapability(
      {
        audience: "public_network",
        authority: "check_only",
        compensationMode: "unpaid",
        contentBoundary: "public_or_test",
      },
      allReady,
    ).code,
    "paid_network_required",
  );
  assert.equal(
    resolveHumanReviewCapability(
      {
        audience: "hybrid",
        authority: "check_only",
        compensationMode: "usdc",
        contentBoundary: "private_workspace",
      },
      allReady,
    ).code,
    "public_material_required",
  );
});

test("a recognized lane remains unavailable until its delivery capability is ready", () => {
  const capability = resolveHumanReviewCapability(
    {
      audience: "private_invited",
      authority: "ask_automatically",
      compensationMode: "usdc",
      contentBoundary: "private_workspace",
    },
    { ...allReady, privateInvitedPaid: false },
  );
  assert.equal(capability.available, false);
  assert.equal(capability.code, "private_paid_unavailable");
});

test("authority readiness is independent from lane readiness", () => {
  const capability = resolveHumanReviewCapability(
    {
      audience: "public_network",
      authority: "prepare_for_approval",
      compensationMode: "usdc",
      contentBoundary: "public_or_test",
    },
    { ...allReady, ownerApproval: false },
  );
  assert.equal(capability.available, false);
  assert.equal(capability.code, "owner_approval_unavailable");
});

test("deployed implementation readiness is shared without overstating hybrid delivery", () => {
  assert.deepEqual(HUMAN_REVIEW_IMPLEMENTATION_READINESS, {
    ownerApproval: true,
    privateInvitedUnpaid: true,
    privateInvitedPaid: false,
    publicPaidNetwork: false,
    hybridPublicSafe: false,
  });
  assert.deepEqual(deployedHumanReviewReadiness({ evaluation: true, autonomousPublishing: false }), {
    evaluation: true,
    autonomousPublishing: false,
    ...HUMAN_REVIEW_IMPLEMENTATION_READINESS,
  });
});

test("supported paid lanes require evidence-bound activation while hybrid stays unavailable", () => {
  assert.deepEqual(humanReviewLaneImplementation({}), {
    privateInvitedUnpaid: true,
    privateInvitedPaid: false,
    publicPaidNetwork: false,
    hybridPublicSafe: false,
  });
  const activation = {
    NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE: "",
    TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED: "true",
    TOKENLESS_NETWORK_PANELS_ENABLED: "true",
    TOKENLESS_HYBRID_REVIEWS_ENABLED: "true",
    NEXT_PUBLIC_TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED: "true",
    NEXT_PUBLIC_TOKENLESS_NETWORK_PANELS_ENABLED: "true",
    NEXT_PUBLIC_TOKENLESS_HYBRID_REVIEWS_ENABLED: "true",
    TOKENLESS_PAID_LANES_DPIA_APPROVAL_REFERENCE: `sha256:${"a".repeat(64)}`,
    TOKENLESS_PAID_LANES_TRANSFER_INVENTORY_APPROVAL_REFERENCE: `sha256:${"b".repeat(64)}`,
    TOKENLESS_PAID_LANES_FUNDING_VALIDATION_REFERENCE: `sha256:${"c".repeat(64)}`,
    TOKENLESS_INVITED_PAID_ADULTHOOD_APPROVAL_REFERENCE: `sha256:${"d".repeat(64)}`,
    TOKENLESS_PAID_LANES_COMPLIANCE_APPROVED_AT: "2026-07-25T12:00:00.000Z",
    WORLD_ID_APP_ID: "app_rateloopprod",
    WORLD_ID_RP_ID: "rp_rateloopprod",
    WORLD_ID_ENVIRONMENT: "production",
  };
  activation.NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE = derivePaidLaneActivationReference(activation);
  assert.deepEqual(humanReviewLaneImplementation(activation), {
    privateInvitedUnpaid: true,
    privateInvitedPaid: true,
    publicPaidNetwork: true,
    hybridPublicSafe: false,
  });
  assert.equal(
    humanReviewLaneImplementation({
      ...activation,
      NEXT_PUBLIC_TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED: "false",
    }).hybridPublicSafe,
    false,
  );
  assert.equal(
    humanReviewLaneImplementation({
      ...activation,
      NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE: `sha256:${"f".repeat(64)}`,
    }).publicPaidNetwork,
    false,
  );
  assert.equal(
    humanReviewLaneImplementation({
      ...activation,
      TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED: "false",
    }).privateInvitedPaid,
    false,
  );
});

test("capability defaults bind the public projection to exact server activation evidence", () => {
  const source = readFileSync(new URL("./reviewCapabilities.ts", import.meta.url), "utf8");
  for (const name of [
    "NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE",
    "NEXT_PUBLIC_TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED",
    "NEXT_PUBLIC_TOKENLESS_NETWORK_PANELS_ENABLED",
  ]) {
    assert.match(source, new RegExp(`process\\.env\\.${name}`, "u"));
  }
  assert.match(source, /derivePaidLaneActivationReference\(env\)/u);
  assert.match(source, /process\.env\.TOKENLESS_PAID_LANES_DPIA_APPROVAL_REFERENCE/u);
});

test("configured lane descriptions use the same implementation truth", () => {
  assert.deepEqual(configuredHumanReviewLanes(), {
    privateInvitedUnpaid: { available: true, message: "Implemented on this deployment." },
    privateInvitedPaid: {
      available: false,
      message:
        "Invited-review USDC settlement is implemented but unavailable until deployment funding and compliance approval are validated.",
    },
    publicPaidNetwork: {
      available: false,
      message:
        "Paid RateLoop network review is implemented but unavailable until identity, funding, deployment, and compliance activation are validated.",
    },
    hybridPublicSafe: {
      available: false,
      message:
        "Hybrid review is unavailable in this release until both child paths have durable release, terminal, expiry, and refund processing.",
    },
  });
  assert.deepEqual(configuredHumanReviewAudienceSources(), ["customer_invited"]);
  assert.equal(configuredHumanReviewLaneForSelection("private_invited", "unpaid").available, true);
  assert.equal(configuredHumanReviewLaneForSelection("private_invited", "usdc").available, false);
  assert.equal(configuredHumanReviewLaneForSelection("public_network", "usdc").available, false);
  assert.equal(configuredHumanReviewLaneForSelection("hybrid", "usdc").available, false);
});

test("owner approval is deployed while autonomous publishing remains grant-bound", () => {
  const readiness = deployedHumanReviewReadiness({ evaluation: true, autonomousPublishing: false });
  assert.equal(
    resolveHumanReviewCapability(
      {
        audience: "private_invited",
        authority: "prepare_for_approval",
        compensationMode: "unpaid",
        contentBoundary: "private_workspace",
      },
      readiness,
    ).code,
    "ready",
  );
  assert.equal(
    resolveHumanReviewCapability(
      {
        audience: "private_invited",
        authority: "ask_automatically",
        compensationMode: "unpaid",
        contentBoundary: "private_workspace",
      },
      readiness,
    ).code,
    "autonomous_publishing_unavailable",
  );
});
