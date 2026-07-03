import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEPLOY_HELP_TEXT = `
Usage: yarn deploy [options]
Options:
  --network <network>   Specify the network (default: localhost)
  --keystore <name>     Specify the live-network keystore account to use (bypasses selection prompt)
  --resume              Resume a partial broadcast for the current network + account
  --help, -h           Show this help message
Examples:
  yarn deploy --network base --keystore my-account --resume
  yarn deploy
  `;

const SUPPORTED_DEPLOY_NETWORKS = new Set(["localhost", "base"]);

const SLOW_BROADCAST_NETWORKS = new Set(["base"]);
const PRODUCTION_DEPLOY_NETWORKS = new Set(["base"]);
export const DEPLOY_NETWORK_CHAIN_IDS = {
  localhost: 31337,
  base: 8453,
};
export const PRODUCTION_DEPLOY_CHAIN_IDS = {
  base: 8453,
};

export const DEFAULT_LIVE_DEPLOY_COMPUTE_UNITS_PER_SECOND = "25";
export const DEFAULT_LIVE_DEPLOY_RPC_TIMEOUT_SECONDS = "120";
export const DEFAULT_LIVE_DEPLOY_BROADCAST_TIMEOUT_SECONDS = "300";
export const DEFAULT_RPC_CHAIN_ID_TIMEOUT_MS = 10_000;
export const RATELOOP_DEPLOYMENT_PROFILE_ENV = "RATELOOP_DEPLOYMENT_PROFILE";
export const PRODUCTION_DEPLOYMENT_PROFILE = "production";
export const DEFAULT_DEPLOYMENT_PROFILE = "default";
const ENV_INTERPOLATION_RE = /^\$\{([A-Z0-9_]+)\}$/;
const ENV_INTERPOLATION_GLOBAL_RE = /\$\{([A-Z0-9_]+)\}/g;
const DEPLOY_KEYSTORE_ACCOUNT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const foundryPackageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

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

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      return {
        showHelp: true,
        network,
        keystoreArg,
        resume,
      };
    }

    if (arg === "--network") {
      network = readOptionValue(args, i, "--network");
      i++;
      continue;
    }

    if (arg === "--keystore") {
      keystoreArg = assertDeployKeystoreAccountName(
        readOptionValue(args, i, "--keystore"),
        "--keystore"
      );
      i++;
      continue;
    }

    if (arg === "--resume") {
      resume = true;
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

  return {
    showHelp: false,
    network,
    keystoreArg,
    resume,
  };
}

export function isDeployKeystoreAccountName(value) {
  return typeof value === "string" && DEPLOY_KEYSTORE_ACCOUNT_RE.test(value);
}

