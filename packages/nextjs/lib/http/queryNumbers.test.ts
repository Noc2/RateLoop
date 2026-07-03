import { isBlankQueryNumber, parseStrictPositiveQueryNumber, parseStrictUnsignedQueryNumber } from "./queryNumbers";
import assert from "node:assert/strict";
import test from "node:test";

test("parseStrictUnsignedQueryNumber accepts trimmed unsigned decimal integers", () => {
  assert.equal(parseStrictUnsignedQueryNumber("0"), 0);
  assert.equal(parseStrictUnsignedQueryNumber("42"), 42);
  assert.equal(parseStrictUnsignedQueryNumber(" 42 "), 42);
});

test("parseStrictUnsignedQueryNumber rejects partial, signed, decimal, blank, and unsafe values", () => {
  for (const value of ["42abc", "+42", "-1", "1.2", "", " ", "9007199254740993", null, undefined]) {
    assert.equal(parseStrictUnsignedQueryNumber(value), null);
  }
});

test("parseStrictPositiveQueryNumber requires a positive value", () => {
  assert.equal(parseStrictPositiveQueryNumber("1"), 1);
  assert.equal(parseStrictPositiveQueryNumber("0"), null);
  assert.equal(parseStrictPositiveQueryNumber("1junk"), null);
});

test("isBlankQueryNumber treats absent and whitespace values as omitted", () => {
  assert.equal(isBlankQueryNumber(null), true);
  assert.equal(isBlankQueryNumber(undefined), true);
  assert.equal(isBlankQueryNumber(" "), true);
  assert.equal(isBlankQueryNumber("0"), false);
});
