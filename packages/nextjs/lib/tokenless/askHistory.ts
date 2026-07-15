import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;

export async function listAccountAskHistory(input: { accountAddress: string }) {
  let address: string;
  try {
    address = normalizeAccountSubject(input.accountAddress);
  } catch {
    throw new TokenlessServiceError("Account address is invalid.", 400, "invalid_account");
  }
  const result = await dbClient.execute({
    sql: `SELECT o.operation_key, o.workspace_id, a.status, a.verdict_status, a.created_at, a.updated_at,
                 q.visibility, q.data_classification
          FROM tokenless_ask_ownership o
          JOIN tokenless_agent_asks a ON a.operation_key = o.operation_key
          JOIN tokenless_question_records q ON q.question_id = o.question_id
          WHERE o.owner_account_address = ?
          ORDER BY a.created_at DESC, a.operation_key DESC LIMIT 100`,
    args: [address],
  });
  return result.rows.map(row => {
    const value = row as Row;
    return {
      operationKey: String(value.operation_key),
      workspaceId: String(value.workspace_id),
      status: String(value.status),
      verdictStatus:
        value.verdict_status === null || value.verdict_status === undefined ? null : String(value.verdict_status),
      visibility: String(value.visibility),
      dataClassification: String(value.data_classification),
      createdAt: new Date(String(value.created_at)).toISOString(),
      updatedAt: new Date(String(value.updated_at)).toISOString(),
    };
  });
}
