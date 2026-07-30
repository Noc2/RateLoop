import {
  type TokenlessPlatformSecretAccountConfiguration,
  loadPlatformSecretEthereumAccountConfiguration,
} from "./platformSecretAccount";
import {
  TOKENLESS_MINIMUM_BEACON_FAILURE_GRACE_SECONDS as IMMUTABLE_MINIMUM_BEACON_FAILURE_GRACE_SECONDS,
  TOKENLESS_MINIMUM_REVEAL_WINDOW_SECONDS as IMMUTABLE_MINIMUM_REVEAL_WINDOW_SECONDS,
  TOKENLESS_SCORING_BEACON_SAFETY_MARGIN_SECONDS as IMMUTABLE_SCORING_BEACON_SAFETY_MARGIN_SECONDS,
  TOKENLESS_QUICKNET_T_CHAIN_HASH,
} from "@rateloop/sdk";
import "server-only";
import { type Address, getAddress, isAddress, zeroAddress } from "viem";

export const TOKENLESS_BASE_SEPOLIA_CHAIN_ID = 84_532;
export const TOKENLESS_DEPLOYMENT_SCHEMA = "rateloop-tokenless-deployment-v4";
export { TOKENLESS_QUICKNET_T_CHAIN_HASH };
export const TOKENLESS_MINIMUM_REVEAL_WINDOW_SECONDS = Number(IMMUTABLE_MINIMUM_REVEAL_WINDOW_SECONDS);
export const TOKENLESS_DEFAULT_REVEAL_WINDOW_SECONDS = 60 * 60;
export const TOKENLESS_MINIMUM_BEACON_FAILURE_GRACE_SECONDS = Number(IMMUTABLE_MINIMUM_BEACON_FAILURE_GRACE_SECONDS);
export const TOKENLESS_SCORING_BEACON_SAFETY_MARGIN_SECONDS = Number(IMMUTABLE_SCORING_BEACON_SAFETY_MARGIN_SECONDS);

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export type TokenlessChainConfig = {
  chainId: typeof TOKENLESS_BASE_SEPOLIA_CHAIN_ID;
  claimGracePeriodSeconds: number;
  deploymentBlock: bigint;
  deploymentKey: string;
  feeRecipient: Address;
  feedbackBonusAddress: Address;
  issuerAddress: Address;
  panelAddress: Address;
  prepaidFunderSigner?: TokenlessSignerConfig;
  surpriseBonusFunderSigner?: TokenlessSignerConfig;
  revealWindowSeconds: number;
  beaconFailureGraceSeconds: number;
  relayerSigner?: TokenlessSignerConfig;
  rpcFallbackUrls: string[];
  rpcUrl: string;
  schemaVersion: typeof TOKENLESS_DEPLOYMENT_SCHEMA;
  usdcAddress: Address;
  usdcEip712Name: string;
  usdcEip712Version: string;
  x402SubmitterAddress: Address;
};

export type TokenlessSignerConfig = {
  kind: "platform-secret";
  configuration: TokenlessPlatformSecretAccountConfiguration;
};

const MAXIMUM_RPC_FALLBACKS = 3;

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

function signerConfiguration(
  env: NodeJS.ProcessEnv,
  input: {
    role: Parameters<typeof loadPlatformSecretEthereumAccountConfiguration>[0]["role"];
  },
): TokenlessSignerConfig | undefined {
  const prefixes = {
    PREPAID_FUNDER: "TOKENLESS_PREPAID_FUNDER",
    SURPRISE_BONUS_FUNDER: "TOKENLESS_SURPRISE_BONUS_FUNDER",
    X402_RELAYER: "TOKENLESS_X402_RELAYER",
    CREDENTIAL_ISSUER: "TOKENLESS_CREDENTIAL_ISSUER_SIGNER",
  } as const;
  const prefix = prefixes[input.role];
  const configured = ["PRIVATE_KEY", "EXPECTED_ADDRESS", "KEY_VERSION"].some(suffix =>
    env[`${prefix}_${suffix}`]?.trim(),
  );
  if (!configured) return undefined;
  return {
    configuration: loadPlatformSecretEthereumAccountConfiguration({
      env,
      role: input.role,
    }),
    kind: "platform-secret",
  };
}

