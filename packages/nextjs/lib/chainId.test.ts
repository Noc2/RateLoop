import { parsePositiveIntegerChainId } from "./chainId";
import assert from "node:assert/strict";
import { test } from "node:test";

test("parsePositiveIntegerChainId accepts positive integer values", () => {
  assert.equal(parsePositiveIntegerChainId(8453), 8453);
  assert.equal(parsePositiveIntegerChainId("8453"), 8453);
  assert.equal(parsePositiveIntegerChainId(" 8453 "), 8453);
});

test("parsePositiveIntegerChainId rejects partial, decimal, and unsafe values", () => {
  for (const value of ["8453abc", "8453.1", "0", "-1", "", "9007199254740993", 8453.1, 0, null, undefined]) {
    assert.equal(parsePositiveIntegerChainId(value), null);
  }
});
