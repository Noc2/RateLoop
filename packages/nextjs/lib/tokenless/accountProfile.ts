import "server-only";
import { type Locale, SUPPORTED_LOCALES, isLocale } from "~~/i18n/config";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { THEMES, type Theme, parseThemePreference } from "~~/lib/ui/themePreference";

type Row = Record<string, unknown>;

export type PreferredLocale = Locale;
export type PreferredTheme = Theme;

export type AccountProfileUpdate = {
  displayName?: string | null;
  preferredLocale?: PreferredLocale | null;
  preferredTheme?: PreferredTheme | null;
};

const PROFILE_UPDATE_FIELDS = ["displayName", "preferredLocale", "preferredTheme"] as const;

function normalizeAddress(value: string) {
  try {
    return normalizeAccountSubject(value);
  } catch {
    throw new TokenlessServiceError("Account address is invalid.", 400, "invalid_account");
  }
}

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowDate(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : new Date(String(value)).toISOString();
}

function optionalDisplayName(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new TokenlessServiceError(
      "Display name must be text or empty.",
      400,
      "invalid_profile",
      false,
      "displayName",
    );
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > 80) {
    throw new TokenlessServiceError(
      "Display name must be at most 80 characters.",
      400,
      "invalid_profile",
      false,
      "displayName",
    );
  }
  return normalized;
}

function optionalLocale(value: unknown): PreferredLocale | null {
  if (value === null) return null;
  if (typeof value !== "string" || !isLocale(value)) {
    throw new TokenlessServiceError(
      `Locale must be ${SUPPORTED_LOCALES.join(" or ")}, or empty.`,
      400,
      "invalid_profile",
      false,
      "preferredLocale",
    );
  }
  return value;
}

function optionalTheme(value: unknown): PreferredTheme | null {
  if (value === null) return null;
  const theme = typeof value === "string" ? parseThemePreference(value) : undefined;
  if (!theme) {
    throw new TokenlessServiceError(
      `Theme must be ${THEMES.join(" or ")}, or empty.`,
      400,
      "invalid_profile",
      false,
      "preferredTheme",
    );
  }
  return theme;
}

export function normalizeAccountProfileUpdate(value: unknown): AccountProfileUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError("Profile update must be an object.", 400, "invalid_profile");
  }
  const source = value as Row;
  const unknownFields = Object.keys(source).filter(key => !(PROFILE_UPDATE_FIELDS as readonly string[]).includes(key));
  if (unknownFields.length > 0) {
    throw new TokenlessServiceError(
      "Profile update contains unsupported fields.",
      400,
      "invalid_profile",
      false,
      unknownFields.sort()[0],
    );
  }

  const update: AccountProfileUpdate = {};
  if (Object.hasOwn(source, "displayName")) update.displayName = optionalDisplayName(source.displayName);
  if (Object.hasOwn(source, "preferredLocale")) {
    update.preferredLocale = optionalLocale(source.preferredLocale);
  }
  if (Object.hasOwn(source, "preferredTheme")) {
    update.preferredTheme = optionalTheme(source.preferredTheme);
  }
  return update;
}

function profileResult(row: Row | undefined, providerDisplayName: string | null) {
  const profileDisplayName = row ? rowString(row, "display_name") : null;
  return {
    displayName: profileDisplayName ?? providerDisplayName,
    profileDisplayName,
    providerDisplayName,
    preferredLocale: rowString(row, "preferred_locale") as PreferredLocale | null,
    preferredTheme: rowString(row, "preferred_theme") as PreferredTheme | null,
    createdAt: rowDate(row, "created_at"),
    updatedAt: rowDate(row, "updated_at"),
  };
}

export async function getAccountProfile(input: { principalAddress: string; providerDisplayName: string | null }) {
  const address = normalizeAddress(input.principalAddress);
  const result = await dbClient.execute({
    sql: `SELECT display_name, preferred_locale, preferred_theme, created_at, updated_at
          FROM tokenless_account_profiles
          WHERE principal_address = ? LIMIT 1`,
    args: [address],
  });
  return {
    principalAddress: address,
    ...profileResult(result.rows[0] as Row | undefined, input.providerDisplayName),
  };
}

export async function updateAccountProfile(input: {
  principalAddress: string;
  providerDisplayName: string | null;
  displayName?: unknown;
  preferredLocale?: unknown;
  preferredTheme?: unknown;
}): Promise<Awaited<ReturnType<typeof getAccountProfile>>> {
  const address = normalizeAddress(input.principalAddress);
  const rawUpdate: Row = {};
  for (const field of PROFILE_UPDATE_FIELDS) {
    if (Object.hasOwn(input, field)) rawUpdate[field] = input[field];
  }
  const update = normalizeAccountProfileUpdate(rawUpdate);
  const updateFields = PROFILE_UPDATE_FIELDS.filter(field => Object.hasOwn(update, field));
  if (updateFields.length === 0) return getAccountProfile(input);

  const now = new Date();
  const columnByField = {
    displayName: "display_name",
    preferredLocale: "preferred_locale",
    preferredTheme: "preferred_theme",
  } as const;
  const insertColumns = [
    "principal_address",
    ...updateFields.map(field => columnByField[field]),
    "created_at",
    "updated_at",
  ];
  const updateAssignments = updateFields
    .map(field => `${columnByField[field]} = EXCLUDED.${columnByField[field]}`)
    .join(", ");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_account_profiles (${insertColumns.join(", ")})
          VALUES (${insertColumns.map(() => "?").join(", ")})
          ON CONFLICT (principal_address) DO UPDATE SET ${updateAssignments}, updated_at = EXCLUDED.updated_at`,
    args: [address, ...updateFields.map(field => update[field]), now, now],
  });
  return getAccountProfile(input);
}
