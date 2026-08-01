import assert from "node:assert/strict";
import test from "node:test";
import { deriveDsaReferenceNetworkLabel } from "~~/lib/tokenless/dsaReferenceNetworkProvenance";
import {
  classifyDsaConfusionCell,
  referenceOutcomeForNamedPanelPolicyChoice,
  referenceOutcomeForStoredAssuranceChoice,
  storedAssuranceChoiceForReferenceOutcome,
} from "~~/lib/tokenless/dsaReferenceOutcomes";

test("named policy choices and stored assurance choices share the Part 8 positive-class polarity", () => {
  const matches = referenceOutcomeForNamedPanelPolicyChoice("policy_matches");
  const doesNotMatch = referenceOutcomeForNamedPanelPolicyChoice("policy_does_not_match");

  assert.equal(matches, "fail");
  assert.equal(doesNotMatch, "pass");
  assert.equal(storedAssuranceChoiceForReferenceOutcome(matches), "baseline");
  assert.equal(storedAssuranceChoiceForReferenceOutcome(doesNotMatch), "candidate");
  assert.equal(referenceOutcomeForStoredAssuranceChoice("baseline"), matches);
  assert.equal(referenceOutcomeForStoredAssuranceChoice("candidate"), doesNotMatch);
  assert.equal(deriveDsaReferenceNetworkLabel("baseline"), matches);
  assert.equal(deriveDsaReferenceNetworkLabel("candidate"), doesNotMatch);
  assert.equal(referenceOutcomeForStoredAssuranceChoice("unsupported"), null);

  assert.equal(classifyDsaConfusionCell("fail", matches), "true_positive");
  assert.equal(classifyDsaConfusionCell("fail", doesNotMatch), "false_positive");
  assert.equal(classifyDsaConfusionCell("pass", doesNotMatch), "true_negative");
  assert.equal(classifyDsaConfusionCell("pass", matches), "false_negative");
});
