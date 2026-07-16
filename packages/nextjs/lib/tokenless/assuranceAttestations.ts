import { createPublicKey, verify } from "node:crypto";

export const IN_TOTO_STATEMENT_TYPE = "https://in-toto.io/Statement/v1" as const;
export const RATELOOP_REVIEW_VERDICT_PREDICATE_TYPE = "https://rateloop.ai/attestation/review-verdict/v1" as const;
export const RATELOOP_REVIEW_VERDICT_PREDICATE_SCHEMA = "rateloop.review-verdict-attestation.v1" as const;
export const DSSE_PAYLOAD_TYPE = "application/vnd.in-toto+json" as const;

const SHA256 = /^sha256:([0-9a-f]{64})$/u;
const SCHEMA = /^[a-z][a-z0-9._:/-]{2,199}$/u;
const KEY_ID = /^[A-Za-z0-9:._/-]{1,200}$/u;

export type AssuranceAttestationKind = "decision_packet" | "audit_export_head" | "coverage_export_head";

export type AssuranceAttestationStatement = {
  _type: typeof IN_TOTO_STATEMENT_TYPE;
  subject: [{ name: `rateloop:${AssuranceAttestationKind}`; digest: { sha256: string } }];
  predicateType: typeof RATELOOP_REVIEW_VERDICT_PREDICATE_TYPE;
  predicate: {
    schemaVersion: typeof RATELOOP_REVIEW_VERDICT_PREDICATE_SCHEMA;
    artifactKind: AssuranceAttestationKind;
    artifactSchemaVersion: string;
    artifactDigest: `sha256:${string}`;
    boundary: { kind: "artifact_generated" | "export_batch_closed"; occurredAt: string };
    disclosure: "digest_only_no_tenant_metadata";
  };
};

export type DsseEnvelope = {
  payloadType: typeof DSSE_PAYLOAD_TYPE;
  payload: string;
  signatures: [{ keyid: string; sig: string }];
};

function isoDate(value: Date) {
  if (!Number.isFinite(value.getTime())) throw new Error("Attestation boundary time is invalid.");
  return value.toISOString();
}

function digest(value: string) {
  const match = value.match(SHA256);
  if (!match) throw new Error("Attestation subject digest must be a canonical SHA-256 digest.");
  return { prefixed: value as `sha256:${string}`, hex: match[1] };
}

function schemaVersion(value: string) {
  const normalized = value.trim();
  if (!SCHEMA.test(normalized)) throw new Error("Attestation artifact schema version is invalid.");
  return normalized;
}

export function createAssuranceAttestationStatement(input: {
  kind: AssuranceAttestationKind;
  artifactDigest: string;
  artifactSchemaVersion: string;
  boundaryAt: Date;
}): AssuranceAttestationStatement {
  const subjectDigest = digest(input.artifactDigest);
  return {
    _type: IN_TOTO_STATEMENT_TYPE,
    subject: [{ name: `rateloop:${input.kind}`, digest: { sha256: subjectDigest.hex } }],
    predicateType: RATELOOP_REVIEW_VERDICT_PREDICATE_TYPE,
    predicate: {
      schemaVersion: RATELOOP_REVIEW_VERDICT_PREDICATE_SCHEMA,
      artifactKind: input.kind,
      artifactSchemaVersion: schemaVersion(input.artifactSchemaVersion),
      artifactDigest: subjectDigest.prefixed,
      boundary: {
        kind: input.kind === "decision_packet" ? "artifact_generated" : "export_batch_closed",
        occurredAt: isoDate(input.boundaryAt),
      },
      disclosure: "digest_only_no_tenant_metadata",
    },
  };
}

export function canonicalAttestationJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalAttestationJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalAttestationJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Attestation content must be JSON serializable.");
  return encoded;
}

function dsseLength(value: Buffer) {
  return Buffer.from(String(value.byteLength));
}

