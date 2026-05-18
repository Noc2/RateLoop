import { resolveVotingQuestionCardDisplayError } from "./votingQuestionCardStatus";
import assert from "node:assert/strict";
import test from "node:test";

test("resolveVotingQuestionCardDisplayError hides round fallback while cooldown is active", () => {
  assert.equal(
    resolveVotingQuestionCardDisplayError({
      cooldownActive: true,
      error: null,
      roundNotAcceptingMessage: "This round is not accepting votes right now.",
    }),
    null,
  );
});

test("resolveVotingQuestionCardDisplayError hides duplicate cooldown errors", () => {
  assert.equal(
    resolveVotingQuestionCardDisplayError({
      cooldownActive: true,
      error: "You already voted on this content within the last 24 hours. Try again in 23h 59m.",
      roundNotAcceptingMessage: "This round is not accepting votes right now.",
    }),
    null,
  );
});

test("resolveVotingQuestionCardDisplayError keeps explicit non-cooldown errors", () => {
  assert.equal(
    resolveVotingQuestionCardDisplayError({
      cooldownActive: true,
      error: "Wallet rejected the vote.",
      roundNotAcceptingMessage: "This round is not accepting votes right now.",
    }),
    "Wallet rejected the vote.",
  );
});
