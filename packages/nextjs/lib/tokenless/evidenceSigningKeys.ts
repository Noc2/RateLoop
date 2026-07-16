import { createPublicKey } from "node:crypto";
import "server-only";
import { dbClient } from "~~/lib/db";
import { requireAssuranceAttestationManagement } from "~~/lib/tokenless/assuranceAttestationPipeline";
import { projectHumanReviewGateTrustedKeyHistory } from "~~/lib/tokenless/humanReviewGateEvidence";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;

function text(row: Row, key: string) {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

function iso(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new TokenlessServiceError("Stored evidence key history is invalid.", 500, "stored_evidence_key_invalid");
  }
  return parsed.toISOString();
}

function packetPublicKeyJwk(value: string) {
  try {
    const key = createPublicKey({ key: Buffer.from(value, "base64url"), format: "der", type: "spki" });
    const jwk = key.export({ format: "jwk" });
    if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") throw new Error();
    return { kty: "OKP" as const, crv: "Ed25519" as const, x: jwk.x };
  } catch {
    throw new TokenlessServiceError("Stored evidence key history is invalid.", 500, "stored_evidence_key_invalid");
  }
}

export async function listWorkspaceEvidenceSigningKeys(input: { accountAddress: string; workspaceId: string }) {
  await requireAssuranceAttestationManagement(input.accountAddress, input.workspaceId);
  const gateKeyring = projectHumanReviewGateTrustedKeyHistory();
  const packets = await dbClient.execute({
    sql: `SELECT ep.signing_key_id,ep.signing_public_key,
                 MIN(ep.generated_at) AS first_seen_at,MAX(ep.generated_at) AS last_seen_at,
                 COUNT(*) AS packet_count
          FROM tokenless_assurance_evidence_packets ep
          JOIN tokenless_assurance_runs r ON r.run_id=ep.run_id
          JOIN tokenless_assurance_projects p ON p.project_id=r.project_id
          WHERE p.workspace_id=? AND ep.signing_key_id IS NOT NULL AND ep.signing_public_key IS NOT NULL
          GROUP BY ep.signing_key_id,ep.signing_public_key
          ORDER BY last_seen_at DESC,ep.signing_key_id ASC`,
    args: [input.workspaceId],
  });
  const packetById = new Map(
    packets.rows.map(value => {
      const row = value as Row;
      return [text(row, "signing_key_id")!, row] as const;
    }),
  );
  const keys = gateKeyring.keys.map(key => {
    const packet = packetById.get(key.keyId);
    if (packet) packetById.delete(key.keyId);
    return {
      keyId: key.keyId,
      algorithm: key.algorithm,
      publicKeyJwk: key.publicKeyJwk,
      status: key.status,
      uses: ["human_review_gate", ...(packet ? (["decision_packet"] as const) : [])],
      firstPacketAt: packet ? iso(packet.first_seen_at) : null,
      lastPacketAt: packet ? iso(packet.last_seen_at) : null,
      packetCount: packet ? Number(packet.packet_count) : 0,
    };
  });
  for (const packet of packetById.values()) {
    keys.push({
      keyId: text(packet, "signing_key_id")!,
      algorithm: "Ed25519",
      publicKeyJwk: packetPublicKeyJwk(text(packet, "signing_public_key")!),
      status: "retired",
      uses: ["decision_packet"],
      firstPacketAt: iso(packet.first_seen_at),
      lastPacketAt: iso(packet.last_seen_at),
      packetCount: Number(packet.packet_count),
    });
  }
  return {
    schemaVersion: "rateloop.evidence-trusted-key-history.v1" as const,
    workspaceId: input.workspaceId,
    keys,
  };
}
