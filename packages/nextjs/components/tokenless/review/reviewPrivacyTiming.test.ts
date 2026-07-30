import assert from "node:assert/strict";
import test from "node:test";
import { PRIVATE_UNPAID_REVIEW_PRIVACY_CONTEXT } from "~~/components/tokenless/HumanAssuranceRaterClient";
import { PUBLIC_PAID_REVIEW_PRIVACY_CONTEXT } from "~~/components/tokenless/answer/PublicQuestionCard";
import {
  reviewForecastPrivacyMessage,
  reviewRatingPrivacyMessage,
} from "~~/components/tokenless/review/CrowdForecastField";

test("public paid and private unpaid rating consumers bind to distinct lifecycle timing", () => {
  assert.equal(
    reviewRatingPrivacyMessage(PUBLIC_PAID_REVIEW_PRIVACY_CONTEXT),
    "Submitting publishes a sealed rating. It becomes publicly decryptable after the commit deadline.",
  );
  assert.equal(
    reviewForecastPrivacyMessage(PUBLIC_PAID_REVIEW_PRIVACY_CONTEXT),
    "Your forecast is sealed on submission and becomes publicly decryptable after the commit deadline.",
  );
  assert.equal(
    reviewRatingPrivacyMessage(PRIVATE_UNPAID_REVIEW_PRIVACY_CONTEXT),
    "This private, unpaid rating stays off-chain and is recorded when you submit.",
  );
  assert.equal(
    reviewForecastPrivacyMessage(PRIVATE_UNPAID_REVIEW_PRIVACY_CONTEXT),
    "Your forecast stays off-chain and is recorded with this private, unpaid review when you submit.",
  );
});
