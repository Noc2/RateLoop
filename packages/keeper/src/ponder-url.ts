export function buildPonderUrl(baseUrl: string, path: string): URL {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.replace(/^\/+/u, "");
  return new URL(normalizedPath, normalizedBase);
}
