import { RaterRegistryAbi } from "@rateloop/contracts/abis";
import deployedContracts from "@rateloop/contracts/deployedContracts";
import "server-only";
import {
  type Hex,
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  keccak256,
  padHex,
  toBytes,
  toHex,
} from "viem";
import { type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import { getServerRpcOverrides, getServerTargetNetworkById } from "~~/lib/env/server";
import { getKeystoreAccount } from "~~/utils/keystore";

const BASE_MULTIPLIER_BPS = 10_000;
const DEFAULT_CREDENTIAL_TTL_SECONDS = 365 * 24 * 60 * 60;
const LOCAL_FOUNDRY_CHAIN_ID = 31_337;

type SelfCredentialRecord = {
  verified: boolean;
  legacy: boolean;
  revoked: boolean;
  nullifierHash: Hex;
  expiresAt: bigint;
};

export type WorldIdAttestationResult = {
  status: "attested" | "already_active";
  raterRegistry: Hex;
  attestor: Hex | null;
  transactionHash: Hex | null;
  nullifierHash: Hex;
  expiresAt: number;
};

export class WorldIdAttestationError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "WorldIdAttestationError";
    this.status = status;
  }
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function normalizePrivateKey(value: string | undefined): Hex | null {
  const candidate = value?.trim();
  if (!candidate || !/^0x[0-9a-fA-F]{64}$/.test(candidate)) {
    return null;
  }

  return candidate as Hex;
}

function getCredentialTtlSeconds() {
  const parsed = Number.parseInt(readEnv("WORLD_ID_CREDENTIAL_TTL_SECONDS") ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 60) {
    return DEFAULT_CREDENTIAL_TTL_SECONDS;
  }

  return parsed;
}

function getWorldIdAttestorAccount(chainId: number): PrivateKeyAccount | null {
  const explicitKey = normalizePrivateKey(readEnv("WORLD_ID_ATTESTOR_PRIVATE_KEY"));
  if (explicitKey) {
    return privateKeyToAccount(explicitKey);
  }

  const keystoreAccount = getKeystoreAccount();
  if (keystoreAccount) {
    return keystoreAccount;
  }

  const localFallbackKey =
    process.env.NODE_ENV !== "production" && chainId === LOCAL_FOUNDRY_CHAIN_ID
      ? normalizePrivateKey(readEnv("FAUCET_PRIVATE_KEY"))
      : null;

  return localFallbackKey ? privateKeyToAccount(localFallbackKey) : null;
}

function getRaterRegistryAddress(chainId: number): Hex | null {
  const chainContracts = deployedContracts[chainId as keyof typeof deployedContracts] as
    | { RaterRegistry?: { address?: string } }
    | undefined;
  const address = chainContracts?.RaterRegistry?.address;
  return address && isAddress(address, { strict: false }) ? (getAddress(address) as Hex) : null;
}

function getRpcUrl(chainId: number) {
  const network = getServerTargetNetworkById(chainId);
  if (!network) {
    throw new WorldIdAttestationError("This chain is not enabled for server-side World ID attestation.", 400);
  }

  const rpcUrl = getServerRpcOverrides()[chainId] ?? network.rpcUrls.default.http[0];
  if (!rpcUrl) {
    throw new WorldIdAttestationError("No RPC URL is configured for World ID attestation.", 503);
  }

  return { network, rpcUrl };
}

export function normalizeWorldIdNullifierHash(value: string | null | undefined): Hex | null {
  const trimmedValue = value?.trim();
  if (!trimmedValue) {
    return null;
  }

  if (/^0x[0-9a-fA-F]+$/.test(trimmedValue)) {
    const hexValue = trimmedValue.toLowerCase() as Hex;
    if (hexValue.length > 66) {
      return keccak256(hexValue);
    }

    return padHex(hexValue, { size: 32 });
  }

  if (/^\d+$/.test(trimmedValue)) {
    try {
      return toHex(BigInt(trimmedValue), { size: 32 });
    } catch {
      return null;
    }
  }

  return keccak256(toBytes(trimmedValue));
}

