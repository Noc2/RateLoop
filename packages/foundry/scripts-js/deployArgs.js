export const DEPLOY_HELP_TEXT = `
Usage: yarn deploy [options]
Options:
  --network <network>   Specify the network (default: localhost)
  --keystore <name>     Specify the live-network keystore account to use (bypasses selection prompt)
  --resume              Resume a partial broadcast for the current network + account
  --world-id-staging-canary
                        Deploy World Chain mainnet with the World ID staging verifier
  --help, -h           Show this help message
Examples:
  yarn deploy --network worldchainSepolia --keystore my-account --resume
  yarn deploy --network worldchain --world-id-staging-canary --keystore my-account
  yarn deploy --network worldchain --keystore my-account
  yarn deploy
  `;

const SUPPORTED_DEPLOY_NETWORKS = new Set([
  "localhost",
  "worldchainSepolia",
  "worldchain",
]);

const SLOW_BROADCAST_NETWORKS = new Set(["worldchainSepolia", "worldchain"]);

export const DEFAULT_WORLDCHAIN_DEPLOY_COMPUTE_UNITS_PER_SECOND = "25";
export const DEFAULT_WORLDCHAIN_DEPLOY_RPC_TIMEOUT_SECONDS = "120";
export const DEFAULT_WORLDCHAIN_DEPLOY_BROADCAST_TIMEOUT_SECONDS = "300";
export const WORLD_ID_STAGING_VERIFIER_ADDRESS =
  "0x703a6316c975DEabF30b637c155edD53e24657DB";
export const RATELOOP_MAINNET_CANARY_ENV = "RATELOOP_MAINNET_CANARY";
export const WORLD_ID_V4_VERIFIER_ADDRESS_ENV = "WORLD_ID_V4_VERIFIER_ADDRESS";

function readOptionValue(args, index, optionName) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(
      `Missing value for ${optionName}. Run \`yarn deploy --help\` for usage.`
    );
  }
  return value;
}

export function parseDeployArgs(args) {
  let network = "localhost";
  let keystoreArg = null;
  let resume = false;
  let worldIdStagingCanary = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      return {
        showHelp: true,
        network,
        keystoreArg,
        resume,
        worldIdStagingCanary,
      };
    }

    if (arg === "--network") {
      network = readOptionValue(args, i, "--network");
      i++;
      continue;
    }

    if (arg === "--keystore") {
      keystoreArg = readOptionValue(args, i, "--keystore");
      i++;
      continue;
    }

    if (arg === "--resume") {
      resume = true;
      continue;
    }

    if (arg === "--world-id-staging-canary") {
      worldIdStagingCanary = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(
        `Unknown option: ${arg}. Run \`yarn deploy --help\` for usage.`
      );
    }

    throw new Error(
      `Unexpected argument: ${arg}. Run \`yarn deploy --help\` for usage.`
    );
  }

  if (!SUPPORTED_DEPLOY_NETWORKS.has(network)) {
    throw new Error(
      `Unsupported deploy network: ${network}. Supported networks: ${Array.from(
        SUPPORTED_DEPLOY_NETWORKS
      ).join(", ")}.`
    );
  }

  if (worldIdStagingCanary && network !== "worldchain") {
    throw new Error(
      "--world-id-staging-canary is only supported with --network worldchain."
    );
  }

  return {
    showHelp: false,
    network,
    keystoreArg,
    resume,
    worldIdStagingCanary,
  };
}

function envValue(env, key, fallback) {
  const value = env[key]?.trim();
  return value ? value : fallback;
}

export function isSlowBroadcastNetwork(network) {
  return SLOW_BROADCAST_NETWORKS.has(network);
}

export function buildDeployFlowFlags(network, env = process.env) {
  if (!isSlowBroadcastNetwork(network)) {
    return "";
  }

  const computeUnitsPerSecond = envValue(
    env,
    "WORLDCHAIN_DEPLOY_COMPUTE_UNITS_PER_SECOND",
    DEFAULT_WORLDCHAIN_DEPLOY_COMPUTE_UNITS_PER_SECOND
  );
  const rpcTimeoutSeconds = envValue(
    env,
    "WORLDCHAIN_DEPLOY_RPC_TIMEOUT_SECONDS",
    DEFAULT_WORLDCHAIN_DEPLOY_RPC_TIMEOUT_SECONDS
  );
  const broadcastTimeoutSeconds = envValue(
    env,
    "WORLDCHAIN_DEPLOY_BROADCAST_TIMEOUT_SECONDS",
    DEFAULT_WORLDCHAIN_DEPLOY_BROADCAST_TIMEOUT_SECONDS
  );

  return [
    "--slow",
    "--compute-units-per-second",
    computeUnitsPerSecond,
    "--rpc-timeout",
    rpcTimeoutSeconds,
    "--timeout",
    broadcastTimeoutSeconds,
  ].join(" ");
}

export function buildWorldIdStagingCanaryEnv(env = process.env) {
  const existingVerifier = env[WORLD_ID_V4_VERIFIER_ADDRESS_ENV]?.trim();
  if (
    existingVerifier &&
    existingVerifier.toLowerCase() !==
      WORLD_ID_STAGING_VERIFIER_ADDRESS.toLowerCase()
  ) {
    throw new Error(
      `--world-id-staging-canary requires ${WORLD_ID_V4_VERIFIER_ADDRESS_ENV} to be unset or ${WORLD_ID_STAGING_VERIFIER_ADDRESS}. Received: ${existingVerifier}`
    );
  }

  return {
    [RATELOOP_MAINNET_CANARY_ENV]: "true",
    [WORLD_ID_V4_VERIFIER_ADDRESS_ENV]: WORLD_ID_STAGING_VERIFIER_ADDRESS,
  };
}