export function dssePreAuthenticationEncoding(payloadType: string, payload: Buffer) {
  const type = Buffer.from(payloadType);
  return Buffer.concat([
    Buffer.from("DSSEv1 "),
    dsseLength(type),
    Buffer.from(" "),
    type,
    Buffer.from(" "),
    dsseLength(payload),
    Buffer.from(" "),
    payload,
  ]);
}

export async function createAssuranceDsseEnvelope(input: {
  statement: AssuranceAttestationStatement;
  signer: { keyId: string; sign: (payload: Buffer) => Promise<Buffer> };
}): Promise<DsseEnvelope> {
  const keyId = input.signer.keyId.trim();
  if (!KEY_ID.test(keyId)) throw new Error("Attestation signing key ID is invalid.");
  const payload = Buffer.from(canonicalAttestationJson(input.statement));
  const signature = await input.signer.sign(dssePreAuthenticationEncoding(DSSE_PAYLOAD_TYPE, payload));
  if (!Buffer.isBuffer(signature) || signature.byteLength < 32) {
    throw new Error("Attestation signer returned an invalid signature.");
  }
  return {
    payloadType: DSSE_PAYLOAD_TYPE,
    payload: payload.toString("base64"),
    signatures: [{ keyid: keyId, sig: signature.toString("base64") }],
  };
}

export function verifyAssuranceDsseEnvelope(input: {
  envelope: DsseEnvelope;
  publicKeyDer: Buffer;
  expectedKeyId: string;
  expectedArtifactDigest: string;
  expectedArtifactKind: AssuranceAttestationKind;
  expectedArtifactSchemaVersion: string;
}) {
  try {
    if (
      input.envelope.payloadType !== DSSE_PAYLOAD_TYPE ||
      input.envelope.signatures.length !== 1 ||
      input.envelope.signatures[0].keyid !== input.expectedKeyId
    ) {
      return { valid: false, errors: ["invalid_envelope_binding"] } as const;
    }
    const payload = Buffer.from(input.envelope.payload, "base64");
    const statement = JSON.parse(payload.toString("utf8")) as AssuranceAttestationStatement;
    if (
      canonicalAttestationJson(statement) !== payload.toString("utf8") ||
      statement._type !== IN_TOTO_STATEMENT_TYPE ||
      statement.predicateType !== RATELOOP_REVIEW_VERDICT_PREDICATE_TYPE ||
      statement.subject.length !== 1 ||
      statement.subject[0]?.name !== `rateloop:${input.expectedArtifactKind}` ||
      statement.predicate.schemaVersion !== RATELOOP_REVIEW_VERDICT_PREDICATE_SCHEMA ||
      statement.predicate.artifactKind !== input.expectedArtifactKind ||
      statement.predicate.artifactSchemaVersion !== schemaVersion(input.expectedArtifactSchemaVersion) ||
      statement.predicate.artifactDigest !== input.expectedArtifactDigest ||
      statement.subject[0]?.digest.sha256 !== digest(input.expectedArtifactDigest).hex ||
      statement.predicate.boundary.kind !==
        (input.expectedArtifactKind === "decision_packet" ? "artifact_generated" : "export_batch_closed") ||
      statement.predicate.disclosure !== "digest_only_no_tenant_metadata" ||
      !Number.isFinite(Date.parse(statement.predicate.boundary.occurredAt))
    ) {
      return { valid: false, errors: ["statement_mismatch"] } as const;
    }
    const publicKey = createPublicKey({ key: input.publicKeyDer, format: "der", type: "spki" });
    const signatureValid = verify(
      null,
      dssePreAuthenticationEncoding(input.envelope.payloadType, payload),
      publicKey,
      Buffer.from(input.envelope.signatures[0].sig, "base64"),
    );
    return signatureValid
      ? ({ valid: true, errors: [], statement } as const)
      : ({ valid: false, errors: ["signature_invalid"] } as const);
  } catch {
    return { valid: false, errors: ["verification_failed"] } as const;
  }
}
