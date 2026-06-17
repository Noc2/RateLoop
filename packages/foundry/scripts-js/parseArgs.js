import { spawnSync } from "child_process";
import { config } from "dotenv";
import { join, dirname } from "path";
import { readFileSync, existsSync } from "fs";
import { parse } from "toml";
import { fileURLToPath } from "url";
import {
  DEPLOY_HELP_TEXT,
  buildDeploymentProfileEnv,
  buildDeployFlowFlags,
  isSlowBroadcastNetwork,
  parseDeployArgs,
} from "./deployArgs.js";
import { selectOrCreateKeystore } from "./selectOrCreateKeystore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

const NETWORK_RPC_OVERRIDE_ENV = {
  baseSepolia: "BASE_SEPOLIA_RPC_URL",
  base: "BASE_RPC_URL",
  worldchainSepolia: "WORLDCHAIN_SEPOLIA_RPC_URL",
  worldchain: "WORLDCHAIN_RPC_URL",
};

function formatBlockscoutVerifyCommand(networkName) {
  return `make verify-blockscout NETWORK=${networkName} CONTRACT_ADDRESS=0x... CONTRACT_NAME=MyContract`;
}

// Get all arguments after the script name
const args = process.argv.slice(2);
let network;
let keystoreArg;
let resume;

try {
  const parsedArgs = parseDeployArgs(args);
  if (parsedArgs.showHelp) {
    console.log(DEPLOY_HELP_TEXT);
    process.exit(0);
  }
  network = parsedArgs.network;
  keystoreArg = parsedArgs.keystoreArg;
  resume = parsedArgs.resume;
} catch (error) {
  console.error(`\n❌ Error: ${error.message}`);
  process.exit(1);
}

// Function to check if a keystore exists
function validateKeystore(keystoreName) {
  if (keystoreName === "scaffold-eth-default") {
    return true; // Default keystore is always valid
  }

  const keystorePath = join(
    process.env.HOME,
    ".foundry",
    "keystores",
    keystoreName
  );
  return existsSync(keystorePath);
}

function resolveRpcUrl(networkName) {
  const overrideEnvKey = NETWORK_RPC_OVERRIDE_ENV[networkName];
  if (!overrideEnvKey) {
    return { rpcUrl: networkName, overrideEnvKey: null };
  }

  const overrideValue = process.env[overrideEnvKey]?.trim();
  if (!overrideValue) {
    return { rpcUrl: networkName, overrideEnvKey: null };
  }

  return { rpcUrl: overrideValue, overrideEnvKey };
}

function clearKeystoreEnvForLocalDeploy() {
  delete process.env.ETH_KEYSTORE_ACCOUNT;
  delete process.env.ETH_KEYSTORE;
  delete process.env.ETH_PASSWORD;
}