function rpcUrls(env: NodeJS.ProcessEnv) {
  const primary = required(env, "BASE_SEPOLIA_RPC_URL");
  const fallbacks = (env.BASE_SEPOLIA_RPC_FALLBACK_URLS ?? "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  if (env.NODE_ENV === "production" && fallbacks.length === 0) {
    throw new Error("BASE_SEPOLIA_RPC_FALLBACK_URLS must contain at least one independent HTTPS RPC in production.");
  }
  if (fallbacks.length > MAXIMUM_RPC_FALLBACKS) {
    throw new Error(`BASE_SEPOLIA_RPC_FALLBACK_URLS must contain at most ${MAXIMUM_RPC_FALLBACKS} URLs.`);
  }
  const normalized = [primary, ...fallbacks].map((value, index) => {
    const name = index === 0 ? "BASE_SEPOLIA_RPC_URL" : "BASE_SEPOLIA_RPC_FALLBACK_URLS";
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`${name} must contain valid HTTP URLs.`);
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
      throw new Error(`${name} must contain HTTP URLs without embedded credentials or fragments.`);
    }
    if (env.NODE_ENV === "production" && parsed.protocol !== "https:") {
      throw new Error(`${name} must use HTTPS in production.`);
    }
    return parsed.toString();
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("BASE_SEPOLIA_RPC_URL and BASE_SEPOLIA_RPC_FALLBACK_URLS must be distinct.");
  }
  return { rpcUrl: normalized[0]!, rpcFallbackUrls: normalized.slice(1) };
}

