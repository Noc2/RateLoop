import { spawnSync } from "child_process";
import { config } from "dotenv";
import { join, dirname } from "path";
import { readFileSync, existsSync } from "fs";
import { parse } from "toml";
import { fileURLToPath } from "url";
import {
  DEPLOY_HELP_TEXT,
  assertDeployKeystoreAccountName,
  buildDeploymentProfileEnv,
  buildDeployFlowFlags,
  isSlowBroadcastNetwork,
  parseDeployArgs,
  resolveConfiguredRpcEndpoint,
  resolveEtherscanVerification,
  validateObservedDeployChain,
} from "./deployArgs.js";
import { selectOrCreateKeystore } from "./selectOrCreateKeystore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

const NETWORK_RPC_OVERRIDE_ENV = {
  base: "BASE_RPC_URL",
};
const LOCAL_DEPLOYMENT_SYNC_CONTRACTS = [
  "LoopReputation",
  "ContentRegistry",
  "RoundVotingEngine",
  "RoundRewardDistributor",
  "QuestionRewardPoolEscrow",
  "ConfidentialityEscrow",
  "FeedbackRegistry",
  "FeedbackBonusEscrow",
  "CategoryRegistry",
  "RaterRegistry",
  "ClusterPayoutOracle",
  "LaunchDistributionPool",
  "AdvisoryVoteRecorder",
  "X402QuestionSubmitter",
  "FrontendRegistry",
  "ProfileRegistry",
  "ProtocolConfig",
  "MockERC20",
  "MockWorldIDRouter",
];
let foundryRpcEndpoints = {};

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
  const safeKeystoreName = assertDeployKeystoreAccountName(keystoreName);
  if (keystoreName === "scaffold-eth-default") {
    return true; // Default keystore is always valid
  }

  const keystorePath = join(
    process.env.HOME,
    ".foundry",
    "keystores",
    safeKeystoreName
  );
  return existsSync(keystorePath);
}

function resolveRpcUrl(networkName) {
  const overrideEnvKey = NETWORK_RPC_OVERRIDE_ENV[networkName];
  if (!overrideEnvKey) {
    return { rpcUrl: networkName, overrideEnvKey: null };
  }

  const overrideValue = process.env[overrideEnvKey]?.trim();
  if (overrideValue) {
    return { rpcUrl: overrideValue, overrideEnvKey };
  }

  const configuredRpcUrl = resolveConfiguredRpcEndpoint(
    foundryRpcEndpoints[networkName],
    process.env
  );
  return { rpcUrl: configuredRpcUrl || networkName, overrideEnvKey: null };
}

function clearKeystoreEnvForLocalDeploy() {
  delete process.env.ETH_KEYSTORE_ACCOUNT;
  delete process.env.ETH_KEYSTORE;
  delete process.env.ETH_PASSWORD;
}

async function validateProductionDeployGuard(rpcUrl) {
  try {
    await validateObservedDeployChain({
      network,
      rpcUrl,
    });
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
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
  foundryRpcEndpoints = parsedToml.rpc_endpoints ?? {};

  if (!foundryRpcEndpoints[network]) {
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

const { rpcUrl, overrideEnvKey } = resolveRpcUrl(network);
await validateProductionDeployGuard(rpcUrl);

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
    selectedKeystore = assertDeployKeystoreAccountName(keystoreArg);
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
process.env.RPC_URL = rpcUrl;
if (network === "localhost") {
  clearKeystoreEnvForLocalDeploy();
} else {
  process.env.ETH_KEYSTORE_ACCOUNT =
    assertDeployKeystoreAccountName(selectedKeystore);
}
configureDeploymentProfile();
process.env.RESUME_FLAG = resume ? "--resume" : "";

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
  try {
    const foundryTomlPath = join(__dirname, "..", "foundry.toml");
    const tomlString = readFileSync(foundryTomlPath, "utf-8");
    const parsedToml = parse(tomlString);
    const etherscanConfig = parsedToml.etherscan?.[network];
    const verification = resolveEtherscanVerification({
      etherscanConfig,
      env: process.env,
    });

    process.env.VERIFY_FLAGS = verification.verifyFlags;
    if (verification.reason === "enabled") {
      console.log(`\n🔍 Verification: using Etherscan-compatible API`);
    } else if (verification.reason === "missing-api-key") {
      console.log(
        `\n⚠️  Skipping auto-verification for ${network}: ${verification.requiredApiKeyEnv} is not set`
      );
    } else {
      console.log(
        `\n⚠️  No explorer config for '${network}' — skipping verification`
      );
    }
  } catch {
    process.env.VERIFY_FLAGS = "";
  }
} else {
  process.env.VERIFY_FLAGS = "";
}

// Pass target network so generateTsAbis.js can reorder scaffold.config.ts
process.env.DEPLOY_TARGET_NETWORK = network;

const result = spawnSync("make", ["deploy-and-generate-abis"], {
  stdio: "inherit",
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
  const localDeploymentSyncResult = spawnSync(
    "node",
    [
      join(__dirname, "validateLocalDeploymentSync.js"),
      join(__dirname, "..", "deployments", "31337.json"),
      join(__dirname, "..", "..", "contracts", "src", "deployedContracts.ts"),
      "31337",
      ...LOCAL_DEPLOYMENT_SYNC_CONTRACTS,
    ],
    {
      stdio: "inherit",
      cwd: join(__dirname, ".."),
    }
  );
  if (localDeploymentSyncResult.status !== 0) {
    process.exit(localDeploymentSyncResult.status);
  }

  const fundKeeperScript = join(
    __dirname,
    "..",
    "scripts-js",
    "fundLocalKeeper.js"
  );
  const fundKeeperResult = spawnSync("node", [fundKeeperScript], {
    stdio: "inherit",
    cwd: join(__dirname, ".."),
  });
  if (fundKeeperResult.status !== 0) {
    process.exit(fundKeeperResult.status);
  }

  const seedScript = join(__dirname, "..", "script", "SeedContent.sh");
  const seedResult = spawnSync("bash", [seedScript], {
    stdio: "inherit",
    cwd: join(__dirname, ".."),
  });
  process.exit(seedResult.status);
}

process.exit(0);
