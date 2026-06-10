import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, canonicalJsonHash } from "./json";

test("canonicalJson sorts object keys recursively and stringifies bigints", () => {
  const value = {
    z: 3,
    a: {
      d: 4n,
      b: "two",
      c: [{ y: 2, x: 1 }],
    },
  };

  const expected =
    '{"a":{"b":"two","c":[{"x":1,"y":2}],"d":"4"},"z":3}';

  assert.equal(canonicalJson(value), expected);
  assert.equal(
    canonicalJsonHash(value),
    "0xf3e039f285b99832fc58b3325113460c5c0136f57b8636578b7d23648baff8d8",
  );
});
