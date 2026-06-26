import { canonicalJson, canonicalJsonHash } from "@rateloop/node-utils/json";
import { ponder } from "ponder:registry";
import { correlationEpochSnapshot, payoutArtifactCache, roundPayoutSnapshot } from "ponder:schema";
import type { Hex } from "viem";

const SNAPSHOT_STATUS = {
  Proposed: 1,
  Challenged: 2,
  Finalized: 3,
  Rejected: 4,
} as const;

const ARTIFACT_FETCH_TIMEOUT_MS = 5_000;
const ARTIFACT_MAX_BYTES = 10_000_000;
const DATA_URI_PREFIX = "data:";
const DATA_URI_BASE64_MAX_BYTES = Math.ceil(ARTIFACT_MAX_BYTES / 3) * 4;
const DATA_URI_PERCENT_ENCODED_MAX_BYTES = ARTIFACT_MAX_BYTES * 3;
const httpsArtifactAllowlist = parseHttpsArtifactAllowlist(
  process.env.PAYOUT_ARTIFACT_HTTPS_ALLOWLIST ?? process.env.KEEPER_ARTIFACT_HTTPS_ALLOWLIST ?? "",
);

function readFrontendOperator(args: Record<string, unknown>): `0x${string}` {
  return (args.frontendOperator ?? args.proposer) as `0x${string}`;
}

function readProposer(args: Record<string, unknown>): `0x${string}` {
  return (args.proposer ?? args.frontendOperator) as `0x${string}`;
}

async function cachePayoutArtifact(params: {
  context: { db: any };
  artifactHash: Hex;
  artifactURI: string;
  timestamp: bigint;
}) {
  try {
    const canonical = await readVerifiedArtifactCanonicalJson(
      params.artifactURI,
      params.artifactHash,
    );
    if (!canonical) return;

    await params.context.db
      .insert(payoutArtifactCache)
      .values({
        artifactHash: params.artifactHash,
        artifactUri: params.artifactURI,
        canonicalJson: canonical,
        byteLength: Buffer.byteLength(canonical),
        firstSeenAt: params.timestamp,
        lastFetchedAt: params.timestamp,
        updatedAt: params.timestamp,
      })
      .onConflictDoUpdate({
        artifactUri: params.artifactURI,
        canonicalJson: canonical,
        byteLength: Buffer.byteLength(canonical),
        lastFetchedAt: params.timestamp,
        updatedAt: params.timestamp,
      });
  } catch (error) {
    console.warn(
      `[ClusterPayoutOracle] Failed to cache payout artifact ${params.artifactHash} from ${formatArtifactUriForLog(params.artifactURI)}:`,
      error,
    );
  }
}

async function readVerifiedArtifactCanonicalJson(
  artifactURI: string,
  artifactHash: Hex,
): Promise<string | null> {
  const artifact = await readArtifactJson(artifactURI);
  if (!artifact) return null;
  const actualHash = canonicalJsonHash(artifact);
  if (actualHash.toLowerCase() !== artifactHash.toLowerCase()) {
    return null;
  }
  return canonicalJson(artifact);
}

async function readArtifactJson(uri: string): Promise<unknown | null> {
  const normalizedUri = normalizeArtifactUri(uri);
  if (!normalizedUri) return null;
  if (normalizedUri.startsWith(DATA_URI_PREFIX)) {
    return JSON.parse(readDataUri(normalizedUri));
  }

  const response = await fetch(normalizedUri, {
    signal: AbortSignal.timeout(ARTIFACT_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const parsed = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsed) && parsed > ARTIFACT_MAX_BYTES) return null;
  }
  if (!response.body) return response.json();

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const reader = response.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > ARTIFACT_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(combined));
}

function normalizeArtifactUri(uri: string): string | null {
  const value = uri.trim();
  if (!value) return null;
  if (value.startsWith(DATA_URI_PREFIX)) return value;
  if (value.startsWith("https://")) {
    return isAllowedHttpsArtifactUrl(value) ? value : null;
  }
  if (value.startsWith("http://")) {
    return isAllowedLocalHttpArtifactUrl(value) ? value : null;
  }
  if (value.startsWith("ipfs://")) {
    const gatewayUri = `https://ipfs.io/ipfs/${value.slice("ipfs://".length)}`;
    return isAllowedHttpsArtifactUrl(gatewayUri) ? gatewayUri : null;
  }
  if (value.startsWith("ar://")) {
    const gatewayUri = `https://arweave.net/${value.slice("ar://".length)}`;
    return isAllowedHttpsArtifactUrl(gatewayUri) ? gatewayUri : null;
  }
  return null;
}

