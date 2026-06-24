import { readHeadToHeadVoteUiFromQuestionMetadata } from "@rateloop/agents/voteUi";

function parseStoredJson(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function readQuestionMetadata(record: Record<string, unknown>) {
  const raw = record.questionMetadata;
  if (typeof raw === "string") {
    return parseStoredJson(raw);
  }
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw;
  }
  return null;
}

export function extractVoteUiFromContentRecord(record: Record<string, unknown>) {
  return readHeadToHeadVoteUiFromQuestionMetadata(readQuestionMetadata(record));
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
