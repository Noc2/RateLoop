import { createHash, createPublicKey, verify } from "node:crypto";

export const EXTERNAL_WITNESS_SCHEMA_VERSION = "rateloop.assurance-external-witness.v1";
export const REKOR_RECEIPT_SCHEMA_VERSION = "rateloop.rekor-dsse-receipt.v1";

const SHA256 = /^sha256:([0-9a-f]{64})$/u;
const HEX_64 = /^[0-9a-f]{64}$/u;
const JOB_ID = /^aat_[0-9a-f]{40}$/u;
const ARTIFACT_KINDS = new Set(["decision_packet", "audit_export_head", "coverage_export_head"]);
const IN_TOTO_STATEMENT_TYPE = "https://in-toto.io/Statement/v1";
const PREDICATE_TYPE = "https://rateloop.ai/attestation/review-verdict/v1";
const PREDICATE_SCHEMA = "rateloop.review-verdict-attestation.v1";
const DSSE_PAYLOAD_TYPE = "application/vnd.in-toto+json";

export function canonicalizeAttestationWitness(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalizeAttestationWitness).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizeAttestationWitness(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Attestation witness content must be JSON serializable.");
  return encoded;
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest();
}

function sha256Hex(value) {
  return sha256Bytes(value).toString("hex");
}

function strictBase64(value) {
  if (typeof value !== "string" || !value || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) throw new Error();
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error();
  return decoded;
}

function jsonObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function number(value) {
  const parsed = typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value) ? Number(value) : value;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function hashBytes(value) {
  if (typeof value !== "string") throw new Error();
  if (HEX_64.test(value)) return Buffer.from(value, "hex");
  const decoded = strictBase64(value);
  if (decoded.byteLength !== 32) throw new Error();
  return decoded;
}

function keyDer(value) {
  return publicKey(value).export({ format: "der", type: "spki" });
}

function publicKey(value) {
  return value?.type === "public" && typeof value.export === "function" ? value : createPublicKey(value);
}

function publicKeysEqual(left, right) {
  try {
    return Buffer.from(keyDer(left)).equals(Buffer.from(keyDer(right)));
  } catch {
    return false;
  }
}

function dssePae(payloadType, payload) {
  const type = Buffer.from(payloadType);
  return Buffer.concat([
    Buffer.from("DSSEv1 "),
    Buffer.from(String(type.byteLength)),
    Buffer.from(" "),
    type,
    Buffer.from(" "),
    Buffer.from(String(payload.byteLength)),
    Buffer.from(" "),
    payload,
  ]);
}

export function rfc3161BoundaryPayload(input) {
  if (!SHA256.test(input.artifactDigest) || !Number.isFinite(new Date(input.boundaryAt).getTime())) {
    throw new Error("RFC 3161 boundary is invalid.");
  }
  return canonicalizeAttestationWitness({
    schemaVersion: "rateloop.assurance-rfc3161-boundary.v1",
    artifactDigest: input.artifactDigest,
    boundaryAt: new Date(input.boundaryAt).toISOString(),
  });
}

export function rfc3161BoundaryDigestHex(input) {
  return sha256Hex(rfc3161BoundaryPayload(input));
}

export function expectedRekorCanonicalBody(input) {
  const envelopeJson = canonicalizeAttestationWitness(input.envelope);
  const payload = strictBase64(input.envelope.payload);
  const signature = input.envelope.signatures?.[0]?.sig;
  if (typeof signature !== "string" || !signature) throw new Error("DSSE signature is missing.");
  const publicKeyPem = publicKey(input.signerPublicKey).export({ format: "pem", type: "spki" }).toString();
  return {
    apiVersion: "0.0.1",
    kind: "dsse",
    spec: {
      envelopeHash: { algorithm: "sha256", value: sha256Hex(envelopeJson) },
      payloadHash: { algorithm: "sha256", value: sha256Hex(payload) },
      signatures: [{ signature, verifier: Buffer.from(publicKeyPem).toString("base64") }],
    },
  };
}

