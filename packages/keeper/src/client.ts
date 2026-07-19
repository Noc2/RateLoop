import { createPublicClient, createWalletClient, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";
import { getKeystoreAccount } from "./keystore.js";
import { createConfiguredRpcTransport } from "./rpc.js";

const rpcUrls = [config.rpcUrl, ...config.rpcFallbackUrls];

export const chain = defineChain({
  id: config.chainId,
  name: config.chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: rpcUrls },
  },
});

export function getAccount() {
  const keystoreAccount = getKeystoreAccount();
  if (keystoreAccount) return keystoreAccount;

  if (config.privateKey) {
    return privateKeyToAccount(config.privateKey);
  }

  throw new Error(
    "No wallet configured. Set KEYSTORE_ACCOUNT+KEYSTORE_PASSWORD or KEEPER_PRIVATE_KEY",
  );
}

export const publicClient = createPublicClient({
  chain,
  transport: createConfiguredRpcTransport(rpcUrls),
});

type KeeperConnectivityClient = Pick<typeof publicClient, "getChainId">;

export async function validateKeeperConnectivity(
  client: KeeperConnectivityClient = publicClient,
) {
  const rpcChainId = await client.getChainId();
  if (rpcChainId !== config.chainId) {
    throw new Error(
      `RPC_URL reports chain ID ${rpcChainId}, but CHAIN_ID is ${config.chainId}.`,
    );
  }
}

export function getWalletClient() {
  const account = getAccount();
  return createWalletClient({
    account,
    chain,
    transport: createConfiguredRpcTransport(rpcUrls),
  });
}
