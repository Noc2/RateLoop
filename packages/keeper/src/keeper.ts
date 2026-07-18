import { timelockDecrypt } from "tlock-js";
import {
  hexToBytes,
  isAddressEqual,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import type { config as runtimeConfig } from "./config.js";
import { resolveTlockClientForDrandChain } from "./drand.js";
import { isExpectedPanelRaceError } from "./expected-panel-race.js";
import type { Logger } from "./logger.js";
import {
  decodeTokenlessRevealPayload,
  tokenlessPayoutCommitment,
  tokenlessRevealCommitment,
} from "./sealed-payload.js";
import {
  TokenlessFeedbackBonusAbi,
  TokenlessPanelAbi,
} from "./tokenless-abi.js";
import {
  TokenlessRoundState,
  type TokenlessCommit,
  type TokenlessKeeperResult,
  type TokenlessRevealMaterial,
  type TokenlessRound,
} from "./tokenless-types.js";

type KeeperConfig = typeof runtimeConfig;

export interface TokenlessPublicClient {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBlock(): Promise<{ timestamp: bigint }>;
  getBytecode(args: { address: Address }): Promise<Hex | undefined>;
  getBalance(args: { address: Address }): Promise<bigint>;
  readContract(args: Record<string, unknown>): Promise<unknown>;
  getLogs(args: Record<string, unknown>): Promise<
    Array<{
      args?: {
        roundId?: bigint;
        commitKey?: Hex;
        sealedPayload?: Hex;
      };
    }>
  >;
  waitForTransactionReceipt(args: { hash: Hex }): Promise<unknown>;
}

export interface TokenlessWalletClient {
  writeContract(args: Record<string, unknown>): Promise<Hex>;
}

export interface TokenlessKeeperClients {
  publicClient: TokenlessPublicClient;
  walletClient: TokenlessWalletClient;
  account: { address: Address };
}

export type RevealDecryptor = (params: {
  sealedPayload: Hex;
  beaconNetworkHash: Hex;
  maxCiphertextBytes: number;
}) => Promise<TokenlessRevealMaterial>;

const revealMaterialCache = new Map<string, TokenlessRevealMaterial>();
const permanentlyInvalidRevealCommits = new Set<string>();
let nextHistoricalRoundId = 0n;
let highestNewRoundIdProcessed = 0n;
let nextScanFeedbackBonusPoolId = 1n;

class InvalidRevealMaterialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRevealMaterialError";
  }
}

export function resetTokenlessKeeperStateForTests() {
  revealMaterialCache.clear();
  permanentlyInvalidRevealCommits.clear();
  nextHistoricalRoundId = 0n;
  highestNewRoundIdProcessed = 0n;
  nextScanFeedbackBonusPoolId = 1n;
}

function emptyResult(): TokenlessKeeperResult {
  return {
    roundsScanned: 0,
    revealWindowsOpened: 0,
    votesRevealed: 0,
    settlementsBegun: 0,
    aggregateBatchesProcessed: 0,
    scoringSeedsFinalized: 0,
    scoreBatchesProcessed: 0,
    roundsFinalized: 0,
    terminalRoundsAdvanced: 0,
    claimsExecuted: 0,
    staleReturnsExecuted: 0,
    feedbackBonusRefundsExecuted: 0,
    selfRevealFallbacksPending: 0,
    roundsAwaitingBeaconFailure: 0,
    roundsAwaitingScoringEntropy: 0,
  };
}

function acceptsReveals(round: TokenlessRound, now: bigint) {
  return (
    (round.state === TokenlessRoundState.Open ||
      round.state === TokenlessRoundState.Revealable) &&
    now > round.commitDeadline &&
    now <= round.beaconFailureDeadline &&
    (now <= round.revealDeadline || round.revealCount < round.minimumReveals)
  );
}

