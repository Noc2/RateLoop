import { parsePositiveIntegerChainId } from "./chainId";
import assert from "node:assert/strict";
import { test } from "node:test";

test("parsePositiveIntegerChainId accepts positive integer values", () => {
  assert.equal(parsePositiveIntegerChainId(84532), 84532);
  assert.equal(parsePositiveIntegerChainId("84532"), 84532);
  assert.equal(parsePositiveIntegerChainId(" 84532 "), 84532);
});

test("parsePositiveIntegerChainId rejects partial, decimal, and unsafe values", () => {
  for (const value of ["84532abc", "84532.1", "0", "-1", "", "9007199254740993", 84532.1, 0, null, undefined]) {
    assert.equal(parsePositiveIntegerChainId(value), null);
  }
});
