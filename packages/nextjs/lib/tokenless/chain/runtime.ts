import type { TokenlessChainConfig } from "./config";
import { TokenlessPanelAbi, X402PanelSubmitterAbi } from "@rateloop/contracts/tokenless";
import "server-only";
import {
  type Account,
  type Address,
  type Hash,
  type Hex,
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

function createBasePublicClient(rpcUrl: string) {
  return createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
}

function createBaseWalletClient(account: Account, rpcUrl: string) {
  return createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl) });
}

export type TokenlessPublicClient = ReturnType<typeof createBasePublicClient>;
export type TokenlessWalletClient = ReturnType<typeof createBaseWalletClient>;

export type TokenlessChainRuntime = {
  publicClient: TokenlessPublicClient;
  prepaidAccount?: Account;
  prepaidWallet?: TokenlessWalletClient;
  relayerAccount?: Account;
  relayerWallet?: TokenlessWalletClient;
};

let runtimeCache: { rpcUrl: string; runtime: TokenlessChainRuntime } | null = null;
let runtimeOverride: TokenlessChainRuntime | null = null;

function wallet(privateKey: `0x${string}`, rpcUrl: string) {
  const account = privateKeyToAccount(privateKey);
  return {
    account,
    client: createBaseWalletClient(account, rpcUrl),
  };
}

export function getTokenlessChainRuntime(config: TokenlessChainConfig): TokenlessChainRuntime {
  if (runtimeOverride) return runtimeOverride;
  if (runtimeCache?.rpcUrl === config.rpcUrl) return runtimeCache.runtime;
  const prepaid = config.prepaidFunderPrivateKey ? wallet(config.prepaidFunderPrivateKey, config.rpcUrl) : null;
  const relayer = config.relayerPrivateKey ? wallet(config.relayerPrivateKey, config.rpcUrl) : null;
  const runtime: TokenlessChainRuntime = {
    publicClient: createBasePublicClient(config.rpcUrl),
    ...(prepaid ? { prepaidAccount: prepaid.account, prepaidWallet: prepaid.client } : {}),
    ...(relayer ? { relayerAccount: relayer.account, relayerWallet: relayer.client } : {}),
  };
  runtimeCache = { rpcUrl: config.rpcUrl, runtime };
  return runtime;
}

export function __setTokenlessChainRuntimeForTests(runtime: TokenlessChainRuntime | null) {
  runtimeOverride = runtime;
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
  ]);
  if (
    !sameAddress(panelUsdc, config.usdcAddress) ||
    !sameAddress(panelIssuer, config.issuerAddress) ||
    !sameAddress(adapterPanel, config.panelAddress) ||
    !sameAddress(adapterUsdc, config.usdcAddress) ||
    !sameAddress(authorizationToken, config.usdcAddress) ||
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
