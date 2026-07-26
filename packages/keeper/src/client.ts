import { createPublicClient, createWalletClient, defineChain } from "viem";
import { type LocalAccount } from "viem/accounts";
import { createAuditedPlatformSecretEvmAccount } from "@rateloop/node-utils/platform-secret-evm-account";
import { config } from "./config.js";
import { getKeystoreAccount } from "./keystore.js";
import { recordSigningFailure } from "./metrics.js";
import { createConfiguredRpcTransport } from "./rpc.js";
import { createKeeperEvmSigningLedgerPool } from "./signing-ledger.js";

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
  | ReturnType<typeof createKeeperEvmSigningLedgerPool>
  | undefined;

export function getAccount(): LocalAccount {
  if (cachedAccount) return cachedAccount;

  if (config.signer.kind === "platform-secret") {
    signingLedgerPool ??= createKeeperEvmSigningLedgerPool(
      config.signingDatabaseUrl!,
    );
    const managedAccount = createAuditedPlatformSecretEvmAccount({
      configuration: {
        expectedAddress: config.signer.expectedAddress,
        keyVersion: config.signer.keyVersion,
        privateKey: config.signer.privateKey,
        signerRole: "keeper",
      },
      ledger: signingLedgerPool.ledger,
      onFailure: recordSigningFailure,
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

  throw new Error(
    "No local-test wallet configured. Set KEYSTORE_ACCOUNT+KEYSTORE_PASSWORD",
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
