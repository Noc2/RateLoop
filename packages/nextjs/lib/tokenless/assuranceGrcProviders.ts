import { createHash } from "node:crypto";
import "server-only";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export type GrcProvider = "drata" | "vanta";

export type DrataProviderConfig = {
  connectionId: string;
  resourceId: string;
};

export type VantaProviderConfig = {
  documentId: string;
};

export type GrcControlMapping = {
  mappingId: string;
  controlId: string;
  scopeId: string | null;
  minimumCoverageBps: number;
  requireSignedPacket: boolean;
};

export type GrcCoverageTestRecord = {
  schemaVersion: "rateloop.grc-coverage-test.v1";
  recordId: string;
  workspaceReference: string;
  mappingId: string;
  controlId: string;
  scopeReference: string | null;
  period: { start: string; end: string };
  status: "passing" | "failing" | "insufficient_data";
  opportunityCount: number;
  reviewedCount: number;
  coverageBps: number | null;
  requiredCoverageBps: number;
  signedPacketCount: number;
  signedPacketRequired: boolean;
  sourceCommitment: string;
};

export type GrcPacketDocumentEvidence = {
  schemaVersion: "rateloop.grc-packet-document-evidence.v1";
  recordId: string;
  workspaceReference: string;
  controlIds: string[];
  packetDigest: string;
  documentReference: string;
  mediaType: "application/vnd.rateloop.assurance-evidence+json";
  signatureAlgorithm: string;
  signingKeyId: string;
  generatedAt: string;
  signedPacket: Record<string, unknown>;
};

export type GrcEvidenceBundle = {
  schemaVersion: "rateloop.grc-evidence-bundle.v1";
  bundleId: string;
  generatedAt: string;
  workspaceReference: string;
  period: { start: string; end: string };
  coverageTests: GrcCoverageTestRecord[];
  documentEvidence: GrcPacketDocumentEvidence[];
  limitations: [
    "coverage_is_derived_from_rateloop_observations",
    "host_reported_provenance_is_not_independently_verified",
    "control_mapping_is_customer_configured",
  ];
  bundleDigest: string;
};

export type GrcProviderDelivery = {
  externalReference: string;
  recordCount: number;
};

export type GrcProviderAdapter = {
  provider: GrcProvider;
  deliver(input: {
    bundle: GrcEvidenceBundle;
    credential: string;
    idempotencyKey: string;
    providerConfig: DrataProviderConfig | VantaProviderConfig;
  }): Promise<GrcProviderDelivery>;
};

type Fetch = typeof fetch;
type JsonRecord = Record<string, unknown>;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u;
const DRATA_NUMERIC_ID = /^[1-9][0-9]{0,18}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const DRATA_BATCH_SIZE = 250;
const PROVIDER_TIMEOUT_MS = 8_000;

function providerSignal() {
  return AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
}

export function canonicalGrcJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalGrcJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalGrcJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("GRC evidence must be JSON serializable.");
  return encoded;
}

export function grcSha256(value: unknown) {
  const input = typeof value === "string" ? value : canonicalGrcJson(value);
  return `sha256:${createHash("sha256").update(input).digest("hex")}` as const;
}

function exactObject(value: unknown, allowed: readonly string[], code = "invalid_grc_connector") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError("Connector configuration must be a JSON object.", 400, code);
  }
  const record = value as JsonRecord;
  if (Object.keys(record).some(key => !allowed.includes(key))) {
    throw new TokenlessServiceError("Connector configuration contains unsupported fields.", 400, code);
  }
  return record;
}

function requiredIdentifier(value: unknown, name: string) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new TokenlessServiceError(`${name} is invalid.`, 400, "invalid_grc_connector");
  }
  return value;
}

export function parseGrcProviderConfig(
  provider: GrcProvider,
  value: unknown,
): DrataProviderConfig | VantaProviderConfig {
  if (provider === "drata") {
    const config = exactObject(value, ["connectionId", "resourceId"]);
    if (!DRATA_NUMERIC_ID.test(String(config.connectionId)) || !DRATA_NUMERIC_ID.test(String(config.resourceId))) {
      throw new TokenlessServiceError(
        "Drata connectionId and resourceId must be positive numeric identifiers.",
        400,
        "invalid_grc_connector",
      );
    }
    return { connectionId: String(config.connectionId), resourceId: String(config.resourceId) };
  }
  const config = exactObject(value, ["documentId"]);
  return { documentId: requiredIdentifier(config.documentId, "Vanta documentId") };
}