export async function decryptTokenlessRevealMaterial(params: {
  sealedPayload: Hex;
  beaconNetworkHash: Hex;
  maxCiphertextBytes: number;
}): Promise<TokenlessRevealMaterial> {
  const bytes = hexToBytes(params.sealedPayload);
  if (bytes.length === 0 || bytes.length > params.maxCiphertextBytes) {
    throw new Error(
      "Tokenless tlock ciphertext size is outside configured bounds.",
    );
  }
  const armored = Buffer.from(bytes).toString("utf8");
  const client = resolveTlockClientForDrandChain(params.beaconNetworkHash);
  const plaintext = await timelockDecrypt(armored, client);
  return decodeTokenlessRevealPayload(plaintext);
}

function normalizeRound(value: unknown): TokenlessRound {
  if (!value || typeof value !== "object") {
    throw new Error("TokenlessPanel.getRound returned an invalid value.");
  }
  const round = value as TokenlessRound;
  if (round.funder === zeroAddress) {
    throw new Error("TokenlessPanel.getRound returned an unknown round.");
  }
  return round;
}

function normalizeCommit(value: unknown): TokenlessCommit {
  if (!value || typeof value !== "object") {
    throw new Error("TokenlessPanel.getCommit returned an invalid value.");
  }
  return value as TokenlessCommit;
}

async function readRound(
  publicClient: TokenlessPublicClient,
  panel: Address,
  roundId: bigint,
) {
  return normalizeRound(
    await publicClient.readContract({
      address: panel,
      abi: TokenlessPanelAbi,
      functionName: "getRound",
      args: [roundId],
    }),
  );
}

async function readCommit(
  publicClient: TokenlessPublicClient,
  panel: Address,
  commitKey: Hex,
) {
  return normalizeCommit(
    await publicClient.readContract({
      address: panel,
      abi: TokenlessPanelAbi,
      functionName: "getCommit",
      args: [commitKey],
    }),
  );
}

// Every keeper write must confirm a *successful* receipt. A mined-but-reverted
// transaction returns a receipt with status "reverted"; treating that as success
// would let settlement, reveal, claim, stale-return or bonus-refund work fail
// silently while health stays green.
async function sendAndConfirm(
  clients: TokenlessKeeperClients,
  request: {
    address: Address;
    abi: unknown;
    functionName: string;
    args: readonly unknown[];
  },
) {
  const hash = await clients.walletClient.writeContract({
    address: request.address,
    abi: request.abi,
    functionName: request.functionName,
    args: request.args,
    account: clients.account,
  });
  const receipt = (await clients.publicClient.waitForTransactionReceipt({
    hash,
  })) as { status?: string } | null;
  if (receipt?.status !== "success") {
    throw new Error(
      `Tokenless keeper transaction ${request.functionName} reverted on-chain (status ${String(
        receipt?.status,
      )}).`,
    );
  }
  return hash;
}

async function writeAndConfirm(
  clients: TokenlessKeeperClients,
  panel: Address,
  functionName: string,
  args: readonly unknown[],
) {
  return sendAndConfirm(clients, {
    address: panel,
    abi: TokenlessPanelAbi,
    functionName,
    args,
  });
}

