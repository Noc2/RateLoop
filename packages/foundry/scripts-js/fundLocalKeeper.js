import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  isAddress,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const DEFAULT_LOCAL_RPC_URL = "http://127.0.0.1:8545";
export const DEFAULT_KEEPER_TARGET_BALANCE_ETH = "5";
export const DEFAULT_LOCAL_DEPLOYER_PRIVATE_KEY =
  "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6";

const __dirname = dirname(fileURLToPath(import.meta.url));
const keeperEnvPath = join(__dirname, "..", "..", "keeper", ".env.local");

export function parseEnvFile(raw) {
  const values = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

function resolveRpcUrl(env) {
  const value = env.RPC_URL?.trim();
  if (!value || value === "localhost") return DEFAULT_LOCAL_RPC_URL;
  return value;
}

export function resolveKeeperFundingConfig(env) {
  const keeperPrivateKey = env.KEEPER_PRIVATE_KEY?.trim();
  const keeperAddress = env.KEEPER_ADDRESS?.trim();

  if (keeperPrivateKey) {
    return {
      enabled: true,
      rpcUrl: resolveRpcUrl(env),
      keeperAddress: privateKeyToAccount(keeperPrivateKey).address,
      deployerPrivateKey:
        env.LOCALHOST_DEPLOYER_PRIVATE_KEY?.trim() ||
        DEFAULT_LOCAL_DEPLOYER_PRIVATE_KEY,
      targetBalance: parseEther(
        env.KEEPER_TARGET_BALANCE_ETH?.trim() ||
          DEFAULT_KEEPER_TARGET_BALANCE_ETH
      ),
    };
  }

  if (keeperAddress) {
    if (!isAddress(keeperAddress)) {
      throw new Error(
        `KEEPER_ADDRESS is not a valid address: ${keeperAddress}`
      );
    }

    return {
      enabled: true,
      rpcUrl: resolveRpcUrl(env),
      keeperAddress,
      deployerPrivateKey:
        env.LOCALHOST_DEPLOYER_PRIVATE_KEY?.trim() ||
        DEFAULT_LOCAL_DEPLOYER_PRIVATE_KEY,
      targetBalance: parseEther(
        env.KEEPER_TARGET_BALANCE_ETH?.trim() ||
          DEFAULT_KEEPER_TARGET_BALANCE_ETH
      ),
    };
  }

  return { enabled: false };
}

async function fundLocalKeeper() {
  if (!existsSync(keeperEnvPath)) {
    console.log(
      "[keeper-fund] Skipping keeper funding because packages/keeper/.env.local does not exist."
    );
    return;
  }

  const fileEnv = parseEnvFile(readFileSync(keeperEnvPath, "utf8"));
  const config = resolveKeeperFundingConfig({ ...fileEnv, ...process.env });

  if (!config.enabled) {
    console.log(
      "[keeper-fund] Skipping keeper funding because KEEPER_PRIVATE_KEY or KEEPER_ADDRESS is not set in packages/keeper/.env.local."
    );
    return;
  }

  const chain = {
    id: 31337,
    name: "Foundry",
    nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  };
  const deployer = privateKeyToAccount(config.deployerPrivateKey);
  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  });
  const walletClient = createWalletClient({
    account: deployer,
    chain,
    transport: http(config.rpcUrl),
  });

  const balance = await publicClient.getBalance({
    address: config.keeperAddress,
  });
  if (balance >= config.targetBalance) {
    console.log(
      `[keeper-fund] Keeper ${config.keeperAddress} already has ${formatEther(
        balance
      )} ETH.`
    );
    return;
  }

  const value = config.targetBalance - balance;
  const hash = await walletClient.sendTransaction({
    to: config.keeperAddress,
    value,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  console.log(
    `[keeper-fund] Funded keeper ${config.keeperAddress} with ${formatEther(
      value
    )} ETH.`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fundLocalKeeper().catch((error) => {
    console.error(
      `[keeper-fund] ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  });
}
