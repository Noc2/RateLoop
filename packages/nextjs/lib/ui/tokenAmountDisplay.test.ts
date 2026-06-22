import {
  formatEthTokenAmount,
  formatFixedTokenAmount,
  formatLrepTokenAmount,
  formatUsdcTokenAmount,
} from "./tokenAmountDisplay";
import assert from "node:assert/strict";
import test from "node:test";

test("fixed token formatter rounds half up and keeps requested decimals", () => {
  assert.equal(formatFixedTokenAmount(24_666_666n, { displayDecimals: 2, sourceDecimals: 6 }), "24.67");
  assert.equal(formatFixedTokenAmount(24_664_999n, { displayDecimals: 2, sourceDecimals: 6 }), "24.66");
  assert.equal(formatFixedTokenAmount(999_999n, { displayDecimals: 2, sourceDecimals: 6 }), "1.00");
  assert.equal(formatFixedTokenAmount(25_000_000n, { displayDecimals: 2, sourceDecimals: 6 }), "25.00");
});

test("wallet token formatters use RateLoop display precision", () => {
  assert.equal(formatLrepTokenAmount(25_064_000_000n), "25,064.00");
  assert.equal(formatLrepTokenAmount(10_000_000n), "10.00");
  assert.equal(formatUsdcTokenAmount(0n), "0.00");
  assert.equal(formatEthTokenAmount(19_974_000_000_000_000n), "0.0200");
  assert.equal(formatEthTokenAmount(1_234_567_890_000_000_000n), "1.2346");
});
