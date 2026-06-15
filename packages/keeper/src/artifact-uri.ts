const DATA_URI_PREFIX = "data:";

function stripTrailingSlash(value: string): string {
  return value === "/" ? "" : value.replace(/\/+$/, "");
}

function parseHttpsArtifactAllowlist(value: string): URL[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      try {
        const url = new URL(entry);
        return url.protocol === "https:" ? [url] : [];
      } catch {
        return [];
      }
    });
}

function isAllowedHttpsArtifactUrl(value: string, allowlist: URL[]): boolean {
  let artifactUrl: URL;
  try {
    artifactUrl = new URL(value);
  } catch {
    return false;
  }
  if (artifactUrl.protocol !== "https:") return false;

  return allowlist.some((allowedUrl) => {
    if (artifactUrl.origin !== allowedUrl.origin) return false;
    const allowedPath = stripTrailingSlash(allowedUrl.pathname);
    if (allowedPath === "") return true;
    const artifactPath = stripTrailingSlash(artifactUrl.pathname);
    return artifactPath === allowedPath || artifactPath.startsWith(`${allowedPath}/`);
  });
}

export function resolveAllowedArtifactUri(uri: string, allowlistCsv: string): string | null {
  const value = uri.trim();
  if (!value) return null;
  if (value.startsWith(DATA_URI_PREFIX)) {
    return value;
  }

  const allowlist = parseHttpsArtifactAllowlist(allowlistCsv);
  if (allowlist.length === 0) {
    return null;
  }

  if (value.startsWith("https://")) {
    return isAllowedHttpsArtifactUrl(value, allowlist) ? value : null;
  }
  if (value.startsWith("ipfs://")) {
    const gatewayUri = `https://ipfs.io/ipfs/${value.slice("ipfs://".length)}`;
    return isAllowedHttpsArtifactUrl(gatewayUri, allowlist) ? gatewayUri : null;
  }
  if (value.startsWith("ar://")) {
    const gatewayUri = `https://arweave.net/${value.slice("ar://".length)}`;
    return isAllowedHttpsArtifactUrl(gatewayUri, allowlist) ? gatewayUri : null;
  }

  return null;
}