function readDataUri(uri: string): string {
  const commaIndex = uri.indexOf(",");
  if (commaIndex < 0) {
    throw new Error("Invalid data URI");
  }
  const metadata = uri.slice(DATA_URI_PREFIX.length, commaIndex);
  const payload = uri.slice(commaIndex + 1);
  const metadataParts = metadata.split(";").filter(Boolean);
  const mediaType = metadataParts[0]?.toLowerCase() ?? "";
  const isBase64 = metadataParts.some((part) => part.toLowerCase() === "base64");
  if (mediaType && mediaType !== "application/json" && !mediaType.endsWith("+json")) {
    throw new Error("Payout artifact data URI must contain JSON");
  }
  const encodedBytes = Buffer.byteLength(payload, "utf8");
  if (encodedBytes > (isBase64 ? DATA_URI_BASE64_MAX_BYTES : DATA_URI_PERCENT_ENCODED_MAX_BYTES)) {
    throw new Error(`Payout artifact data URI exceeds ${ARTIFACT_MAX_BYTES} decoded bytes`);
  }
  const decoded = isBase64
    ? Buffer.from(payload, "base64").toString("utf8")
    : decodeURIComponent(payload);
  if (Buffer.byteLength(decoded, "utf8") > ARTIFACT_MAX_BYTES) {
    throw new Error(`Payout artifact data URI exceeded ${ARTIFACT_MAX_BYTES} decoded bytes`);
  }
  return decoded;
}

function parseHttpsArtifactAllowlist(value: string): URL[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      try {
        const url = new URL(entry);
        return url.protocol === "https:" ? [url] : [];
      } catch {
        return [];
      }
    });
}

function isAllowedHttpsArtifactUrl(value: string): boolean {
  let artifactUrl: URL;
  try {
    artifactUrl = new URL(value);
  } catch {
    return false;
  }
  if (artifactUrl.protocol !== "https:") return false;
  return httpsArtifactAllowlist.some((allowedUrl) => {
    if (artifactUrl.origin !== allowedUrl.origin) return false;
    const allowedPath = stripTrailingSlash(allowedUrl.pathname);
    if (allowedPath === "") return true;
    const artifactPath = stripTrailingSlash(artifactUrl.pathname);
    return artifactPath === allowedPath || artifactPath.startsWith(`${allowedPath}/`);
  });
}

function isAllowedLocalHttpArtifactUrl(value: string): boolean {
  if (!shouldAllowLocalHttpArtifacts()) return false;

  let artifactUrl: URL;
  try {
    artifactUrl = new URL(value);
  } catch {
    return false;
  }
  if (artifactUrl.protocol !== "http:") return false;
  if (artifactUrl.username || artifactUrl.password) return false;

  return (
    artifactUrl.hostname === "localhost" ||
    artifactUrl.hostname === "127.0.0.1" ||
    artifactUrl.hostname === "[::1]"
  );
}

function shouldAllowLocalHttpArtifacts(): boolean {
  return process.env.PONDER_NETWORK === "hardhat";
}

function stripTrailingSlash(value: string): string {
  return value === "/" ? "" : value.replace(/\/+$/u, "");
}

function formatArtifactUriForLog(value: string): string {
  return value.length <= 240 ? value : `${value.slice(0, 240)}... (${value.length} chars)`;
}

