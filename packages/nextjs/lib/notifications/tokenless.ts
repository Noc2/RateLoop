import { createHash, randomBytes, randomUUID } from "node:crypto";
import "server-only";
import { getAddress } from "viem";
import { dbClient } from "~~/lib/db";

export const TOKENLESS_NOTIFICATION_KEYS = [
  "assignmentAvailable",
  "assignmentCompleted",
  "paymentUpdates",
  "askResults",
  "accountSecurity",
] as const;

export type TokenlessNotificationKey = (typeof TOKENLESS_NOTIFICATION_KEYS)[number];

export type TokenlessNotificationPreferences = Record<TokenlessNotificationKey, boolean>;

export type TokenlessEmailNotificationSettings = TokenlessNotificationPreferences & {
  email: string;
  verified: boolean;
  deliveryConfigured: boolean;
};

export const DEFAULT_TOKENLESS_NOTIFICATION_PREFERENCES: TokenlessNotificationPreferences = {
  assignmentAvailable: true,
  assignmentCompleted: true,
  paymentUpdates: true,
  askResults: true,
  accountSecurity: true,
};

export const DEFAULT_TOKENLESS_EMAIL_SETTINGS: TokenlessEmailNotificationSettings = {
  ...DEFAULT_TOKENLESS_NOTIFICATION_PREFERENCES,
  email: "",
  verified: false,
  deliveryConfigured: false,
};

type Row = Record<string, unknown>;

function principalAddress(value: string) {
  try {
    return getAddress(value).toLowerCase();
  } catch {
    throw new Error("Account address is invalid.");
  }
}

function readBoolean(row: Row | undefined, key: string, fallback: boolean) {
  return typeof row?.[key] === "boolean" ? Boolean(row[key]) : fallback;
}

function preferencesFromRow(row: Row | undefined): TokenlessNotificationPreferences {
  return {
    assignmentAvailable: readBoolean(row, "assignment_available", true),
    assignmentCompleted: readBoolean(row, "assignment_completed", true),
    paymentUpdates: readBoolean(row, "payment_updates", true),
    askResults: readBoolean(row, "ask_results", true),
    accountSecurity: readBoolean(row, "account_security", true),
  };
}

export function normalizeNotificationPreferences(input: unknown): TokenlessNotificationPreferences {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Notification preferences must be an object.");
  }

  const source = input as Record<string, unknown>;
  return Object.fromEntries(
    TOKENLESS_NOTIFICATION_KEYS.map(key => {
      if (typeof source[key] !== "boolean") throw new Error(`${key} must be a boolean.`);
      return [key, source[key]];
    }),
  ) as TokenlessNotificationPreferences;
}

export function normalizeNotificationEmail(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") throw new Error("Email must be text.");
  const email = value.trim().toLowerCase();
  if (!email) return "";
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  return email;
}

export async function getTokenlessNotificationPreferences(address: string) {
  const principal = principalAddress(address);
  const result = await dbClient.execute({
    sql: `SELECT assignment_available, assignment_completed, payment_updates, ask_results, account_security
          FROM tokenless_notification_preferences
          WHERE principal_address = ? LIMIT 1`,
    args: [principal],
  });
  return preferencesFromRow(result.rows[0] as Row | undefined);
}

