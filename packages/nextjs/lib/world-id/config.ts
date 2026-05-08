const DEFAULT_WORLD_ID_ACTION = "rateloop-human-credential-v1";
const DEFAULT_WORLD_ID_ENVIRONMENT = "production";
const DEFAULT_WORLD_ID_VERIFY_ENDPOINT = "https://developer.world.org/api/v4/verify";

function cleanEnv(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getWorldIdClientConfig() {
  const appId = cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_APP_ID);
  const action = cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_ACTION) ?? DEFAULT_WORLD_ID_ACTION;
  const environment = cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT) ?? DEFAULT_WORLD_ID_ENVIRONMENT;
  const signal = cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_SIGNAL);

  return {
    action,
    appId,
    enabled: Boolean(appId && action),
    environment: environment === "staging" ? "staging" : "production",
    signal,
  };
}

export function getWorldIdServerConfig() {
  const endpoint = cleanEnv(process.env.WORLD_ID_VERIFY_ENDPOINT) ?? DEFAULT_WORLD_ID_VERIFY_ENDPOINT;
  const rpId = cleanEnv(process.env.WORLD_ID_RP_ID) ?? cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_APP_ID);
  const action = cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_ACTION) ?? DEFAULT_WORLD_ID_ACTION;
  const environment = cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT) ?? DEFAULT_WORLD_ID_ENVIRONMENT;
  const signal = cleanEnv(process.env.NEXT_PUBLIC_WORLD_ID_SIGNAL);
  const signingKey = cleanEnv(process.env.WORLD_ID_SIGNING_KEY);

  return {
    action,
    endpoint,
    environment: environment === "staging" ? "staging" : "production",
    rpId,
    signal,
    signingKey,
  };
}
