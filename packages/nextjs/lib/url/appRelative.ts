function normalizeAppPath(value: string) {
  const trimmed = value.trim();
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed) || trimmed.startsWith("//")) {
    throw new Error("App-relative URLs must not include an absolute URL.");
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/u, "");
}

export function buildAppRelativeUrl(baseUrl: string, appPath: string): URL {
  const base = new URL(baseUrl);
  const child = new URL(normalizeAppPath(appPath), "https://rateloop.local");
  const basePath = trimTrailingSlashes(base.pathname);
  const childPath = child.pathname.replace(/^\/+/u, "");

  base.pathname = [basePath === "/" ? "" : basePath, childPath].filter(Boolean).join("/") || "/";
  base.search = child.search;
  base.hash = child.hash;
  return base;
}

export function resolveRequestAppBaseUrl(requestUrl: string, routePath: string): string {
  const url = new URL(requestUrl);
  const routeSuffix = trimTrailingSlashes(normalizeAppPath(routePath));
  const pathname = trimTrailingSlashes(url.pathname) || "/";

  if (routeSuffix && pathname.endsWith(routeSuffix)) {
    url.pathname = trimTrailingSlashes(pathname.slice(0, -routeSuffix.length)) || "/";
  }

  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

export function resolveApiRequestAppBaseUrl(requestUrl: string): string {
  const url = new URL(requestUrl);
  const apiIndex = url.pathname.indexOf("/api/");
  url.pathname = apiIndex >= 0 ? url.pathname.slice(0, apiIndex) || "/" : "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}
