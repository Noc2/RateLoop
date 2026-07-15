import "server-only";
import { dbClient, dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

export async function moderateTokenlessOperation(input: {
  operationKey: string;
  decision: "approved" | "rejected" | "delisted";
  reasonCode: string;
  now?: Date;
}) {
  if (!/^[A-Za-z0-9._:-]{3,120}$/.test(input.reasonCode)) {
    throw new TokenlessServiceError("Moderation reason code is invalid.", 400, "invalid_moderation_reason");
  }
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      "SELECT operation_key FROM tokenless_ask_ownership WHERE operation_key = $1 FOR UPDATE",
      [input.operationKey],
    );
    if (locked.rowCount !== 1) throw new TokenlessServiceError("Ask not found.", 404, "ask_not_found");
    const result = await client.query(
      `SELECT o.question_id, o.payment_mode, o.payment_reference, q.content_id,
              e.state AS execution_state, e.chain_id, e.panel_address, e.round_id
       FROM tokenless_ask_ownership o
       JOIN tokenless_question_records q ON q.question_id = o.question_id
       LEFT JOIN tokenless_chain_executions e ON e.operation_key = o.operation_key
       WHERE o.operation_key = $1`,
      [input.operationKey],
    );
    const row = result.rows[0] as Row | undefined;
    if (!row) throw new TokenlessServiceError("Ask not found.", 404, "ask_not_found");
    const questionId = rowString(row, "question_id")!;
    const contentId = rowString(row, "content_id")!;
    if (input.decision === "approved") {
      const unavailableMedia = await client.query(
        `SELECT asset_id FROM tokenless_public_question_media
         WHERE question_id = $1 AND technical_status <> 'ready'
         LIMIT 1`,
        [questionId],
      );
      if (unavailableMedia.rowCount) {
        throw new TokenlessServiceError(
          "Question media is unavailable and cannot be approved.",
          409,
          "public_media_unavailable",
        );
      }
    }
    await client.query(
      `UPDATE tokenless_content_records
       SET moderation_status = $1, moderation_reason = $2, moderated_at = $3, updated_at = $3
       WHERE content_id = $4`,
      [input.decision, input.reasonCode, now, contentId],
    );
    await client.query(
      "UPDATE tokenless_question_records SET moderation_status = $1, updated_at = $2 WHERE question_id = $3",
      [input.decision, now, questionId],
    );
    await client.query(
      `UPDATE tokenless_public_question_media
       SET moderation_status = $1, moderation_reason = $2, moderated_at = $3, updated_at = $3
       WHERE question_id = $4 AND technical_status = 'ready'`,
      [input.decision, input.reasonCode, now, questionId],
    );

    const acceptedOnChain = rowString(row, "execution_state") === "confirmed" && rowString(row, "round_id");
    if (input.decision !== "approved" && acceptedOnChain) {
      await client.query(
        `UPDATE tokenless_voucher_rounds SET status = 'takedown', updated_at = $1
         WHERE chain_id = $2 AND panel_address = $3 AND round_id = $4`,
        [now, Number(row.chain_id), rowString(row, "panel_address"), rowString(row, "round_id")],
      );
      await client.query("COMMIT");
      return { decision: input.decision, terminal: false, acceptedWorkPreserved: true };
    }

    if (input.decision !== "approved") {
      if (rowString(row, "payment_mode") === "prepaid") {
        await client.query(
          `UPDATE tokenless_prepaid_reservations SET status = 'released', updated_at = $1
           WHERE reservation_id = $2 AND status = 'reserved'`,
          [now, rowString(row, "payment_reference")],
        );
      } else {
        await client.query(
          `UPDATE tokenless_payment_intents SET state = 'failed', updated_at = $1
           WHERE payment_intent_id = $2 AND state NOT IN ('confirmed', 'settled')`,
          [now, rowString(row, "payment_reference")],
        );
      }
      await client.query(
        "UPDATE tokenless_ask_ownership SET payment_state = 'released', updated_at = $1 WHERE operation_key = $2",
        [now, input.operationKey],
      );
      await client.query(
        "UPDATE tokenless_agent_asks SET status = 'rejected', updated_at = $1 WHERE operation_key = $2",
        [now, input.operationKey],
      );
    }
    await client.query("COMMIT");
    return {
      decision: input.decision,
      terminal: input.decision !== "approved",
      acceptedWorkPreserved: false,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getTokenlessModerationState(operationKey: string) {
  const result = await dbClient.execute({
    sql: `SELECT c.moderation_status, c.moderation_reason, c.moderated_at
          FROM tokenless_ask_ownership o
          JOIN tokenless_question_records q ON q.question_id = o.question_id
          JOIN tokenless_content_records c ON c.content_id = q.content_id
          WHERE o.operation_key = ? LIMIT 1`,
    args: [operationKey],
  });
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new TokenlessServiceError("Ask not found.", 404, "ask_not_found");
  return {
    status: rowString(row, "moderation_status"),
    reasonCode: rowString(row, "moderation_reason"),
    moderatedAt: row.moderated_at ? new Date(String(row.moderated_at)).toISOString() : null,
  };
}

export async function moderateTokenlessPublicRaterResponse(input: {
  responseId: string;
  decision: "approved" | "rejected";
  reasonCode: string;
  now?: Date;
}) {
  if (!/^rrs_[a-f0-9]{32}$/.test(input.responseId)) {
    throw new TokenlessServiceError("Response id is invalid.", 400, "invalid_public_response_id");
  }
  if (!/^[A-Za-z0-9._:-]{3,120}$/.test(input.reasonCode)) {
    throw new TokenlessServiceError("Moderation reason code is invalid.", 400, "invalid_moderation_reason");
  }
  const result = await dbPool.query(
    `UPDATE tokenless_public_rater_responses
     SET moderation_status = $1, moderation_reason = $2, updated_at = $3
     WHERE response_id = $4 AND moderation_status = 'pending'
     RETURNING response_id, operation_key, moderation_status`,
    [input.decision, input.reasonCode, input.now ?? new Date(), input.responseId],
  );
  if (result.rowCount !== 1) {
    throw new TokenlessServiceError("Pending public response not found.", 404, "public_response_not_found");
  }
  return {
    responseId: rowString(result.rows[0] as Row, "response_id")!,
    operationKey: rowString(result.rows[0] as Row, "operation_key")!,
    decision: rowString(result.rows[0] as Row, "moderation_status") as "approved" | "rejected",
  };
}
