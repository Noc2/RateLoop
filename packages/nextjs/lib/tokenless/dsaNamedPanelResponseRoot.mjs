import { createHash } from "node:crypto";

const DOMAIN = "rateloop.dsa-named-panel-response-root.v1\0";

/**
 * @param {ReadonlyArray<ReadonlyArray<string>>} rows
 * @returns {`sha256:${string}`}
 */
export function dsaNamedPanelResponseEvidenceRoot(rows) {
  const lines = rows.map(row => {
    if (row.length !== 6 || row.some(value => typeof value !== "string" || value.length === 0)) {
      throw new Error("Named-panel response-root rows must contain six non-empty strings.");
    }
    return row.join("|");
  });
  const rootInput = `${DOMAIN}${lines.length ? `${lines.join("\n")}\n` : ""}`;
  return `sha256:${createHash("sha256").update(rootInput, "utf8").digest("hex")}`;
}
