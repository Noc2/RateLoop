import {
  PRODUCTION_REDEPLOY_CONFIRMATION_ENV,
  isProductionDeployNetwork,
  parseDeployArgs,
  readProductionDeploymentArtifact,
  validateProductionRedeployConfirmation,
} from "./deployArgs.js";

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

function main() {
  const network = readDeployTargetNetwork();
  if (network === "localhost") return;

  const rpcUrl = process.env.RPC_URL?.trim();
  if (!process.env.DEPLOY_TARGET_NETWORK?.trim() && rpcUrl !== network) {
    throw new Error(
      "Refusing live make deploy without DEPLOY_TARGET_NETWORK. Use `yarn deploy --network <network>` or set DEPLOY_TARGET_NETWORK to the intended supported network."
    );
  }

  if (!isProductionDeployNetwork(network)) return;

  validateProductionRedeployConfirmation({
    network,
    deploymentJson: readProductionDeploymentArtifact(network),
    confirmation: process.env[PRODUCTION_REDEPLOY_CONFIRMATION_ENV],
  });
}

try {
  main();
} catch (error) {
  console.error(`\n❌ Error: ${error.message}`);
  process.exit(1);
}
