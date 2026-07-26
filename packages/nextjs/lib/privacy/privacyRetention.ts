import "server-only";
import { dbClient } from "~~/lib/db";

const SECURITY_TELEMETRY_RETENTION_MS = 35 * 86_400_000;
const NOTIFICATION_DELIVERY_RETENTION_MS = 90 * 86_400_000;
const ELIGIBILITY_HANDOFF_RETENTION_MS = 7 * 86_400_000;

function affected(result: { rowCount: number | null }) {
  return result.rowCount ?? 0;
}

/**
 * Purges bounded operational personal data. Settlement, billing, legal-hold,
 * deletion-receipt, and public-chain records are deliberately outside this
 * routine and follow their separately documented legal schedules.
 */
export async function purgeExpiredPrivacyOperations(now = new Date()) {
  const securityCutoff = new Date(now.getTime() - SECURITY_TELEMETRY_RETENTION_MS);
  const notificationCutoff = new Date(now.getTime() - NOTIFICATION_DELIVERY_RETENTION_MS);
  const handoffCutoff = new Date(now.getTime() - ELIGIBILITY_HANDOFF_RETENTION_MS);
  const [
    subjectExports,
    verifications,
    betterAuthSessions,
    productSessions,
    eligibilityHandoffs,
    notificationDeliveries,
    staleScopes,
  ] = await Promise.all([
    dbClient.execute({ sql: "DELETE FROM tokenless_subject_request_exports WHERE delete_after <= ?", args: [now] }),
    dbClient.execute({
      sql: "DELETE FROM tokenless_better_auth_verifications WHERE expires_at <= ?",
      args: [now],
    }),
    dbClient.execute({
      sql: "DELETE FROM tokenless_better_auth_sessions WHERE expires_at <= ?",
      args: [securityCutoff],
    }),
    dbClient.execute({
      sql: `DELETE FROM tokenless_auth_sessions
            WHERE expires_at <= ? OR (revoked_at IS NOT NULL AND revoked_at <= ?)`,
      args: [securityCutoff, securityCutoff],
    }),
    dbClient.execute({
      sql: `DELETE FROM tokenless_eligibility_provider_handoffs
            WHERE expires_at <= ? AND created_at <= ?`,
      args: [now, handoffCutoff],
    }),
    dbClient.execute({
      sql: `DELETE FROM tokenless_notification_email_deliveries
            WHERE state IN ('delivered','suppressed','dead') AND updated_at <= ?`,
      args: [notificationCutoff],
    }),
    dbClient.execute({
      sql: `DELETE FROM tokenless_paid_eligibility_scopes
            WHERE status IN ('review','blocked','expired') AND updated_at <= ?`,
      args: [securityCutoff],
    }),
  ]);
  const orphanedScreenings = await dbClient.execute({
    sql: `DELETE FROM tokenless_sanctions_screenings
          WHERE screening_id NOT IN (
            SELECT sanctions_screening_id FROM tokenless_paid_eligibility_scopes
          ) AND updated_at <= ?`,
    args: [securityCutoff],
  });
  return {
    betterAuthSessions: affected(betterAuthSessions),
    eligibilityHandoffs: affected(eligibilityHandoffs),
    notificationDeliveries: affected(notificationDeliveries),
    orphanedScreenings: affected(orphanedScreenings),
    productSessions: affected(productSessions),
    staleEligibilityScopes: affected(staleScopes),
    subjectExports: affected(subjectExports),
    verifications: affected(verifications),
  };
}
