import { createPublicClient } from "viem";
import {
  validateTokenlessDeploymentOnChain,
  type ValidatedTokenlessDeploymentHealth,
} from "./deployment-health";
import { resolveTokenlessDeployment } from "./protocol-deployment";
import { createPonderRpcTransport, resolvePonderRpcUrls } from "./rpc";

const VALIDATION_TTL_MS = 30_000;

const deployment = resolveTokenlessDeployment();
const client = createPublicClient({
  transport: createPonderRpcTransport(resolvePonderRpcUrls(deployment)),
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
