export function buildE2EServiceUrl(baseUrl, path) {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.replace(/^\/+/u, "");
  return new URL(normalizedPath, normalizedBase).toString();
}
