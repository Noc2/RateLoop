import { resolveVoteUiConfig } from "@rateloop/agents/voteUi";

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

function readContentText(record: Record<string, unknown>) {
  return [record.question, record.title, record.description]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");
}

export function extractVoteUiFromContentRecord(record: Record<string, unknown>) {
  const config = resolveVoteUiConfig({
    resultSpecHash: typeof record.resultSpecHash === "string" ? record.resultSpecHash : null,
    questionMetadata: readQuestionMetadata(record),
    text: readContentText(record),
  });
  return config.mode === "head_to_head" ? config : null;
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
