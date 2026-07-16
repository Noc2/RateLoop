import { execFile } from "node:child_process";
import { createHash, createHmac, createPublicKey, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import "server-only";
import type {
  ManagedAttestationSigner,
  RekorPublisher,
  Rfc3161TimestampAuthority,
} from "~~/lib/tokenless/assuranceAttestationPipeline";
import { canonicalAttestationJson } from "~~/lib/tokenless/assuranceAttestations";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import {
  REKOR_RECEIPT_SCHEMA_VERSION,
  rfc3161BoundaryDigestHex,
  verifyRekorReceipt,
} from "~~/scripts/assurance-attestation-witness-core.mjs";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type AwsKmsCredential = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

const AWS_REGION = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u;
const KEY_ARN = /^arn:aws(?:-us-gov)?:kms:([a-z0-9-]+):\d{12}:key\/[0-9a-f-]{36}$/u;
const MAX_PROVIDER_BYTES = 2 * 1024 * 1024;
const execFileAsync = promisify(execFile);

function sha256Hex(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function ed25519KeyId(publicKeyDer: Buffer) {
  return `ed25519:${sha256Hex(publicKeyDer).slice(0, 24)}`;
}

function hmac(key: string | Uint8Array, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function awsTimestamp(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function canonicalHeaders(headers: Record<string, string>) {
  const normalized = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, " ")] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return {
    names: normalized.map(([name]) => name).join(";"),
    value: `${normalized.map(([name, value]) => `${name}:${value}\n`).join("")}`,
  };
}

function validateAwsCredential(value: AwsKmsCredential) {
  if (
    !value ||
    typeof value.accessKeyId !== "string" ||
    value.accessKeyId.length < 4 ||
    value.accessKeyId.length > 256 ||
    typeof value.secretAccessKey !== "string" ||
    value.secretAccessKey.length < 16 ||
    value.secretAccessKey.length > 512 ||
    (value.sessionToken !== undefined && (!value.sessionToken || value.sessionToken.length > 4096))
  ) {
    throw new TokenlessServiceError(
      "Managed attestation credential could not be resolved.",
      503,
      "attestation_credential_unavailable",
      true,
    );
  }
  return value;
}

async function responseBytes(response: Response, description: string) {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_BYTES) {
    throw new TokenlessServiceError(
      `${description} response is too large.`,
      502,
      "invalid_attestation_provider_response",
    );
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_PROVIDER_BYTES) {
        await reader.cancel();
        throw new TokenlessServiceError(
          `${description} response is too large.`,
          502,
          "invalid_attestation_provider_response",
        );
      }
      chunks.push(Buffer.from(next.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function signedKmsRequest(input: {
  region: string;
  credential: AwsKmsCredential;
  target: "TrentService.GetPublicKey" | "TrentService.Sign";
  body: Record<string, unknown>;
  fetch: FetchLike;
  now: Date;
}) {
  const body = canonicalAttestationJson(input.body);
  const url = new URL(`https://kms.${input.region}.amazonaws.com/`);
  const amzDate = awsTimestamp(input.now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = {
    "content-type": "application/x-amz-json-1.1",
    host: url.host,
    "x-amz-date": amzDate,
    "x-amz-target": input.target,
  };
  if (input.credential.sessionToken) headers["x-amz-security-token"] = input.credential.sessionToken;
  const canonical = canonicalHeaders(headers);
  const canonicalRequest = ["POST", "/", "", canonical.value, canonical.names, payloadHash].join("\n");
  const scope = `${dateStamp}/${input.region}/kms/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const dateKey = hmac(`AWS4${input.credential.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, input.region);
  const serviceKey = hmac(regionKey, "kms");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.credential.accessKeyId}/${scope}, SignedHeaders=${canonical.names}, Signature=${signature}`;
  const response = await input.fetch(url, {
    method: "POST",
    headers,
    body,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const bytes = await responseBytes(response, "AWS KMS");
  if (!response.ok) {
    throw new TokenlessServiceError(
      "Managed attestation signing provider rejected the request.",
      response.status >= 500 ? 503 : 502,
      "attestation_signer_rejected",
      response.status >= 500,
    );
  }
  try {
    return JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new TokenlessServiceError("AWS KMS returned invalid JSON.", 502, "invalid_attestation_provider_response");
  }
}

export async function createAwsKmsManagedAttestationSigner(input: {
  keyArn: string;
  region: string;
  resolveCredential: () => Promise<AwsKmsCredential>;
  fetch?: FetchLike;
  now?: () => Date;
}): Promise<ManagedAttestationSigner> {
  const keyArn = input.keyArn.trim();
  const region = input.region.trim().toLowerCase();
  const match = keyArn.match(KEY_ARN);
  if (!AWS_REGION.test(region) || match?.[1] !== region) {
    throw new TokenlessServiceError(
      "Managed attestation KMS key configuration is invalid.",
      500,
      "invalid_attestation_config",
    );
  }
  const fetcher = input.fetch ?? fetch;
  const currentTime = input.now ?? (() => new Date());
  const credential = validateAwsCredential(await input.resolveCredential());
  const response = await signedKmsRequest({
    region,
    credential,
    target: "TrentService.GetPublicKey",
    body: { KeyId: keyArn },
    fetch: fetcher,
    now: currentTime(),
  });
  if (
    response.KeyId !== keyArn ||
    response.KeySpec !== "ECC_NIST_EDWARDS25519" ||
    response.KeyUsage !== "SIGN_VERIFY" ||
    !Array.isArray(response.SigningAlgorithms) ||
    !response.SigningAlgorithms.includes("ED25519_SHA_512") ||
    typeof response.PublicKey !== "string"
  ) {
    throw new TokenlessServiceError(
      "Managed attestation KMS key does not satisfy the Ed25519 signing policy.",
      503,
      "invalid_attestation_signing_key",
      true,
    );
  }
  let publicKeyDer: Buffer;
  try {
    publicKeyDer = Buffer.from(response.PublicKey, "base64");
    const key = createPublicKey({ key: publicKeyDer, format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") throw new Error();
  } catch {
    throw new TokenlessServiceError("AWS KMS returned an invalid Ed25519 key.", 502, "invalid_attestation_signing_key");
  }
  return {
    custody: "managed",
    keyId: ed25519KeyId(publicKeyDer),
    publicKeyDer,
    async sign(payload) {
      if (!Buffer.isBuffer(payload) || payload.byteLength < 1 || payload.byteLength > 4096) {
        throw new TokenlessServiceError("Attestation signing payload is invalid.", 500, "invalid_attestation_payload");
      }
      const liveCredential = validateAwsCredential(await input.resolveCredential());
      const signed = await signedKmsRequest({
        region,
        credential: liveCredential,
        target: "TrentService.Sign",
        body: {
          KeyId: keyArn,
          Message: payload.toString("base64"),
          MessageType: "RAW",
          SigningAlgorithm: "ED25519_SHA_512",
        },
        fetch: fetcher,
        now: currentTime(),
      });
      if (
        signed.KeyId !== keyArn ||
        signed.SigningAlgorithm !== "ED25519_SHA_512" ||
        typeof signed.Signature !== "string"
      ) {
        throw new TokenlessServiceError(
          "AWS KMS returned an invalid signature receipt.",
          502,
          "invalid_managed_signature",
        );
      }
      const signature = Buffer.from(signed.Signature, "base64");
      if (signature.byteLength !== 64) {
        throw new TokenlessServiceError(
          "AWS KMS returned an invalid Ed25519 signature.",
          502,
          "invalid_managed_signature",
        );
      }
      return signature;
    },
  };
}

function normalizeProviderUrl(value: string, kind: "Rekor" | "RFC 3161", originOnly: boolean) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new TokenlessServiceError(`${kind} URL is invalid.`, 500, "invalid_attestation_config");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.hostname === "localhost" ||
    /^(?:127\.|10\.|192\.168\.|169\.254\.|\[?::1\]?$)/u.test(url.hostname) ||
    (originOnly && (url.pathname !== "/" || url.search))
  ) {
    throw new TokenlessServiceError(`${kind} URL is invalid.`, 500, "invalid_attestation_config");
  }
  return url;
}

function parseRekorEntry(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error();
  const entries = Object.entries(payload as Record<string, unknown>);
  if (entries.length !== 1) throw new Error();
  const [entryUuid, rawEntry] = entries[0]!;
  if (
    !/^[A-Za-z0-9._:-]{1,200}$/u.test(entryUuid) ||
    !rawEntry ||
    typeof rawEntry !== "object" ||
    Array.isArray(rawEntry)
  ) {
    throw new Error();
  }
  return { entryUuid, logEntry: rawEntry as Record<string, unknown> };
}

async function rekorJson(response: Response) {
  const bytes = await responseBytes(response, "Rekor");
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new TokenlessServiceError("Rekor returned invalid JSON.", 502, "invalid_external_attestation_receipt");
  }
}

export function createRekorDssePublisher(input: {
  logOrigin: string;
  signerPublicKeyDer: Buffer;
  trustedRekorPublicKeyPem: string;
  fetch?: FetchLike;
}): RekorPublisher {
  const origin = normalizeProviderUrl(input.logOrigin, "Rekor", true);
  const entriesUrl = new URL("/api/v1/log/entries", origin);
  const fetcher = input.fetch ?? fetch;
  const signerPublicKeyPem = createPublicKey({ key: input.signerPublicKeyDer, format: "der", type: "spki" })
    .export({ format: "pem", type: "spki" })
    .toString();
  createPublicKey(input.trustedRekorPublicKeyPem);
  return {
    async publish({ envelope }) {
      const request = {
        apiVersion: "0.0.1",
        kind: "dsse",
        spec: {
          proposedContent: {
            envelope: canonicalAttestationJson(envelope),
            verifiers: [Buffer.from(signerPublicKeyPem).toString("base64")],
          },
        },
      };
      let response = await fetcher(entriesUrl, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: canonicalAttestationJson(request),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 409) {
        const location = response.headers.get("location");
        const existing = location ? new URL(location, origin) : null;
        if (!existing || existing.origin !== origin.origin || !existing.pathname.startsWith("/api/v1/log/entries/")) {
          throw new TokenlessServiceError(
            "Rekor conflict did not identify the existing entry.",
            502,
            "invalid_external_attestation_receipt",
          );
        }
        response = await fetcher(existing, {
          headers: { accept: "application/json" },
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        });
      }
      if (!response.ok) {
        throw new TokenlessServiceError(
          "Rekor rejected the DSSE attestation.",
          response.status >= 500 ? 503 : 502,
          "rekor_publication_failed",
          response.status >= 500,
        );
      }
      let parsed: ReturnType<typeof parseRekorEntry>;
      try {
        parsed = parseRekorEntry(await rekorJson(response));
      } catch (error) {
        if (error instanceof TokenlessServiceError) throw error;
        throw new TokenlessServiceError(
          "Rekor returned an invalid log entry.",
          502,
          "invalid_external_attestation_receipt",
        );
      }
      const logIndex = String(parsed.logEntry.logIndex ?? "");
      const receipt = {
        schemaVersion: REKOR_RECEIPT_SCHEMA_VERSION,
        logOrigin: origin.origin,
        entryUuid: parsed.entryUuid,
        logEntry: parsed.logEntry,
      };
      const verification = verifyRekorReceipt({
        receipt,
        entryUuid: parsed.entryUuid,
        logIndex,
        envelope,
        signerPublicKey: signerPublicKeyPem,
        rekorPublicKey: input.trustedRekorPublicKeyPem,
      });
      if (!verification.valid) {
        throw new TokenlessServiceError(
          `Rekor receipt failed local verification: ${verification.errors.join(",")}.`,
          502,
          "invalid_external_attestation_receipt",
        );
      }
      return { entryUuid: parsed.entryUuid, logIndex, inclusionBundle: receipt };
    },
  };
}

function derLength(length: number) {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  for (let value = length; value > 0; value >>= 8) bytes.unshift(value & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag: number, value: Buffer) {
  return Buffer.concat([Buffer.from([tag]), derLength(value.byteLength), value]);
}

function derInteger(value: Buffer) {
  let normalized = Buffer.from(value);
  while (normalized.byteLength > 1 && normalized[0] === 0) normalized = normalized.subarray(1);
  if ((normalized[0]! & 0x80) !== 0) normalized = Buffer.concat([Buffer.from([0]), normalized]);
  return der(0x02, normalized);
}

export function createRfc3161TimestampRequest(digestHex: string, nonce = randomBytes(16)) {
  if (!/^[0-9a-f]{64}$/u.test(digestHex) || !Buffer.isBuffer(nonce) || nonce.byteLength < 8 || nonce.byteLength > 32) {
    throw new TokenlessServiceError("RFC 3161 request input is invalid.", 500, "invalid_attestation_payload");
  }
  const sha256Algorithm = der(
    0x30,
    Buffer.concat([Buffer.from("0609608648016503040201", "hex"), Buffer.from("0500", "hex")]),
  );
  const messageImprint = der(0x30, Buffer.concat([sha256Algorithm, der(0x04, Buffer.from(digestHex, "hex"))]));
  return der(
    0x30,
    Buffer.concat([derInteger(Buffer.from([1])), messageImprint, derInteger(nonce), Buffer.from([0x01, 0x01, 0xff])]),
  );
}

export async function verifyRfc3161WithOpenSsl(input: {
  token: Buffer;
  digestHex: string;
  trustedCaPem: string;
  untrustedChainPem?: string;
  opensslPath?: string;
}) {
  const directory = await mkdtemp(join(tmpdir(), "rateloop-tsa-"));
  try {
    const tokenPath = join(directory, "response.tsr");
    const caPath = join(directory, "trusted-ca.pem");
    const chainPath = join(directory, "untrusted-chain.pem");
    await writeFile(tokenPath, input.token, { mode: 0o600 });
    await writeFile(caPath, input.trustedCaPem, { mode: 0o600 });
    if (input.untrustedChainPem) await writeFile(chainPath, input.untrustedChainPem, { mode: 0o600 });
    const args = ["ts", "-verify", "-digest", input.digestHex, "-in", tokenPath, "-CAfile", caPath];
    if (input.untrustedChainPem) args.push("-untrusted", chainPath);
    await execFileAsync(input.opensslPath ?? "openssl", args, { timeout: 15_000, maxBuffer: 1024 * 1024 });
  } catch {
    throw new TokenlessServiceError(
      "RFC 3161 response failed verification against the configured trust anchor.",
      502,
      "invalid_external_attestation_receipt",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function createRfc3161TimestampAuthority(input: {
  authorityUrl: string;
  trustedCaPem: string;
  untrustedChainPem?: string;
  fetch?: FetchLike;
  verifyResponse?: (input: { token: Buffer; digestHex: string }) => Promise<void>;
}): Rfc3161TimestampAuthority {
  const authorityUrl = normalizeProviderUrl(input.authorityUrl, "RFC 3161", false);
  if (!input.trustedCaPem.trim()) {
    throw new TokenlessServiceError("RFC 3161 trust anchor is missing.", 500, "invalid_attestation_config");
  }
  const fetcher = input.fetch ?? fetch;
  const verifyResponse =
    input.verifyResponse ??
    (value =>
      verifyRfc3161WithOpenSsl({
        ...value,
        trustedCaPem: input.trustedCaPem,
        untrustedChainPem: input.untrustedChainPem,
      }));
  return {
    async timestamp(boundary) {
      const digestHex = rfc3161BoundaryDigestHex(boundary);
      const request = createRfc3161TimestampRequest(digestHex);
      const response = await fetcher(authorityUrl, {
        method: "POST",
        headers: { accept: "application/timestamp-reply", "content-type": "application/timestamp-query" },
        body: request,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      const token = await responseBytes(response, "RFC 3161 authority");
      if (!response.ok) {
        throw new TokenlessServiceError(
          "RFC 3161 authority rejected the timestamp request.",
          response.status >= 500 ? 503 : 502,
          "rfc3161_timestamp_failed",
          response.status >= 500,
        );
      }
      if (token.byteLength < 32 || token[0] !== 0x30) {
        throw new TokenlessServiceError(
          "RFC 3161 authority returned an invalid response.",
          502,
          "invalid_external_attestation_receipt",
        );
      }
      await verifyResponse({ token, digestHex });
      return { token };
    },
  };
}

export const __assuranceAttestationExternalWitnessTestUtils = {
  awsTimestamp,
  canonicalHeaders,
  derLength,
  signedKmsRequest,
  ed25519KeyId,
};
