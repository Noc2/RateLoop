import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyDsaConfusionCell,
  referenceOutcomeForNamedPanelPolicyChoice,
  referenceOutcomeForStoredAssuranceChoice,
} from "~~/lib/tokenless/dsaReferenceOutcomes";

test("named policy choices and stored assurance choices share the Part 8 positive-class polarity", () => {
  const matches = referenceOutcomeForNamedPanelPolicyChoice("policy_matches");
  const doesNotMatch = referenceOutcomeForNamedPanelPolicyChoice("policy_does_not_match");

  assert.equal(matches, "fail");
  assert.equal(doesNotMatch, "pass");
  assert.equal(referenceOutcomeForStoredAssuranceChoice("candidate"), matches);
  assert.equal(referenceOutcomeForStoredAssuranceChoice("baseline"), doesNotMatch);
  assert.equal(referenceOutcomeForStoredAssuranceChoice("unsupported"), null);

  assert.equal(classifyDsaConfusionCell("fail", matches), "true_positive");
  assert.equal(classifyDsaConfusionCell("fail", doesNotMatch), "false_positive");
  assert.equal(classifyDsaConfusionCell("pass", doesNotMatch), "true_negative");
  assert.equal(classifyDsaConfusionCell("pass", matches), "false_negative");
});