function verifyInclusionProof(body, proof) {
  const index = number(proof?.logIndex);
  const treeSize = number(proof?.treeSize);
  if (index === null || treeSize === null || treeSize < 1 || index >= treeSize || !Array.isArray(proof?.hashes)) {
    return false;
  }
  let current = sha256Bytes(Buffer.concat([Buffer.from([0]), body]));
  let node = index;
  let last = treeSize - 1;
  try {
    for (const encoded of proof.hashes) {
      const sibling = hashBytes(encoded);
      if ((node & 1) === 1 || node === last) {
        current = sha256Bytes(Buffer.concat([Buffer.from([1]), sibling, current]));
        while ((node & 1) === 0 && node !== 0) {
          node >>= 1;
          last >>= 1;
        }
      } else {
        current = sha256Bytes(Buffer.concat([Buffer.from([1]), current, sibling]));
      }
      node >>= 1;
      last >>= 1;
    }
    return last === 0 && current.equals(hashBytes(proof.rootHash));
  } catch {
    return false;
  }
}

function verifySignedEntryTimestamp(entry, rekorPublicKey) {
  const signature = entry.verification?.signedEntryTimestamp;
  if (typeof signature !== "string") return false;
  const payload = canonicalizeAttestationWitness({
    body: entry.body,
    integratedTime: entry.integratedTime,
    logID: entry.logID,
    logIndex: entry.logIndex,
  });
  try {
    const key = publicKey(rekorPublicKey);
    const algorithm = key.asymmetricKeyType === "ed25519" || key.asymmetricKeyType === "ed448" ? null : "sha256";
    return verify(algorithm, Buffer.from(payload), key, strictBase64(signature));
  } catch {
    return false;
  }
}

export function verifyRekorReceipt(input) {
  const errors = [];
  const receipt = jsonObject(input.receipt);
  const entry = jsonObject(receipt?.logEntry);
  if (receipt?.schemaVersion !== REKOR_RECEIPT_SCHEMA_VERSION || !entry) {
    return { valid: false, errors: ["invalid_rekor_receipt"] };
  }
  if (receipt.entryUuid !== input.entryUuid || String(entry.logIndex) !== String(input.logIndex)) {
    errors.push("rekor_entry_binding_mismatch");
  }
  let body;
  let canonicalBody;
  try {
    body = strictBase64(entry.body);
    canonicalBody = JSON.parse(body.toString("utf8"));
    if (canonicalizeAttestationWitness(canonicalBody) !== body.toString("utf8")) {
      errors.push("rekor_body_not_canonical");
    }
  } catch {
    errors.push("invalid_rekor_body");
  }
  try {
    const expected = expectedRekorCanonicalBody({
      envelope: input.envelope,
      signerPublicKey: input.signerPublicKey,
    });
    if (!canonicalBody || canonicalizeAttestationWitness(expected) !== canonicalizeAttestationWitness(canonicalBody)) {
      errors.push("rekor_body_binding_mismatch");
    }
    const verifier = canonicalBody?.spec?.signatures?.[0]?.verifier;
    if (!publicKeysEqual(strictBase64(verifier), input.signerPublicKey)) {
      errors.push("rekor_verifier_binding_mismatch");
    }
  } catch {
    errors.push("rekor_body_binding_mismatch");
  }
  const logIndex = number(entry.logIndex);
  const integratedTime = number(entry.integratedTime);
  if (logIndex === null || integratedTime === null || typeof entry.logID !== "string" || !HEX_64.test(entry.logID)) {
    errors.push("invalid_rekor_log_metadata");
  }
  try {
    const expectedLogId = sha256Hex(keyDer(input.rekorPublicKey));
    if (entry.logID !== expectedLogId) errors.push("rekor_log_id_mismatch");
  } catch {
    errors.push("invalid_rekor_trust_anchor");
  }
  if (!verifySignedEntryTimestamp(entry, input.rekorPublicKey)) errors.push("invalid_rekor_signed_entry_timestamp");
  if (!body || !verifyInclusionProof(body, entry.verification?.inclusionProof)) {
    errors.push("invalid_rekor_inclusion_proof");
  }
  return { valid: errors.length === 0, errors };
}

