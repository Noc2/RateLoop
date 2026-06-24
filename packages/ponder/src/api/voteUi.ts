import { readHeadToHeadVoteUiFromQuestionMetadata } from "@rateloop/agents/voteUi";

function parseStoredJson(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function extractVoteUiFromContentRecord(record: Record<string, unknown>) {
  const metadata = parseStoredJson(record.questionMetadata as string | null | undefined);
  return readHeadToHeadVoteUiFromQuestionMetadata(metadata);
}

export function attachVoteUiToContentResponse<T extends Record<string, unknown>>(item: T): T {
  const voteUi = extractVoteUiFromContentRecord(item);
  const record = item as Record<string, unknown>;
  if (voteUi) {
    record.voteUi = voteUi;
  } else {
    delete record.voteUi;
  }
  return item;
}