export function parseGrcControlMappings(value: unknown): GrcControlMapping[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new TokenlessServiceError("Between one and 100 control mappings are required.", 400, "invalid_grc_connector");
  }
  const mappingIds = new Set<string>();
  return value.map(entry => {
    const mapping = exactObject(entry, [
      "mappingId",
      "controlId",
      "scopeId",
      "minimumCoverageBps",
      "requireSignedPacket",
    ]);
    const mappingId = requiredIdentifier(mapping.mappingId, "mappingId");
    if (mappingIds.has(mappingId)) {
      throw new TokenlessServiceError("Control mapping identifiers must be unique.", 400, "invalid_grc_connector");
    }
    mappingIds.add(mappingId);
    const scopeId =
      mapping.scopeId === null || mapping.scopeId === undefined ? null : requiredIdentifier(mapping.scopeId, "scopeId");
    if (
      !Number.isSafeInteger(mapping.minimumCoverageBps) ||
      Number(mapping.minimumCoverageBps) < 0 ||
      Number(mapping.minimumCoverageBps) > 10_000 ||
      typeof mapping.requireSignedPacket !== "boolean"
    ) {
      throw new TokenlessServiceError("Control mapping thresholds are invalid.", 400, "invalid_grc_connector");
    }
    return {
      mappingId,
      controlId: requiredIdentifier(mapping.controlId, "controlId"),
      scopeId,
      minimumCoverageBps: Number(mapping.minimumCoverageBps),
      requireSignedPacket: mapping.requireSignedPacket,
    };
  });
}

function retryableHttpStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

async function expectProviderResponse(response: Response, provider: GrcProvider, operation: string) {
  if (response.ok) return response;
  const retryable = retryableHttpStatus(response.status);
  throw new TokenlessServiceError(
    `${provider} ${operation} failed with HTTP ${response.status}.`,
    retryable ? 503 : 422,
    `${provider}_grc_delivery_failed`,
    retryable,
  );
}

async function providerRequest(
  fetchImpl: Fetch,
  provider: GrcProvider,
  operation: string,
  url: string,
  init: RequestInit,
) {
  try {
    return await expectProviderResponse(await fetchImpl(url, init), provider, operation);
  } catch (error) {
    if (error instanceof TokenlessServiceError) throw error;
    throw new TokenlessServiceError(
      `${provider} ${operation} could not reach the provider.`,
      503,
      `${provider}_grc_delivery_failed`,
      true,
    );
  }
}

async function optionalJson(response: Response): Promise<JsonRecord | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return null;
  try {
    const value = (await response.json()) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
  } catch {
    return null;
  }
}

function arrayAt(value: unknown, ...path: string[]): unknown[] {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return [];
    current = (current as JsonRecord)[key];
  }
  return Array.isArray(current) ? current : [];
}

function drataRecord(value: GrcCoverageTestRecord | GrcPacketDocumentEvidence) {
  if (value.schemaVersion === "rateloop.grc-coverage-test.v1") {
    return {
      id: value.recordId,
      displayName: `RateLoop oversight coverage — ${value.controlId}`,
      recordType: "oversight_coverage_test",
      schemaVersion: value.schemaVersion,
      controlIds: [value.controlId],
      periodStart: value.period.start,
      periodEnd: value.period.end,
      status: value.status,
      payload: value,
    };
  }
  return {
    id: value.recordId,
    displayName: `RateLoop signed evidence — ${value.packetDigest.slice(7, 19)}`,
    recordType: "signed_packet_document_evidence",
    schemaVersion: value.schemaVersion,
    controlIds: value.controlIds,
    periodStart: value.generatedAt,
    periodEnd: value.generatedAt,
    status: "available",
    payload: value,
  };
}

