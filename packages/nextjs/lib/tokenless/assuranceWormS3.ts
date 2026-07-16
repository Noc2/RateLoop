import { createHash, createHmac } from "node:crypto";
import "server-only";
import type {
  AssuranceWormRuntime,
  WormDestinationPreflight,
  WormDestinationSpec,
} from "~~/lib/tokenless/assuranceWormExports";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export type S3CompatibleCredential = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

function hexSha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function digest(value: string | Uint8Array) {
  return `sha256:${hexSha256(value)}`;
}

function hmac(key: string | Uint8Array, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function timestamp(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function awsEncode(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodePath(value: string) {
  return value.split("/").map(awsEncode).join("/");
}

function credential(value: S3CompatibleCredential) {
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
      "S3 credential reference could not be resolved.",
      503,
      "worm_credential_unavailable",
    );
  }
  return value;
}

function xmlValue(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "iu"));
  return match?.[1]?.trim() ?? null;
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

async function signedRequest(input: {
  method: "GET" | "HEAD" | "PUT";
  spec: WormDestinationSpec;
  credential: S3CompatibleCredential;
  fetch: FetchLike;
  now: Date;
  query?: Record<string, string>;
  objectKey?: string;
  body?: Uint8Array;
  headers?: Record<string, string>;
}) {
  const endpoint = new URL(input.spec.endpointOrigin);
  const pathname = `/${encodePath(input.spec.bucketName)}${input.objectKey ? `/${encodePath(input.objectKey)}` : ""}`;
  const query = Object.entries(input.query ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
    .join("&");
  const url = new URL(pathname, endpoint);
  if (query) url.search = query;
  const body = input.body ?? new Uint8Array();
  const payloadHash = hexSha256(body);
  const amzDate = timestamp(input.now);
  const dateStamp = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...input.headers,
  };
  if (input.credential.sessionToken) headers["x-amz-security-token"] = input.credential.sessionToken;
  const canonical = canonicalHeaders(headers);
  const canonicalRequest = [input.method, pathname, query, canonical.value, canonical.names, payloadHash].join("\n");
  const scope = `${dateStamp}/${input.spec.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, hexSha256(canonicalRequest)].join("\n");
  const dateKey = hmac(`AWS4${input.credential.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, input.spec.region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.credential.accessKeyId}/${scope}, SignedHeaders=${canonical.names}, Signature=${signature}`;
  const response = await input.fetch(url, {
    method: input.method,
    headers,
    body: input.method === "PUT" ? body : undefined,
    cache: "no-store",
    redirect: "error",
  });
  const responseBody = input.method === "HEAD" ? "" : await response.text();
  if (!response.ok) {
    throw new TokenlessServiceError(
      `S3 Object Lock provider rejected ${input.method} ${Object.keys(input.query ?? {}).join(",") || "object"}.`,
      response.status >= 500 ? 503 : 422,
      "worm_provider_rejected",
      response.status >= 500,
    );
  }
  return { response, body: responseBody };
}

/**
 * Creates a dependency-light S3-compatible Object Lock adapter. The resolver is
 * the only boundary allowed to turn an opaque `sec_…` reference into live
 * credentials; credentials never enter destination records, jobs, receipts, or
 * provider evidence.
 */
export function createS3CompatibleWormRuntime(input: {
  resolveCredential: (reference: string) => Promise<S3CompatibleCredential>;
  fetch?: FetchLike;
  now?: () => Date;
  verifySettlementReceipt?: AssuranceWormRuntime["verifySettlementReceipt"];
}): AssuranceWormRuntime {
  const fetcher = input.fetch ?? fetch;
  const currentTime = input.now ?? (() => new Date());
  return {
    async inspectDestination(spec) {
      const resolved = credential(await input.resolveCredential(spec.credentialReference));
      const checkedAt = currentTime();
      const [versioning, objectLock] = await Promise.all([
        signedRequest({
          method: "GET",
          spec,
          credential: resolved,
          fetch: fetcher,
          now: checkedAt,
          query: { versioning: "" },
        }),
        signedRequest({
          method: "GET",
          spec,
          credential: resolved,
          fetch: fetcher,
          now: checkedAt,
          query: { "object-lock": "" },
        }),
      ]);
      const status = xmlValue(versioning.body, "Status");
      const lockEnabled = xmlValue(objectLock.body, "ObjectLockEnabled");
      const mode = xmlValue(objectLock.body, "Mode");
      const days = Number(xmlValue(objectLock.body, "Days") ?? "0");
      const years = Number(xmlValue(objectLock.body, "Years") ?? "0");
      const defaultRetentionDays = Number.isSafeInteger(days) && days > 0 ? days : years * 365;
      return {
        schemaVersion: "rateloop.assurance-worm-preflight.v1",
        checkedAt: checkedAt.toISOString(),
        versioning: status === "Enabled" ? "Enabled" : (status as WormDestinationPreflight["versioning"]),
        objectLockEnabled: lockEnabled === "Enabled" ? true : (false as true),
        defaultRetention: {
          mode: mode === "COMPLIANCE" ? "COMPLIANCE" : (mode as "COMPLIANCE"),
          days: defaultRetentionDays,
        },
        providerEvidenceDigest: digest(JSON.stringify({ objectLock: objectLock.body, versioning: versioning.body })),
      };
    },
    async putLockedObject(object) {
      const resolved = credential(await input.resolveCredential(object.spec.credentialReference));
      const uploaded = await signedRequest({
        method: "PUT",
        spec: object.spec,
        credential: resolved,
        fetch: fetcher,
        now: currentTime(),
        objectKey: object.objectKey,
        body: object.body,
        headers: {
          "content-type": "application/json",
          "x-amz-checksum-sha256": object.checksumSha256Base64,
          "x-amz-meta-rateloop-idempotency": object.idempotencyKey,
          "x-amz-object-lock-mode": "COMPLIANCE",
          "x-amz-object-lock-retain-until-date": object.retentionUntil,
        },
      });
      const versionId = uploaded.response.headers.get("x-amz-version-id");
      if (!versionId) {
        return {
          objectVersionId: "",
          etag: "",
          checksumSha256: "",
          objectLockMode: "" as "COMPLIANCE",
          retentionUntil: "",
        };
      }
      const verified = await signedRequest({
        method: "HEAD",
        spec: object.spec,
        credential: resolved,
        fetch: fetcher,
        now: currentTime(),
        objectKey: object.objectKey,
        query: { versionId },
        headers: { "x-amz-checksum-mode": "ENABLED" },
      });
      const verifiedVersionId = verified.response.headers.get("x-amz-version-id");
      const etag = verified.response.headers.get("etag");
      const checksumBase64 = verified.response.headers.get("x-amz-checksum-sha256");
      const retentionUntil = verified.response.headers.get("x-amz-object-lock-retain-until-date");
      const lockMode = verified.response.headers.get("x-amz-object-lock-mode");
      let returnedChecksum = "";
      try {
        returnedChecksum = checksumBase64 ? `sha256:${Buffer.from(checksumBase64, "base64").toString("hex")}` : "";
      } catch {
        returnedChecksum = "";
      }
      return {
        objectVersionId: verifiedVersionId === versionId ? versionId : "",
        etag: etag ?? "",
        checksumSha256: returnedChecksum,
        objectLockMode: lockMode === "COMPLIANCE" ? "COMPLIANCE" : (lockMode as "COMPLIANCE"),
        retentionUntil: retentionUntil ?? "",
      };
    },
    verifySettlementReceipt: input.verifySettlementReceipt,
  };
}

export const __assuranceWormS3TestUtils = { canonicalHeaders, encodePath, signedRequest, timestamp, xmlValue };
