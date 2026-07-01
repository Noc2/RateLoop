import {
  CONFIDENTIALITY_ESCROW_ABI,
  ERC20_INSUFFICIENT_ALLOWANCE_SELECTOR,
  getConfidentialityBondErrorMessage,
  getConfiguredConfidentialityEscrowAddress,
} from "./useConfidentialityBond";
import { strict as assert } from "node:assert";
import test from "node:test";
import { contracts } from "~~/utils/scaffold-eth/contract";

test("live confidentiality escrow metadata wins over a global public override", () => {
  const previousOverride = process.env.NEXT_PUBLIC_CONFIDENTIALITY_ESCROW_ADDRESS;
  const deploymentAddress = contracts?.[8453]?.ConfidentialityEscrow?.address;
  assert.ok(deploymentAddress, "Base mainnet ConfidentialityEscrow deployment is required for this test");
  process.env.NEXT_PUBLIC_CONFIDENTIALITY_ESCROW_ADDRESS = "0x000000000000000000000000000000000000dEaD";

  try {
    assert.equal(getConfiguredConfidentialityEscrowAddress(8453)?.toLowerCase(), deploymentAddress.toLowerCase());
  } finally {
    if (previousOverride === undefined) {
      delete process.env.NEXT_PUBLIC_CONFIDENTIALITY_ESCROW_ADDRESS;
    } else {
      process.env.NEXT_PUBLIC_CONFIDENTIALITY_ESCROW_ADDRESS = previousOverride;
    }
  }
});

test("confidentiality bond ABI decodes bubbled ERC20 allowance errors", () => {
  const errorNames = CONFIDENTIALITY_ESCROW_ABI.filter(item => item.type === "error").map(item => item.name);

  assert.ok(errorNames.includes("ERC20InsufficientAllowance"));
  assert.ok(errorNames.includes("ERC20InsufficientBalance"));
  assert.ok(errorNames.includes("SafeERC20FailedOperation"));
});

test("confidentiality bond errors hide raw ERC20 allowance selectors", () => {
  assert.equal(
    getConfidentialityBondErrorMessage(
      new Error(
        `The contract function "postBond" reverted with the following signature: ${ERC20_INSUFFICIENT_ALLOWANCE_SELECTOR}`,
      ),
      "LREP",
    ),
    "LREP approval was not high enough or was not visible yet. Retry the bond after the approval confirms.",
  );
});