function getScopeHash(rpId: string, action: string): Hex {
  return keccak256(toBytes(`world-id-v4:${rpId}:${action}`));
}

function getEvidenceHash(options: { rpId: string; action: string; signalHash: string | null }): Hex {
  return keccak256(toBytes(`world-id-v4:${options.rpId}:${options.action}:${options.signalHash ?? "no-signal"}`));
}

function isActiveCredentialForNullifier(credential: SelfCredentialRecord, nullifierHash: Hex, blockTimestamp: bigint) {
  return (
    credential.verified &&
    !credential.legacy &&
    !credential.revoked &&
    credential.expiresAt > blockTimestamp &&
    credential.nullifierHash.toLowerCase() === nullifierHash.toLowerCase()
  );
}

export async function attestWorldIdCredential(options: {
  walletAddress: string;
  chainId: number;
  nullifier: string | null;
  action: string;
  rpId: string;
  signalHash: string | null;
}): Promise<WorldIdAttestationResult> {
  if (!isAddress(options.walletAddress, { strict: false })) {
    throw new WorldIdAttestationError("A valid wallet address is required for World ID attestation.", 400);
  }

  const walletAddress = getAddress(options.walletAddress);
  const nullifierHash = normalizeWorldIdNullifierHash(options.nullifier);
  if (!nullifierHash) {
    throw new WorldIdAttestationError("World ID verification did not return a usable nullifier.", 502);
  }

  const raterRegistry = getRaterRegistryAddress(options.chainId);
  if (!raterRegistry) {
    throw new WorldIdAttestationError("RaterRegistry is not deployed on this chain.", 503);
  }

  const { network, rpcUrl } = getRpcUrl(options.chainId);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: network, transport });
  const block = await publicClient.getBlock();
  const currentCredential = (await publicClient.readContract({
    address: raterRegistry,
    abi: RaterRegistryAbi,
    functionName: "getSelfCredential",
    args: [walletAddress],
  })) as SelfCredentialRecord;
  const expiresAt = Number(block.timestamp) + getCredentialTtlSeconds();

  if (isActiveCredentialForNullifier(currentCredential, nullifierHash, block.timestamp)) {
    return {
      status: "already_active",
      raterRegistry,
      attestor: null,
      transactionHash: null,
      nullifierHash,
      expiresAt: Number(currentCredential.expiresAt),
    };
  }

  const account = getWorldIdAttestorAccount(options.chainId);
  if (!account) {
    throw new WorldIdAttestationError("World ID attestor wallet is not configured.", 503);
  }

  const selfAttestorRole = (await publicClient.readContract({
    address: raterRegistry,
    abi: RaterRegistryAbi,
    functionName: "SELF_ATTESTOR_ROLE",
  })) as Hex;
  const hasSelfAttestorRole = (await publicClient.readContract({
    address: raterRegistry,
    abi: RaterRegistryAbi,
    functionName: "hasRole",
    args: [selfAttestorRole, account.address],
  })) as boolean;

  if (!hasSelfAttestorRole) {
    throw new WorldIdAttestationError("World ID attestor wallet is not authorized by RaterRegistry.", 503);
  }

  const walletClient = createWalletClient({ account, chain: network, transport });
  const transactionHash = await walletClient.writeContract({
    address: raterRegistry,
    abi: RaterRegistryAbi,
    functionName: "attestSelfCredential",
    args: [
      walletAddress,
      nullifierHash,
      getScopeHash(options.rpId, options.action),
      BigInt(expiresAt),
      BASE_MULTIPLIER_BPS,
      getEvidenceHash(options),
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });

  if (receipt.status !== "success") {
    throw new WorldIdAttestationError("World ID credential attestation transaction reverted.", 500);
  }

  return {
    status: "attested",
    raterRegistry,
    attestor: account.address as Hex,
    transactionHash,
    nullifierHash,
    expiresAt,
  };
}
