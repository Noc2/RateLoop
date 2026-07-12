import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env") });

const usage = "yarn deploy --network baseSepolia --keystore <foundry-account> [--resume]";
const args = process.argv.slice(2);
let network;
let keystore;
let resume = false;
for (let index = 0; index < args.length; index += 1) {
  const value = args[index];
  if (value === "--network") network = args[++index];
  else if (value === "--keystore") keystore = args[++index];
  else if (value === "--resume") resume = true;
  else if (value === "--help" || value === "-h") {
    console.log(usage);
    process.exit(0);
  } else {
    throw new Error(`Unknown deployment argument ${value}. Usage: ${usage}`);
  }
}

if (network !== "baseSepolia") throw new Error(`Only --network baseSepolia is supported. Usage: ${usage}`);
if (!keystore || !/^[A-Za-z0-9._-]{1,128}$/u.test(keystore)) {
  throw new Error(`A safe --keystore account name is required. Usage: ${usage}`);
}
if (!existsSync(join(homedir(), ".foundry", "keystores", keystore))) {
  throw new Error(`Foundry keystore ${keystore} does not exist.`);
}

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL?.trim();
if (!rpcUrl) throw new Error("BASE_SEPOLIA_RPC_URL is required.");
const chainProbe = spawnSync("cast", ["chain-id", "--rpc-url", rpcUrl], { encoding: "utf8" });
if (chainProbe.status !== 0) throw new Error(`Base Sepolia RPC probe failed: ${chainProbe.stderr.trim()}`);
if (chainProbe.stdout.trim() !== "84532") {
  throw new Error(`BASE_SEPOLIA_RPC_URL reports chain ${chainProbe.stdout.trim()}, expected 84532.`);
}

const env = {
  ...process.env,
  DEPLOY_TARGET_NETWORK: "baseSepolia",
  ETH_KEYSTORE_ACCOUNT: keystore,
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
