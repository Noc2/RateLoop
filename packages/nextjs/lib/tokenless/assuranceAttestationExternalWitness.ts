import { execFile } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign } from "node:crypto";
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
import { maintenanceRequestSignal } from "~~/lib/tokenless/maintenanceCancellation";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import {
  REKOR_RECEIPT_SCHEMA_VERSION,
  rfc3161BoundaryDigestHex,
  verifyRekorReceipt,
} from "~~/scripts/assurance-attestation-witness-core.mjs";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const MAX_PROVIDER_BYTES = 2 * 1024 * 1024;
const execFileAsync = promisify(execFile);

function sha256Hex(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function ed25519KeyId(publicKeyDer: Buffer) {
  return `ed25519:${sha256Hex(publicKeyDer).slice(0, 24)}`;
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

export function createPlatformSecretManagedAttestationSigner(input: {
  expectedKeyId?: string;
  privateKey: string;
}): ManagedAttestationSigner {
  let privateKey: ReturnType<typeof createPrivateKey>;
  try {
    privateKey = input.privateKey.includes("BEGIN PRIVATE KEY")
      ? createPrivateKey(input.privateKey)
      : createPrivateKey({ key: Buffer.from(input.privateKey, "base64url"), format: "der", type: "pkcs8" });
    if (privateKey.asymmetricKeyType !== "ed25519") throw new Error();
  } catch {
    throw new TokenlessServiceError(
      "Platform attestation signing key must be a private Ed25519 PKCS#8 key.",
      500,
      "invalid_attestation_signing_key",
    );
  }
  const publicKeyDer = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const keyId = ed25519KeyId(publicKeyDer);
  if (input.expectedKeyId?.trim() && input.expectedKeyId.trim() !== keyId) {
    throw new TokenlessServiceError(
      "Platform attestation signing key ID does not match its public-key fingerprint.",
      500,
      "invalid_attestation_signing_key",
    );
  }
  return {
    custody: "managed",
    keyId,
    publicKeyDer,
    async sign(payload) {
      if (!Buffer.isBuffer(payload) || payload.byteLength < 1 || payload.byteLength > 4096) {
        throw new TokenlessServiceError("Attestation signing payload is invalid.", 500, "invalid_attestation_payload");
      }
      return sign(null, payload, privateKey);
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
    async publish({ envelope, signal }) {
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
        signal: maintenanceRequestSignal(signal, 15_000),
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
          signal: maintenanceRequestSignal(signal, 15_000),
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
        signal: maintenanceRequestSignal(boundary.signal, 15_000),
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
  derLength,
  ed25519KeyId,
};
