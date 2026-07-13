import "server-only";
import { type Address, getAddress, isAddress, zeroAddress } from "viem";

export const TOKENLESS_BASE_SEPOLIA_CHAIN_ID = 84_532;
export const TOKENLESS_DEPLOYMENT_SCHEMA = "rateloop-tokenless-deployment-v3";
export const TOKENLESS_QUICKNET_T_CHAIN_HASH =
  "0xcc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5" as const;

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export type TokenlessChainConfig = {
  chainId: typeof TOKENLESS_BASE_SEPOLIA_CHAIN_ID;
  claimGracePeriodSeconds: number;
  deploymentBlock: bigint;
  deploymentKey: string;
  feeRecipient: Address;
  issuerAddress: Address;
  panelAddress: Address;
  prepaidFunderPrivateKey?: `0x${string}`;
  revealWindowSeconds: number;
  beaconFailureGraceSeconds: number;
  relayerPrivateKey?: `0x${string}`;
  rpcUrl: string;
  schemaVersion: typeof TOKENLESS_DEPLOYMENT_SCHEMA;
  usdcAddress: Address;
  x402SubmitterAddress: Address;
};

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for live tokenless chain execution.`);
  return value;
}

function requiredAddress(env: NodeJS.ProcessEnv, name: string) {
  const value = required(env, name);
  if (!isAddress(value) || value.toLowerCase() === zeroAddress) {
    throw new Error(`${name} must be a non-zero EVM address.`);
  }
  return getAddress(value);
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function privateKey(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) return undefined;
  if (!PRIVATE_KEY_PATTERN.test(value)) throw new Error(`${name} must be a 32-byte hex private key.`);
  return value as `0x${string}`;
}

export function buildTokenlessDeploymentKey(input: {
  chainId: number;
  panelAddress: Address;
  issuerAddress: Address;
  x402SubmitterAddress: Address;
}) {
  return [
    "tokenless-v3",
    input.chainId,
    input.panelAddress.toLowerCase(),
    input.issuerAddress.toLowerCase(),
    input.x402SubmitterAddress.toLowerCase(),
  ].join(":");
}

export function loadTokenlessChainConfig(env: NodeJS.ProcessEnv = process.env): TokenlessChainConfig {
  const schemaVersion = required(env, "TOKENLESS_DEPLOYMENT_SCHEMA");
  if (schemaVersion !== TOKENLESS_DEPLOYMENT_SCHEMA) {
    throw new Error(`TOKENLESS_DEPLOYMENT_SCHEMA must be ${TOKENLESS_DEPLOYMENT_SCHEMA}.`);
  }
  const configuredChainId = positiveInteger(env, "TOKENLESS_CHAIN_ID", TOKENLESS_BASE_SEPOLIA_CHAIN_ID);
  if (configuredChainId !== TOKENLESS_BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(`TOKENLESS_CHAIN_ID must be ${TOKENLESS_BASE_SEPOLIA_CHAIN_ID}.`);
  }
  const panelAddress = requiredAddress(env, "TOKENLESS_PANEL_ADDRESS");
  const issuerAddress = requiredAddress(env, "TOKENLESS_CREDENTIAL_ISSUER_ADDRESS");
  const x402SubmitterAddress = requiredAddress(env, "TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS");
  const usdcAddress = requiredAddress(env, "TOKENLESS_USDC_ADDRESS");
  const feeRecipient = requiredAddress(env, "TOKENLESS_FEE_RECIPIENT");
  const expectedKey = buildTokenlessDeploymentKey({
    chainId: configuredChainId,
    panelAddress,
    issuerAddress,
    x402SubmitterAddress,
  });
  const deploymentKey = required(env, "TOKENLESS_DEPLOYMENT_KEY").toLowerCase();
  if (deploymentKey !== expectedKey) {
    throw new Error("TOKENLESS_DEPLOYMENT_KEY does not match the complete configured tokenless contract bundle.");
  }
  const deploymentBlock = BigInt(required(env, "TOKENLESS_DEPLOYMENT_BLOCK"));
  if (deploymentBlock <= 0n) throw new Error("TOKENLESS_DEPLOYMENT_BLOCK must be positive.");
  const rpcUrl = required(env, "BASE_SEPOLIA_RPC_URL");
  const parsedRpcUrl = new URL(rpcUrl);
  if (env.NODE_ENV === "production" && parsedRpcUrl.protocol !== "https:") {
    throw new Error("BASE_SEPOLIA_RPC_URL must use HTTPS in production.");
  }
  const claimGracePeriodSeconds = positiveInteger(env, "TOKENLESS_CLAIM_GRACE_PERIOD_SECONDS", 7 * 24 * 60 * 60);
  if (claimGracePeriodSeconds > 30 * 24 * 60 * 60) {
    throw new Error("TOKENLESS_CLAIM_GRACE_PERIOD_SECONDS exceeds the contract maximum of 30 days.");
  }
  const prepaidFunderPrivateKey = privateKey(env, "TOKENLESS_PREPAID_FUNDER_PRIVATE_KEY");
  const relayerPrivateKey = privateKey(env, "TOKENLESS_X402_RELAYER_PRIVATE_KEY");
  const credentialSignerPrivateKey = privateKey(env, "TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY");
  if (
    (relayerPrivateKey && relayerPrivateKey.toLowerCase() === credentialSignerPrivateKey?.toLowerCase()) ||
    (prepaidFunderPrivateKey && prepaidFunderPrivateKey.toLowerCase() === credentialSignerPrivateKey?.toLowerCase())
  ) {
    throw new Error("Chain payment and relay keys must never reuse the credential issuer signer.");
  }
  if (prepaidFunderPrivateKey && prepaidFunderPrivateKey.toLowerCase() === relayerPrivateKey?.toLowerCase()) {
    throw new Error("The prepaid funder and gas-only relayer must use distinct keys.");
  }
  return {
    chainId: TOKENLESS_BASE_SEPOLIA_CHAIN_ID,
    claimGracePeriodSeconds,
    deploymentBlock,
    deploymentKey,
    feeRecipient,
    issuerAddress,
    panelAddress,
    prepaidFunderPrivateKey,
    revealWindowSeconds: positiveInteger(env, "TOKENLESS_REVEAL_WINDOW_SECONDS", 120),
    beaconFailureGraceSeconds: positiveInteger(env, "TOKENLESS_BEACON_FAILURE_GRACE_SECONDS", 300),
    relayerPrivateKey,
    rpcUrl: parsedRpcUrl.toString(),
    schemaVersion: TOKENLESS_DEPLOYMENT_SCHEMA,
    usdcAddress,
    x402SubmitterAddress,
  };
}
