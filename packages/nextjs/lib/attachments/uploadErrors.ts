import "server-only";
import { dbClient } from "~~/lib/db";

const PENDING_GATED_ATTACHMENTS_MIGRATION_PATH = "packages/nextjs/drizzle/0006_pending_gated_attachments.sql";
const PENDING_GATED_ATTACHMENTS_MIGRATION_MESSAGE =
  `Hosted private context attachment database migration is pending. Apply ${PENDING_GATED_ATTACHMENTS_MIGRATION_PATH} ` +
  "before uploading private context attachments.";
const GATED_ATTACHMENT_SCHEMA_READY_CHECK_COLUMN = "requires_gated_access";

const gatedAttachmentMigrationStatements = [
  `ALTER TABLE "question_details" ADD COLUMN IF NOT EXISTS "${GATED_ATTACHMENT_SCHEMA_READY_CHECK_COLUMN}" boolean DEFAULT false NOT NULL`,
  `ALTER TABLE "question_image_attachments" ADD COLUMN IF NOT EXISTS "${GATED_ATTACHMENT_SCHEMA_READY_CHECK_COLUMN}" boolean DEFAULT false NOT NULL`,
] as const;

type ErrorWithCause = {
  cause?: unknown;
  code?: unknown;
  message?: unknown;
};

export class PendingGatedAttachmentsMigrationError extends Error {
  readonly status = 503;

  constructor() {
    super(PENDING_GATED_ATTACHMENTS_MIGRATION_MESSAGE);
    this.name = "PendingGatedAttachmentsMigrationError";
  }
}

function isMissingGatedAttachmentSchemaError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as ErrorWithCause;
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";
  const mentionsGatedColumn = message.includes("requires_gated_access");
  const mentionsAttachmentTable =
    message.includes("question_details") || message.includes("question_image_attachments");

  if ((code === "42703" || code === "42P01") && (mentionsGatedColumn || mentionsAttachmentTable)) {
    return true;
  }
  if (message.includes("column") && message.includes("does not exist") && mentionsGatedColumn) {
    return true;
  }
  if (message.includes("relation") && message.includes("does not exist") && mentionsAttachmentTable) {
    return true;
  }

  return depth < 3 && candidate.cause !== undefined
    ? isMissingGatedAttachmentSchemaError(candidate.cause, depth + 1)
    : false;
}

export function isDatabaseQueryError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as ErrorWithCause;
  const message = typeof candidate.message === "string" ? candidate.message : "";
  if (message.startsWith("Failed query:")) return true;

  return depth < 3 && candidate.cause !== undefined ? isDatabaseQueryError(candidate.cause, depth + 1) : false;
}

async function checkGatedAttachmentSchemaReady(table: "question_details" | "question_image_attachments") {
  await dbClient.execute(`SELECT ${GATED_ATTACHMENT_SCHEMA_READY_CHECK_COLUMN} FROM ${table} LIMIT 0`);
}

async function applyPendingGatedAttachmentsMigration() {
  for (const statement of gatedAttachmentMigrationStatements) {
    await dbClient.execute(statement);
  }
}

export async function assertGatedAttachmentSchemaReady(table: "question_details" | "question_image_attachments") {
  try {
    await checkGatedAttachmentSchemaReady(table);
  } catch (error) {
    if (isMissingGatedAttachmentSchemaError(error)) {
      try {
        await applyPendingGatedAttachmentsMigration();
        await checkGatedAttachmentSchemaReady(table);
        return;
      } catch (migrationError) {
        console.error("[attachments] Failed to apply pending gated attachments migration", migrationError);
        throw new PendingGatedAttachmentsMigrationError();
      }
    }
    throw error;
  }
}
