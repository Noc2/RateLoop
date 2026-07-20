import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

import {
  requireFoundryAccount,
  selectFoundryAccount,
} from "./foundryAccounts.js";
import {
  parseTokenlessDeployArgs,
  TOKENLESS_DEPLOY_USAGE,
} from "./tokenlessDeployArgs.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env") });

const { keystore, network, resume, showHelp } = parseTokenlessDeployArgs(process.argv.slice(2));
if (showHelp) {
  console.log(TOKENLESS_DEPLOY_USAGE);
  process.exit(0);
}
const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL?.trim();
if (!rpcUrl) throw new Error("BASE_SEPOLIA_RPC_URL is required.");
const chainProbe = spawnSync("cast", ["chain-id", "--rpc-url", rpcUrl], { encoding: "utf8" });
if (chainProbe.status !== 0) throw new Error(`Base Sepolia RPC probe failed: ${chainProbe.stderr.trim()}`);
if (chainProbe.stdout.trim() !== "84532") {
  throw new Error(`BASE_SEPOLIA_RPC_URL reports chain ${chainProbe.stdout.trim()}, expected 84532.`);
}

const selectedKeystore = keystore
  ? requireFoundryAccount(keystore)
  : await selectFoundryAccount();
console.log(`\nUsing Foundry deployment account: ${selectedKeystore}`);

const env = {
  ...process.env,
  DEPLOY_TARGET_NETWORK: "baseSepolia",
  ETH_KEYSTORE_ACCOUNT: selectedKeystore,
  RPC_URL: rpcUrl,
  RESUME_FLAG: resume ? "--resume" : "",
  VERIFY_FLAGS: process.env.BASESCAN_API_KEY?.trim() ? "--verify" : "",
};
const result = spawnSync("make", ["deploy-tokenless-and-generate-artifacts"], {
  cwd: root,
  env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
