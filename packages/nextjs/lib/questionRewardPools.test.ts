import {
  formatUsdAmount,
  getConfiguredQuestionRewardPoolEscrowAddress,
  getDefaultUsdcAddress,
  getDefaultUsdcDisplayName,
  parseConfidentialityBondAmount,
  parseUsdRewardPoolAmount,
} from "./questionRewardPools";
import assert from "node:assert/strict";
import test from "node:test";
import { contracts } from "~~/utils/scaffold-eth/contract";

test("parseUsdRewardPoolAmount accepts plain decimal USDC amounts", () => {
  assert.equal(parseUsdRewardPoolAmount("10"), 10_000_000n);
  assert.equal(parseUsdRewardPoolAmount("1234.56"), 1_234_560_000n);
  assert.equal(parseUsdRewardPoolAmount("0.000001"), 1n);
});

// Codex P2 follow-up to L-9: cent rounding must carry into the whole-dollar portion
// when the rounded cent value would otherwise be 100 (e.g. 1_999_999 micro -> "$2.00",
// not "$1.100"). These cases also pin the L-9 behaviour (0.005 USD -> $0.01) so the
// two fixes can't accidentally regress in opposite directions.
test("formatUsdAmount carries whole dollars when cents would round to 100", () => {
  assert.equal(formatUsdAmount(1_999_999n), "$2.00");
  assert.equal(formatUsdAmount(999_999n), "$1.00");
  assert.equal(formatUsdAmount(10_999_999n), "$11.00");
  assert.equal(formatUsdAmount(999_999_999_999n), "$1,000,000.00");
});

test("formatUsdAmount rounds 0.005 USD up to $0.01 and 0.004999 down to $0.00", () => {
  assert.equal(formatUsdAmount(5_000n), "$0.01");
  assert.equal(formatUsdAmount(4_999n), "$0.00");
});

test("formatUsdAmount keeps whole-dollar inputs as $N with no trailing decimals", () => {
  assert.equal(formatUsdAmount(0n), "$0");
  assert.equal(formatUsdAmount(1_000_000n), "$1");
  assert.equal(formatUsdAmount(10_000_000_000n), "$10,000");
});

test("parseUsdRewardPoolAmount accepts comma-grouped USD amounts", () => {
  assert.equal(parseUsdRewardPoolAmount("1,000"), 1_000_000_000n);
  assert.equal(parseUsdRewardPoolAmount("1,234.56"), 1_234_560_000n);
  assert.equal(parseUsdRewardPoolAmount("12,345,678.901234"), 12_345_678_901_234n);
});

test("parseUsdRewardPoolAmount rejects ambiguous or malformed comma input", () => {
  assert.equal(parseUsdRewardPoolAmount("1,5"), null);
  assert.equal(parseUsdRewardPoolAmount("1,2,3"), null);
  assert.equal(parseUsdRewardPoolAmount("12,34.56"), null);
  assert.equal(parseUsdRewardPoolAmount("1,000.1234567"), null);
});

test("parseConfidentialityBondAmount allows no bond and whole-token bonds", () => {
  assert.equal(parseConfidentialityBondAmount("0"), 0n);
  assert.equal(parseConfidentialityBondAmount("0.000000"), 0n);
  assert.equal(parseConfidentialityBondAmount("1"), 1_000_000n);
  assert.equal(parseConfidentialityBondAmount("1,234.56"), 1_234_560_000n);
});

test("parseConfidentialityBondAmount rejects dust and malformed bonds", () => {
  assert.equal(parseConfidentialityBondAmount("0.000001"), null);
  assert.equal(parseConfidentialityBondAmount("0.999999"), null);
  assert.equal(parseConfidentialityBondAmount("1.0000001"), null);
  assert.equal(parseConfidentialityBondAmount("1,2"), null);
});

test("getConfiguredQuestionRewardPoolEscrowAddress rejects mismatched production overrides", () => {
  const env = process.env as Record<string, string | undefined>;
  const originalNodeEnv = env.NODE_ENV;
  const originalOverride = env.NEXT_PUBLIC_QUESTION_REWARD_POOL_ESCROW_ADDRESS;
  const deployedAddress = getConfiguredQuestionRewardPoolEscrowAddress(31337);
  assert.ok(deployedAddress);

  try {
    env.NODE_ENV = "production";
    env.NEXT_PUBLIC_QUESTION_REWARD_POOL_ESCROW_ADDRESS = deployedAddress.toLowerCase();
    assert.equal(getConfiguredQuestionRewardPoolEscrowAddress(31337)?.toLowerCase(), deployedAddress.toLowerCase());

    env.NEXT_PUBLIC_QUESTION_REWARD_POOL_ESCROW_ADDRESS = "0x000000000000000000000000000000000000bEEF";
    assert.throws(
      () => getConfiguredQuestionRewardPoolEscrowAddress(999999),
      /requires a shared QuestionRewardPoolEscrow deployment/,
    );

    env.NEXT_PUBLIC_QUESTION_REWARD_POOL_ESCROW_ADDRESS = "0x000000000000000000000000000000000000dEaD";
    assert.throws(
      () => getConfiguredQuestionRewardPoolEscrowAddress(31337),
      /must match the shared QuestionRewardPoolEscrow deployment/,
    );
  } finally {
    if (originalNodeEnv === undefined) {
      delete env.NODE_ENV;
    } else {
      env.NODE_ENV = originalNodeEnv;
    }
    if (originalOverride === undefined) {
      delete env.NEXT_PUBLIC_QUESTION_REWARD_POOL_ESCROW_ADDRESS;
    } else {
      env.NEXT_PUBLIC_QUESTION_REWARD_POOL_ESCROW_ADDRESS = originalOverride;
    }
  }
});

test("getDefaultUsdcAddress uses local MockERC20 before World Chain defaults", () => {
  const env = process.env as Record<string, string | undefined>;
  const originalOverride = env.NEXT_PUBLIC_USDC_ADDRESS;
  assert.ok(contracts);
  const localMockUsdcAddress = (contracts[31337] as Record<string, { address?: string }>).MockERC20.address;
  assert.ok(localMockUsdcAddress);

  try {
    delete env.NEXT_PUBLIC_USDC_ADDRESS;
    assert.equal(getDefaultUsdcAddress(31337)?.toLowerCase(), localMockUsdcAddress.toLowerCase());
    assert.equal(getDefaultUsdcDisplayName(31337), "Mock USDC");
    assert.equal(getDefaultUsdcAddress(480), "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1");
  } finally {
    if (originalOverride === undefined) {
      delete env.NEXT_PUBLIC_USDC_ADDRESS;
    } else {
      env.NEXT_PUBLIC_USDC_ADDRESS = originalOverride;
    }
  }
});