export function createDrataGrcAdapter(fetchImpl: Fetch = fetch): GrcProviderAdapter {
  return {
    provider: "drata",
    async deliver(input) {
      const config = parseGrcProviderConfig("drata", input.providerConfig) as DrataProviderConfig;
      const sessionId = `rl_${createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 40)}`;
      const base = `https://public-api.drata.com/public/v2/custom-connections/${config.connectionId}/resources/${config.resourceId}`;
      const headers = { Authorization: `Bearer ${input.credential}`, Accept: "application/json" };
      const sessionsResponse = await providerRequest(fetchImpl, "drata", "session lookup", `${base}/sessions`, {
        method: "GET",
        headers,
        redirect: "error",
        signal: providerSignal(),
      });
      const sessionsJson = await optionalJson(sessionsResponse);
      const sessions = [...arrayAt(sessionsJson, "data"), ...arrayAt(sessionsJson, "results", "data")] as JsonRecord[];
      const existing = sessions.find(session => String(session.sessionId ?? session.id) === sessionId);
      if (String(existing?.status).toUpperCase() !== "ACTIVE") {
        const records = [...input.bundle.coverageTests, ...input.bundle.documentEvidence].map(drataRecord);
        for (let index = 0; index < records.length; index += DRATA_BATCH_SIZE) {
          await providerRequest(fetchImpl, "drata", "session upload", `${base}/sessions/${sessionId}`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: canonicalGrcJson({ data: records.slice(index, index + DRATA_BATCH_SIZE) }),
            redirect: "error",
            signal: providerSignal(),
          });
        }
        await providerRequest(fetchImpl, "drata", "session completion", `${base}/sessions/${sessionId}/actions`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: canonicalGrcJson({ action: "complete" }),
          redirect: "error",
          signal: providerSignal(),
        });
      }
      return {
        externalReference: `drata:custom-connection:${config.connectionId}:${config.resourceId}:${sessionId}`,
        recordCount: input.bundle.coverageTests.length + input.bundle.documentEvidence.length,
      };
    },
  };
}

export function createVantaGrcAdapter(fetchImpl: Fetch = fetch): GrcProviderAdapter {
  return {
    provider: "vanta",
    async deliver(input) {
      const config = parseGrcProviderConfig("vanta", input.providerConfig) as VantaProviderConfig;
      const fileName = `rateloop-assurance-${input.bundle.bundleId}.json`;
      const base = `https://api.vanta.com/v1/documents/${encodeURIComponent(config.documentId)}`;
      const headers = { Authorization: `Bearer ${input.credential}`, Accept: "application/json" };
      const uploadsResponse = await providerRequest(
        fetchImpl,
        "vanta",
        "document lookup",
        `${base}/uploads?pageSize=100`,
        {
          method: "GET",
          headers,
          redirect: "error",
          signal: providerSignal(),
        },
      );
      const uploadsJson = await optionalJson(uploadsResponse);
      const uploads = [...arrayAt(uploadsJson, "results", "data"), ...arrayAt(uploadsJson, "data")] as JsonRecord[];
      let uploadId = uploads.find(upload => String(upload.fileName) === fileName)?.id;
      if (!uploadId) {
        const form = new FormData();
        form.append("file", new Blob([canonicalGrcJson(input.bundle)], { type: "application/json" }), fileName);
        form.append(
          "description",
          `RateLoop assurance evidence ${input.bundle.period.start} — ${input.bundle.period.end}`,
        );
        const uploadedResponse = await providerRequest(fetchImpl, "vanta", "document upload", `${base}/uploads`, {
          method: "POST",
          headers,
          body: form,
          redirect: "error",
          signal: providerSignal(),
        });
        const uploaded = await optionalJson(uploadedResponse);
        uploadId = uploaded?.id;
        await providerRequest(fetchImpl, "vanta", "document submit", `${base}/submit`, {
          method: "POST",
          headers,
          redirect: "error",
          signal: providerSignal(),
        });
      }
      const reference =
        typeof uploadId === "string" && IDENTIFIER.test(uploadId)
          ? `vanta:document:${config.documentId}:upload:${uploadId}`
          : `vanta:document:${config.documentId}:file:${fileName}`;
      return {
        externalReference: reference,
        recordCount: input.bundle.coverageTests.length + input.bundle.documentEvidence.length,
      };
    },
  };
}

export const DEFAULT_GRC_PROVIDER_ADAPTERS: Readonly<Record<GrcProvider, GrcProviderAdapter>> = {
  drata: createDrataGrcAdapter(),
  vanta: createVantaGrcAdapter(),
};

export const __assuranceGrcProviderTestUtils = { HASH, drataRecord };
