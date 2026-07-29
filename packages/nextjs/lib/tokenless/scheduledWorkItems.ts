import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";

export type TokenlessScheduledWorkKind =
  | "publish_finalized_round"
  | "recover_chain_execution"
  | "recover_rater_commit"
  | "delete_artifact"
  | "delete_public_media"
  | "prepare_public_network_audience"
  | "cleanup_public_network_foundation"
  | "project_private_review_evidence";

export function tokenlessScheduledWorkItemId(kind: TokenlessScheduledWorkKind, subjectKey: string) {
  return `swi_${createHash("sha256").update(`${kind}:${subjectKey}`).digest("hex").slice(0, 40)}`;
}

export async function enqueueTokenlessScheduledWorkInTransaction(
  client: PoolClient,
  input: {
    kind: TokenlessScheduledWorkKind;
    subjectKey: string;
    now: Date;
  },
) {
  const result = await client.query(
    `INSERT INTO tokenless_scheduled_work_items
     (item_id,kind,subject_key,state,attempt_count,next_attempt_at,created_at,updated_at)
     VALUES ($1,$2,$3,'pending',0,$4,$4,$4)
     ON CONFLICT (kind,subject_key) DO NOTHING
     RETURNING item_id`,
    [tokenlessScheduledWorkItemId(input.kind, input.subjectKey), input.kind, input.subjectKey, input.now],
  );
  return { enqueued: result.rowCount === 1 };
}
