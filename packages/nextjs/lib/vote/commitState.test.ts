import { hasNonZeroCommit } from "./commitState";
import assert from "node:assert/strict";
import test from "node:test";

const zeroCommit = `0x${"0".repeat(64)}`;
const nonZeroCommit = `0x${"0".repeat(63)}1`;

test("hasNonZeroCommit detects direct advisory commit keys", () => {
  assert.equal(hasNonZeroCommit(nonZeroCommit), true);
  assert.equal(hasNonZeroCommit(zeroCommit), false);
});

test("hasNonZeroCommit detects nested staked commit state tuples", () => {
  assert.equal(hasNonZeroCommit([zeroCommit, nonZeroCommit]), true);
  assert.equal(hasNonZeroCommit([[zeroCommit, zeroCommit], zeroCommit]), false);
});
