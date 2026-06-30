import { formatTokenBalance, treasuryAddressesDiffer, truncateAddress } from "./TreasuryBalance";
import assert from "node:assert/strict";
import test from "node:test";

test("formatTokenBalance renders 6-decimal token balances with two decimals", () => {
  assert.equal(formatTokenBalance(undefined), "—");
  assert.equal(formatTokenBalance(0n), "0");
  assert.equal(formatTokenBalance(1_000_000n), "1");
  assert.equal(formatTokenBalance(1_234_567n), "1.23");
  assert.equal(formatTokenBalance(1_295_000n), "1.3");
  assert.equal(formatTokenBalance(123_456_789_123_456n), "123,456,789.12");
});

test("formatTokenBalance handles alternate decimal scales", () => {
  assert.equal(formatTokenBalance(123n, 0), "123");
  assert.equal(formatTokenBalance(12_345n, 2), "123.45");
  assert.equal(formatTokenBalance(-1_234_567n), "-1.23");
});

test("truncateAddress keeps compact treasury addresses readable", () => {
  assert.equal(truncateAddress(undefined), "—");
  assert.equal(truncateAddress("0x1234"), "0x1234");
  assert.equal(truncateAddress("0x1234567890abcdef1234567890abcdef12345678"), "0x1234...5678");
});

test("treasuryAddressesDiffer compares configured treasury addresses case-insensitively", () => {
  const address = "0x1234567890abcdef1234567890abcdef12345678";
  assert.equal(treasuryAddressesDiffer(undefined, address), false);
  assert.equal(treasuryAddressesDiffer(address, address.toUpperCase()), false);
  assert.equal(treasuryAddressesDiffer(address, "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"), true);
});
