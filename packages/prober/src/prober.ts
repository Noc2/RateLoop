import { RaterDeclarationRegistryAbi } from "@rateloop/contracts/abis";
import type { Account, Address, Chain, PublicClient, WalletClient } from "viem";
import { buildBehavioralDriftArtifact, buildProbeResultArtifact, type ProbeArtifactStore } from "./artifacts.js";
import { config } from "./config.js";
import type { ProbeDetectorPipeline } from "./detectors/types.js";
import type { Logger } from "./logger.js";
import { readProbeState, type PendingProbeTracker } from "./registry.js";
import type { ProberRunResult } from "./types.js";

type ProberPublicClient = Pick<PublicClient, "waitForTransactionReceipt" | "readContract" | "getLogs" | "getBlockNumber" | "getCode">;
type ProberWalletClient = Pick<WalletClient, "writeContract">;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function writeContractAndConfirm(
  publicClient: Pick<PublicClient, "waitForTransactionReceipt">,
  walletClient: ProberWalletClient,
  request: Parameters<WalletClient["writeContract"]>[0],
): Promise<`0x${string}`> {
  if (!request.gas && config.maxGasPerTx > 0) {
    request.gas = BigInt(config.maxGasPerTx);
  }

  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") {
    throw new Error(`Transaction ${hash} reverted on-chain`);
  }

  return hash;
}

export async function runProberCycle(params: {
  publicClient: ProberPublicClient;
  walletClient: ProberWalletClient;
  chain: Chain;
  account: Account;
  logger: Logger;
  tracker: PendingProbeTracker;
  detectorPipeline: ProbeDetectorPipeline;
  artifactStore: ProbeArtifactStore;
}): Promise<ProberRunResult> {
  const registryAddress = config.contracts.raterDeclarationRegistry;
  const scanState = await params.tracker.scan(params.publicClient, registryAddress);
  const candidates = params.tracker.claim(config.maxCandidatesPerTick);

  const result: ProberRunResult = {
    candidatesDiscovered: scanState.discoveredCandidates,
    candidatesProcessed: 0,
    candidatesSkipped: 0,
    probeResultsRecorded: 0,
    driftFlagsRecorded: 0,
    failedDetections: 0,
    pendingCount: scanState.pendingCount,
    latestBlock: scanState.latestBlock,
    lastScannedBlock: scanState.lastScannedBlock,
  };

  for (const candidate of candidates) {
    try {
      const { storedDeclaration, latestProbeResult } = await readProbeState(
        params.publicClient,
        registryAddress,
        candidate.rater,
      );

      if (!storedDeclaration.probePending) {
        result.candidatesSkipped++;
        params.logger.debug("Skipping cleared probe candidate", {
          rater: candidate.rater,
          hintVersion: candidate.hintVersion,
          source: candidate.source,
        });
        continue;
      }

      const evaluation = await params.detectorPipeline.evaluate({
        candidate,
        storedDeclaration,
        latestProbeResult,
        detectorBundleHash: config.detectorBundleHash,
        probeLibraryHash: config.probeLibraryHash,
      });

      const probeArtifact = buildProbeResultArtifact({
        candidate,
        storedDeclaration,
        latestProbeResult,
        evaluation,
        detectorBundleHash: config.detectorBundleHash,
        probeLibraryHash: config.probeLibraryHash,
      });
      await params.artifactStore.store(probeArtifact);

      const resultTxHash = await writeContractAndConfirm(params.publicClient, params.walletClient, {
        account: params.account,
        chain: params.chain,
        address: registryAddress,
        abi: RaterDeclarationRegistryAbi,
        functionName: "recordProbeResult",
        args: [
          storedDeclaration.declaration.rater,
          storedDeclaration.declaration.version,
          config.probeLibraryHash,
          evaluation.confidenceBps,
          evaluation.passed,
          probeArtifact.hash,
        ],
      });

      result.candidatesProcessed++;
      result.probeResultsRecorded++;

      params.logger.info("Recorded probe result", {
        rater: storedDeclaration.declaration.rater,
        operator: storedDeclaration.declaration.operator,
        version: storedDeclaration.declaration.version,
        passed: evaluation.passed,
        confidenceBps: evaluation.confidenceBps,
        resultHash: probeArtifact.hash,
        txHash: resultTxHash,
      });

      if ((evaluation.driftScoreBps ?? 0) > 0) {
        try {
          const driftArtifact = buildBehavioralDriftArtifact({
            candidate,
            storedDeclaration,
            evaluation,
            detectorBundleHash: config.detectorBundleHash,
            probeLibraryHash: config.probeLibraryHash,
          });
          await params.artifactStore.store(driftArtifact);

          const driftTxHash = await writeContractAndConfirm(params.publicClient, params.walletClient, {
            account: params.account,
            chain: params.chain,
            address: registryAddress,
            abi: RaterDeclarationRegistryAbi,
            functionName: "flagBehavioralDrift",
            args: [
              storedDeclaration.declaration.rater,
              storedDeclaration.declaration.version,
              evaluation.driftScoreBps ?? 0,
              driftArtifact.hash,
            ],
          });

          result.driftFlagsRecorded++;
          params.logger.warn("Flagged behavioral drift", {
            rater: storedDeclaration.declaration.rater,
            operator: storedDeclaration.declaration.operator,
            version: storedDeclaration.declaration.version,
            driftScoreBps: evaluation.driftScoreBps ?? 0,
            evidenceHash: driftArtifact.hash,
            txHash: driftTxHash,
          });
        } catch (error) {
          result.failedDetections++;
          params.logger.error("Failed to flag behavioral drift", {
            rater: storedDeclaration.declaration.rater,
            version: storedDeclaration.declaration.version,
            error: errorMessage(error),
          });
        }
      }
    } catch (error) {
      result.failedDetections++;
      params.tracker.requeue(candidate);
      params.logger.error("Failed to process probe candidate", {
        rater: candidate.rater,
        hintVersion: candidate.hintVersion,
        source: candidate.source,
        error: errorMessage(error),
      });
    }
  }

  result.pendingCount = params.tracker.pendingCount();
  return result;
}
