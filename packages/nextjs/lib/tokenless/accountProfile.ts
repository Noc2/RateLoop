import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;

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
    throw new TokenlessServiceError("displayName must be text or null.", 400, "invalid_profile");
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > 80) {
    throw new TokenlessServiceError("displayName must be at most 80 characters.", 400, "invalid_profile");
  }
  return normalized;
}

function profileResult(row: Row | undefined, providerDisplayName: string | null) {
  const profileDisplayName = row ? rowString(row, "display_name") : null;
  return {
    displayName: profileDisplayName ?? providerDisplayName,
    profileDisplayName,
    providerDisplayName,
    createdAt: rowDate(row, "created_at"),
    updatedAt: rowDate(row, "updated_at"),
  };
}

export async function getAccountProfile(input: { principalAddress: string; providerDisplayName: string | null }) {
  const address = normalizeAddress(input.principalAddress);
  const result = await dbClient.execute({
    sql: `SELECT display_name, created_at, updated_at
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
  displayName: unknown;
}) {
  const address = normalizeAddress(input.principalAddress);
  const displayName = optionalDisplayName(input.displayName);
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_account_profiles (principal_address, display_name, created_at, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (principal_address) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = EXCLUDED.updated_at`,
    args: [address, displayName, now, now],
  });
  return getAccountProfile(input);
}
