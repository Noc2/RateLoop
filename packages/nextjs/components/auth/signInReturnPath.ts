const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export function normalizeSignInReturnPath(value: string | null, applicationOrigin: string) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return "/agents";
  }

  try {
    const origin = new URL(applicationOrigin).origin;
    const target = new URL(value, origin);
    if (target.origin !== origin) return "/agents";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/agents";
  }
}
