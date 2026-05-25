export function getMissingKeeperEnvVars(env) {
  const missing = [];

  if (!env.RPC_URL?.trim()) {
    missing.push("RPC_URL");
  }
  if (!env.CHAIN_ID?.trim()) {
    missing.push("CHAIN_ID");
  }

  const hasKeystoreAccount = Boolean(env.KEYSTORE_ACCOUNT?.trim());
  const hasKeystorePassword = Boolean(env.KEYSTORE_PASSWORD?.trim());
  const hasPrivateKey = Boolean(env.KEEPER_PRIVATE_KEY?.trim());

  if (!hasKeystoreAccount && !hasPrivateKey) {
    missing.push("KEYSTORE_ACCOUNT or KEEPER_PRIVATE_KEY");
  }
  if (hasKeystoreAccount && !hasKeystorePassword && !hasPrivateKey) {
    missing.push("KEYSTORE_PASSWORD");
  }

  const correlationSnapshotsEnabled = isTruthy(env.KEEPER_CORRELATION_SNAPSHOTS_ENABLED);
  if (correlationSnapshotsEnabled) {
    const artifactPath = env.KEEPER_CORRELATION_SNAPSHOT_ARTIFACT_PATH?.trim();
    const mode = env.KEEPER_CORRELATION_SNAPSHOTS_MODE?.trim() || (artifactPath ? "file" : "auto");
    const artifactStorage =
      env.KEEPER_CORRELATION_ARTIFACT_STORAGE?.trim() || defaultCorrelationArtifactStorage(env.CHAIN_ID);

    if (mode === "file" && !artifactPath) {
      missing.push("KEEPER_CORRELATION_SNAPSHOT_ARTIFACT_PATH");
    }
    if (mode === "auto" && !env.PONDER_BASE_URL?.trim()) {
      missing.push("PONDER_BASE_URL");
    }
    if (
      mode === "auto" &&
      artifactStorage === "file" &&
      !env.KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL?.trim()
    ) {
      missing.push("KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL");
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
