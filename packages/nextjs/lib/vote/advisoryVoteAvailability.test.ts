import {
  ADVISORY_COMMIT_AVAILABILITY_STATUS,
  getAdvisoryVoteUnavailableMessage,
  parseAdvisoryCommitAvailability,
} from "./advisoryVoteAvailability";
import assert from "node:assert/strict";
import test from "node:test";

test("parseAdvisoryCommitAvailability decodes tuple-shaped contract results", () => {
  const availability = parseAdvisoryCommitAvailability([
    true,
    ADVISORY_COMMIT_AVAILABILITY_STATUS.Available,
    7n,
    5_000,
    1_800n,
    `0x${"12".repeat(32)}`,
    100n,
    3n,
    567n,
    569n,
  ]);

  assert.equal(availability.canCommit, true);
  assert.equal(availability.roundId, 7n);
  assert.equal(availability.roundReferenceRatingBps, 5_000);
  assert.equal(availability.epochEnd, 1_800n);
  assert.equal(availability.minTargetRound, 567n);
  assert.equal(getAdvisoryVoteUnavailableMessage(availability), null);
});

test("getAdvisoryVoteUnavailableMessage explains missing staked rounds", () => {
  const message = getAdvisoryVoteUnavailableMessage({
    canCommit: false,
    status: ADVISORY_COMMIT_AVAILABILITY_STATUS.NoStakedRound,
  });
  assert.ok(message);
  assert.match(message, /after at least one staked rater/u);
});
