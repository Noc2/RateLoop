import { createHash } from "node:crypto";

export const AUDIT_EXPORT_FORMAT = "rateloop-audit-v1";
export const AUDIT_GENESIS_DIGEST = `sha256:${"0".repeat(64)}`;

export function canonicalizeAuditValue(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalizeAuditValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizeAuditValue(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Audit data must be JSON serializable.");
  return encoded;
}

export function auditEventDigest(previousDigest, payload) {
  return `sha256:${createHash("sha256")
    .update(`${previousDigest}\n${canonicalizeAuditValue(payload)}`)
    .digest("hex")}`;
}

function field(event, camel, snake) {
  return event[camel] ?? event[snake];
}

function integer(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("Audit sequence is invalid.");
  return parsed;
}

function metadata(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") throw new Error("Audit metadata is invalid.");
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Audit metadata is invalid.");
  return parsed;
}

function isoDate(value) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error("Audit timestamp is invalid.");
  return date.toISOString();
}

export function verifyAuditExport(value, options = {}) {
  try {
    if (!value || typeof value !== "object" || value.format !== AUDIT_EXPORT_FORMAT) {
      return { valid: false, errors: ["invalid_export_shape"] };
    }
    if (!Array.isArray(value.events) || !value.integrity || typeof value.integrity !== "object") {
      return { valid: false, errors: ["invalid_export_shape"] };
    }
    const workspaceId = String(value.workspaceId ?? "");
    if (!workspaceId) return { valid: false, errors: ["workspace_missing"] };
    let previousDigest = AUDIT_GENESIS_DIGEST;
    let expectedSequence = 1;
    for (const event of value.events) {
      if (!event || typeof event !== "object") throw new Error("Audit event is invalid.");
      const sequence = integer(field(event, "sequence", "sequence"));
      if (sequence !== expectedSequence) return { valid: false, errors: ["sequence_mismatch"] };
      if (String(field(event, "workspaceId", "workspace_id")) !== workspaceId) {
        return { valid: false, errors: ["workspace_mismatch"] };
      }
      if (String(field(event, "previousDigest", "previous_digest")) !== previousDigest) {
        return { valid: false, errors: ["previous_digest_mismatch"] };
      }
      const payload = {
        action: String(field(event, "action", "action")),
        actorKind: String(field(event, "actorKind", "actor_kind")),
        actorReference: String(field(event, "actorReference", "actor_reference")),
        assuranceMethod: String(field(event, "assuranceMethod", "assurance_method")),
        eventId: String(field(event, "eventId", "event_id")),
        homeRegion: String(field(event, "homeRegion", "home_region")),
        metadata: metadata(field(event, "metadata", "metadata_json")),
        occurredAt: isoDate(field(event, "occurredAt", "occurred_at")),
        purpose: String(field(event, "purpose", "purpose")),
        reason: String(field(event, "reason", "reason")),
        requestCorrelation: field(event, "requestCorrelation", "request_correlation") ?? null,
        result: String(field(event, "result", "result")),
        targetId: String(field(event, "targetId", "target_id")),
        targetKind: String(field(event, "targetKind", "target_kind")),
        workspaceId,
        sequence,
      };
      const computed = auditEventDigest(previousDigest, payload);
      if (String(field(event, "eventDigest", "event_digest")) !== computed) {
        return { valid: false, errors: ["event_digest_mismatch"], sequence };
      }
      previousDigest = computed;
      expectedSequence += 1;
    }
    const eventCount = value.events.length;
    if (
      value.integrity.valid !== true ||
      Number(value.integrity.eventCount) !== eventCount ||
      String(value.integrity.headDigest) !== previousDigest
    ) {
      return { valid: false, errors: ["head_mismatch"] };
    }
    if (options.expectedHead && options.expectedHead !== previousDigest) {
      return { valid: false, errors: ["expected_head_mismatch"] };
    }
    return { valid: true, errors: [], eventCount, headDigest: previousDigest };
  } catch {
    return { valid: false, errors: ["verification_failed"] };
  }
}
