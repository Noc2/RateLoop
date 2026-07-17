import { humanReviewConfirmationMessage } from "./humanReviewConfirmation";
import assert from "node:assert/strict";
import test from "node:test";

test("ordinary unpaid configurations save without an extra confirmation", () => {
  assert.equal(
    humanReviewConfirmationMessage({
      authority: "prepare_for_approval",
      bountyPerSeatAtomic: null,
      feedbackBonusPoolAtomic: null,
      panelSize: 2,
    }),
    null,
  );
});

test("automatic sending requires an extra confirmation", () => {
  const message = humanReviewConfirmationMessage({
    authority: "ask_automatically",
    bountyPerSeatAtomic: null,
    feedbackBonusPoolAtomic: null,
    panelSize: 2,
  });

  assert.match(message ?? "", /send review requests automatically, without another approval/u);
  assert.match(message ?? "", /Material already sent cannot be recalled/u);
});

test("reviewer spending requires an extra confirmation with the maximum amount", () => {
  const message = humanReviewConfirmationMessage({
    authority: "check_only",
    bountyPerSeatAtomic: "1500000",
    feedbackBonusPoolAtomic: "2000000",
    panelSize: 3,
  });

  assert.match(message ?? "", /6\.5 USDC per request/u);
  assert.match(message ?? "", /plus the base-review fee and attempt reserve/u);
});

test("automatic paid reviews combine both consequences in one confirmation", () => {
  const message = humanReviewConfirmationMessage({
    authority: "ask_automatically",
    bountyPerSeatAtomic: "1000000",
    feedbackBonusPoolAtomic: null,
    panelSize: 2,
  });

  assert.match(message ?? "", /send review requests automatically/u);
  assert.match(message ?? "", /2 USDC per request/u);
  assert.match(message ?? "", /Save this configuration\?$/u);
});
