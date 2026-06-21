export const DEPLOY_HELP_TEXT = `
Usage: yarn deploy [options]
Options:
  --network <network>   Specify the network (default: localhost)
  --keystore <name>     Specify the live-network keystore account to use (bypasses selection prompt)
  --resume              Resume a partial broadcast for the current network + account
  --confirm-production-redeploy <chainId:block>
                        Break-glass confirmation for redeploying an existing production stack
  --help, -h           Show this help message
Examples:
  yarn deploy --network baseSepolia --keystore my-account --resume
  yarn deploy
  `;

const SUPPORTED_DEPLOY_NETWORKS = new Set([
  "localhost",
  "baseSepolia",
  "base",
  "worldchainSepolia",
  "worldchain",
]);

const SLOW_BROADCAST_NETWORKS = new Set([
  "baseSepolia",
  "base",
  "worldchainSepolia",
  "worldchain",
]);
const PRODUCTION_DEPLOY_NETWORKS = new Set(["base", "worldchain"]);
export const PRODUCTION_DEPLOY_CHAIN_IDS = {
  base: 8453,
  worldchain: 480,
};

export const DEFAULT_LIVE_DEPLOY_COMPUTE_UNITS_PER_SECOND = "25";
export const DEFAULT_LIVE_DEPLOY_RPC_TIMEOUT_SECONDS = "120";
export const DEFAULT_LIVE_DEPLOY_BROADCAST_TIMEOUT_SECONDS = "300";
export const RATELOOP_DEPLOYMENT_PROFILE_ENV = "RATELOOP_DEPLOYMENT_PROFILE";
export const PRODUCTION_REDEPLOY_CONFIRMATION_ENV =
  "RATELOOP_CONFIRM_PRODUCTION_REDEPLOY";
export const PRODUCTION_DEPLOYMENT_PROFILE = "production";
export const DEFAULT_DEPLOYMENT_PROFILE = "default";
const ENV_INTERPOLATION_RE = /^\$\{([A-Z0-9_]+)\}$/;

function readOptionValue(args, index, optionName) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(
      `Missing value for ${optionName}. Run \`yarn deploy --help\` for usage.`,
    );
  }
  return value;
}

