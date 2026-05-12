import { RaterDeclarationRegistryAbi } from "@rateloop/contracts/abis";
import type { AbiEvent, Address, Hex, PublicClient } from "viem";
import type { Logger } from "./logger.js";
import {
  ZERO_HASH,
  type LatestProbeResultState,
  type ProbeCandidateHint,
  type ProbeCandidateSource,
  type ProbeScanState,
  type StoredDeclarationState,
} from "./types.js";

type RegistryClient = Pick<PublicClient, "getBlockNumber" | "getLogs" | "readContract" | "getCode">;

export interface PendingProbeTrackerConfig {
  startBlock: number;
  recentBlockLookback: number;
  declarationScanBatchBlocks: number;
}

export interface PendingProbeTracker {
  scan(client: RegistryClient, registryAddress: Address): Promise<ProbeScanState>;
  claim(limit: number): ProbeCandidateHint[];
  requeue(candidate: ProbeCandidateHint): void;
  pendingCount(): number;
}

const SOURCE_PRIORITY: Record<ProbeCandidateSource, number> = {
  "declaration-scan": 0,
  "recent-declaration": 1,
  "probe-requested": 2,
};

function getEvent(name: string): AbiEvent {
  const event = RaterDeclarationRegistryAbi.find(
    item => item.type === "event" && item.name === name,
  ) as AbiEvent | undefined;
  if (!event) {
    throw new Error(`Missing ${name} event in RaterDeclarationRegistry ABI`);
  }

  return event;
}

const declarationSubmittedEvent = getEvent("DeclarationSubmitted");
const probeRequestedEvent = getEvent("ProbeRequested");

function toBigIntValue(value: bigint | number | string | undefined): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string" && value.length > 0) return BigInt(value);
  return 0n;
}

function toNumberValue(value: bigint | number | string | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.length > 0) return Number(value);
  return 0;
}

function tupleField<T>(value: any, name: string, index: number): T {
  return (value?.[name] ?? value?.[index]) as T;
}

function normalizeStoredDeclaration(raw: any): StoredDeclarationState {
  const declaration = tupleField<any>(raw, "declaration", 0);

  return {
    declaration: {
      rater: tupleField<Address>(declaration, "rater", 0),
      operator: tupleField<Address>(declaration, "operator", 1),
      modelClass: toNumberValue(tupleField<number | bigint>(declaration, "modelClass", 2)),
      modelId: tupleField<Hex>(declaration, "modelId", 3),
      provider: tupleField<Hex>(declaration, "provider", 4),
      endpointHint: tupleField<Hex>(declaration, "endpointHint", 5),
      promptTemplateHash: tupleField<Hex>(declaration, "promptTemplateHash", 6),
      retrievalConfigHash: tupleField<Hex>(declaration, "retrievalConfigHash", 7),
      toolingHash: tupleField<Hex>(declaration, "toolingHash", 8),
      version: toNumberValue(tupleField<number | bigint>(declaration, "version", 9)),
      effectiveEpoch: toBigIntValue(tupleField<bigint | number>(declaration, "effectiveEpoch", 10)),
      expiresAtEpoch: toBigIntValue(tupleField<bigint | number>(declaration, "expiresAtEpoch", 11)),
      disclosure: toNumberValue(tupleField<number | bigint>(declaration, "disclosure", 12)),
      nonce: toBigIntValue(tupleField<bigint | number>(declaration, "nonce", 13)),
    },
    tier: toNumberValue(tupleField<number | bigint>(raw, "tier", 1)),
    declaredAt: toBigIntValue(tupleField<bigint | number>(raw, "declaredAt", 2)),
    probePending: Boolean(tupleField<boolean>(raw, "probePending", 3)),
    declarationHash: tupleField<Hex>(raw, "declarationHash", 4) ?? ZERO_HASH,
    lastProbeResultHash: tupleField<Hex>(raw, "lastProbeResultHash", 5) ?? ZERO_HASH,
  };
}

