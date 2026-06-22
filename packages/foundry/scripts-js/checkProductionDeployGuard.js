import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "toml";
import {
  PRODUCTION_REDEPLOY_CONFIRMATION_ENV,
  parseDeployArgs,
  resolveConfiguredRpcEndpoint,
  validateObservedDeployChain,
} from "./deployArgs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readDeployTargetNetwork(env = process.env) {
  const explicitTarget = env.DEPLOY_TARGET_NETWORK?.trim();
  if (explicitTarget) {
    return parseDeployArgs(["--network", explicitTarget]).network;
  }

  const rpcUrl = env.RPC_URL?.trim();
  if (!rpcUrl || rpcUrl === "localhost") return "localhost";

  try {
    const parsed = parseDeployArgs(["--network", rpcUrl]);
    if (parsed.network === rpcUrl) return parsed.network;
  } catch {
    throw new Error(
      "Refusing live make deploy without DEPLOY_TARGET_NETWORK. Use `yarn deploy --network <network>` or set DEPLOY_TARGET_NETWORK to the intended supported network."
    );
  }

  throw new Error("Unexpected deploy target resolution failure.");
}

function readFoundryRpcEndpoints() {
  const foundryTomlPath = join(__dirname, "..", "foundry.toml");
  if (!existsSync(foundryTomlPath)) return {};
  const parsedToml = parse(readFileSync(foundryTomlPath, "utf8"));
  return parsedToml.rpc_endpoints ?? {};
}

function resolveGuardRpcUrl(rpcUrl, env = process.env) {
  try {
    const parsed = parseDeployArgs(["--network", rpcUrl]);
    if (parsed.network !== rpcUrl) return rpcUrl;
    const endpoint = readFoundryRpcEndpoints()[parsed.network];
    if (!endpoint) {
      throw new Error(
        `Network '${parsed.network}' not found in foundry.toml rpc_endpoints.`
      );
    }
    return resolveConfiguredRpcEndpoint(endpoint, env);
  } catch (error) {
    if (error.message.includes("not found in foundry.toml")) {
      throw error;
    }
    return rpcUrl;
  }
}

async function main() {
  const network = readDeployTargetNetwork();
  if (network === "localhost") return;

  const rpcUrl = process.env.RPC_URL?.trim();
  if (!rpcUrl) {
    throw new Error("RPC_URL is required for live deploy guard checks.");
  }
  if (!process.env.DEPLOY_TARGET_NETWORK?.trim() && rpcUrl !== network) {
    throw new Error(
      "Refusing live make deploy without DEPLOY_TARGET_NETWORK. Use `yarn deploy --network <network>` or set DEPLOY_TARGET_NETWORK to the intended supported network."
    );
  }
  const resolvedRpcUrl = resolveGuardRpcUrl(rpcUrl);

  await validateObservedDeployChain({
    network,
    rpcUrl: resolvedRpcUrl,
    confirmation: process.env[PRODUCTION_REDEPLOY_CONFIRMATION_ENV],
  });
}

try {
  await main();
} catch (error) {
  console.error(`\n❌ Error: ${error.message}`);
  process.exit(1);
}
