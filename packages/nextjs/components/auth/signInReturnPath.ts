const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
export const DEFAULT_SIGN_IN_RETURN_PATH = "/welcome";

export function isSignInPath(value: string | null | undefined) {
  const pathname = value?.split(/[?#]/u, 1)[0].replace(/\/$/u, "");
  return pathname === "/sign-in" || /^\/[a-z]{2}\/sign-in$/u.test(pathname ?? "");
}

export function normalizeSignInReturnPath(value: string | null, applicationOrigin: string) {
  if (
    !value ||
    isSignInPath(value) ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return DEFAULT_SIGN_IN_RETURN_PATH;
  }

  try {
    const origin = new URL(applicationOrigin).origin;
    const target = new URL(value, origin);
    if (target.origin !== origin) return DEFAULT_SIGN_IN_RETURN_PATH;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return DEFAULT_SIGN_IN_RETURN_PATH;
  }
}
