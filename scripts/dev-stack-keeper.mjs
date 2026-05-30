const DEFAULT_DEV_STACK_PONDER_BASE_URL = "http://localhost:42069";

export function applyKeeperDevStackEnvDefaults(env) {
  const resolved = { ...env };

  if (resolved.NODE_ENV !== "production" && !resolved.PONDER_BASE_URL?.trim()) {
    resolved.PONDER_BASE_URL = resolved.NEXT_PUBLIC_PONDER_URL?.trim() || DEFAULT_DEV_STACK_PONDER_BASE_URL;
  }

  return resolved;
}

export function getMissingKeeperEnvVars(env) {
  const resolvedEnv = applyKeeperDevStackEnvDefaults(env);
  const missing = [];

  if (!resolvedEnv.RPC_URL?.trim()) {
    missing.push("RPC_URL");
  }
  if (!resolvedEnv.CHAIN_ID?.trim()) {
    missing.push("CHAIN_ID");
  }
  if (!resolvedEnv.PONDER_BASE_URL?.trim()) {
    missing.push("PONDER_BASE_URL");
  }

  const hasKeystoreAccount = Boolean(resolvedEnv.KEYSTORE_ACCOUNT?.trim());
  const hasKeystorePassword = Boolean(resolvedEnv.KEYSTORE_PASSWORD?.trim());
  const hasPrivateKey = Boolean(resolvedEnv.KEEPER_PRIVATE_KEY?.trim());

  if (!hasKeystoreAccount && !hasPrivateKey) {
    missing.push("KEYSTORE_ACCOUNT or KEEPER_PRIVATE_KEY");
  }
  if (hasKeystoreAccount && !hasKeystorePassword && !hasPrivateKey) {
    missing.push("KEYSTORE_PASSWORD");
  }

  const correlationSnapshotsEnabled = isTruthy(resolvedEnv.KEEPER_CORRELATION_SNAPSHOTS_ENABLED);
  if (correlationSnapshotsEnabled) {
    const artifactPath = resolvedEnv.KEEPER_CORRELATION_SNAPSHOT_ARTIFACT_PATH?.trim();
    const mode = resolvedEnv.KEEPER_CORRELATION_SNAPSHOTS_MODE?.trim() || (artifactPath ? "file" : "auto");
    const artifactStorage =
      resolvedEnv.KEEPER_CORRELATION_ARTIFACT_STORAGE?.trim() ||
      defaultCorrelationArtifactStorage(resolvedEnv.CHAIN_ID);

    if (mode === "file" && !artifactPath) {
      missing.push("KEEPER_CORRELATION_SNAPSHOT_ARTIFACT_PATH");
    }
    if (
      mode === "auto" &&
      artifactStorage === "file" &&
      !resolvedEnv.KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL?.trim()
    ) {
      missing.push("KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL");
    }
    if (
      mode === "auto" &&
      artifactStorage === "file" &&
      resolvedEnv.KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL?.trim() &&
      !isHttpsUrl(resolvedEnv.KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL)
    ) {
      missing.push("KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL must be a valid HTTPS URL");
    }
  }

  return missing;
}

function defaultCorrelationArtifactStorage(chainId) {
  return String(chainId ?? "").trim() === "31337" ? "data-uri" : "file";
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