export async function upsertTokenlessNotificationPreferences(
  address: string,
  preferences: TokenlessNotificationPreferences,
) {
  const principal = principalAddress(address);
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_notification_preferences
          (principal_address, assignment_available, assignment_completed, payment_updates, ask_results, account_security, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (principal_address) DO UPDATE SET
            assignment_available = EXCLUDED.assignment_available,
            assignment_completed = EXCLUDED.assignment_completed,
            payment_updates = EXCLUDED.payment_updates,
            ask_results = EXCLUDED.ask_results,
            account_security = EXCLUDED.account_security,
            updated_at = EXCLUDED.updated_at`,
    args: [
      principal,
      preferences.assignmentAvailable,
      preferences.assignmentCompleted,
      preferences.paymentUpdates,
      preferences.askResults,
      preferences.accountSecurity,
      now,
      now,
    ],
  });
  return preferences;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function emailSettingsFromRow(row: Row | undefined, deliveryConfigured: boolean): TokenlessEmailNotificationSettings {
  if (!row) return { ...DEFAULT_TOKENLESS_EMAIL_SETTINGS, deliveryConfigured };
  return {
    ...preferencesFromRow(row),
    email: String(row.email ?? ""),
    verified: Boolean(row.verified_at),
    deliveryConfigured,
  };
}

export async function getTokenlessEmailNotificationSettings(address: string, deliveryConfigured: boolean) {
  const principal = principalAddress(address);
  const result = await dbClient.execute({
    sql: `SELECT email, verified_at, assignment_available, assignment_completed, payment_updates, ask_results, account_security
          FROM tokenless_notification_email_subscriptions
          WHERE principal_address = ? LIMIT 1`,
    args: [principal],
  });
  return emailSettingsFromRow(result.rows[0] as Row | undefined, deliveryConfigured);
}

export async function getTokenlessEmailNotificationSubscription(address: string) {
  const principal = principalAddress(address);
  const result = await dbClient.execute({
    sql: `SELECT principal_address, email, verified_at, verification_token_hash, verification_expires_at,
                 unsubscribe_token_hash, assignment_available, assignment_completed, payment_updates, ask_results,
                 account_security, created_at, updated_at
          FROM tokenless_notification_email_subscriptions
          WHERE principal_address = ? LIMIT 1`,
    args: [principal],
  });
  return (result.rows[0] as Row | undefined) ?? null;
}

export async function upsertTokenlessEmailNotificationSettings(
  address: string,
  email: string,
  preferences: TokenlessNotificationPreferences,
) {
  const principal = principalAddress(address);
  if (!email) {
    await dbClient.execute({
      sql: "DELETE FROM tokenless_notification_email_subscriptions WHERE principal_address = ?",
      args: [principal],
    });
    return { settings: { ...DEFAULT_TOKENLESS_EMAIL_SETTINGS }, verificationToken: null };
  }

  const existing = await getTokenlessEmailNotificationSubscription(principal);
  const owner = await dbClient.execute({
    sql: `SELECT principal_address FROM tokenless_notification_email_subscriptions
          WHERE email = ? AND principal_address <> ? LIMIT 1`,
    args: [email, principal],
  });
  if (owner.rows.length > 0) throw new Error("EMAIL_IN_USE");

  const now = new Date();
  const emailChanged = !existing || String(existing.email) !== email;
  const requiresVerification = emailChanged || !existing?.verified_at;
  const verificationToken = requiresVerification ? randomBytes(32).toString("base64url") : null;
  const unsubscribeToken = existing?.unsubscribe_token_hash ? null : randomBytes(32).toString("base64url");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_notification_email_subscriptions
          (principal_address, email, verified_at, verification_token_hash, verification_expires_at, unsubscribe_token_hash,
           assignment_available, assignment_completed, payment_updates, ask_results, account_security, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (principal_address) DO UPDATE SET
            email = EXCLUDED.email,
            verified_at = EXCLUDED.verified_at,
            verification_token_hash = EXCLUDED.verification_token_hash,
            verification_expires_at = EXCLUDED.verification_expires_at,
            unsubscribe_token_hash = EXCLUDED.unsubscribe_token_hash,
            assignment_available = EXCLUDED.assignment_available,
            assignment_completed = EXCLUDED.assignment_completed,
            payment_updates = EXCLUDED.payment_updates,
            ask_results = EXCLUDED.ask_results,
            account_security = EXCLUDED.account_security,
            updated_at = EXCLUDED.updated_at`,
    args: [
      principal,
      email,
      emailChanged ? null : (existing?.verified_at ?? null),
      verificationToken ? hashToken(verificationToken) : null,
      verificationToken ? new Date(now.getTime() + 24 * 60 * 60 * 1_000) : null,
      existing?.unsubscribe_token_hash ?? (unsubscribeToken ? hashToken(unsubscribeToken) : null),
      preferences.assignmentAvailable,
      preferences.assignmentCompleted,
      preferences.paymentUpdates,
      preferences.askResults,
      preferences.accountSecurity,
      existing?.created_at ?? now,
      now,
    ],
  });

  return {
    settings: {
      ...preferences,
      email,
      verified: !requiresVerification,
      deliveryConfigured: true,
    },
    verificationToken,
  };
}

export async function verifyTokenlessEmailNotificationToken(token: string) {
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_notification_email_subscriptions
          SET verified_at = ?, verification_token_hash = NULL, verification_expires_at = NULL, updated_at = ?
          WHERE verification_token_hash = ? AND verification_expires_at > ?
          RETURNING principal_address, email`,
    args: [new Date(), new Date(), hashToken(token), new Date()],
  });
  return result.rows[0] ? { ok: true as const, email: String((result.rows[0] as Row).email) } : { ok: false as const };
}

export async function unsubscribeTokenlessEmailNotificationToken(token: string) {
  const result = await dbClient.execute({
    sql: `DELETE FROM tokenless_notification_email_subscriptions
          WHERE unsubscribe_token_hash = ? RETURNING principal_address`,
    args: [hashToken(token)],
  });
  return { ok: result.rows.length > 0 };
}

export function newTokenlessNotificationId() {
  return `tn_${randomUUID()}`;
}