export function parseDeployArgs(args) {
  let network = "localhost";
  let keystoreArg = null;
  let resume = false;
  let productionRedeployConfirmation = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      return {
        showHelp: true,
        network,
        keystoreArg,
        resume,
        productionRedeployConfirmation,
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

    if (arg === "--confirm-production-redeploy") {
      productionRedeployConfirmation = readOptionValue(
        args,
        i,
        "--confirm-production-redeploy",
      );
      i++;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(
        `Unknown option: ${arg}. Run \`yarn deploy --help\` for usage.`,
      );
    }

    throw new Error(
      `Unexpected argument: ${arg}. Run \`yarn deploy --help\` for usage.`,
    );
  }

  if (!SUPPORTED_DEPLOY_NETWORKS.has(network)) {
    throw new Error(
      `Unsupported deploy network: ${network}. Supported networks: ${Array.from(
        SUPPORTED_DEPLOY_NETWORKS,
      ).join(", ")}.`,
    );
  }

  return {
    showHelp: false,
    network,
    keystoreArg,
    resume,
    productionRedeployConfirmation,
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
    "RATELOOP_LIVE_DEPLOY_COMPUTE_UNITS_PER_SECOND",
    envValue(
      env,
      "WORLDCHAIN_DEPLOY_COMPUTE_UNITS_PER_SECOND",
      DEFAULT_LIVE_DEPLOY_COMPUTE_UNITS_PER_SECOND,
    ),
  );
  const rpcTimeoutSeconds = envValue(
    env,
    "RATELOOP_LIVE_DEPLOY_RPC_TIMEOUT_SECONDS",
    envValue(
      env,
      "WORLDCHAIN_DEPLOY_RPC_TIMEOUT_SECONDS",
      DEFAULT_LIVE_DEPLOY_RPC_TIMEOUT_SECONDS,
    ),
  );
  const broadcastTimeoutSeconds = envValue(
    env,
    "RATELOOP_LIVE_DEPLOY_BROADCAST_TIMEOUT_SECONDS",
    envValue(
      env,
      "WORLDCHAIN_DEPLOY_BROADCAST_TIMEOUT_SECONDS",
      DEFAULT_LIVE_DEPLOY_BROADCAST_TIMEOUT_SECONDS,
    ),
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

export function buildDeploymentProfileEnv({ network }, env = process.env) {
  const expectedProfile = PRODUCTION_DEPLOY_NETWORKS.has(network)
    ? PRODUCTION_DEPLOYMENT_PROFILE
    : DEFAULT_DEPLOYMENT_PROFILE;
  const existingProfile = env[RATELOOP_DEPLOYMENT_PROFILE_ENV]?.trim();
  if (
    PRODUCTION_DEPLOY_NETWORKS.has(network) &&
    existingProfile &&
    existingProfile !== PRODUCTION_DEPLOYMENT_PROFILE
  ) {
    throw new Error(
      `${RATELOOP_DEPLOYMENT_PROFILE_ENV} must be ${PRODUCTION_DEPLOYMENT_PROFILE} for mainnet deployments.`,
    );
  }

  return {
    [RATELOOP_DEPLOYMENT_PROFILE_ENV]: existingProfile || expectedProfile,
  };
}

export function isProductionDeployNetwork(network) {
  return PRODUCTION_DEPLOY_NETWORKS.has(network);
}

export function getProductionDeployChainId(network) {
  return PRODUCTION_DEPLOY_CHAIN_IDS[network] ?? null;
}

export function buildProductionRedeployConfirmationToken({
  chainId,
  deploymentBlockNumber,
}) {
  const parsedChainId = Number(chainId);
  const parsedDeploymentBlockNumber = Number(deploymentBlockNumber);
  if (!Number.isInteger(parsedChainId) || parsedChainId <= 0) {
    throw new Error(
      "Production redeploy confirmation requires a valid chain ID.",
    );
  }
  if (
    !Number.isInteger(parsedDeploymentBlockNumber) ||
    parsedDeploymentBlockNumber <= 0
  ) {
    throw new Error(
      "Production redeploy confirmation requires a valid deploymentBlockNumber.",
    );
  }
  return `${parsedChainId}:${parsedDeploymentBlockNumber}`;
}

export function validateProductionRedeployConfirmation({
  network,
  deploymentJson,
  confirmation,
}) {
  if (!isProductionDeployNetwork(network)) {
    return {
      required: false,
      expectedToken: null,
    };
  }

  const chainId = getProductionDeployChainId(network);
  if (!chainId) {
    throw new Error(`Missing production chain ID for ${network}.`);
  }

  if (!deploymentJson || typeof deploymentJson !== "object") {
    throw new Error(
      `Refusing to deploy to ${network}: missing existing production deployment artifact for chain ${chainId}. Restore the artifact or use a dedicated incident runbook before redeploying.`,
    );
  }

  if (deploymentJson.networkName !== network) {
    throw new Error(
      `Refusing to deploy to ${network}: existing production artifact is for ${deploymentJson.networkName ?? "unknown network"}.`,
    );
  }

  if (deploymentJson.deploymentProfile !== PRODUCTION_DEPLOYMENT_PROFILE) {
    throw new Error(
      `Refusing to deploy to ${network}: existing deployment artifact must use deploymentProfile=${PRODUCTION_DEPLOYMENT_PROFILE}.`,
    );
  }

  const expectedToken = buildProductionRedeployConfirmationToken({
    chainId,
    deploymentBlockNumber: deploymentJson.deploymentBlockNumber,
  });
  const providedToken = confirmation?.trim() ?? "";

  if (providedToken !== expectedToken) {
    throw new Error(
      [
        `Refusing to deploy to ${network}: production contracts are already deployed.`,
        "For routine configuration, indexing, UI, keeper, or operator changes, use the existing deployment.",
        `If this is a deliberate incident/governance redeploy, pass --confirm-production-redeploy ${expectedToken} or set ${PRODUCTION_REDEPLOY_CONFIRMATION_ENV}=${expectedToken}.`,
      ].join(" "),
    );
  }

  return {
    required: true,
    expectedToken,
  };
}

export function resolveEtherscanVerification({
  etherscanConfig,
  env = process.env,
}) {
  if (!etherscanConfig) {
    return {
      verifyFlags: "",
      reason: "missing-explorer-config",
    };
  }

  const rawKey = String(etherscanConfig.key ?? "").trim();
  const requiredApiKeyEnv = rawKey.match(ENV_INTERPOLATION_RE)?.[1] ?? null;
  if (requiredApiKeyEnv && !env[requiredApiKeyEnv]?.trim()) {
    return {
      verifyFlags: "",
      reason: "missing-api-key",
      requiredApiKeyEnv,
    };
  }

  return {
    verifyFlags: "--verify",
    reason: "enabled",
    requiredApiKeyEnv,
  };
}
