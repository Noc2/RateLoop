const DEFAULT_WORLD_ID_ACTION = "rateloop-human-credential-v1";
const DEFAULT_WORLD_ID_ENVIRONMENT = "production";

export type WorldIdProofMode = "legacy" | "compat" | "v4";
type WorldIdE2EMode = "mock" | null;

function cleanEnv(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveWorldIdE2EMode(value: string | undefined): WorldIdE2EMode {
  return cleanEnv(value) === "mock" ? "mock" : null;
}

function resolveWorldIdProofMode(value: string | undefined): WorldIdProofMode {
  const proofMode = cleanEnv(value);
  return proofMode === "compat" || proofMode === "v4" ? proofMode : "legacy";
}

export function getWorldIdClientConfig() {
  const appId = cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_APP_ID);
  const action = cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_ACTION) ?? DEFAULT_WORLD_ID_ACTION;
  const environment = cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT) ?? DEFAULT_WORLD_ID_ENVIRONMENT;
  const e2eMode = resolveWorldIdE2EMode(process.env.NEXT_PUBLIC_WORLD_ID_E2E_MODE);
  const proofMode = resolveWorldIdProofMode(process.env.NEXT_PUBLIC_WORLD_ID_PROOF_MODE);

  return {
    action,
    appId,
    e2eMode,
    enabled: Boolean(appId && action),
    environment: environment === "staging" ? "staging" : "production",
    proofMode,
  };
}

export function getWorldIdServerConfig() {
  const rpId = cleanEnv(process.env.WORLD_ID_RP_ID) ?? cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_APP_ID);
  const action = cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_ACTION) ?? DEFAULT_WORLD_ID_ACTION;
  const environment = cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT) ?? DEFAULT_WORLD_ID_ENVIRONMENT;
  const proofMode = resolveWorldIdProofMode(process.env.NEXT_PUBLIC_WORLD_ID_PROOF_MODE);
  const signingKey = cleanEnv(process.env.WORLD_ID_SIGNING_KEY);

  return {
    action,
    environment: environment === "staging" ? "staging" : "production",
    proofMode,
    rpId,
    signingKey,
  };
}
