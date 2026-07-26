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
  const expiredSanctionsBlocks = await dbClient.execute({
    sql: "DELETE FROM tokenless_sanctions_blocks WHERE retained_until <= ?",
    args: [now],
  });
  const expiredDac7Eligibility = await dbClient.execute({
    sql: `UPDATE tokenless_legal_eligibility
          SET dac7_status='expired',dac7_record_id=NULL,eligibility_status='expired',
              blocked_reason='dac7_record_expired',updated_at=?
          WHERE dac7_record_id IN (
            SELECT record_id FROM tokenless_dac7_records WHERE retained_until<=?
          )`,
    args: [now, now],
  });
  const expiredDac7Records = await dbClient.execute({
    sql: "DELETE FROM tokenless_dac7_records WHERE retained_until <= ?",
    args: [now],
  });
  const expiredEligibilityDeclines = await dbClient.execute({
    sql: "DELETE FROM tokenless_paid_eligibility_decisions WHERE delete_after <= ?",
    args: [now],
  });
  const expiringRiskRows = await dbClient.execute({
    sql: `SELECT risk_check_id FROM tokenless_paid_eligibility_risk_checks
          WHERE expires_at<=? ORDER BY expires_at,risk_check_id LIMIT 1000`,
    args: [now],
  });
  const expiringRiskIds = expiringRiskRows.rows.map(row => String(row.risk_check_id));
  const expiredRiskEligibility =
    expiringRiskIds.length === 0
      ? { rowCount: 0 }
      : await dbClient.execute({
          sql: `UPDATE tokenless_legal_eligibility
                SET eligibility_status=?,blocked_reason=?,updated_at=?
                WHERE risk_check_id IN (${expiringRiskIds.map(() => "?").join(",")})`,
          args: ["expired", "paid_eligibility_risk_expired", now, ...expiringRiskIds],
        });
  const deletableRiskRows = await dbClient.execute({
    sql: `SELECT risk_check_id FROM tokenless_paid_eligibility_risk_checks
          WHERE delete_after<=? ORDER BY delete_after,risk_check_id LIMIT 1000`,
    args: [now],
  });
  const deletableRiskIds = deletableRiskRows.rows.map(row => String(row.risk_check_id));
  if (deletableRiskIds.length > 0) {
    await dbClient.execute({
      sql: `UPDATE tokenless_legal_eligibility
            SET risk_check_id=NULL
            WHERE risk_check_id IN (${deletableRiskIds.map(() => "?").join(",")})`,
      args: deletableRiskIds,
    });
  }
  const expiredRiskChecks =
    deletableRiskIds.length === 0
      ? { rowCount: 0 }
      : await dbClient.execute({
          sql: `DELETE FROM tokenless_paid_eligibility_risk_checks
                WHERE risk_check_id IN (${deletableRiskIds.map(() => "?").join(",")})`,
          args: deletableRiskIds,
        });
  const [
    subjectExports,
    verifications,
    betterAuthSessions,
    productSessions,
    eligibilityHandoffs,
    notificationDeliveries,
    reviewerInvitationEmailDeliveries,
    staleLegalEligibility,
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
      sql: `DELETE FROM tokenless_workspace_reviewer_invitation_email_deliveries
            WHERE state IN ('delivered','suppressed','dead') AND updated_at <= ?`,
      args: [notificationCutoff],
    }),
    dbClient.execute({
      sql: `DELETE FROM tokenless_legal_eligibility
            WHERE scope_id IN (
              SELECT scope.scope_id FROM tokenless_paid_eligibility_scopes scope
              JOIN tokenless_sanctions_screenings screening
                ON screening.screening_id=scope.sanctions_screening_id
              WHERE scope.status='expired' AND scope.updated_at<=?
                AND screening.status<>'match'
            )`,
      args: [securityCutoff],
    }),
  ]);
  const staleScopes = await dbClient.execute({
    sql: `DELETE FROM tokenless_paid_eligibility_scopes
          WHERE status='expired' AND updated_at<=?
            AND sanctions_screening_id NOT IN (
              SELECT screening_id FROM tokenless_sanctions_screenings WHERE status='match'
            )`,
    args: [securityCutoff],
  });
  const orphanedScreenings = await dbClient.execute({
    sql: `DELETE FROM tokenless_sanctions_screenings
          WHERE screening_id NOT IN (
            SELECT sanctions_screening_id FROM tokenless_paid_eligibility_scopes
          )
            AND screening_id NOT IN (
              SELECT screening_id FROM tokenless_sanctions_blocks
            )
            AND status<>'pending' AND updated_at <= ?`,
    args: [securityCutoff],
  });
  return {
    betterAuthSessions: affected(betterAuthSessions),
    eligibilityHandoffs: affected(eligibilityHandoffs),
    notificationDeliveries: affected(notificationDeliveries),
    orphanedScreenings: affected(orphanedScreenings),
    productSessions: affected(productSessions),
    reviewerInvitationEmailDeliveries: affected(reviewerInvitationEmailDeliveries),
    staleEligibilityScopes: affected(staleScopes),
    staleLegalEligibility: affected(staleLegalEligibility),
    expiredSanctionsBlocks: affected(expiredSanctionsBlocks),
    expiredDac7Eligibility: affected(expiredDac7Eligibility),
    expiredDac7Records: affected(expiredDac7Records),
    expiredEligibilityDeclines: affected(expiredEligibilityDeclines),
    expiredRiskEligibility: affected(expiredRiskEligibility),
    expiredRiskChecks: affected(expiredRiskChecks),
    subjectExports: affected(subjectExports),
    verifications: affected(verifications),
  };
}
