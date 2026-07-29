import { createHash, createPublicKey } from "node:crypto";
import "server-only";
import { dbClient } from "~~/lib/db";
import { requireAssuranceAttestationManagement } from "~~/lib/tokenless/assuranceAttestationPipeline";
import { encodeEd25519SpkiDerBase64url } from "~~/lib/tokenless/evidenceVerificationKey";
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

function keyIdentity(keyId: string, publicKeySpki: string) {
  return JSON.stringify([keyId, publicKeySpki]);
}

type DecisionPacketVerificationKey = {
  algorithm: "ECDSA-SHA256" | "Ed25519";
  keyId: string;
  publicKey: string;
  publicKeyJwk: JsonWebKey;
  status: "current" | "retired";
};

type EvidenceSigningEnvironment = {
  TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS?: string;
  TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY?: string;
};

function parseDecisionPacketVerificationKeysWithOptions(encoded: string, options: { allowEmpty?: boolean }) {
  let entries: unknown;
  try {
    entries = JSON.parse(encoded);
  } catch {
    throw new TokenlessServiceError("Decision-packet verification keys are invalid.", 503, "invalid_evidence_keyring");
  }
  if (!Array.isArray(entries) || (entries.length === 0 && !options.allowEmpty)) {
    throw new TokenlessServiceError(
      "Decision-packet verification keys are unavailable.",
      503,
      "invalid_evidence_keyring",
    );
  }
  if (entries.length === 0) return [];
  const seen = new Set<string>();
  let current = 0;
  const parsed = entries.map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("invalid key entry");
    const value = entry as Record<string, unknown>;
    if (
      (value.algorithm !== "Ed25519" && value.algorithm !== "ECDSA-SHA256") ||
      typeof value.keyId !== "string" ||
      typeof value.publicKey !== "string" ||
      (value.status !== "current" && value.status !== "retired")
    ) {
      throw new Error("invalid key entry");
    }
    const publicKey = createPublicKey({ key: Buffer.from(value.publicKey, "base64url"), format: "der", type: "spki" });
    const canonical = publicKey.export({ format: "der", type: "spki" });
    const ed25519 = value.algorithm === "Ed25519";
    if (
      (ed25519 && (publicKey.asymmetricKeyType !== "ed25519" || !/^ed25519:[0-9a-f]{24}$/u.test(value.keyId))) ||
      (!ed25519 &&
        (publicKey.asymmetricKeyType !== "ec" ||
          publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1" ||
          !/^p256:[0-9a-f]{24}$/u.test(value.keyId) ||
          value.status !== "retired"))
    ) {
      throw new Error("invalid key type");
    }
    const derivedKeyId = `${ed25519 ? "ed25519" : "p256"}:${createHash("sha256")
      .update(canonical)
      .digest("hex")
      .slice(0, 24)}`;
    if (derivedKeyId !== value.keyId || canonical.toString("base64url") !== value.publicKey) {
      throw new Error("invalid key identity");
    }
    const identity = keyIdentity(value.keyId, value.publicKey);
    if (seen.has(identity)) throw new Error("duplicate key");
    seen.add(identity);
    if (value.status === "current") current += 1;
    return {
      algorithm: value.algorithm,
      keyId: value.keyId,
      publicKey: value.publicKey,
      publicKeyJwk: publicKey.export({ format: "jwk" }),
      status: value.status,
    } as DecisionPacketVerificationKey;
  });
  if (current !== 1) throw new Error("exactly one current key is required");
  return parsed;
}

export function parseDecisionPacketVerificationKeys(encoded: string): DecisionPacketVerificationKey[] {
  return parseDecisionPacketVerificationKeysWithOptions(encoded, {});
}

export function configuredDecisionPacketVerificationKeys(
  env?: EvidenceSigningEnvironment,
): DecisionPacketVerificationKey[] {
  const configuration = env ?? {
    TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS: process.env.TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS,
    TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY: process.env.TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY,
  };
  const encoded = configuration.TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS?.trim();
  const usesPlatformSecretSigner = Boolean(configuration.TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY?.trim());
  const allowEmpty = usesPlatformSecretSigner;
  if (!encoded) {
    if (allowEmpty) return [];
    throw new TokenlessServiceError(
      "Decision-packet verification keys are unavailable.",
      503,
      "invalid_evidence_keyring",
    );
  }
  return parseDecisionPacketVerificationKeysWithOptions(encoded, { allowEmpty });
}

