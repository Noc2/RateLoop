import { passkey as passkeyPlugin } from "@better-auth/passkey";
import { scim } from "@better-auth/scim";
import { sso } from "@better-auth/sso";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, emailOTP } from "better-auth/plugins";
import { randomUUID } from "node:crypto";
import "server-only";
import { BETTER_AUTH_COOKIE_PREFIX } from "~~/lib/auth/betterAuthCookies";
import { enterpriseIdentityEnabled } from "~~/lib/auth/enterpriseIdentityConfig";
import {
  authenticationMethodFromContext,
  canGenerateScimToken,
  provisionEnterpriseSsoUser,
  ssoProviderLimitForUser,
} from "~~/lib/auth/enterpriseIdentityPolicy";
import { passkeySafetyPlugin } from "~~/lib/auth/passkeys";
import { getAuthOrigin } from "~~/lib/auth/session";
import { db } from "~~/lib/db";
import { account, passkey, scimProvider, session, ssoProvider, user, verification } from "~~/lib/db/schema";
import { isResendConfigured, sendTokenlessLoginOtpEmail } from "~~/lib/notifications/resend";

type SocialProviders = NonNullable<Parameters<typeof betterAuth>[0]["socialProviders"]>;
const APPLE_AUTH_ORIGIN = "https://appleid.apple.com";

export function getConfiguredSsoIssuerOrigins() {
  const raw = process.env.TOKENLESS_SSO_TRUSTED_ISSUERS?.trim();
  if (!raw) return [];
  return raw.split(",").map(value => {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("TOKENLESS_SSO_TRUSTED_ISSUERS must contain comma-separated HTTPS origins without paths.");
    }
    return url.origin;
  });
}

function requiredSecret() {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
  }
  return secret;
}

function configuredSocialProviders(): SocialProviders {
  const providers: SocialProviders = {};
  const googleClientId = process.env.BETTER_AUTH_GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET?.trim();
  if (googleClientId && googleClientSecret) {
    providers.google = { clientId: googleClientId, clientSecret: googleClientSecret };
  }
  const appleClientId = process.env.BETTER_AUTH_APPLE_CLIENT_ID?.trim();
  const appleClientSecret = process.env.BETTER_AUTH_APPLE_CLIENT_SECRET?.trim();
  if (appleClientId && appleClientSecret) {
    providers.apple = { clientId: appleClientId, clientSecret: appleClientSecret };
  }
  return providers;
}

export function getBetterAuthConfiguration() {
  const origin = getAuthOrigin();
  const url = new URL(origin);
  return {
    origin,
    rpID: process.env.BETTER_AUTH_PASSKEY_RP_ID?.trim() || url.hostname,
    emailOtpEnabled: isResendConfigured(),
    googleEnabled: Boolean(
      process.env.BETTER_AUTH_GOOGLE_CLIENT_ID?.trim() && process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET?.trim(),
    ),
    appleEnabled: Boolean(
      process.env.BETTER_AUTH_APPLE_CLIENT_ID?.trim() && process.env.BETTER_AUTH_APPLE_CLIENT_SECRET?.trim(),
    ),
  };
}

export function getBetterAuthTrustedOrigins() {
  const configuration = getBetterAuthConfiguration();
  return [
    configuration.origin,
    ...(configuration.appleEnabled ? [APPLE_AUTH_ORIGIN] : []),
    ...(enterpriseIdentityEnabled() ? getConfiguredSsoIssuerOrigins() : []),
  ];
}

function enterpriseIdentityPlugins() {
  if (!enterpriseIdentityEnabled()) return [];
  return [
    sso({
      domainVerification: { enabled: true as const, tokenPrefix: "rateloop-sso" },
      providersLimit: user => ssoProviderLimitForUser(user.id),
      provisionUser: provisionEnterpriseSsoUser,
      provisionUserOnEveryLogin: true,
      saml: {
        algorithms: { onDeprecated: "reject" as const },
        allowIdpInitiated: false,
        clockSkew: 120_000,
        enableInResponseToValidation: true,
        maxMetadataSize: 102_400,
        maxResponseSize: 262_144,
        requestTTL: 300_000,
        requireTimestamps: true,
      },
    }),
    scim({
      canGenerateToken: ({ providerId, user }) => canGenerateScimToken({ providerId, userId: user.id }),
      linkExistingUsers: false,
      providerOwnership: { enabled: true },
      storeSCIMToken: "hashed",
    }),
  ];
}

function createRateLoopAuth() {
  const configuration = getBetterAuthConfiguration();
  return betterAuth({
    appName: "RateLoop",
    basePath: "/api/auth/better",
    baseURL: configuration.origin,
    secret: requiredSecret(),
    trustedOrigins: getBetterAuthTrustedOrigins(),
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { account, passkey, scimProvider, session, ssoProvider, user, verification },
    }),
    emailAndPassword: { enabled: false },
    socialProviders: configuredSocialProviders(),
    session: {
      expiresIn: 10 * 60,
      updateAge: 0,
      additionalFields: {
        authenticationMethod: { type: "string", required: false, input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          async before(sessionRecord, context) {
            return {
              data: { ...sessionRecord, authenticationMethod: authenticationMethodFromContext(context) },
            };
          },
        },
      },
    },
    advanced: {
      cookiePrefix: BETTER_AUTH_COOKIE_PREFIX,
      database: { generateId: () => randomUUID() },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      },
    },
    plugins: [
      admin({ defaultRole: "user" }),
      emailOTP({
        allowedAttempts: 3,
        expiresIn: 5 * 60,
        otpLength: 6,
        storeOTP: "hashed",
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== "sign-in") throw new Error("This email code flow is limited to sign-in.");
          if (!configuration.emailOtpEnabled) throw new Error("Email sign-in is not configured.");
          await sendTokenlessLoginOtpEmail({ email, otp });
        },
      }),
      passkeyPlugin({
        origin: configuration.origin,
        rpID: configuration.rpID,
        rpName: "RateLoop",
      }),
      passkeySafetyPlugin(),
      ...enterpriseIdentityPlugins(),
    ],
  });
}

type RateLoopBetterAuth = ReturnType<typeof createRateLoopAuth>;
let authInstance: RateLoopBetterAuth | null = null;

export function getBetterAuth(): RateLoopBetterAuth {
  if (!authInstance) authInstance = createRateLoopAuth();
  return authInstance;
}

export function __resetBetterAuthForTests() {
  authInstance = null;
}
