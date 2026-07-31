import assert from "node:assert/strict";
import test from "node:test";
import {
  Rfc8785CanonicalizationError,
  canonicalizeRfc8785,
  sha256Hex,
  sha256Rfc8785,
} from "./jcs";

test("RFC 8785 canonicalizes the specification literals, numbers, and string escapes", () => {
  const value = {
    numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 1e-27],
    string: '\u20ac$\u000f\nA\'B"\\\\"/',
    literals: [null, true, false],
  };

  assert.equal(
    canonicalizeRfc8785(value),
    '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"\u20ac$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
  );
});

test("RFC 8785 sorts property names by UTF-16 code units", () => {
  const value = {
    "\u20ac": "Euro Sign",
    "\r": "Carriage Return",
    "\ufb33": "Hebrew Letter Dalet With Dagesh",
    "1": "One",
    "\ud83d\ude00": "Emoji: Grinning Face",
    "\u0080": "Control",
    "\u00f6": "Latin Small Letter O With Diaeresis",
  };

  assert.equal(
    canonicalizeRfc8785(value),
    '{"\\r":"Carriage Return","1":"One","\u0080":"Control","\u00f6":"Latin Small Letter O With Diaeresis","\u20ac":"Euro Sign","\ud83d\ude00":"Emoji: Grinning Face","\ufb33":"Hebrew Letter Dalet With Dagesh"}',
  );
});

test("RFC 8785 rejects values outside I-JSON", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const sparse = Array.from({ length: 1 }) as unknown[];
  delete sparse[0];

  for (const invalid of [
    undefined,
    1n,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    { nested: undefined },
    [undefined],
    sparse,
    "\ud800",
    { "\udc00": "invalid key" },
    new Date("2026-01-01T00:00:00.000Z"),
    cyclic,
  ]) {
    assert.throws(
      () => canonicalizeRfc8785(invalid),
      Rfc8785CanonicalizationError,
    );
  }
});

test("environment-neutral SHA-256 helpers match the standard vector", () => {
  assert.equal(
    sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(
    sha256Rfc8785({ b: 1, a: 2 }),
    "sha256:d3626ac30a87e6f7a6428233b3c68299976865fa5508e4267c5415c76af7a772",
  );
});