function configureDeploymentProfile() {
  try {
    Object.assign(
      process.env,
      buildDeploymentProfileEnv({ network }, process.env)
    );
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

// Check if the network exists in rpc_endpoints
try {
  const foundryTomlPath = join(__dirname, "..", "foundry.toml");
  const tomlString = readFileSync(foundryTomlPath, "utf-8");
  const parsedToml = parse(tomlString);

  if (!parsedToml.rpc_endpoints[network]) {
    console.log(
      `\n❌ Error: Network '${network}' not found in foundry.toml!`,
      "\nPlease check `foundry.toml` for available networks in the [rpc_endpoints] section or add a new network."
    );
    process.exit(1);
  }
} catch (error) {
  console.error("\n❌ Error reading or parsing foundry.toml:", error);
  process.exit(1);
}

let selectedKeystore;
if (network !== "localhost") {
  if (keystoreArg) {
    // Use the keystore provided via command line argument
    if (!validateKeystore(keystoreArg)) {
      console.log(`\n❌ Error: Keystore '${keystoreArg}' not found!`);
      console.log(
        `Please check that the keystore exists in ~/.foundry/keystores/`
      );
      process.exit(1);
    }
    selectedKeystore = keystoreArg;
    console.log(`\n🔑 Using keystore: ${selectedKeystore}`);
  } else {
    try {
      selectedKeystore = await selectOrCreateKeystore();
    } catch (error) {
      console.error("\n❌ Error selecting keystore:", error);
      process.exit(1);
    }
  }
} else if (keystoreArg) {
  console.log(
    "\nℹ️  Ignoring --keystore for localhost; local deploys use the standard Anvil private key directly."
  );
}

// Check for default account on live network
if (selectedKeystore === "scaffold-eth-default" && network !== "localhost") {
  console.log(`
❌ Error: Cannot deploy to live network using default keystore account!

To deploy to ${network}, please follow these steps:

1. If you haven't generated a keystore account yet:
   $ yarn generate

2. Run the deployment command again.

The default account (scaffold-eth-default) can only be used for localhost deployments.
`);
  process.exit(1);
}

// Set environment variables for the make command
const { rpcUrl, overrideEnvKey } = resolveRpcUrl(network);
process.env.RPC_URL = rpcUrl;
if (network === "localhost") {
  clearKeystoreEnvForLocalDeploy();
} else {
  process.env.ETH_KEYSTORE_ACCOUNT = selectedKeystore;
}
configureDeploymentProfile();
process.env.RESUME_FLAG = resume ? "--resume" : "";

// World Chain explorer support can vary by provider. Skip auto-verification here;
// verify manually via: make verify-blockscout NETWORK=<worldchain|worldchainSepolia> CONTRACT_ADDRESS=0x... CONTRACT_NAME=MyContract
const BLOCKSCOUT_NETWORKS = new Set(["worldchainSepolia", "worldchain"]);
process.env.DEPLOY_FLOW_FLAGS = buildDeployFlowFlags(network, process.env);

if (resume) {
  console.log("\n⏯️  Resuming previous broadcast state");
}

if (isSlowBroadcastNetwork(network)) {
  console.log(
    `\n🐢 Using throttled slow broadcast mode for ${network} to avoid sequencer nonce and RPC rate-limit issues`
  );
}

if (overrideEnvKey) {
  console.log(`\n🌐 Using custom RPC from ${overrideEnvKey}`);
}

// Determine verification flags based on network's explorer config
if (network !== "localhost") {
  if (BLOCKSCOUT_NETWORKS.has(network)) {
    process.env.VERIFY_FLAGS = "";
    // Suppress Forge's built-in etherscan lookups (manual World Chain verification)
    const existing = process.env.RUST_LOG || "";
    process.env.RUST_LOG = existing
      ? `${existing},etherscan=off`
      : "etherscan=off";
    console.log(`\n⚠️  Skipping auto-verification for ${network}`);
    console.log(
      `   Verify after deploy: ${formatBlockscoutVerifyCommand(network)}`
    );
  } else {
    try {
      const foundryTomlPath = join(__dirname, "..", "foundry.toml");
      const tomlString = readFileSync(foundryTomlPath, "utf-8");
      const parsedToml = parse(tomlString);
      const etherscanConfig = parsedToml.etherscan?.[network];

      if (etherscanConfig) {
        process.env.VERIFY_FLAGS = "--verify";
        console.log(`\n🔍 Verification: using Etherscan-compatible API`);
      } else {
        process.env.VERIFY_FLAGS = "";
        console.log(
          `\n⚠️  No explorer config for '${network}' — skipping verification`
        );
      }
    } catch {
      process.env.VERIFY_FLAGS = "";
    }
  }
} else {
  process.env.VERIFY_FLAGS = "";
}

// Pass target network so generateTsAbis.js can reorder scaffold.config.ts
process.env.DEPLOY_TARGET_NETWORK = network;

const result = spawnSync("make", ["deploy-and-generate-abis"], {
  stdio: "inherit",
  shell: true,
  cwd: join(__dirname, ".."),
});

if (result.status !== 0) {
  if (!resume && network !== "localhost") {
    console.log(
      "\n💡 If this was a partial broadcast, rerun the same deploy with --resume."
    );
  }
  process.exit(result.status);
}

// Run seed script for localhost deployments
if (network === "localhost") {
  const fundKeeperScript = join(
    __dirname,
    "..",
    "scripts-js",
    "fundLocalKeeper.js"
  );
  const fundKeeperResult = spawnSync("node", [fundKeeperScript], {
    stdio: "inherit",
    shell: true,
    cwd: join(__dirname, ".."),
  });
  if (fundKeeperResult.status !== 0) {
    process.exit(fundKeeperResult.status);
  }

  const seedScript = join(__dirname, "..", "script", "SeedContent.sh");
  const seedResult = spawnSync("bash", [seedScript], {
    stdio: "inherit",
    shell: true,
    cwd: join(__dirname, ".."),
  });
  process.exit(seedResult.status);
}

process.exit(0);
