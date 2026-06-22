import { getConfiguredConfidentialityEscrowAddress } from "./useConfidentialityBond";
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
