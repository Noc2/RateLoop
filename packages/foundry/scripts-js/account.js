import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";
import { createPublicClient, formatEther, http, isAddress } from "viem";

import { readStoredFoundryAccountAddress, selectFoundryAccount } from "./foundryAccounts.js";

const foundryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(foundryRoot, ".env") });

async function main() {
  const account = await selectFoundryAccount();
  let address = readStoredFoundryAccountAddress(account);
  if (!address) {
    console.log(
      `\n${account} does not store its public address; enter its password to derive it.`
    );
    const addressResult = spawnSync("cast", ["wallet", "address", "--account", account], {
      encoding: "utf8",
      stdio: ["inherit", "pipe", "inherit"],
    });
    if (addressResult.error) throw new Error(`Unable to run cast: ${addressResult.error.message}`);
    if (addressResult.status !== 0) throw new Error(`Unable to derive the address for ${account}.`);
    address = addressResult.stdout.trim();
  }
  if (!isAddress(address)) {
    throw new Error(`Foundry returned an invalid address for ${account}.`);
  }

  console.log(`\nAccount: ${account}`);
  console.log(`Address: ${address}`);

  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL?.trim();
  if (!rpcUrl) {
    console.log("Base Sepolia balance: unavailable (BASE_SEPOLIA_RPC_URL is not configured)");
  } else {
    const client = createPublicClient({ transport: http(rpcUrl) });
    const chainId = await client.getChainId();
    if (chainId !== 84532) {
      throw new Error(`BASE_SEPOLIA_RPC_URL reports chain ${chainId}, expected 84532.`);
    }
    const [balance, nonce] = await Promise.all([
      client.getBalance({ address }),
      client.getTransactionCount({ address }),
    ]);
    console.log(`Base Sepolia balance: ${formatEther(balance)} ETH`);
    console.log(`Base Sepolia nonce: ${nonce}`);
  }

  console.log("\nDeploy with:");
  console.log("yarn foundry:deploy:tokenless --network baseSepolia");
}

try {
  await main();
} catch (error) {
  console.error(`[account] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
