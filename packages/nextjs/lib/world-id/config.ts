const DEFAULT_WORLD_ID_ACTION = "rateloop-human-credential-v1";
const DEFAULT_WORLD_ID_ENVIRONMENT = "production";

function cleanEnv(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getWorldIdClientConfig() {
  const appId = cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_APP_ID);
  const action = cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_ACTION) ?? DEFAULT_WORLD_ID_ACTION;
  const environment = cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT) ?? DEFAULT_WORLD_ID_ENVIRONMENT;

  return {
    action,
    appId,
    enabled: Boolean(appId && action),
    environment: environment === "staging" ? "staging" : "production",
  };
}

export function getWorldIdServerConfig() {
  const rpId = cleanEnv(process.env.WORLD_ID_RP_ID) ?? cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_APP_ID);
  const action = cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_ACTION) ?? DEFAULT_WORLD_ID_ACTION;
  const environment = cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT) ?? DEFAULT_WORLD_ID_ENVIRONMENT;
  const signingKey = cleanEnv(process.env.WORLD_ID_SIGNING_KEY);

  return {
    action,
    environment: environment === "staging" ? "staging" : "production",
    rpId,
    signingKey,
  };
}