ponder.on(
  "ClusterPayoutOracle:CorrelationEpochProposed",
  async ({ event, context }) => {
    const {
      epochId,
      fromRoundId,
      toRoundId,
      clusterRoot,
      parameterHash,
      artifactHash,
      artifactURI,
    } = event.args;
    const frontendOperator = readFrontendOperator(event.args);
    const proposer = readProposer(event.args);

    await context.db
      .insert(correlationEpochSnapshot)
      .values({
        id: epochId,
        fromRoundId,
        toRoundId,
        proposer,
        frontendOperator,
        challenger: null,
        clusterRoot,
        parameterHash,
        artifactHash,
        artifactUri: artifactURI,
        status: SNAPSHOT_STATUS.Proposed,
        proposedAt: event.block.timestamp,
        finalizedAt: null,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate({
        fromRoundId,
        toRoundId,
        proposer,
        frontendOperator,
        challenger: null,
        clusterRoot,
        parameterHash,
        artifactHash,
        artifactUri: artifactURI,
        status: SNAPSHOT_STATUS.Proposed,
        proposedAt: event.block.timestamp,
        finalizedAt: null,
        updatedAt: event.block.timestamp,
      });
    await cachePayoutArtifact({
      context,
      artifactHash,
      artifactURI,
      timestamp: event.block.timestamp,
    });
  },
);

ponder.on(
  "ClusterPayoutOracle:CorrelationEpochChallenged",
  async ({ event, context }) => {
    const { epochId, challenger } = event.args;

    await context.db.update(correlationEpochSnapshot, { id: epochId }).set({
      challenger,
      status: SNAPSHOT_STATUS.Challenged,
      updatedAt: event.block.timestamp,
    });
  },
);

ponder.on(
  "ClusterPayoutOracle:CorrelationEpochFinalized",
  async ({ event, context }) => {
    const { epochId } = event.args;

    await context.db.update(correlationEpochSnapshot, { id: epochId }).set({
      status: SNAPSHOT_STATUS.Finalized,
      finalizedAt: event.block.timestamp,
      updatedAt: event.block.timestamp,
    });
  },
);

ponder.on(
  "ClusterPayoutOracle:CorrelationEpochRejected",
  async ({ event, context }) => {
    const { epochId } = event.args;

    await context.db.update(correlationEpochSnapshot, { id: epochId }).set({
      status: SNAPSHOT_STATUS.Rejected,
      updatedAt: event.block.timestamp,
    });
  },
);

ponder.on(
  "ClusterPayoutOracle:RoundPayoutSnapshotProposed",
  async ({ event, context }) => {
    const {
      snapshotKey,
      domain,
      rewardPoolId,
      contentId,
      roundId,
      correlationEpochId,
      rawEligibleVoters,
      effectiveParticipantUnits,
      totalClaimWeight,
      weightRoot,
      reasonRoot,
      artifactHash,
      artifactURI,
    } = event.args;
    const frontendOperator = readFrontendOperator(event.args);
    const proposer = readProposer(event.args);

    await context.db
      .insert(roundPayoutSnapshot)
      .values({
        id: snapshotKey,
        domain: Number(domain),
        rewardPoolId,
        contentId,
        roundId,
        correlationEpochId,
        proposer,
        frontendOperator,
        challenger: null,
        rawEligibleVoters: Number(rawEligibleVoters),
        effectiveParticipantUnits: Number(effectiveParticipantUnits),
        totalClaimWeight,
        weightRoot,
        reasonRoot,
        artifactHash,
        artifactUri: artifactURI,
        status: SNAPSHOT_STATUS.Proposed,
        proposedAt: event.block.timestamp,
        finalizedAt: null,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate({
        domain: Number(domain),
        rewardPoolId,
        contentId,
        roundId,
        correlationEpochId,
        proposer,
        frontendOperator,
        challenger: null,
        rawEligibleVoters: Number(rawEligibleVoters),
        effectiveParticipantUnits: Number(effectiveParticipantUnits),
        totalClaimWeight,
        weightRoot,
        reasonRoot,
        artifactHash,
        artifactUri: artifactURI,
        status: SNAPSHOT_STATUS.Proposed,
        proposedAt: event.block.timestamp,
        finalizedAt: null,
        updatedAt: event.block.timestamp,
      });
    await cachePayoutArtifact({
      context,
      artifactHash,
      artifactURI,
      timestamp: event.block.timestamp,
    });
  },
);

ponder.on(
  "ClusterPayoutOracle:RoundPayoutSnapshotChallenged",
  async ({ event, context }) => {
    const { snapshotKey, challenger } = event.args;

    await context.db.update(roundPayoutSnapshot, { id: snapshotKey }).set({
      challenger,
      status: SNAPSHOT_STATUS.Challenged,
      updatedAt: event.block.timestamp,
    });
  },
);

ponder.on(
  "ClusterPayoutOracle:RoundPayoutSnapshotFinalized",
  async ({ event, context }) => {
    const { snapshotKey } = event.args;

    await context.db.update(roundPayoutSnapshot, { id: snapshotKey }).set({
      status: SNAPSHOT_STATUS.Finalized,
      finalizedAt: event.block.timestamp,
      updatedAt: event.block.timestamp,
    });
  },
);

ponder.on(
  "ClusterPayoutOracle:RoundPayoutSnapshotRejected",
  async ({ event, context }) => {
    const { snapshotKey } = event.args;

    await context.db.update(roundPayoutSnapshot, { id: snapshotKey }).set({
      status: SNAPSHOT_STATUS.Rejected,
      updatedAt: event.block.timestamp,
    });
  },
);