async function permissionlessWrite(
  clients: TokenlessKeeperClients,
  panel: Address,
  functionName: string,
  args: readonly unknown[],
  logger: Logger,
) {
  try {
    await writeAndConfirm(clients, panel, functionName, args);
    return true;
  } catch (error) {
    if (isExpectedPanelRaceError(error)) {
      logger.debug("Permissionless keeper call lost an on-chain race", {
        functionName,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
    throw error;
  }
}

async function commitLogsForRound(
  publicClient: TokenlessPublicClient,
  config: KeeperConfig,
  roundId: bigint,
) {
  return publicClient.getLogs({
    address: config.deployment.panel,
    event: TokenlessPanelAbi.find(
      (item) => item.type === "event" && item.name === "CommitAccepted",
    ),
    args: { roundId },
    fromBlock: config.deployment.blockNumber,
    toBlock: "latest",
  });
}

function validateRevealMaterial(
  material: TokenlessRevealMaterial,
  commit: TokenlessCommit,
  roundId: bigint,
) {
  if (material.roundId !== roundId || commit.roundId !== roundId) {
    throw new InvalidRevealMaterialError(
      "Decrypted tokenless reveal material is bound to another round.",
    );
  }
  if (!isAddressEqual(material.voteKey, commit.voteKey)) {
    throw new InvalidRevealMaterialError(
      "Decrypted tokenless reveal material is bound to another vote key.",
    );
  }
  if (isAddressEqual(material.payoutAddress, zeroAddress)) {
    throw new InvalidRevealMaterialError(
      "Decrypted tokenless reveal material has a zero payout address.",
    );
  }
  if (
    tokenlessPayoutCommitment(material.payoutAddress, material.salt) !==
    commit.payoutCommitment.toLowerCase()
  ) {
    throw new InvalidRevealMaterialError(
      "Decrypted tokenless reveal material does not match the payout commitment.",
    );
  }
  if (
    tokenlessRevealCommitment(material) !==
    commit.sealedCommitment.toLowerCase()
  ) {
    throw new InvalidRevealMaterialError(
      "Decrypted tokenless reveal material does not match the reveal commitment.",
    );
  }
}

async function materialForCommit(params: {
  config: KeeperConfig;
  decrypt: RevealDecryptor;
  round: TokenlessRound;
  roundId: bigint;
  commitKey: Hex;
  sealedPayload: Hex;
  commit: TokenlessCommit;
}) {
  const normalizedCommitKey = params.commitKey.toLowerCase();
  if (permanentlyInvalidRevealCommits.has(normalizedCommitKey)) {
    throw new InvalidRevealMaterialError(
      "Tokenless reveal material for this commit was permanently rejected.",
    );
  }
  const cached = revealMaterialCache.get(normalizedCommitKey);
  if (cached) {
    validateRevealMaterial(cached, params.commit, params.roundId);
    return cached;
  }
  const material = await params.decrypt({
    sealedPayload: params.sealedPayload,
    beaconNetworkHash: params.round.beaconNetworkHash,
    maxCiphertextBytes: params.config.maxCiphertextBytes,
  });
  try {
    validateRevealMaterial(material, params.commit, params.roundId);
  } catch (error) {
    if (error instanceof InvalidRevealMaterialError) {
      permanentlyInvalidRevealCommits.add(normalizedCommitKey);
    }
    throw error;
  }
  revealMaterialCache.set(normalizedCommitKey, material);
  return material;
}

async function revealAndClaimRound(params: {
  clients: TokenlessKeeperClients;
  config: KeeperConfig;
  logger: Logger;
  decrypt: RevealDecryptor;
  roundId: bigint;
  round: TokenlessRound;
  now: bigint;
  result: TokenlessKeeperResult;
}) {
  let revealedAny = false;
  const logs = await commitLogsForRound(
    params.clients.publicClient,
    params.config,
    params.roundId,
  );
  for (const log of logs) {
    const commitKey = log.args?.commitKey;
    const sealedPayload = log.args?.sealedPayload;
    if (!commitKey || !sealedPayload) continue;
    const commit = await readCommit(
      params.clients.publicClient,
      params.config.deployment.panel,
      commitKey,
    );

    let material: TokenlessRevealMaterial;
    try {
      material = await materialForCommit({
        config: params.config,
        decrypt: params.decrypt,
        round: params.round,
        roundId: params.roundId,
        commitKey,
        sealedPayload,
        commit,
      });
    } catch (error) {
      if (!commit.revealed && acceptsReveals(params.round, params.now)) {
        params.result.selfRevealFallbacksPending += 1;
      }
      const context = {
        roundId: params.roundId.toString(),
        commitKey,
        error: error instanceof Error ? error.message : String(error),
      };
      if (error instanceof InvalidRevealMaterialError) {
        params.logger.warn(
          "Tokenless commit contains permanently invalid reveal material",
          context,
        );
      } else {
        params.logger.debug(
          "Tokenless commit is not auto-decryptable yet",
          context,
        );
      }
      continue;
    }

    if (!commit.revealed && acceptsReveals(params.round, params.now)) {
      const revealed = await permissionlessWrite(
        params.clients,
        params.config.deployment.panel,
        "reveal",
        [
          params.roundId,
          material.voteKey,
          material.vote,
          material.predictedUpBps,
          material.responseHash,
          material.payoutAddress,
          material.salt,
        ],
        params.logger,
      );
      if (revealed) {
        params.result.votesRevealed += 1;
        revealedAny = true;
      }
    }

    if (
      !commit.claimed &&
      params.round.claimDeadline > 0n &&
      params.now <= params.round.claimDeadline
    ) {
      const functionName =
        params.round.state === TokenlessRoundState.Finalized
          ? "claim"
          : params.round.state ===
                TokenlessRoundState.BeaconFailureCompensation ||
              (params.round.state ===
                TokenlessRoundState.UnderQuorumCompensation &&
                commit.revealed)
            ? "claimCompensation"
            : null;
      if (functionName) {
        const claimed = await permissionlessWrite(
          params.clients,
          params.config.deployment.panel,
          functionName,
          [commitKey, material.payoutAddress, material.salt],
          params.logger,
        );
        if (claimed) params.result.claimsExecuted += 1;
      }
    }
  }
  return revealedAny;
}

async function advanceRound(params: {
  clients: TokenlessKeeperClients;
  config: KeeperConfig;
  logger: Logger;
  decrypt: RevealDecryptor;
  roundId: bigint;
  now: bigint;
  result: TokenlessKeeperResult;
}) {
  let round = await readRound(
    params.clients.publicClient,
    params.config.deployment.panel,
    params.roundId,
  );
  params.result.roundsScanned += 1;

  if (
    round.commitCount > 0 &&
    round.state === TokenlessRoundState.Open &&
    params.now > round.commitDeadline &&
    params.now <= round.beaconFailureDeadline
  ) {
    const opened = await permissionlessWrite(
      params.clients,
      params.config.deployment.panel,
      "openReveal",
      [params.roundId],
      params.logger,
    );
    if (opened) params.result.revealWindowsOpened += 1;
    round = { ...round, state: TokenlessRoundState.Revealable };
  }

  const terminalClaimWindowOpen =
    (round.state === TokenlessRoundState.Finalized ||
      round.state === TokenlessRoundState.UnderQuorumCompensation ||
      round.state === TokenlessRoundState.BeaconFailureCompensation) &&
    round.claimDeadline > 0n &&
    params.now <= round.claimDeadline;
  const shouldInspectCommits =
    acceptsReveals(round, params.now) || terminalClaimWindowOpen;
  const revealedAny = shouldInspectCommits
    ? await revealAndClaimRound({ ...params, round })
    : false;
  if (revealedAny) {
    round = await readRound(
      params.clients.publicClient,
      params.config.deployment.panel,
      params.roundId,
    );
  }

  if (
    (round.state === TokenlessRoundState.Open ||
      round.state === TokenlessRoundState.Revealable) &&
    params.now > round.revealDeadline
  ) {
    const quorumMet = round.revealCount >= round.minimumReveals;
    const mayAdvance =
      round.commitCount === 0 ||
      quorumMet ||
      params.now > round.beaconFailureDeadline;
    if (mayAdvance) {
      const terminal = round.commitCount === 0 || !quorumMet;
      const advanced = await permissionlessWrite(
        params.clients,
        params.config.deployment.panel,
        "beginSettlement",
        [params.roundId],
        params.logger,
      );
      if (advanced) {
        if (terminal) params.result.terminalRoundsAdvanced += 1;
        else params.result.settlementsBegun += 1;
      }
    } else {
      params.result.roundsAwaitingBeaconFailure += 1;
    }
    return;
  }

  if (round.state === TokenlessRoundState.Aggregating) {
    const processed = await permissionlessWrite(
      params.clients,
      params.config.deployment.panel,
      "processAggregate",
      [
        params.roundId,
        round.aggregateCursor,
        params.config.settlementBatchSize,
      ],
      params.logger,
    );
    if (processed) params.result.aggregateBatchesProcessed += 1;
    return;
  }

  if (round.state === TokenlessRoundState.AwaitingSeed) {
    const currentBlock = await params.clients.publicClient.getBlockNumber();
    if (currentBlock <= round.entropyBlock) {
      params.result.roundsAwaitingScoringEntropy += 1;
      return;
    }
    const seeded = await permissionlessWrite(
      params.clients,
      params.config.deployment.panel,
      "finalizeScoringSeed",
      [params.roundId],
      params.logger,
    );
    if (seeded) params.result.scoringSeedsFinalized += 1;
    return;
  }

  if (round.state === TokenlessRoundState.Scoring) {
    if (round.scoreCursor < round.frozenRevealCount) {
      const processed = await permissionlessWrite(
        params.clients,
        params.config.deployment.panel,
        "processScores",
        [params.roundId, round.scoreCursor, params.config.settlementBatchSize],
        params.logger,
      );
      if (processed) params.result.scoreBatchesProcessed += 1;
      return;
    }
    const finalized = await permissionlessWrite(
      params.clients,
      params.config.deployment.panel,
      "finalizeSettlement",
      [params.roundId],
      params.logger,
    );
    if (finalized) params.result.roundsFinalized += 1;
    return;
  }

  const staleReturnState =
    round.state === TokenlessRoundState.Finalized ||
    round.state === TokenlessRoundState.UnderQuorumCompensation ||
    round.state === TokenlessRoundState.BeaconFailureCompensation;
  if (
    staleReturnState &&
    !round.staleReturned &&
    round.claimDeadline > 0n &&
    params.now > round.claimDeadline
  ) {
    const returned = await permissionlessWrite(
      params.clients,
      params.config.deployment.panel,
      "returnStaleShares",
      [params.roundId],
      params.logger,
    );
    if (returned) params.result.staleReturnsExecuted += 1;
  }
}

function scanRoundIds(nextRoundId: bigint, maxRounds: number) {
  const total = nextRoundId - 1n;
  if (total <= 0n) return [];
  const count = Math.min(maxRounds, Number(total));
  const ids: bigint[] = [];
  const selected = new Set<bigint>();

  // On restart, inspect the tip immediately, then continue backward through older history.
  // Thereafter, reserve only the capacity needed for never-seen new IDs; the remaining budget
  // advances the historical cursor without resetting or overlapping the prior sweep.
  if (highestNewRoundIdProcessed === 0n) {
    ids.push(total);
    selected.add(total);
    highestNewRoundIdProcessed = total;
    nextHistoricalRoundId = total === 1n ? 1n : total - 1n;
  } else {
    while (highestNewRoundIdProcessed < total && ids.length < count) {
      highestNewRoundIdProcessed += 1n;
      ids.push(highestNewRoundIdProcessed);
      selected.add(highestNewRoundIdProcessed);
    }
  }

  if (nextHistoricalRoundId === 0n || nextHistoricalRoundId > total) {
    nextHistoricalRoundId = total;
  }
  let historicalCandidatesChecked = 0n;
  while (ids.length < count && historicalCandidatesChecked < total) {
    const candidate = nextHistoricalRoundId;
    nextHistoricalRoundId = candidate === 1n ? total : candidate - 1n;
    historicalCandidatesChecked += 1n;
    if (!selected.has(candidate)) {
      ids.push(candidate);
      selected.add(candidate);
    }
  }
  return ids;
}

function scanFeedbackBonusPoolIds(nextPoolId: bigint, maxPools: number) {
  const total = nextPoolId - 1n;
  if (total <= 0n) return [];
  if (nextScanFeedbackBonusPoolId > total) nextScanFeedbackBonusPoolId = 1n;
  const count = Math.min(maxPools, Number(total));
  const ids: bigint[] = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(nextScanFeedbackBonusPoolId);
    nextScanFeedbackBonusPoolId =
      nextScanFeedbackBonusPoolId === total
        ? 1n
        : nextScanFeedbackBonusPoolId + 1n;
  }
  return ids;
}

async function reconcileFeedbackBonusRemainders(params: {
  clients: TokenlessKeeperClients;
  config: KeeperConfig;
  logger: Logger;
  now: bigint;
  nextPoolId: bigint;
  result: TokenlessKeeperResult;
}) {
  for (const poolId of scanFeedbackBonusPoolIds(
    params.nextPoolId,
    params.config.maxFeedbackBonusPoolsPerTick,
  )) {
    const pool = (await params.clients.publicClient.readContract({
      address: params.config.deployment.feedbackBonus,
      abi: TokenlessFeedbackBonusAbi,
      functionName: "getPool",
      args: [poolId],
    })) as {
      depositedAmount: bigint;
      awardedAmount: bigint;
      awardDeadline: bigint;
      refunded: boolean;
    };
    if (
      pool.refunded ||
      params.now <= BigInt(pool.awardDeadline) ||
      BigInt(pool.depositedAmount) <= BigInt(pool.awardedAmount)
    ) {
      continue;
    }
    try {
      await sendAndConfirm(params.clients, {
        address: params.config.deployment.feedbackBonus,
        abi: TokenlessFeedbackBonusAbi,
        functionName: "refundRemainder",
        args: [poolId],
      });
      params.result.feedbackBonusRefundsExecuted += 1;
    } catch (error) {
      if (
        /NothingToRefund|AwardWindowClosed|InvalidPool/iu.test(String(error))
      ) {
        params.logger.debug("Feedback bonus refund lost an on-chain race", {
          poolId: poolId.toString(),
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      throw error;
    }
  }
}

export async function validateTokenlessKeeperDeployment(
  clients: TokenlessKeeperClients,
  config: KeeperConfig,
) {
  const chainId = await clients.publicClient.getChainId();
  if (chainId !== config.chainId) {
    throw new Error(
      `RPC reports chain ${chainId}, expected tokenless keeper chain ${config.chainId}.`,
    );
  }
  const [
    panelCode,
    issuerCode,
    feedbackBonusCode,
    currentBlock,
    issuer,
    scoringVersion,
    basePayBps,
    maximumCommits,
    panelUsdc,
    feedbackBonusUsdc,
    feedbackBonusIssuer,
  ] = await Promise.all([
    clients.publicClient.getBytecode({ address: config.deployment.panel }),
    clients.publicClient.getBytecode({
      address: config.deployment.credentialIssuer,
    }),
    clients.publicClient.getBytecode({
      address: config.deployment.feedbackBonus,
    }),
    clients.publicClient.getBlockNumber(),
    clients.publicClient.readContract({
      address: config.deployment.panel,
      abi: TokenlessPanelAbi,
      functionName: "credentialIssuer",
    }),
    clients.publicClient.readContract({
      address: config.deployment.panel,
      abi: TokenlessPanelAbi,
      functionName: "SCORING_VERSION",
    }),
    clients.publicClient.readContract({
      address: config.deployment.panel,
      abi: TokenlessPanelAbi,
      functionName: "BASE_PAY_BPS",
    }),
    clients.publicClient.readContract({
      address: config.deployment.panel,
      abi: TokenlessPanelAbi,
      functionName: "MAXIMUM_COMMITS",
    }),
    clients.publicClient.readContract({
      address: config.deployment.panel,
      abi: TokenlessPanelAbi,
      functionName: "usdc",
    }),
    clients.publicClient.readContract({
      address: config.deployment.feedbackBonus,
      abi: TokenlessFeedbackBonusAbi,
      functionName: "usdc",
    }),
    clients.publicClient.readContract({
      address: config.deployment.feedbackBonus,
      abi: TokenlessFeedbackBonusAbi,
      functionName: "credentialIssuer",
    }),
  ]);
  if (!panelCode || panelCode === "0x") {
    throw new Error("TOKENLESS_PANEL_ADDRESS has no deployed bytecode.");
  }
  if (!issuerCode || issuerCode === "0x") {
    throw new Error(
      "TOKENLESS_CREDENTIAL_ISSUER_ADDRESS has no deployed bytecode.",
    );
  }
  if (!feedbackBonusCode || feedbackBonusCode === "0x") {
    throw new Error(
      "TOKENLESS_FEEDBACK_BONUS_ADDRESS has no deployed bytecode.",
    );
  }
  if (
    typeof issuer !== "string" ||
    !isAddressEqual(issuer as Address, config.deployment.credentialIssuer)
  ) {
    throw new Error(
      "TokenlessPanel credentialIssuer does not match the versioned deployment identity.",
    );
  }
  if (
    typeof panelUsdc !== "string" ||
    typeof feedbackBonusUsdc !== "string" ||
    !isAddressEqual(panelUsdc as Address, feedbackBonusUsdc as Address) ||
    typeof feedbackBonusIssuer !== "string" ||
    !isAddressEqual(
      feedbackBonusIssuer as Address,
      config.deployment.credentialIssuer,
    )
  ) {
    throw new Error(
      "TokenlessFeedbackBonus wiring does not match the versioned deployment identity.",
    );
  }
  if (
    Number(scoringVersion) !== 2 ||
    Number(basePayBps) !== 8_000 ||
    Number(maximumCommits) !== 500
  ) {
    throw new Error(
      "TokenlessPanel RBTS constants do not match the tokenless-v4 deployment identity.",
    );
  }
  if (
    config.deployment.x402PanelSubmitter &&
    !isAddressEqual(config.deployment.x402PanelSubmitter, zeroAddress)
  ) {
    const adapterCode = await clients.publicClient.getBytecode({
      address: config.deployment.x402PanelSubmitter,
    });
    if (!adapterCode || adapterCode === "0x") {
      throw new Error(
        "TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS has no deployed bytecode.",
      );
    }
  }
  if (config.deployment.blockNumber > currentBlock) {
    throw new Error(
      "TOKENLESS_DEPLOYMENT_BLOCK is ahead of the current chain.",
    );
  }
}

export async function runTokenlessKeeper(
  clients: TokenlessKeeperClients,
  config: KeeperConfig,
  logger: Logger,
  decrypt: RevealDecryptor = decryptTokenlessRevealMaterial,
) {
  await validateTokenlessKeeperDeployment(clients, config);
  const [block, nextRoundIdRaw, nextFeedbackBonusPoolIdRaw] = await Promise.all(
    [
      clients.publicClient.getBlock(),
      clients.publicClient.readContract({
        address: config.deployment.panel,
        abi: TokenlessPanelAbi,
        functionName: "nextRoundId",
      }),
      clients.publicClient.readContract({
        address: config.deployment.feedbackBonus,
        abi: TokenlessFeedbackBonusAbi,
        functionName: "nextPoolId",
      }),
    ],
  );
  const nextRoundId = BigInt(nextRoundIdRaw as bigint);
  const result = emptyResult();
  for (const roundId of scanRoundIds(nextRoundId, config.maxRoundsPerTick)) {
    await advanceRound({
      clients,
      config,
      logger,
      decrypt,
      roundId,
      now: block.timestamp,
      result,
    });
  }
  await reconcileFeedbackBonusRemainders({
    clients,
    config,
    logger,
    now: block.timestamp,
    nextPoolId: BigInt(nextFeedbackBonusPoolIdRaw as bigint),
    result,
  });
  return result;
}
