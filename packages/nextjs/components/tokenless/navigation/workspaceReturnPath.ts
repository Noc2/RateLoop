import { normalizeSignInReturnPath } from "~~/components/auth/signInReturnPath";

export const WORKSPACE_RETURN_SOURCE = "workspace";
export const WORKSPACE_RETURN_PARAM = "returnTo";

const LOCAL_ORIGIN = "https://rateloop.local";
const PUBLIC_CONTENT_PREFIXES = ["/docs", "/legal", "/pricing"] as const;

function relativeUrl(value: string, origin = LOCAL_ORIGIN) {
  const target = new URL(value, origin);
  return `${target.pathname}${target.search}${target.hash}`;
}

export function isPublicContentPath(pathname: string) {
  return PUBLIC_CONTENT_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function normalizeWorkspaceReturnPath(value: string | null, applicationOrigin = LOCAL_ORIGIN) {
  const normalized = normalizeSignInReturnPath(value, applicationOrigin);
  const target = new URL(normalized, applicationOrigin);
  if (target.pathname !== "/agents" && !target.pathname.startsWith("/agents/")) return null;
  return `${target.pathname}${target.search}${target.hash}`;
}

export function workspaceReturnPathForLocation(pathname: string, search: string | URLSearchParams | null) {
  const params =
    search instanceof URLSearchParams
      ? new URLSearchParams(search)
      : new URLSearchParams(search?.startsWith("?") ? search.slice(1) : (search ?? ""));
  if (pathname === "/agents" || pathname.startsWith("/agents/")) {
    return normalizeWorkspaceReturnPath(`${pathname}${params.size ? `?${params}` : ""}`);
  }
  if (!isPublicContentPath(pathname) || params.get("from") !== WORKSPACE_RETURN_SOURCE) return null;
  return normalizeWorkspaceReturnPath(params.get(WORKSPACE_RETURN_PARAM));
}

export function workspacePublicContentHref(destination: string, returnPath: string) {
  if (
    !destination.startsWith("/") ||
    destination.startsWith("//") ||
    destination.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(destination)
  ) {
    throw new Error("Public content destination must be a safe same-origin path.");
  }
  const target = new URL(destination, LOCAL_ORIGIN);
  if (target.origin !== LOCAL_ORIGIN || !isPublicContentPath(target.pathname)) {
    throw new Error("Public content destination is not allowed.");
  }
  const normalizedReturnPath = normalizeWorkspaceReturnPath(returnPath);
  if (!normalizedReturnPath) throw new Error("Workspace return path is not allowed.");
  target.searchParams.set("from", WORKSPACE_RETURN_SOURCE);
  target.searchParams.set(WORKSPACE_RETURN_PARAM, normalizedReturnPath);
  return relativeUrl(target.href);
}
