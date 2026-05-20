import assert from "node:assert/strict";
import test from "node:test";
import { getVoteViewGroups, isScopedVoteViewOption } from "~~/lib/vote/viewOptions";

test("getVoteViewGroups hides wallet-only entries when disconnected", () => {
  const groups = getVoteViewGroups(false);

  assert.deepEqual(
    groups.map(group => group.label),
    ["Rate"],
  );
  assert.equal(
    groups[0]?.options.some(option => option.value === "watched"),
    false,
  );
  assert.equal(
    groups[0]?.options.some(option => option.value === "contested"),
    false,
  );
  assert.equal(
    groups[0]?.options.some(option => option.value === "zero_lrep_vote"),
    false,
  );
});

test("getVoteViewGroups includes activity entries when connected", () => {
  const groups = getVoteViewGroups(true);

  assert.deepEqual(
    groups.map(group => group.label),
    ["Rate", "Your Activity"],
  );
  assert.equal(
    groups[1]?.options.some(option => option.value === "my_votes"),
    true,
  );
  assert.equal(
    groups[0]?.options.some(option => option.value === "zero_lrep_vote"),
    true,
  );
  assert.equal(
    groups[1]?.options.some(option => option.value === "zero_lrep_vote"),
    false,
  );
  assert.equal(
    groups[0]?.options.some(option => option.label === "0 LREP Vote"),
    true,
  );
  assert.equal(
    groups[1]?.options.some(option => option.label === "Your Settling Soon"),
    false,
  );
});

test("isScopedVoteViewOption identifies non-discover scoped views", () => {
  assert.equal(isScopedVoteViewOption("trending"), false);
  assert.equal(isScopedVoteViewOption("my_submissions"), true);
  assert.equal(isScopedVoteViewOption("zero_lrep_vote"), true);
});
