import { passkey as passkeyPlugin } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";
import { randomUUID } from "node:crypto";
import "server-only";
import { getAuthOrigin } from "~~/lib/auth/session";
import { db } from "~~/lib/db";
import { account, passkey, session, user, verification } from "~~/lib/db/schema";
import { isResendConfigured, sendTokenlessLoginOtpEmail } from "~~/lib/notifications/resend";

type SocialProviders = NonNullable<Parameters<typeof betterAuth>[0]["socialProviders"]>;
const APPLE_AUTH_ORIGIN = "https://appleid.apple.com";

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
  return configuration.appleEnabled ? [configuration.origin, APPLE_AUTH_ORIGIN] : [configuration.origin];
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
      schema: { account, passkey, session, user, verification },
    }),
    emailAndPassword: { enabled: false },
    socialProviders: configuredSocialProviders(),
    session: {
      expiresIn: 10 * 60,
      updateAge: 0,
    },
    advanced: {
      cookiePrefix: "rateloop-identity",
      database: { generateId: () => randomUUID() },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      },
    },
    plugins: [
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
