const DEFAULT_WORLD_ID_CREDENTIAL_ACTION = "rateloop-human-credential-v1";
const DEFAULT_WORLD_ID_PRESENCE_ACTION = "rateloop-human-presence-v1";
const DEFAULT_WORLD_ID_ENVIRONMENT = "production";

type WorldIdE2EMode = "mock" | null;
export type WorldIdActionPurpose = "credential" | "presence";

function cleanEnv(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveWorldIdE2EMode(value: string | undefined): WorldIdE2EMode {
  return cleanEnv(value) === "mock" ? "mock" : null;
}

export function getWorldIdClientConfig() {
  const appId = cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_APP_ID);
  const credentialAction =
    cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION) ?? DEFAULT_WORLD_ID_CREDENTIAL_ACTION;
  const presenceAction = cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_PRESENCE_ACTION) ?? DEFAULT_WORLD_ID_PRESENCE_ACTION;
  const environment = cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT) ?? DEFAULT_WORLD_ID_ENVIRONMENT;
  const e2eMode = resolveWorldIdE2EMode(process.env.NEXT_PUBLIC_WORLD_ID_E2E_MODE);

  return {
    action: credentialAction,
    appId,
    credentialAction,
    e2eMode,
    enabled: Boolean(appId && credentialAction && presenceAction),
    environment: environment === "staging" ? "staging" : "production",
    presenceAction,
  };
}

export function getWorldIdServerConfig(purpose: WorldIdActionPurpose = "credential") {
  const rpId = cleanEnv(process.env.WORLD_ID_V4_RP_ID) ?? cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_APP_ID);
  const credentialAction =
    cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION) ?? DEFAULT_WORLD_ID_CREDENTIAL_ACTION;
  const presenceAction = cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_PRESENCE_ACTION) ?? DEFAULT_WORLD_ID_PRESENCE_ACTION;
  const environment = cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT) ?? DEFAULT_WORLD_ID_ENVIRONMENT;
  const signingKey = cleanEnv(process.env.WORLD_ID_SIGNING_KEY);

  return {
    action: purpose === "presence" ? presenceAction : credentialAction,
    credentialAction,
    environment: environment === "staging" ? "staging" : "production",
    presenceAction,
    rpId,
    signingKey,
  };
}