function normalizeLatestProbeResult(raw: any): LatestProbeResultState {
  return {
    probeLibraryHash: tupleField<Hex>(raw, "probeLibraryHash", 0) ?? ZERO_HASH,
    resultHash: tupleField<Hex>(raw, "resultHash", 1) ?? ZERO_HASH,
    confidenceBps: toNumberValue(tupleField<number | bigint>(raw, "confidenceBps", 2)),
    recordedAt: toBigIntValue(tupleField<bigint | number>(raw, "recordedAt", 3)),
    passed: Boolean(tupleField<boolean>(raw, "passed", 4)),
  };
}

function compareCandidates(left: ProbeCandidateHint, right: ProbeCandidateHint): number {
  const priorityDelta = SOURCE_PRIORITY[right.source] - SOURCE_PRIORITY[left.source];
  if (priorityDelta !== 0) return priorityDelta;

  const leftBlock = left.discoveredAtBlock ?? 0n;
  const rightBlock = right.discoveredAtBlock ?? 0n;
  if (leftBlock !== rightBlock) return leftBlock > rightBlock ? -1 : 1;

  const leftVersion = left.hintVersion ?? 0;
  const rightVersion = right.hintVersion ?? 0;
  if (leftVersion !== rightVersion) return rightVersion - leftVersion;

  return left.rater.localeCompare(right.rater);
}

export function createPendingProbeTracker(
  trackerConfig: PendingProbeTrackerConfig,
  logger?: Logger,
): PendingProbeTracker {
  const startBlock = BigInt(trackerConfig.startBlock);
  const recentBlockLookback = BigInt(trackerConfig.recentBlockLookback);
  const declarationScanBatchBlocks = BigInt(trackerConfig.declarationScanBatchBlocks);

  const pending = new Map<string, ProbeCandidateHint>();
  let nextFullScanBlock = startBlock;
  let lastScannedBlock = startBlock > 0n ? startBlock - 1n : 0n;

  function upsertCandidate(candidate: ProbeCandidateHint): number {
    const key = candidate.rater.toLowerCase();
    const existing = pending.get(key);
    if (!existing) {
      pending.set(key, candidate);
      return 1;
    }

    if (compareCandidates(candidate, existing) < 0) {
      pending.set(key, candidate);
    }

    return 0;
  }

  function stageDeclarationLogs(logs: readonly any[], source: ProbeCandidateSource): number {
    let discovered = 0;

    for (const log of logs) {
      const args = log.args as Record<string, unknown> | undefined;
      if (!args?.rater || !args.probePending) continue;

      discovered += upsertCandidate({
        rater: args.rater as Address,
        hintVersion: toNumberValue(args.version as number | bigint | undefined),
        declarationHash: (args.declarationHash as Hex | undefined) ?? ZERO_HASH,
        source,
        discoveredAtBlock: log.blockNumber ?? 0n,
      });
    }

    return discovered;
  }

  function stageProbeRequestedLogs(logs: readonly any[]): number {
    let discovered = 0;

    for (const log of logs) {
      const args = log.args as Record<string, unknown> | undefined;
      if (!args?.rater) continue;

      discovered += upsertCandidate({
        rater: args.rater as Address,
        hintVersion: toNumberValue(args.version as number | bigint | undefined),
        declarationHash: (args.declarationHash as Hex | undefined) ?? ZERO_HASH,
        source: "probe-requested",
        discoveredAtBlock: log.blockNumber ?? 0n,
      });
    }

    return discovered;
  }

  return {
    async scan(client: RegistryClient, registryAddress: Address): Promise<ProbeScanState> {
      const latestBlock = await client.getBlockNumber();
      let discoveredCandidates = 0;

      if (nextFullScanBlock <= latestBlock) {
        const toBlock = latestBlock < nextFullScanBlock + declarationScanBatchBlocks - 1n
          ? latestBlock
          : nextFullScanBlock + declarationScanBatchBlocks - 1n;

        const fullScanLogs = await client.getLogs({
          address: registryAddress,
          event: declarationSubmittedEvent,
          fromBlock: nextFullScanBlock,
          toBlock,
        });
        discoveredCandidates += stageDeclarationLogs(fullScanLogs, "declaration-scan");
        lastScannedBlock = toBlock;
        nextFullScanBlock = toBlock + 1n;
      } else {
        lastScannedBlock = latestBlock;
      }

      const lookbackStart = latestBlock >= recentBlockLookback
        ? latestBlock - recentBlockLookback + 1n
        : 0n;
      const recentFromBlock = lookbackStart > startBlock ? lookbackStart : startBlock;

      if (recentFromBlock <= latestBlock) {
        const [recentDeclarationLogs, recentProbeLogs] = await Promise.all([
          client.getLogs({
            address: registryAddress,
            event: declarationSubmittedEvent,
            fromBlock: recentFromBlock,
            toBlock: latestBlock,
          }),
          client.getLogs({
            address: registryAddress,
            event: probeRequestedEvent,
            fromBlock: recentFromBlock,
            toBlock: latestBlock,
          }),
        ]);

        discoveredCandidates += stageDeclarationLogs(recentDeclarationLogs, "recent-declaration");
        discoveredCandidates += stageProbeRequestedLogs(recentProbeLogs);
      }

      logger?.debug("Pending probe tracker scan complete", {
        latestBlock: latestBlock.toString(),
        lastScannedBlock: lastScannedBlock.toString(),
        pendingCandidates: pending.size,
        discoveredCandidates,
      });

      return {
        discoveredCandidates,
        pendingCount: pending.size,
        latestBlock,
        lastScannedBlock,
      };
    },

    claim(limit: number): ProbeCandidateHint[] {
      const claimed = [...pending.values()].sort(compareCandidates).slice(0, limit);
      for (const candidate of claimed) {
        pending.delete(candidate.rater.toLowerCase());
      }
      return claimed;
    },

    requeue(candidate: ProbeCandidateHint) {
      upsertCandidate(candidate);
    },

    pendingCount() {
      return pending.size;
    },
  };
}

