import { createPublicClient, createWalletClient, defineChain } from "viem";
import { privateKeyToAccount, type LocalAccount } from "viem/accounts";
import { createAwsKmsKeeperAccount } from "./aws-kms-account.js";
import { config } from "./config.js";
import { getKeystoreAccount } from "./keystore.js";
import { createKeeperEvmKmsSigningLedgerPool } from "./kms-signing-ledger.js";
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

let cachedAccount: LocalAccount | undefined;
let validateManagedAccount: (() => Promise<void>) | undefined;
let signingLedgerPool:
  | ReturnType<typeof createKeeperEvmKmsSigningLedgerPool>
  | undefined;

export function getAccount(): LocalAccount {
  if (cachedAccount) return cachedAccount;

  if (config.signer.kind === "aws-kms") {
    signingLedgerPool ??= createKeeperEvmKmsSigningLedgerPool(
      config.kmsSigningDatabaseUrl!,
    );
    const managedAccount = createAwsKmsKeeperAccount({
      configuration: config.signer,
      ledger: signingLedgerPool.ledger,
    });
    cachedAccount = managedAccount;
    validateManagedAccount = managedAccount.validate;
    return cachedAccount;
  }

  const keystoreAccount = getKeystoreAccount();
  if (keystoreAccount) {
    cachedAccount = keystoreAccount;
    return cachedAccount;
  }

  if (config.signer.privateKey) {
    cachedAccount = privateKeyToAccount(config.signer.privateKey);
    return cachedAccount;
  }

  throw new Error(
    "No local-test wallet configured. Set KEYSTORE_ACCOUNT+KEYSTORE_PASSWORD or KEEPER_PRIVATE_KEY",
  );
}

export async function closeKeeperSigningLedger() {
  const pool = signingLedgerPool;
  signingLedgerPool = undefined;
  await pool?.close();
}

export async function validateKeeperSigner() {
  getAccount();
  await validateManagedAccount?.();
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
