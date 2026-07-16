import { createHash } from "node:crypto";
import type { AutomatedEvalLabeledDataItem } from "./automatedEval";

export type LangfuseScoreSubject = { traceId: string; observationId?: string };

export type LangfuseHumanLabelExportOptions = {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  items: AutomatedEvalLabeledDataItem[];
  resolveSubject: (
    item: AutomatedEvalLabeledDataItem,
  ) => LangfuseScoreSubject | null;
  scoreName?: string;
  fetchImpl?: typeof fetch;
  allowInsecureLocalhost?: boolean;
};

function langfuseOrigin(value: string, allowInsecureLocalhost = false) {
  const url = new URL(value);
  const local =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(
      "Langfuse baseUrl must be an origin without credentials, query, fragment, or path.",
    );
  }
  if (
    url.protocol !== "https:" &&
    !(allowInsecureLocalhost && local && url.protocol === "http:")
  ) {
    throw new Error(
      "Langfuse baseUrl must use HTTPS; HTTP is allowed only for explicit localhost testing.",
    );
  }
  return url.origin;
}

function stableUuid(...parts: string[]) {
  const bytes = Buffer.from(
    createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 32),
    "hex",
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Exports only completed human labels; automated outcomes are never exported as human scores. */
export async function exportHumanLabelsToLangfuse(
  options: LangfuseHumanLabelExportOptions,
) {
  const origin = langfuseOrigin(
    options.baseUrl,
    options.allowInsecureLocalhost,
  );
  if (!options.publicKey || !options.secretKey)
    throw new Error("Langfuse project credentials are required.");
  const scoreName = options.scoreName ?? "rateloop.human_verdict";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u.test(scoreName))
    throw new Error("Langfuse scoreName is invalid.");
  const fetchImpl = options.fetchImpl ?? fetch;
  let exported = 0;
  let skipped = 0;
  for (const item of options.items) {
    const subject = options.resolveSubject(item);
    if (!subject) {
      skipped += 1;
      continue;
    }
    if (
      !subject.traceId ||
      (subject.observationId !== undefined && !subject.observationId)
    ) {
      throw new Error("Langfuse score subject is invalid.");
    }
    const response = await fetchImpl(`${origin}/api/public/scores`, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Basic ${Buffer.from(`${options.publicKey}:${options.secretKey}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: stableUuid(
          "rateloop-human-label",
          item.receiptId,
          item.humanResultCommitment,
        ),
        traceId: subject.traceId,
        ...(subject.observationId
          ? { observationId: subject.observationId }
          : {}),
        name: scoreName,
        value: item.humanLabel,
        dataType: "CATEGORICAL",
        comment: `RateLoop human result ${item.humanResultCommitment}`,
      }),
    });
    if (!response.ok)
      throw new Error(
        `Langfuse score export failed with HTTP ${response.status}.`,
      );
    exported += 1;
  }
  return { exported, skipped };
}

export const __langfuseHumanLabelsTestUtils = { stableUuid };