export async function readProbeState(
  client: Pick<PublicClient, "readContract">,
  registryAddress: Address,
  rater: Address,
): Promise<{ storedDeclaration: StoredDeclarationState; latestProbeResult: LatestProbeResultState }> {
  const [storedDeclarationRaw, latestProbeResultRaw] = await Promise.all([
    client.readContract({
      address: registryAddress,
      abi: RaterDeclarationRegistryAbi,
      functionName: "getDeclaration",
      args: [rater],
    }),
    client.readContract({
      address: registryAddress,
      abi: RaterDeclarationRegistryAbi,
      functionName: "getLatestProbeResult",
      args: [rater],
    }),
  ]);

  return {
    storedDeclaration: normalizeStoredDeclaration(storedDeclarationRaw),
    latestProbeResult: normalizeLatestProbeResult(latestProbeResultRaw),
  };
}

export async function validateProberContracts(
  client: Pick<PublicClient, "getCode" | "readContract">,
  registryAddress: Address,
  roleWallet: Address,
): Promise<{ probeRole: Hex }> {
  const code = await client.getCode({ address: registryAddress });
  if (!code || code === "0x") {
    throw new Error(`No contract code found at RATER_DECLARATION_REGISTRY_ADDRESS ${registryAddress}.`);
  }

  const probeRole = await client.readContract({
    address: registryAddress,
    abi: RaterDeclarationRegistryAbi,
    functionName: "PROBE_ROLE",
  });
  const hasRole = await client.readContract({
    address: registryAddress,
    abi: RaterDeclarationRegistryAbi,
    functionName: "hasRole",
    args: [probeRole, roleWallet],
  });

  if (!hasRole) {
    throw new Error(`Configured signer ${roleWallet} does not have PROBE_ROLE on ${registryAddress}.`);
  }

  return { probeRole };
}
