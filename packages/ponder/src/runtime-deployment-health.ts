import { createPublicClient, http } from "viem";
import {
  validateTokenlessDeploymentOnChain,
  type ValidatedTokenlessDeploymentHealth,
} from "./deployment-health";
import {
  resolveTokenlessDeployment,
  type TokenlessDeployment,
} from "./protocol-deployment";

const VALIDATION_TTL_MS = 30_000;

function rpcUrlForDeployment(
  deployment: TokenlessDeployment,
  env: NodeJS.ProcessEnv = process.env,
) {
  const key = `PONDER_RPC_URL_${deployment.chainId}`;
  const value = env[key]?.trim();
  if (value) {
    const parsed = new URL(value);
    if (deployment.network !== "hardhat" && parsed.protocol !== "https:") {
      throw new Error(`${key} must use HTTPS.`);
    }
    return value;
  }
  if (deployment.network === "hardhat") return "http://127.0.0.1:8545";
  throw new Error(`${key} is required.`);
}

const deployment = resolveTokenlessDeployment();
const client = createPublicClient({
  transport: http(rpcUrlForDeployment(deployment)),
});
let cached:
  | {
      expiresAt: number;
      value: ValidatedTokenlessDeploymentHealth;
    }
  | undefined;
let inFlight: Promise<ValidatedTokenlessDeploymentHealth> | undefined;

export async function validateRuntimeTokenlessDeployment() {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;
  if (inFlight) return inFlight;

  inFlight = validateTokenlessDeploymentOnChain(client, deployment)
    .then((value) => {
      cached = { expiresAt: Date.now() + VALIDATION_TTL_MS, value };
      return value;
    })
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}
