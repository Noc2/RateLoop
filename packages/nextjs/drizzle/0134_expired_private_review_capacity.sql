CREATE TEMPORARY TABLE "_tokenless_expired_private_reviewers" AS
SELECT assignment."project_id",assignment."cohort_id",assignment."reviewer_account_address",
       COUNT(*)::integer AS "stale_count"
FROM "tokenless_private_unpaid_review_assignments" assignment
JOIN "tokenless_workspace_reviewer_access_grants" access_grant
  ON access_grant."workspace_id"=assignment."workspace_id"
 AND access_grant."grant_id"=assignment."workspace_reviewer_access_grant_id"
 AND access_grant."grant_hash"=assignment."workspace_reviewer_access_grant_hash"
WHERE assignment."status"='accepted'
  AND assignment."lease_state"='expired'
  AND access_grant."revoked_at" IS NOT NULL
  AND assignment."updated_at"=access_grant."revoked_at"
GROUP BY assignment."project_id",assignment."cohort_id",assignment."reviewer_account_address";--> statement-breakpoint
UPDATE tokenless_assurance_cohort_reviewers reviewer
SET active_reservations=GREATEST(0,reviewer.active_reservations-stale.stale_count),
    updated_at=CURRENT_TIMESTAMP
FROM "_tokenless_expired_private_reviewers" stale
WHERE reviewer.project_id=stale.project_id
  AND reviewer.cohort_id=stale.cohort_id
  AND reviewer.reviewer_account_address=stale.reviewer_account_address
  AND reviewer.active_reservations>0;--> statement-breakpoint
CREATE TEMPORARY TABLE "_tokenless_expired_private_cohorts" AS
SELECT "project_id","cohort_id",SUM("stale_count")::integer AS "stale_count"
FROM "_tokenless_expired_private_reviewers"
GROUP BY "project_id","cohort_id";--> statement-breakpoint
UPDATE tokenless_assurance_cohorts cohort
SET active_reservations=GREATEST(0,cohort.active_reservations-stale.stale_count),
    updated_at=CURRENT_TIMESTAMP
FROM "_tokenless_expired_private_cohorts" stale
WHERE cohort.project_id=stale.project_id
  AND cohort.cohort_id=stale.cohort_id
  AND cohort.active_reservations>0;--> statement-breakpoint
DROP TABLE "_tokenless_expired_private_reviewers";--> statement-breakpoint
DROP TABLE "_tokenless_expired_private_cohorts";
