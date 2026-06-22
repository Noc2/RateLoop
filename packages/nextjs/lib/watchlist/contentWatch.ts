import { and, eq } from "drizzle-orm";
import { db, dbClient } from "~~/lib/db";
import { watchedContent } from "~~/lib/db/schema";

export interface WatchedContentRecord {
  contentId: string;
  deploymentKey: string;
  chainId: number;
  contentRegistryAddress: `0x${string}`;
  createdAt: string;
}

export interface WatchlistDeploymentScope {
  deploymentKey: string;
  chainId: number;
  contentRegistryAddress: `0x${string}`;
}

const DEPLOYMENT_SCOPE_COLUMN_NAMES = ["deployment_key", "chain_id", "content_registry_address"];
let warnedLegacyFallback = false;

function getErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "";
}

function isWatchlistDeploymentScopeUnavailableError(error: unknown, depth = 0): boolean {
  if (depth > 3) return false;

  const message = getErrorMessage(error).toLowerCase();
  const code = getErrorCode(error);
  const mentionsDeploymentColumn = DEPLOYMENT_SCOPE_COLUMN_NAMES.some(column => message.includes(column));
  if ((code === "42703" || message.includes("does not exist")) && mentionsDeploymentColumn) {
    return true;
  }

  const cause =
    typeof error === "object" && error !== null && "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  return cause !== undefined ? isWatchlistDeploymentScopeUnavailableError(cause, depth + 1) : false;
}

function warnLegacyFallback(operation: "add" | "list" | "remove", error: unknown) {
  if (warnedLegacyFallback) return;
  warnedLegacyFallback = true;
  const message = `[watchlist] deployment-scoped columns are unavailable during ${operation}; using legacy unscoped watched_content fallback. Apply packages/nextjs/drizzle/0013_watchlist_notifications_deployment_scope.sql.`;
  const code = getErrorCode(error);
  if (code) {
    console.warn(message, { code });
    return;
  }
  console.warn(message);
}

export function isValidWalletAddress(address: string): address is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function normalizeWalletAddress(address: string): `0x${string}` {
  return address.toLowerCase() as `0x${string}`;
}

export function normalizeContentId(value: unknown): string | null {
  const raw =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number" || typeof value === "bigint"
        ? String(value)
        : null;

  if (!raw || !/^\d+$/.test(raw)) {
    return null;
  }

  const normalized = raw.replace(/^0+(?=\d)/, "");
  return normalized === "0" ? null : normalized;
}

export function createWatchlistTimestamp(nowMs = Date.now()): Date {
  return new Date(Math.floor(nowMs / 1000) * 1000);
}

export async function ensureWatchedContentTable() {
  // Schema is managed via Drizzle migrations.
}

export async function listWatchedContent(
  walletAddress: `0x${string}`,
  scope: WatchlistDeploymentScope,
): Promise<WatchedContentRecord[]> {
  await ensureWatchedContentTable();

  let result;
  try {
    result = await dbClient.execute({
      sql: `
        SELECT content_id, deployment_key, chain_id, content_registry_address, created_at
        FROM watched_content
        WHERE wallet_address = ? AND deployment_key = ?
        ORDER BY created_at DESC
      `,
      args: [walletAddress, scope.deploymentKey],
    });
  } catch (error) {
    if (!isWatchlistDeploymentScopeUnavailableError(error)) {
      throw error;
    }
    warnLegacyFallback("list", error);
    result = await dbClient.execute({
      sql: `
        SELECT content_id, created_at
        FROM watched_content
        WHERE wallet_address = ?
        ORDER BY created_at DESC
      `,
      args: [walletAddress],
    });
  }

  return result.rows.map(row => ({
    contentId: String(row.content_id),
    deploymentKey: row.deployment_key ? String(row.deployment_key) : scope.deploymentKey,
    chainId: row.chain_id ? Number(row.chain_id) : scope.chainId,
    contentRegistryAddress: row.content_registry_address
      ? (String(row.content_registry_address).toLowerCase() as `0x${string}`)
      : scope.contentRegistryAddress,
    createdAt: new Date(String(row.created_at)).toISOString(),
  }));
}

export async function addWatchedContent(
  walletAddress: `0x${string}`,
  contentId: string,
  scope: WatchlistDeploymentScope,
): Promise<void> {
  await ensureWatchedContentTable();
  try {
    await db
      .insert(watchedContent)
      .values({
        walletAddress,
        contentId,
        deploymentKey: scope.deploymentKey,
        chainId: scope.chainId,
        contentRegistryAddress: scope.contentRegistryAddress,
        createdAt: createWatchlistTimestamp(),
      })
      .onConflictDoNothing();
  } catch (error) {
    if (!isWatchlistDeploymentScopeUnavailableError(error)) {
      throw error;
    }
    warnLegacyFallback("add", error);
    await dbClient.execute({
      sql: `
        INSERT INTO watched_content (wallet_address, content_id, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT DO NOTHING
      `,
      args: [walletAddress, contentId, createWatchlistTimestamp()],
    });
  }
}

export async function removeWatchedContent(
  walletAddress: `0x${string}`,
  contentId: string,
  scope: WatchlistDeploymentScope,
): Promise<void> {
  await ensureWatchedContentTable();

  try {
    await db
      .delete(watchedContent)
      .where(
        and(
          eq(watchedContent.walletAddress, walletAddress),
          eq(watchedContent.contentId, contentId),
          eq(watchedContent.deploymentKey, scope.deploymentKey),
        ),
      );
  } catch (error) {
    if (!isWatchlistDeploymentScopeUnavailableError(error)) {
      throw error;
    }
    warnLegacyFallback("remove", error);
    await dbClient.execute({
      sql: "DELETE FROM watched_content WHERE wallet_address = ? AND content_id = ?",
      args: [walletAddress, contentId],
    });
  }
}
