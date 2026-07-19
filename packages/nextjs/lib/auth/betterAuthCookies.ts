export const BETTER_AUTH_COOKIE_PREFIX = "rateloop-identity";

export const BETTER_AUTH_SESSION_COOKIE_NAMES = [
  `${BETTER_AUTH_COOKIE_PREFIX}.session_token`,
  `__Secure-${BETTER_AUTH_COOKIE_PREFIX}.session_token`,
] as const;