export function verifyAssuranceAttestationWitnessBundle(bundle, trust = {}) {
  const errors = [];
  try {
    if (!bundle || bundle.schemaVersion !== EXTERNAL_WITNESS_SCHEMA_VERSION) {
      return { valid: false, errors: ["unsupported_witness_schema"] };
    }
    if (
      !JOB_ID.test(bundle.jobId) ||
      !ARTIFACT_KINDS.has(bundle.artifact?.kind) ||
      !SHA256.test(bundle.artifact?.digest) ||
      typeof bundle.artifact?.schemaVersion !== "string" ||
      !Number.isFinite(new Date(bundle.artifact?.boundaryAt).getTime()) ||
      !Number.isFinite(new Date(bundle.completedAt).getTime())
    ) {
      errors.push("invalid_artifact_metadata");
    }
    if (!trust.signerPublicKey) errors.push("missing_signer_trust_anchor");
    if (!trust.rekorPublicKey) errors.push("missing_rekor_trust_anchor");
    const envelope = bundle.dsse?.envelope;
    const signature = envelope?.signatures?.[0];
    if (
      envelope?.payloadType !== DSSE_PAYLOAD_TYPE ||
      !Array.isArray(envelope?.signatures) ||
      envelope.signatures.length !== 1
    ) {
      errors.push("invalid_dsse_envelope");
    }
    const payload = strictBase64(envelope?.payload);
    const statement = JSON.parse(payload.toString("utf8"));
    if (canonicalizeAttestationWitness(statement) !== payload.toString("utf8")) errors.push("non_canonical_statement");
    if (canonicalizeAttestationWitness(statement) !== canonicalizeAttestationWitness(bundle.statement)) {
      errors.push("statement_envelope_mismatch");
    }
    const digestHex = bundle.artifact?.digest?.match(SHA256)?.[1];
    const expectedBoundaryKind =
      bundle.artifact?.kind === "decision_packet" ? "artifact_generated" : "export_batch_closed";
    if (
      statement?._type !== IN_TOTO_STATEMENT_TYPE ||
      statement?.predicateType !== PREDICATE_TYPE ||
      statement?.predicate?.schemaVersion !== PREDICATE_SCHEMA ||
      statement?.predicate?.disclosure !== "digest_only_no_tenant_metadata" ||
      statement?.predicate?.artifactDigest !== bundle.artifact?.digest ||
      statement?.predicate?.artifactKind !== bundle.artifact?.kind ||
      statement?.predicate?.artifactSchemaVersion !== bundle.artifact?.schemaVersion ||
      statement?.predicate?.boundary?.occurredAt !== bundle.artifact?.boundaryAt ||
      statement?.predicate?.boundary?.kind !== expectedBoundaryKind ||
      !Array.isArray(statement?.subject) ||
      statement.subject.length !== 1 ||
      statement.subject[0]?.name !== `rateloop:${bundle.artifact?.kind}` ||
      statement.subject[0]?.digest?.sha256 !== digestHex
    ) {
      errors.push("artifact_statement_mismatch");
    }
    if (signature?.keyid !== bundle.dsse?.signerKeyId) errors.push("dsse_key_id_mismatch");
    if (trust.expectedSignerKeyId && signature?.keyid !== trust.expectedSignerKeyId) {
      errors.push("untrusted_signer_key_id");
    }
    if (
      trust.signerPublicKey &&
      !verify(
        null,
        dssePae(envelope.payloadType, payload),
        publicKey(trust.signerPublicKey),
        strictBase64(signature?.sig),
      )
    ) {
      errors.push("invalid_dsse_signature");
    }
    if (trust.signerPublicKey && trust.rekorPublicKey) {
      const rekor = verifyRekorReceipt({
        receipt: bundle.rekor?.bundle,
        entryUuid: bundle.rekor?.entryUuid,
        logIndex: bundle.rekor?.logIndex,
        envelope,
        signerPublicKey: trust.signerPublicKey,
        rekorPublicKey: trust.rekorPublicKey,
      });
      errors.push(...rekor.errors);
    }
    const timestamp = bundle.rfc3161;
    if (bundle.artifact?.kind === "decision_packet") {
      if (timestamp !== null) errors.push("unexpected_rfc3161_timestamp");
    } else if (!timestamp?.tokenBase64) {
      errors.push("missing_rfc3161_timestamp");
    } else {
      strictBase64(timestamp.tokenBase64);
      const expectedDigest = rfc3161BoundaryDigestHex({
        artifactDigest: bundle.artifact.digest,
        boundaryAt: bundle.artifact.boundaryAt,
      });
      if (timestamp.messageImprint?.algorithm !== "sha256" || timestamp.messageImprint?.digest !== expectedDigest) {
        errors.push("rfc3161_imprint_mismatch");
      }
    }
  } catch {
    errors.push("malformed_witness_bundle");
  }
  return { valid: errors.length === 0, errors };
}

export const __attestationWitnessCoreTestUtils = { dssePae, verifyInclusionProof, verifySignedEntryTimestamp };
