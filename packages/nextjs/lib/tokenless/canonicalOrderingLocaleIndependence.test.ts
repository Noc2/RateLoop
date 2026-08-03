import { canonicalizeRfc8785 } from "@rateloop/node-utils/jcs";
import assert from "node:assert/strict";
import test from "node:test";

/**
 * Canonical orderings that feed a digest, a signature or a persisted byte
 * comparison must depend only on the input, never on the host.
 *
 * `localeCompare` with no locale argument uses the default ICU collation, which
 * varies with the Node build (full-icu vs small-icu), the ICU version and
 * `LANG`/`LC_ALL`. Every existing ordering test in this repository uses
 * lowercase ASCII keys, which happen to sort identically under both
 * comparators — so none of them catches the bug. These fixtures do.
 */

/** Keys chosen so ICU collation and UTF-16 code-unit order genuinely disagree. */
const CASE_MIXED = { Z: 1, a: 2 };
const PUNCTUATED = { "x-amz-meta-a": 1, "x-amz-metaa": 2 };
const NON_ASCII = { ö: 1, z: 2, "€": 3, A: 4 };

function byCodeUnit(left: string, right: string) {
  return left === right ? 0 : left < right ? -1 : 1;
}

test("ICU collation and code-unit order really do disagree on these fixtures", () => {
  // Guards the fixtures themselves: if this ever fails, the cases below have
  // stopped exercising the difference and need replacing.
  assert.notEqual(
    Math.sign("Z".localeCompare("a")),
    Math.sign(byCodeUnit("Z", "a")),
    "expected ICU to order 'a' before 'Z' and code units to do the opposite",
  );
});

test("RFC 8785 canonicalization orders keys by code unit, not by locale", () => {
  assert.equal(canonicalizeRfc8785(CASE_MIXED), '{"Z":1,"a":2}');
  assert.equal(canonicalizeRfc8785(PUNCTUATED), '{"x-amz-meta-a":1,"x-amz-metaa":2}');
});

test("RFC 8785 canonicalization is stable across insertion order", () => {
  assert.equal(canonicalizeRfc8785({ a: 2, Z: 1 }), canonicalizeRfc8785({ Z: 1, a: 2 }));
  assert.equal(canonicalizeRfc8785({ A: 4, z: 2, "€": 3, ö: 1 }), canonicalizeRfc8785(NON_ASCII));
});

test("RFC 8785 canonicalization does not depend on the process locale", () => {
  // `Intl.Collator` honours the ambient locale; the canonicalizer must not.
  const before = canonicalizeRfc8785(NON_ASCII);
  const previous = process.env.LANG;
  try {
    for (const locale of ["C", "en_US.UTF-8", "de_DE.UTF-8", "sv_SE.UTF-8"]) {
      process.env.LANG = locale;
      assert.equal(canonicalizeRfc8785(NON_ASCII), before, `canonical bytes changed under LANG=${locale}`);
    }
  } finally {
    if (previous === undefined) delete process.env.LANG;
    else process.env.LANG = previous;
  }
});

test("nested objects and arrays keep code-unit ordering throughout", () => {
  assert.equal(
    canonicalizeRfc8785({ b: { Z: 1, a: 2 }, A: [{ z: 1, B: 2 }] }),
    '{"A":[{"B":2,"z":1}],"b":{"Z":1,"a":2}}',
  );
});
