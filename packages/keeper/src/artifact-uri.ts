const DATA_URI_PREFIX = "data:";
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function stripTrailingSlash(value: string): string {
  return value === "/" ? "" : value.replace(/\/+$/, "");
}

function isLoopbackHttpUrl(url: URL): boolean {
  return (
    url.protocol === "http:" &&
    (LOOPBACK_HOSTNAMES.has(url.hostname) || url.hostname.startsWith("127."))
  );
}

function parseArtifactAllowlist(value: string): URL[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      try {
        const url = new URL(entry);
        return url.protocol === "https:" || isLoopbackHttpUrl(url) ? [url] : [];
      } catch {
        return [];
      }
    });
}

function isAllowedArtifactUrl(value: string, allowlist: URL[]): boolean {
  let artifactUrl: URL;
  try {
    artifactUrl = new URL(value);
  } catch {
    return false;
  }
  if (artifactUrl.protocol !== "https:" && !isLoopbackHttpUrl(artifactUrl)) return false;

  return allowlist.some((allowedUrl) => {
    if (artifactUrl.protocol !== allowedUrl.protocol) return false;
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

  const allowlist = parseArtifactAllowlist(allowlistCsv);
  if (allowlist.length === 0) {
    return null;
  }

  if (value.startsWith("https://") || value.startsWith("http://")) {
    return isAllowedArtifactUrl(value, allowlist) ? value : null;
  }
  if (value.startsWith("ipfs://")) {
    const gatewayUri = `https://ipfs.io/ipfs/${value.slice("ipfs://".length)}`;
    return isAllowedArtifactUrl(gatewayUri, allowlist) ? gatewayUri : null;
  }
  if (value.startsWith("ar://")) {
    const gatewayUri = `https://arweave.net/${value.slice("ar://".length)}`;
    return isAllowedArtifactUrl(gatewayUri, allowlist) ? gatewayUri : null;
  }

  return null;
}
