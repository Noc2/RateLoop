const DEFAULT_WORLD_ID_CREDENTIAL_ACTION = "rateloop-human-credential-v1";
const DEFAULT_WORLD_ID_PRESENCE_ACTION = "rateloop-human-presence-v1";
const DEFAULT_WORLD_ID_ENVIRONMENT = "production";
const WORLD_ID_RP_ID_PREFIX = "rp_";

type WorldIdE2EMode = "mock" | null;
export type WorldIdActionPurpose = "credential" | "presence";

function cleanEnv(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveWorldIdE2EMode(value: string | undefined): WorldIdE2EMode {
  return cleanEnv(value) === "mock" ? "mock" : null;
}

function resolveWorldIdRpContextId() {
  const rpId = cleanEnv(process.env.WORLD_ID_RP_ID) ?? cleanEnv(process.env.WORLD_ID_V4_RP_ID);
  if (!rpId) {
    return {
      error: "World ID relying-party ID is not configured for this deployment.",
      rpId: undefined,
    };
  }

  if (!rpId.startsWith(WORLD_ID_RP_ID_PREFIX)) {
    return {
      error: "World ID relying-party ID must use the rp_ value from the World Developer Portal.",
      rpId: undefined,
    };
  }

  return { error: undefined, rpId };
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
  const { error: rpIdError, rpId } = resolveWorldIdRpContextId();
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
    rpIdError,
    signingKey,
  };
}
