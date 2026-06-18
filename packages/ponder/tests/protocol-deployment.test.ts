import { describe, expect, it } from "vitest";
import { getSharedDeploymentAddress } from "@rateloop/contracts/deployments";
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

  it("accepts explicit chain ids that match the configured network", () => {
    const contentRegistryAddress = "0x1000000000000000000000000000000000000001";
    const feedbackRegistryAddress = "0x1000000000000000000000000000000000000002";
    const metadata = resolvePonderProtocolDeploymentMetadata({
      PONDER_NETWORK: "hardhat",
      PONDER_CHAIN_ID: "31337",
      PONDER_CONTENT_REGISTRY_ADDRESS: contentRegistryAddress,
      PONDER_FEEDBACK_REGISTRY_ADDRESS: feedbackRegistryAddress,
    });

    expect(metadata?.chainId).toBe(31337);
    expect(metadata?.deploymentKey).toBe(
      buildPonderProtocolDeploymentKey({
        chainId: 31337,
        contentRegistryAddress,
        feedbackRegistryAddress,
      }),
    );
  });

  it("allows local deployment keys from explicit hardhat chain ids without a network name", () => {
    const contentRegistryAddress = "0x1000000000000000000000000000000000000001";
    const feedbackRegistryAddress = "0x1000000000000000000000000000000000000002";
    const metadata = resolvePonderProtocolDeploymentMetadata({
      PONDER_CHAIN_ID: "31337",
      PONDER_CONTENT_REGISTRY_ADDRESS: contentRegistryAddress,
      PONDER_FEEDBACK_REGISTRY_ADDRESS: feedbackRegistryAddress,
    });

    expect(metadata).toEqual({
      configured: true,
      network: null,
      chainId: 31337,
      contentRegistryAddress,
      feedbackRegistryAddress,
      deploymentKey: buildPonderProtocolDeploymentKey({
        chainId: 31337,
        contentRegistryAddress,
        feedbackRegistryAddress,
      }),
      databaseSchema: null,
    });
  });

  it("resolves Base Sepolia deployment keys from shared artifacts over stale env", () => {
    const staleContentRegistryAddress = "0x1000000000000000000000000000000000000001";
    const staleFeedbackRegistryAddress = "0x1000000000000000000000000000000000000002";
    const contentRegistryAddress = getSharedDeploymentAddress(84532, "ContentRegistry")?.toLowerCase() as
      | `0x${string}`
      | undefined;
    const feedbackRegistryAddress = getSharedDeploymentAddress(84532, "FeedbackRegistry")?.toLowerCase() as
      | `0x${string}`
      | undefined;
    expect(contentRegistryAddress).toBeDefined();
    expect(feedbackRegistryAddress).toBeDefined();

    const metadata = resolvePonderProtocolDeploymentMetadata({
      PONDER_NETWORK: "baseSepolia",
      PONDER_CHAIN_ID: "84532",
      PONDER_CONTENT_REGISTRY_ADDRESS: staleContentRegistryAddress,
      PONDER_FEEDBACK_REGISTRY_ADDRESS: staleFeedbackRegistryAddress,
      DATABASE_SCHEMA: "rateloop_ponder_base_sepolia",
    });

    expect(metadata).toEqual({
      configured: true,
      network: "baseSepolia",
      chainId: 84532,
      contentRegistryAddress: contentRegistryAddress!,
      feedbackRegistryAddress: feedbackRegistryAddress!,
      deploymentKey: buildPonderProtocolDeploymentKey({
        chainId: 84532,
        contentRegistryAddress: contentRegistryAddress!,
        feedbackRegistryAddress: feedbackRegistryAddress!,
      }),
      databaseSchema: "rateloop_ponder_base_sepolia",
    });
  });

  it("does not configure unknown live chains from env-only contract addresses", () => {
    expect(
      resolvePonderProtocolDeploymentMetadata({
        PONDER_CHAIN_ID: "999999",
        PONDER_CONTENT_REGISTRY_ADDRESS: "0x1000000000000000000000000000000000000001",
        PONDER_FEEDBACK_REGISTRY_ADDRESS: "0x1000000000000000000000000000000000000002",
      }),
    ).toBeNull();
  });

  it("rejects explicit Base chain ids that do not match the configured network", () => {
    expect(() =>
      resolvePonderProtocolDeploymentMetadata({
        PONDER_NETWORK: "base",
        PONDER_CHAIN_ID: "84532",
        PONDER_CONTENT_REGISTRY_ADDRESS: "0x1000000000000000000000000000000000000001",
        PONDER_FEEDBACK_REGISTRY_ADDRESS: "0x1000000000000000000000000000000000000002",
      }),
    ).toThrow("PONDER_CHAIN_ID 84532 does not match PONDER_NETWORK base (8453).");
  });

  it("rejects explicit chain ids that do not match the configured network", () => {
    expect(() =>
      resolvePonderProtocolDeploymentMetadata({
        PONDER_NETWORK: "hardhat",
        PONDER_CHAIN_ID: "4801",
        PONDER_CONTENT_REGISTRY_ADDRESS: "0x1000000000000000000000000000000000000001",
        PONDER_FEEDBACK_REGISTRY_ADDRESS: "0x1000000000000000000000000000000000000002",
      }),
    ).toThrow("PONDER_CHAIN_ID 4801 does not match PONDER_NETWORK hardhat (31337).");
  });

  it("returns null without a known chain", () => {
    expect(resolvePonderProtocolDeploymentMetadata({ PONDER_NETWORK: "unknown" })).toBeNull();
  });
});