export function buildTokenlessDeploymentKey(input: {
  chainId: number;
  panelAddress: Address;
  issuerAddress: Address;
  x402SubmitterAddress: Address;
  feedbackBonusAddress: Address;
}) {
  return [
    "tokenless-v4",
    input.chainId,
    input.panelAddress.toLowerCase(),
    input.issuerAddress.toLowerCase(),
    input.x402SubmitterAddress.toLowerCase(),
    input.feedbackBonusAddress.toLowerCase(),
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
  const feedbackBonusAddress = requiredAddress(env, "TOKENLESS_FEEDBACK_BONUS_ADDRESS");
  const usdcAddress = requiredAddress(env, "TOKENLESS_USDC_ADDRESS");
  const usdcEip712Name = env.TOKENLESS_USDC_EIP712_NAME?.trim() || "RateLoop Tokenless Test USDC";
  const usdcEip712Version = env.TOKENLESS_USDC_EIP712_VERSION?.trim() || "2";
  if (!usdcEip712Name || !usdcEip712Version) {
    throw new Error("TOKENLESS_USDC_EIP712_NAME and TOKENLESS_USDC_EIP712_VERSION must not be empty.");
  }
  const feeRecipient = requiredAddress(env, "TOKENLESS_FEE_RECIPIENT");
  const expectedKey = buildTokenlessDeploymentKey({
    chainId: configuredChainId,
    panelAddress,
    issuerAddress,
    x402SubmitterAddress,
    feedbackBonusAddress,
  });
  const deploymentKey = required(env, "TOKENLESS_DEPLOYMENT_KEY").toLowerCase();
  if (deploymentKey !== expectedKey) {
    throw new Error("TOKENLESS_DEPLOYMENT_KEY does not match the complete configured tokenless contract bundle.");
  }
  const deploymentBlock = BigInt(required(env, "TOKENLESS_DEPLOYMENT_BLOCK"));
  if (deploymentBlock <= 0n) throw new Error("TOKENLESS_DEPLOYMENT_BLOCK must be positive.");
  const { rpcUrl, rpcFallbackUrls } = rpcUrls(env);
  const claimGracePeriodSeconds = positiveInteger(env, "TOKENLESS_CLAIM_GRACE_PERIOD_SECONDS", 7 * 24 * 60 * 60);
  if (claimGracePeriodSeconds > 30 * 24 * 60 * 60) {
    throw new Error("TOKENLESS_CLAIM_GRACE_PERIOD_SECONDS exceeds the configured operational maximum of 30 days.");
  }
  const revealWindowSeconds = positiveInteger(
    env,
    "TOKENLESS_REVEAL_WINDOW_SECONDS",
    TOKENLESS_DEFAULT_REVEAL_WINDOW_SECONDS,
  );
  if (revealWindowSeconds < TOKENLESS_MINIMUM_REVEAL_WINDOW_SECONDS) {
    throw new Error(
      `TOKENLESS_REVEAL_WINDOW_SECONDS must be at least ${TOKENLESS_MINIMUM_REVEAL_WINDOW_SECONDS} seconds.`,
    );
  }
  const beaconFailureGraceSeconds = positiveInteger(
    env,
    "TOKENLESS_BEACON_FAILURE_GRACE_SECONDS",
    TOKENLESS_MINIMUM_BEACON_FAILURE_GRACE_SECONDS,
  );
  if (beaconFailureGraceSeconds < TOKENLESS_MINIMUM_BEACON_FAILURE_GRACE_SECONDS) {
    throw new Error(
      `TOKENLESS_BEACON_FAILURE_GRACE_SECONDS must be at least ${TOKENLESS_MINIMUM_BEACON_FAILURE_GRACE_SECONDS} seconds.`,
    );
  }
  const prepaidFunderSigner = signerConfiguration(env, {
    role: "PREPAID_FUNDER",
  });
  const relayerSigner = signerConfiguration(env, {
    role: "X402_RELAYER",
  });
  const surpriseBonusFunderSigner = signerConfiguration(env, {
    role: "SURPRISE_BONUS_FUNDER",
  });
  const credentialSignerPrivateKey = env.TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY?.trim();
  if (credentialSignerPrivateKey && !PRIVATE_KEY_PATTERN.test(credentialSignerPrivateKey)) {
    throw new Error("TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY must be a 32-byte hex private key.");
  }
  if (
    credentialSignerPrivateKey &&
    (relayerSigner?.configuration.privateKey.toLowerCase() === credentialSignerPrivateKey.toLowerCase() ||
      prepaidFunderSigner?.configuration.privateKey.toLowerCase() === credentialSignerPrivateKey.toLowerCase())
  ) {
    throw new Error("Chain payment and relay keys must never reuse the credential issuer signer.");
  }
  if (
    prepaidFunderSigner &&
    relayerSigner &&
    prepaidFunderSigner.configuration.privateKey.toLowerCase() === relayerSigner?.configuration.privateKey.toLowerCase()
  ) {
    throw new Error("The prepaid funder and gas-only relayer must use distinct keys.");
  }
  const paymentKeys = [prepaidFunderSigner, relayerSigner, surpriseBonusFunderSigner].flatMap(signer =>
    signer ? [signer.configuration.privateKey] : [],
  );
  if (new Set(paymentKeys.map(value => value.toLowerCase())).size !== paymentKeys.length) {
    throw new Error("The prepaid funder, gas-only relayer, and surprise-bonus funder must use distinct keys.");
  }
  if (
    surpriseBonusFunderSigner &&
    credentialSignerPrivateKey &&
    surpriseBonusFunderSigner.configuration.privateKey.toLowerCase() === credentialSignerPrivateKey.toLowerCase()
  ) {
    throw new Error("The surprise-bonus funder must never reuse the credential issuer signer.");
  }
  const managedAddresses = [prepaidFunderSigner, relayerSigner, surpriseBonusFunderSigner].flatMap(signer =>
    signer ? [signer.configuration.expectedAddress.toLowerCase()] : [],
  );
  if (new Set(managedAddresses).size !== managedAddresses.length) {
    throw new Error("Managed prepaid, relay, and surprise-bonus roles must use distinct accounts.");
  }
  return {
    chainId: TOKENLESS_BASE_SEPOLIA_CHAIN_ID,
    claimGracePeriodSeconds,
    deploymentBlock,
    deploymentKey,
    feeRecipient,
    feedbackBonusAddress,
    issuerAddress,
    panelAddress,
    prepaidFunderSigner,
    revealWindowSeconds,
    beaconFailureGraceSeconds,
    relayerSigner,
    rpcFallbackUrls,
    rpcUrl,
    schemaVersion: TOKENLESS_DEPLOYMENT_SCHEMA,
    surpriseBonusFunderSigner,
    usdcAddress,
    usdcEip712Name,
    usdcEip712Version,
    x402SubmitterAddress,
  };
}
