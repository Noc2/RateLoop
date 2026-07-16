import {
  HUMAN_REVIEW_CAPABILITY_CASES,
  type HumanReviewReadiness,
  resolveHumanReviewCapability,
} from "./reviewCapabilities";
import assert from "node:assert/strict";
import test from "node:test";

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
