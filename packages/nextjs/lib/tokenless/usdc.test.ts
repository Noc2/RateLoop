import { formatUsdcAtomic, parseUsdcDecimal } from "./usdc";
import assert from "node:assert/strict";
import test from "node:test";

test("formatUsdcAtomic preserves exact values beyond Number safe precision", () => {
  assert.equal(formatUsdcAtomic("9007199254740993123456"), "9,007,199,254,740,993.123456 USDC");
  assert.equal(formatUsdcAtomic("-2650000"), "-2.65 USDC");
  assert.equal(formatUsdcAtomic("0"), "0 USDC");
});

test("formatUsdcAtomic supports exact display policies and BigInt rounding", () => {
  assert.equal(
    formatUsdcAtomic("1999999", { includeUnit: false, minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    "2.00",
  );
  assert.equal(formatUsdcAtomic("1000000", { includeUnit: false, useGrouping: false }), "1");
  assert.throws(() => formatUsdcAtomic("1", { minimumFractionDigits: 3, maximumFractionDigits: 2 }), RangeError);
});

test("parseUsdcDecimal converts signed decimal strings without floating point", () => {
  assert.equal(parseUsdcDecimal("1.000001"), "1000001");
  assert.equal(parseUsdcDecimal("-2.5"), "-2500000");
  assert.throws(() => parseUsdcDecimal("1.0000001"), /up to six decimal places/u);
  assert.throws(() => parseUsdcDecimal("1e3"), /decimal notation/u);
});
