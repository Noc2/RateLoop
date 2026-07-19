import type { TokenlessChainConfig } from "./config";
import { TokenlessFeedbackBonusAbi, TokenlessPanelAbi, X402PanelSubmitterAbi } from "@rateloop/contracts/tokenless";
import "server-only";
import {
  type Account,
  type Address,
  type BlockTag,
  type Hash,
  type Hex,
  type Transport,
  createPublicClient,
  createWalletClient,
  fallback,
  getAddress,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const RPC_TIMEOUT_MS = 8_000;

export function createOrderedRpcFallbackTransport(transports: readonly Transport[]): Transport {
  if (transports.length === 0) throw new Error("At least one RPC transport is required.");
  if (transports.length === 1) return transports[0]!;
  return fallback(transports, { rank: false, retryCount: 0 });
}

function createConfiguredRpcTransport(rpcUrls: readonly string[]) {
  return createOrderedRpcFallbackTransport(rpcUrls.map(url => http(url, { retryCount: 0, timeout: RPC_TIMEOUT_MS })));
}

function createBasePublicClient(rpcUrls: readonly string[]) {
  return createPublicClient({ chain: baseSepolia, transport: createConfiguredRpcTransport(rpcUrls) });
}

function createBaseWalletClient(account: Account, rpcUrls: readonly string[]) {
  return createWalletClient({ account, chain: baseSepolia, transport: createConfiguredRpcTransport(rpcUrls) });
}

export type TokenlessPublicClient = ReturnType<typeof createBasePublicClient>;
export type TokenlessWalletClient = ReturnType<typeof createBaseWalletClient>;

export type TokenlessChainRuntime = {
  publicClient: TokenlessPublicClient;
  prepaidAccount?: Account;
  prepaidWallet?: TokenlessWalletClient;
  relayerAccount?: Account;
  relayerWallet?: TokenlessWalletClient;
  surpriseBonusAccount?: Account;
  surpriseBonusWallet?: TokenlessWalletClient;
};

export type TokenlessEvidenceFinalityPolicy =
  | { strategy: "block_tag"; blockTag: Extract<BlockTag, "safe" | "finalized"> }
  | { strategy: "confirmations"; confirmationDepth: number };

export type TokenlessEvidenceFinalityFailure = "block_pending" | "hash_mismatch" | "rpc_unavailable";

export class TokenlessEvidenceFinalityPendingError extends Error {
  readonly failure: TokenlessEvidenceFinalityFailure;

  constructor(message: string, failure: TokenlessEvidenceFinalityFailure, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TokenlessEvidenceFinalityPendingError";
    this.failure = failure;
  }
}

const MINIMUM_EVIDENCE_CONFIRMATION_DEPTH = 64;

export function loadTokenlessEvidenceFinalityPolicy(
  env: NodeJS.ProcessEnv = process.env,
): TokenlessEvidenceFinalityPolicy {
  const blockTag = env.TOKENLESS_EVIDENCE_FINALITY_BLOCK_TAG?.trim().toLowerCase();
  const depthText = env.TOKENLESS_EVIDENCE_CONFIRMATION_DEPTH?.trim();
  if (blockTag && depthText) {
    throw new Error(
      "Configure exactly one of TOKENLESS_EVIDENCE_FINALITY_BLOCK_TAG or TOKENLESS_EVIDENCE_CONFIRMATION_DEPTH.",
    );
  }
  if (blockTag) {
    if (blockTag !== "safe" && blockTag !== "finalized") {
      throw new Error('TOKENLESS_EVIDENCE_FINALITY_BLOCK_TAG must be "safe" or "finalized".');
    }
    return { strategy: "block_tag", blockTag };
  }
  if (depthText) {
    const confirmationDepth = Number(depthText);
    if (!Number.isSafeInteger(confirmationDepth) || confirmationDepth < MINIMUM_EVIDENCE_CONFIRMATION_DEPTH) {
      throw new Error(
        `TOKENLESS_EVIDENCE_CONFIRMATION_DEPTH must be an integer of at least ${MINIMUM_EVIDENCE_CONFIRMATION_DEPTH}.`,
      );
    }
    return { strategy: "confirmations", confirmationDepth };
  }
  throw new Error(
    "TOKENLESS_EVIDENCE_FINALITY_BLOCK_TAG or TOKENLESS_EVIDENCE_CONFIRMATION_DEPTH is required for evidence publication.",
  );
}

let runtimeCache: { rpcKey: string; runtime: TokenlessChainRuntime } | null = null;
let runtimeOverride: TokenlessChainRuntime | null = null;

function wallet(privateKey: `0x${string}`, rpcUrls: readonly string[]) {
  const account = privateKeyToAccount(privateKey);
  return {
    account,
    client: createBaseWalletClient(account, rpcUrls),
  };
}

export function getTokenlessChainRuntime(config: TokenlessChainConfig): TokenlessChainRuntime {
  if (runtimeOverride) return runtimeOverride;
  const rpcUrls = [config.rpcUrl, ...config.rpcFallbackUrls];
  const rpcKey = JSON.stringify(rpcUrls);
  if (runtimeCache?.rpcKey === rpcKey) return runtimeCache.runtime;
  const prepaid = config.prepaidFunderPrivateKey ? wallet(config.prepaidFunderPrivateKey, rpcUrls) : null;
  const relayer = config.relayerPrivateKey ? wallet(config.relayerPrivateKey, rpcUrls) : null;
  const surpriseBonus = config.surpriseBonusFunderPrivateKey
    ? wallet(config.surpriseBonusFunderPrivateKey, rpcUrls)
    : null;
  const runtime: TokenlessChainRuntime = {
    publicClient: createBasePublicClient(rpcUrls),
    ...(prepaid ? { prepaidAccount: prepaid.account, prepaidWallet: prepaid.client } : {}),
    ...(relayer ? { relayerAccount: relayer.account, relayerWallet: relayer.client } : {}),
    ...(surpriseBonus
      ? { surpriseBonusAccount: surpriseBonus.account, surpriseBonusWallet: surpriseBonus.client }
      : {}),
  };
  runtimeCache = { rpcKey, runtime };
  return runtime;
}

export function __setTokenlessChainRuntimeForTests(runtime: TokenlessChainRuntime | null) {
  runtimeOverride = runtime;
}

export async function assertCanonicalTokenlessEvidenceBlock(input: {
  blockHash: Hash;
  blockNumber: bigint;
  config: TokenlessChainConfig;
  deploymentKey: string;
  policy: TokenlessEvidenceFinalityPolicy;
  runtime?: TokenlessChainRuntime;
}) {
  if (input.deploymentKey.toLowerCase() !== input.config.deploymentKey.toLowerCase()) {
    throw new Error("Finalized evidence does not belong to the configured tokenless deployment.");
  }
  if (input.blockNumber < input.config.deploymentBlock) {
    throw new Error("Finalized evidence predates the configured tokenless deployment.");
  }
  const client = (input.runtime ?? getTokenlessChainRuntime(input.config)).publicClient;
  try {
    const chainId = await client.getChainId();
    if (chainId !== input.config.chainId) {
      throw new Error(`RPC chain ${chainId} does not match ${input.config.chainId}.`);
    }
    let finalityHead: bigint;
    if (input.policy.strategy === "block_tag") {
      const block = await client.getBlock({ blockTag: input.policy.blockTag });
      if (block.number === null) throw new Error(`${input.policy.blockTag} head has no block number.`);
      finalityHead = block.number;
    } else {
      const latestBlock = await client.getBlockNumber();
      const requiredSuccessors = BigInt(input.policy.confirmationDepth - 1);
      finalityHead = latestBlock >= requiredSuccessors ? latestBlock - requiredSuccessors : -1n;
    }
    if (input.blockNumber > finalityHead) {
      throw new TokenlessEvidenceFinalityPendingError(
        "Finalized round block has not reached the configured evidence finality boundary.",
        "block_pending",
      );
    }
    const canonicalBlock = await client.getBlock({ blockNumber: input.blockNumber });
    if (!canonicalBlock.hash || canonicalBlock.hash.toLowerCase() !== input.blockHash.toLowerCase()) {
      throw new TokenlessEvidenceFinalityPendingError(
        "Finalized round block hash no longer matches the canonical chain.",
        "hash_mismatch",
      );
    }
    return { canonicalBlockHash: canonicalBlock.hash, finalityHead };
  } catch (error) {
    if (error instanceof TokenlessEvidenceFinalityPendingError) throw error;
    throw new TokenlessEvidenceFinalityPendingError(
      "Canonical evidence finality could not be verified from the configured Base RPC.",
      "rpc_unavailable",
      { cause: error },
    );
  }
}

function sameAddress(actual: unknown, expected: Address) {
  return typeof actual === "string" && getAddress(actual) === getAddress(expected);
}

export async function assertLiveTokenlessDeployment(
  config: TokenlessChainConfig,
  runtime: TokenlessChainRuntime = getTokenlessChainRuntime(config),
) {
  const client = runtime.publicClient;
  const chainId = await client.getChainId();
  if (chainId !== config.chainId) throw new Error(`RPC chain ${chainId} does not match ${config.chainId}.`);
  const latestBlock = await client.getBlockNumber();
  if (latestBlock < config.deploymentBlock) throw new Error("TOKENLESS_DEPLOYMENT_BLOCK is ahead of the RPC head.");
  const addresses = [
    config.panelAddress,
    config.issuerAddress,
    config.x402SubmitterAddress,
    config.usdcAddress,
    config.feedbackBonusAddress,
  ] as const;
  const bytecodes = await Promise.all(addresses.map(address => client.getBytecode({ address })));
  if (bytecodes.some(code => !code || code === "0x")) {
    throw new Error("The configured tokenless deployment bundle contains an address without bytecode.");
  }
  const [
    panelUsdc,
    panelIssuer,
    scoringVersion,
    basePayBps,
    maximumCommits,
    adapterPanel,
    adapterUsdc,
    authorizationToken,
    feedbackBonusUsdc,
    feedbackBonusIssuer,
  ] = await Promise.all([
    client.readContract({ abi: TokenlessPanelAbi, address: config.panelAddress, functionName: "usdc" }),
    client.readContract({ abi: TokenlessPanelAbi, address: config.panelAddress, functionName: "credentialIssuer" }),
    client.readContract({ abi: TokenlessPanelAbi, address: config.panelAddress, functionName: "SCORING_VERSION" }),
    client.readContract({ abi: TokenlessPanelAbi, address: config.panelAddress, functionName: "BASE_PAY_BPS" }),
    client.readContract({ abi: TokenlessPanelAbi, address: config.panelAddress, functionName: "MAXIMUM_COMMITS" }),
    client.readContract({ abi: X402PanelSubmitterAbi, address: config.x402SubmitterAddress, functionName: "panel" }),
    client.readContract({ abi: X402PanelSubmitterAbi, address: config.x402SubmitterAddress, functionName: "usdc" }),
    client.readContract({
      abi: X402PanelSubmitterAbi,
      address: config.x402SubmitterAddress,
      functionName: "authorizationToken",
    }),
    client.readContract({
      abi: TokenlessFeedbackBonusAbi,
      address: config.feedbackBonusAddress,
      functionName: "usdc",
    }),
    client.readContract({
      abi: TokenlessFeedbackBonusAbi,
      address: config.feedbackBonusAddress,
      functionName: "credentialIssuer",
    }),
  ]);
  if (
    !sameAddress(panelUsdc, config.usdcAddress) ||
    !sameAddress(panelIssuer, config.issuerAddress) ||
    !sameAddress(adapterPanel, config.panelAddress) ||
    !sameAddress(adapterUsdc, config.usdcAddress) ||
    !sameAddress(authorizationToken, config.usdcAddress) ||
    !sameAddress(feedbackBonusUsdc, config.usdcAddress) ||
    !sameAddress(feedbackBonusIssuer, config.issuerAddress) ||
    Number(scoringVersion) !== 2 ||
    Number(basePayBps) !== 8_000 ||
    Number(maximumCommits) !== 500
  ) {
    throw new Error("The configured tokenless addresses are a mixed deployment bundle.");
  }
  return { chainId, latestBlock };
}

/**
 * Narrow gas-only relay primitive shared by x402 submission and sponsored commits.
 * The configured account pays Base gas only; no credential-issuer or prepaid-funder
 * key is accepted through this boundary.
 */
export async function relayTokenlessPanelCall(input: {
  config: TokenlessChainConfig;
  data: Hex;
  nonce?: number;
  runtime?: TokenlessChainRuntime;
}): Promise<Hash> {
  const runtime = input.runtime ?? getTokenlessChainRuntime(input.config);
  if (!runtime.relayerAccount || !runtime.relayerWallet) {
    throw new Error("TOKENLESS_X402_RELAYER_PRIVATE_KEY is required for gas-only relay calls.");
  }
  if (runtime.prepaidAccount && runtime.prepaidAccount.address === runtime.relayerAccount.address) {
    throw new Error("The gas-only relayer must not reuse the prepaid funder account.");
  }
  await assertLiveTokenlessDeployment(input.config, runtime);
  return runtime.relayerWallet.sendTransaction({
    account: runtime.relayerAccount,
    chain: baseSepolia,
    data: input.data,
    nonce: input.nonce,
    to: input.config.panelAddress,
    value: 0n,
  });
}