export function assertDeployKeystoreAccountName(
  value,
  label = "keystore name"
) {
  if (!isDeployKeystoreAccountName(value)) {
    throw new Error(
      `${label} must be 1-128 characters, start with a letter or number, and use only letters, numbers, dots, underscores, or dashes.`
    );
  }
  return value;
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
    DEFAULT_LIVE_DEPLOY_COMPUTE_UNITS_PER_SECOND
  );
  const rpcTimeoutSeconds = envValue(
    env,
    "RATELOOP_LIVE_DEPLOY_RPC_TIMEOUT_SECONDS",
    DEFAULT_LIVE_DEPLOY_RPC_TIMEOUT_SECONDS
  );
  const broadcastTimeoutSeconds = envValue(
    env,
    "RATELOOP_LIVE_DEPLOY_BROADCAST_TIMEOUT_SECONDS",
    DEFAULT_LIVE_DEPLOY_BROADCAST_TIMEOUT_SECONDS
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
      `${RATELOOP_DEPLOYMENT_PROFILE_ENV} must be ${PRODUCTION_DEPLOYMENT_PROFILE} for mainnet deployments.`
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

export function getDeployNetworkChainId(network) {
  return DEPLOY_NETWORK_CHAIN_IDS[network] ?? null;
}

export function getProductionDeployNetworkForChainId(chainId) {
  const parsedChainId = Number(chainId);
  return (
    Object.entries(PRODUCTION_DEPLOY_CHAIN_IDS).find(
      ([, productionChainId]) => productionChainId === parsedChainId
    )?.[0] ?? null
  );
}

export function resolveConfiguredRpcEndpoint(endpoint, env = process.env) {
  const value = String(endpoint ?? "").trim();
  if (!value) return "";

  return value.replace(ENV_INTERPOLATION_GLOBAL_RE, (_, envKey) => {
    const envValue = env[envKey]?.trim();
    if (!envValue) {
      throw new Error(`${envKey} is required to resolve RPC endpoint.`);
    }
    return envValue;
  });
}

export async function readRpcChainId(
  rpcUrl,
  { fetchImpl = fetch, timeoutMs = DEFAULT_RPC_CHAIN_ID_TIMEOUT_MS } = {}
) {
  const controller =
    typeof AbortController === "function" ? new AbortController() : null;
  const timeout =
    controller && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

  try {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      signal: controller?.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
    });
    if (!response.ok) {
      throw new Error(`RPC eth_chainId failed with HTTP ${response.status}.`);
    }

    const payload = await response.json();
    if (payload?.error) {
      throw new Error(
        `RPC eth_chainId failed: ${
          payload.error.message ?? JSON.stringify(payload.error)
        }`
      );
    }

    const rawChainId = payload?.result;
    const parsedChainId =
      typeof rawChainId === "string" && rawChainId.startsWith("0x")
        ? Number.parseInt(rawChainId, 16)
        : Number(rawChainId);
    if (!Number.isInteger(parsedChainId) || parsedChainId <= 0) {
      throw new Error(
        `RPC eth_chainId returned invalid chain ID ${rawChainId}.`
      );
    }
    return parsedChainId;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`RPC eth_chainId timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function validateObservedDeployChain({
  network,
  rpcUrl,
  fetchImpl,
}) {
  if (network === "localhost") {
    return {
      observedChainId: null,
      productionNetwork: null,
    };
  }

  let observedChainId;
  try {
    observedChainId = await readRpcChainId(rpcUrl, { fetchImpl });
  } catch (error) {
    throw new Error(
      `Unable to verify RPC chain for ${network}: ${error.message}`
    );
  }

  const expectedChainId = getDeployNetworkChainId(network);
  if (!expectedChainId) {
    throw new Error(`Missing deploy chain ID for ${network}.`);
  }
  if (observedChainId !== expectedChainId) {
    throw new Error(
      `Refusing to deploy to ${network}: RPC_URL reports chain ${observedChainId}, expected ${expectedChainId}.`
    );
  }

  const productionNetwork =
    getProductionDeployNetworkForChainId(observedChainId);
  if (productionNetwork) {
    validateProductionRedeployConfirmation({
      network: productionNetwork,
      deploymentJson: readProductionDeploymentArtifact(productionNetwork),
    });
  }

  return {
    observedChainId,
    productionNetwork,
  };
}

export function readProductionDeploymentArtifact(
  network,
  rootDir = foundryPackageRoot
) {
  const chainId = getProductionDeployChainId(network);
  if (!chainId) return null;
  const deploymentPath = join(rootDir, "deployments", `${chainId}.json`);
  if (!existsSync(deploymentPath)) {
    return null;
  }

  return JSON.parse(readFileSync(deploymentPath, "utf8"));
}

export function validateProductionRedeployConfirmation({
  network,
  deploymentJson,
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
    return {
      required: false,
      expectedToken: null,
    };
  }

  if (deploymentJson.networkName !== network) {
    throw new Error(
      `Refusing to deploy to ${network}: existing production artifact is for ${
        deploymentJson.networkName ?? "unknown network"
      }.`
    );
  }

  if (deploymentJson.deploymentProfile !== PRODUCTION_DEPLOYMENT_PROFILE) {
    throw new Error(
      `Refusing to deploy to ${network}: existing deployment artifact must use deploymentProfile=${PRODUCTION_DEPLOYMENT_PROFILE}.`
    );
  }

  return {
    required: false,
    expectedToken: null,
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
