import deployedContracts from "@rateloop/contracts/deployedContracts";
import type { Address } from "viem";
import { isAddress } from "viem";

type DeployedContractRecord = {
  address?: Address;
};
type DeployedContractsMap = Record<number, Record<string, DeployedContractRecord | undefined>>;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const deployments = deployedContracts as unknown as Partial<DeployedContractsMap>;

export interface ProtocolDeploymentScope {
  chainId: number;
  contentRegistryAddress: `0x${string}`;
  feedbackRegistryAddress: `0x${string}`;
  deploymentKey: string;
}

interface ContentDeploymentScope {
  chainId: number;
  contentRegistryAddress: `0x${string}`;
  deploymentKey: string;
}

function normalizeRequiredAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== "string" || !isAddress(value) || value.toLowerCase() === ZERO_ADDRESS) {
    return null;
  }

  return value.toLowerCase() as `0x${string}`;
}

function buildProtocolDeploymentKey(params: {
  chainId: number;
  contentRegistryAddress: `0x${string}`;
  feedbackRegistryAddress: `0x${string}`;
}) {
  return [
    String(params.chainId),
    params.contentRegistryAddress.toLowerCase(),
    params.feedbackRegistryAddress.toLowerCase(),
  ].join(":");
}

function buildContentDeploymentKey(params: { chainId: number; contentRegistryAddress: `0x${string}` }) {
  return [String(params.chainId), params.contentRegistryAddress.toLowerCase()].join(":");
}

export function resolveContentDeploymentScope(chainId: number): ContentDeploymentScope | null {
  const contractsForChain = deployments[chainId];
  const contentRegistryAddress = normalizeRequiredAddress(contractsForChain?.ContentRegistry?.address);
  if (!contentRegistryAddress) {
    return null;
  }

  return {
    chainId,
    contentRegistryAddress,
    deploymentKey: buildContentDeploymentKey({
      chainId,
      contentRegistryAddress,
    }),
  };
}

export function resolveProtocolDeploymentScope(chainId: number): ProtocolDeploymentScope | null {
  const contractsForChain = deployments[chainId];
  const contentRegistryAddress = normalizeRequiredAddress(contractsForChain?.ContentRegistry?.address);
  const feedbackRegistryAddress = normalizeRequiredAddress(contractsForChain?.FeedbackRegistry?.address);
  if (!contentRegistryAddress || !feedbackRegistryAddress) {
    return null;
  }

  return {
    chainId,
    contentRegistryAddress,
    feedbackRegistryAddress,
    deploymentKey: buildProtocolDeploymentKey({
      chainId,
      contentRegistryAddress,
      feedbackRegistryAddress,
    }),
  };
}
