import {
  buildReviewExpertiseRequestProfile,
  reviewExpertiseEligibilityStatus,
  reviewExpertiseFormValues,
} from "./reviewExpertise";
import assert from "node:assert/strict";
import { test } from "node:test";

test("expertise requirements are normalized into the request profile", () => {
  assert.deepEqual(reviewExpertiseFormValues(undefined), { requiredExpertiseKeys: [] });
  const profile = buildReviewExpertiseRequestProfile({} as never, {
    requiredExpertiseKeys: ["code-review:typescript", "legal:privacy-compliance"],
  });
  assert.deepEqual(profile.requiredExpertiseKeys, ["code-review:typescript", "legal:privacy-compliance"]);
});

test("expertise eligibility requires the selected panel size in the correct audience lane", () => {
  const eligibility = {
    eligible: 3,
    invited: { eligible: 2 },
    network: { eligible: 1, ready: true },
  };
  assert.equal(
    reviewExpertiseEligibilityStatus({
      audience: "private_invited",
      eligibility,
      panelSize: 3,
      requiredExpertiseCount: 1,
    }).feasible,
    false,
  );
  assert.equal(
    reviewExpertiseEligibilityStatus({
      audience: "public_network",
      eligibility,
      panelSize: 2,
      requiredExpertiseCount: 1,
    }).feasible,
    false,
  );
  assert.deepEqual(
    reviewExpertiseEligibilityStatus({
      audience: "hybrid",
      eligibility,
      panelSize: 3,
      requiredExpertiseCount: 1,
    }),
    {
      feasible: true,
      summary: "3 of 3 reviewers needed are eligible, including 2 invited and 1 public-network.",
    },
  );
});
