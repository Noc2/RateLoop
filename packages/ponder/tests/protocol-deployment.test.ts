import { describe, expect, it } from "vitest";
import {
  buildPonderProtocolDeploymentKey,
  resolvePonderProtocolDeploymentMetadata,
} from "../src/protocol-deployment.js";

describe("Ponder protocol deployment metadata", () => {
  it("reports deployment keys from configured local contract addresses", () => {
    const contentRegistryAddress = "0x1000000000000000000000000000000000000001";
    const feedbackRegistryAddress = "0x1000000000000000000000000000000000000002";
    const metadata = resolvePonderProtocolDeploymentMetadata({
      PONDER_NETWORK: "hardhat",
      PONDER_CONTENT_REGISTRY_ADDRESS: contentRegistryAddress,
      PONDER_FEEDBACK_REGISTRY_ADDRESS: feedbackRegistryAddress,
      DATABASE_SCHEMA: "rateloop_ponder_test",
    });

    expect(metadata).toEqual({
      configured: true,
      network: "hardhat",
      chainId: 31337,
      contentRegistryAddress,
      feedbackRegistryAddress,
      deploymentKey: buildPonderProtocolDeploymentKey({
        chainId: 31337,
        contentRegistryAddress,
        feedbackRegistryAddress,
      }),
      databaseSchema: "rateloop_ponder_test",
    });
  });

  it("returns null without a known chain", () => {
    expect(resolvePonderProtocolDeploymentMetadata({ PONDER_NETWORK: "unknown" })).toBeNull();
  });
});