export function projectPublicEvidenceTrustedKeyHistory(env?: EvidenceSigningEnvironment) {
  const byIdentity = new Map<
    string,
    {
      algorithm: "ECDSA-SHA256" | "Ed25519";
      keyId: string;
      publicKeyJwk: JsonWebKey;
      publicKeySpki: string;
      status: "current" | "retired";
      uses: Array<"decision_packet" | "human_review_gate">;
    }
  >();
  for (const key of projectHumanReviewGateTrustedKeyHistory().keys) {
    const publicKeySpki = encodeEd25519SpkiDerBase64url(key.publicKeyJwk);
    byIdentity.set(keyIdentity(key.keyId, publicKeySpki), {
      ...key,
      publicKeySpki,
      uses: ["human_review_gate"],
    });
  }
  for (const key of configuredDecisionPacketVerificationKeys(env)) {
    const identity = keyIdentity(key.keyId, key.publicKey);
    const existing = byIdentity.get(identity);
    if (existing) {
      existing.uses.push("decision_packet");
      if (key.status === "current") existing.status = "current";
      continue;
    }
    byIdentity.set(identity, {
      algorithm: key.algorithm,
      keyId: key.keyId,
      publicKeyJwk: key.publicKeyJwk,
      publicKeySpki: key.publicKey,
      status: key.status,
      uses: ["decision_packet"],
    });
  }
  return {
    schemaVersion: "rateloop.evidence-public-trusted-keys.v1" as const,
    keys: [...byIdentity.values()],
  };
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
  const packetByKey = new Map(
    packets.rows.map(value => {
      const row = value as Row;
      return [keyIdentity(text(row, "signing_key_id")!, text(row, "signing_public_key")!), row] as const;
    }),
  );
  const gateKeys = gateKeyring.keys.map(key => {
    const publicKeySpki = encodeEd25519SpkiDerBase64url(key.publicKeyJwk);
    const identity = keyIdentity(key.keyId, publicKeySpki);
    const packet = packetByKey.get(identity);
    if (packet) packetByKey.delete(identity);
    return {
      keyId: key.keyId,
      algorithm: key.algorithm,
      publicKeyJwk: key.publicKeyJwk,
      publicKeySpki,
      status: key.status,
      uses: ["human_review_gate", ...(packet ? (["decision_packet"] as const) : [])],
      firstPacketAt: packet ? iso(packet.first_seen_at) : null,
      lastPacketAt: packet ? iso(packet.last_seen_at) : null,
      packetCount: packet ? Number(packet.packet_count) : 0,
    };
  });
  let packetKeys: DecisionPacketVerificationKey[];
  try {
    packetKeys = configuredDecisionPacketVerificationKeys();
  } catch (error) {
    if (error instanceof TokenlessServiceError) throw error;
    throw new TokenlessServiceError("Decision-packet verification keys are invalid.", 503, "invalid_evidence_keyring");
  }
  const decisionKeys = packetKeys.map(key => {
    const identity = keyIdentity(key.keyId, key.publicKey);
    const packet = packetByKey.get(identity);
    if (packet) packetByKey.delete(identity);
    return {
      keyId: key.keyId,
      algorithm: key.algorithm,
      publicKeyJwk: key.publicKeyJwk,
      publicKeySpki: key.publicKey,
      status: key.status,
      uses: ["decision_packet" as const],
      firstPacketAt: packet ? iso(packet.first_seen_at) : null,
      lastPacketAt: packet ? iso(packet.last_seen_at) : null,
      packetCount: packet ? Number(packet.packet_count) : 0,
    };
  });
  return {
    schemaVersion: "rateloop.evidence-trusted-key-history.v1" as const,
    workspaceId: input.workspaceId,
    keys: [...gateKeys, ...decisionKeys],
    untrustedPacketKeyCount: packetByKey.size,
  };
}
