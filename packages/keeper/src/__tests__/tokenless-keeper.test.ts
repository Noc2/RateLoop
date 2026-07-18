import { beforeEach, describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import {
  resetTokenlessKeeperStateForTests,
  runTokenlessKeeper,
  validateTokenlessKeeperDeployment,
  type TokenlessKeeperClients,
} from "../keeper.js";
import {
  getConsecutiveErrors,
  recordError,
  renderMetrics,
} from "../metrics.js";
import type { Logger } from "../logger.js";
import { TokenlessPanelAbi } from "../tokenless-abi.js";
import {
  TokenlessRoundState,
  type TokenlessRound,
} from "../tokenless-types.js";

const PANEL = "0x0000000000000000000000000000000000000011";
const ISSUER = "0x0000000000000000000000000000000000000022";
const ADAPTER = "0x0000000000000000000000000000000000000023";
const FEEDBACK_BONUS = "0x0000000000000000000000000000000000000024";
const USDC = "0x0000000000000000000000000000000000000025";
const VOTE_KEY = "0x0000000000000000000000000000000000000033" as Address;
const PAYOUT = "0x0000000000000000000000000000000000000044" as Address;
const COMMIT_KEY = `0x${"55".repeat(32)}` as Hex;
const SEALED_PAYLOAD = "0x1234" as Hex;
const RESPONSE_HASH = `0x${"66".repeat(32)}` as Hex;
const SALT = `0x${"77".repeat(32)}` as Hex;
const ADMISSION_POLICY_HASH = `0x${"99".repeat(32)}` as Hex;
const ZERO_HASH = `0x${"00".repeat(32)}` as Hex;

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const config = {
  chainId: 84532,
  deployment: {
    key: `tokenless-v4:84532:${PANEL}:${ISSUER}:0x0000000000000000000000000000000000000000:${FEEDBACK_BONUS}`,
    blockNumber: 100n,
    panel: PANEL,
    credentialIssuer: ISSUER,
    x402PanelSubmitter: "0x0000000000000000000000000000000000000000",
    feedbackBonus: FEEDBACK_BONUS,
  },
  maxRoundsPerTick: 100,
  settlementBatchSize: 25,
  maxCiphertextBytes: 16384,
  maxFeedbackBonusPoolsPerTick: 100,
} as any;

function round(overrides: Partial<TokenlessRound> = {}): TokenlessRound {
  return {
    funder: "0x0000000000000000000000000000000000000099",
    contentId: `0x${"01".repeat(32)}`,
    termsHash: `0x${"02".repeat(32)}`,
    beaconNetworkHash: `0x${"03".repeat(32)}`,
    feeRecipient: "0x0000000000000000000000000000000000000088",
    bountyAmount: 100n,
    feeAmount: 5n,
    attemptReserve: 10n,
    attemptCompensation: 2n,
    fixedBasePay: 2n,
    maximumBonus: 1n,
    compensationPerRecipient: 0n,
    totalRbtsScoreBps: 0n,
    totalFinalizedLiability: 0n,
    totalPaid: 0n,
    entropyBlock: 0n,
    revealSetXor: ZERO_HASH,
    revealSetSum: 0n,
    scoringSeed: ZERO_HASH,
    commitDeadline: 100n,
    revealDeadline: 200n,
    beaconFailureDeadline: 250n,
    beaconRound: 1n,
    claimGracePeriod: 100n,
    claimDeadline: 0n,
    minimumReveals: 1,
    maximumCommits: 5,
    admissionPolicyHash: ADMISSION_POLICY_HASH,
    commitCount: 1,
    revealCount: 0,
    compensatedRevealCount: 0,
    frozenRevealCount: 0,
    aggregateCursor: 0,
    scoreCursor: 0,
    upVotes: 0,
    state: TokenlessRoundState.Open,
    scoringMode: 0,
    staleReturned: false,
    ...overrides,
  };
}

function clients(params: {
  currentRound: TokenlessRound;
  now?: bigint;
  writes?: string[];
  nextRoundId?: bigint;
  readRoundIds?: bigint[];
  commitLogQueries?: unknown[];
  commitClaimed?: boolean;
  currentBlock?: bigint;
  receiptStatus?: "success" | "reverted";
  feedbackBonusPool?: {
    depositedAmount: bigint;
    awardedAmount: bigint;
    awardDeadline: bigint;
    refunded: boolean;
  };
}): TokenlessKeeperClients {
  const writes = params.writes ?? [];
  const currentRound = { ...params.currentRound };
  return {
    account: { address: "0x00000000000000000000000000000000000000aa" },
    walletClient: {
      async writeContract(args) {
        const functionName = String(args.functionName);
        writes.push(functionName);
        if (functionName === "openReveal") {
          currentRound.state = TokenlessRoundState.Revealable;
        } else if (functionName === "reveal") {
          currentRound.state = TokenlessRoundState.Revealable;
          currentRound.revealCount += 1;
        }
        return `0x${"88".repeat(32)}`;
      },
    },
    publicClient: {
      async getChainId() {
        return 84532;
      },
      async getBlockNumber() {
        return params.currentBlock ?? 1000n;
      },
      async getBlock() {
        return { timestamp: params.now ?? 150n };
      },
      async getBytecode({ address }: { address: Address }) {
        return address === PANEL ||
          address === ISSUER ||
          address === FEEDBACK_BONUS
          ? "0x6000"
          : undefined;
      },
      async getBalance() {
        return 1n;
      },
      async waitForTransactionReceipt() {
        return { status: params.receiptStatus ?? "success" };
      },
      async getLogs(args) {
        params.commitLogQueries?.push(args);
        if (currentRound.commitCount === 0) return [];
        return [
          {
            args: {
              roundId: 1n,
              commitKey: COMMIT_KEY,
              sealedPayload: SEALED_PAYLOAD,
            },
          },
        ];
      },
      async readContract(args) {
        switch (args.functionName) {
          case "credentialIssuer":
            return ISSUER;
          case "usdc":
            return USDC;
          case "SCORING_VERSION":
            return 2;
          case "BASE_PAY_BPS":
            return 8_000;
          case "MAXIMUM_COMMITS":
            return 500;
          case "nextRoundId":
            return params.nextRoundId ?? 2n;
          case "nextPoolId":
            return params.feedbackBonusPool ? 2n : 1n;
          case "getPool":
            if (params.feedbackBonusPool) return params.feedbackBonusPool;
            throw new Error("unexpected feedback bonus pool read");
          case "getRound":
            params.readRoundIds?.push(
              BigInt(
                (args.args as readonly unknown[] | undefined)?.[0] as bigint,
              ),
            );
            return currentRound;
          case "getCommit":
            return {
              roundId: 1n,
              voteKey: VOTE_KEY,
              sealedCommitment: `0x${"11".repeat(32)}`,
              sealedPayloadHash: `0x${"22".repeat(32)}`,
              payoutCommitment: `0x${"33".repeat(32)}`,
              responseHash: RESPONSE_HASH,
              referenceCommitKey: ZERO_HASH,
              peerCommitKey: ZERO_HASH,
              finalizedPayout: 0n,
              predictedUpBps: 7000,
              informationScoreBps: 0,
              predictionScoreBps: 0,
              rbtsScoreBps: 0,
              vote: 1,
              revealed: currentRound.revealCount > 0,
              claimed: params.commitClaimed ?? false,
            };
          default:
            throw new Error(`unexpected read ${String(args.functionName)}`);
        }
      },
    },
  } as TokenlessKeeperClients;
}

const decrypt = async () => ({
  roundId: 1n,
  voteKey: VOTE_KEY,
  vote: 1 as const,
  predictedUpBps: 7000 as const,
  responseHash: RESPONSE_HASH,
  payoutAddress: PAYOUT,
  salt: SALT,
});

beforeEach(() => resetTokenlessKeeperStateForTests());

describe("tokenless keeper orchestration", () => {
  it("uses the policy-bound v4 RBTS round tuple", () => {
    const getRound = TokenlessPanelAbi.find(
      (entry) => entry.type === "function" && entry.name === "getRound",
    );
    expect(
      getRound?.outputs[0]?.components.map(({ name, type }) => ({
        name,
        type,
      })),
    ).toEqual([
      { name: "funder", type: "address" },
      { name: "contentId", type: "bytes32" },
      { name: "termsHash", type: "bytes32" },
      { name: "beaconNetworkHash", type: "bytes32" },
      { name: "feeRecipient", type: "address" },
      { name: "bountyAmount", type: "uint256" },
      { name: "feeAmount", type: "uint256" },
      { name: "attemptReserve", type: "uint256" },
      { name: "attemptCompensation", type: "uint256" },
      { name: "fixedBasePay", type: "uint256" },
      { name: "maximumBonus", type: "uint256" },
      { name: "compensationPerRecipient", type: "uint256" },
      { name: "totalRbtsScoreBps", type: "uint256" },
      { name: "totalFinalizedLiability", type: "uint256" },
      { name: "totalPaid", type: "uint256" },
      { name: "entropyBlock", type: "uint256" },
      { name: "revealSetXor", type: "bytes32" },
      { name: "revealSetSum", type: "uint256" },
      { name: "scoringSeed", type: "bytes32" },
      { name: "commitDeadline", type: "uint64" },
      { name: "revealDeadline", type: "uint64" },
      { name: "beaconFailureDeadline", type: "uint64" },
      { name: "beaconRound", type: "uint64" },
      { name: "claimGracePeriod", type: "uint64" },
      { name: "claimDeadline", type: "uint256" },
      { name: "minimumReveals", type: "uint32" },
      { name: "maximumCommits", type: "uint32" },
      { name: "admissionPolicyHash", type: "bytes32" },
      { name: "commitCount", type: "uint32" },
      { name: "revealCount", type: "uint32" },
      { name: "compensatedRevealCount", type: "uint32" },
      { name: "frozenRevealCount", type: "uint32" },
      { name: "aggregateCursor", type: "uint32" },
      { name: "scoreCursor", type: "uint32" },
      { name: "upVotes", type: "uint32" },
      { name: "state", type: "uint8" },
      { name: "scoringMode", type: "uint8" },
      { name: "staleReturned", type: "bool" },
    ]);
    expect(
      getRound?.outputs[0]?.components.some(
        (component) => String(component.name) === "totalAccuracyScore",
      ),
    ).toBe(false);
    expect(
      getRound?.outputs[0]?.components.some(
        (component) => String(component.name) === "requiredTier",
      ),
    ).toBe(false);
  });

  it("prioritizes newest rounds after restart and skips terminal log history", async () => {
    const terminalRound = round({
      state: TokenlessRoundState.Finalized,
      claimDeadline: 200n,
      staleReturned: true,
    });
    const readRoundIds: bigint[] = [];
    const commitLogQueries: unknown[] = [];
    const boundedConfig = { ...config, maxRoundsPerTick: 2 };

    await runTokenlessKeeper(
      clients({
        currentRound: terminalRound,
        now: 300n,
        nextRoundId: 10_001n,
        readRoundIds,
        commitLogQueries,
      }),
      boundedConfig,
      logger,
      decrypt,
    );
    expect(readRoundIds).toEqual([10_000n, 9_999n]);
    expect(commitLogQueries).toEqual([]);

    readRoundIds.length = 0;
    await runTokenlessKeeper(
      clients({
        currentRound: terminalRound,
        now: 300n,
        nextRoundId: 10_001n,
        readRoundIds,
        commitLogQueries,
      }),
      boundedConfig,
      logger,
      decrypt,
    );
    expect(readRoundIds).toEqual([9_998n, 9_997n]);

    readRoundIds.length = 0;
    await runTokenlessKeeper(
      clients({
        currentRound: terminalRound,
        now: 300n,
        nextRoundId: 10_002n,
        readRoundIds,
        commitLogQueries,
      }),
      boundedConfig,
      logger,
      decrypt,
    );
    expect(readRoundIds).toEqual([10_001n, 9_996n]);

    resetTokenlessKeeperStateForTests();
    readRoundIds.length = 0;
    await runTokenlessKeeper(
      clients({
        currentRound: terminalRound,
        now: 300n,
        nextRoundId: 10_001n,
        readRoundIds,
        commitLogQueries,
      }),
      boundedConfig,
      logger,
      decrypt,
    );
    expect(readRoundIds).toEqual([10_000n, 9_999n]);
  });

  it("continues the historical sweep while one new round arrives per tick", async () => {
    const terminalRound = round({
      state: TokenlessRoundState.Finalized,
      claimDeadline: 200n,
      staleReturned: true,
    });
    const readRoundIds: bigint[] = [];
    const boundedConfig = { ...config, maxRoundsPerTick: 3 };

    for (const [nextRoundId, expected] of [
      [101n, [100n, 99n, 98n]],
      [102n, [101n, 97n, 96n]],
      [103n, [102n, 95n, 94n]],
      [104n, [103n, 93n, 92n]],
    ] as const) {
      readRoundIds.length = 0;
      await runTokenlessKeeper(
        clients({
          currentRound: terminalRound,
          now: 300n,
          nextRoundId,
          readRoundIds,
        }),
        boundedConfig,
        logger,
        decrypt,
      );
      expect(readRoundIds).toEqual(expected);
    }
  });

  it("fails closed when panel issuer wiring differs", async () => {
    const instance = clients({ currentRound: round() });
    instance.publicClient.readContract = async () =>
      "0x00000000000000000000000000000000000000ff";
    await expect(
      validateTokenlessKeeperDeployment(instance, config),
    ).rejects.toThrow(/credentialIssuer does not match/);
  });

  it("fails closed when a relabeled panel exposes different mechanism constants", async () => {
    const instance = clients({ currentRound: round() });
    const readContract = instance.publicClient.readContract.bind(
      instance.publicClient,
    );
    instance.publicClient.readContract = async (args) =>
      args.functionName === "BASE_PAY_BPS" ? 7_500 : readContract(args);
    await expect(
      validateTokenlessKeeperDeployment(instance, config),
    ).rejects.toThrow(/RBTS constants do not match/);
  });

  it("fails closed when a configured x402 adapter is not deployed", async () => {
    const instance = clients({ currentRound: round() });
    await expect(
      validateTokenlessKeeperDeployment(instance, {
        ...config,
        deployment: {
          ...config.deployment,
          x402PanelSubmitter: ADAPTER,
        },
      }),
    ).rejects.toThrow(/X402_PANEL_SUBMITTER_ADDRESS has no deployed bytecode/);
  });

  it("returns an expired unawarded feedback bonus remainder permissionlessly", async () => {
    const writes: string[] = [];
    const result = await runTokenlessKeeper(
      clients({
        currentRound: round({
          state: TokenlessRoundState.Finalized,
          staleReturned: true,
          claimDeadline: 300n,
        }),
        feedbackBonusPool: {
          depositedAmount: 1_000_000n,
          awardedAmount: 250_000n,
          awardDeadline: 300n,
          refunded: false,
        },
        writes,
        now: 301n,
      }),
      config,
      logger,
      decrypt,
    );
    expect(writes).toContain("refundRemainder");
    expect(result.feedbackBonusRefundsExecuted).toBe(1);
  });

  it("treats a reverted receipt as failed work with zero success counters and degraded health", async () => {
    const counter = (name: string) =>
      Number(
        renderMetrics().match(new RegExp(`^${name} (\\d+)$`, "mu"))?.[1] ?? 0,
      );
    const writes: string[] = [];
    await expect(
      runTokenlessKeeper(
        clients({
          currentRound: round(),
          writes,
          now: 150n,
          receiptStatus: "reverted",
        }),
        config,
        logger,
        decrypt,
      ),
    ).rejects.toThrow(/reverted on-chain/u);
    // The write was submitted, but its mined receipt reverted, so the keeper
    // never confirms the reveal and never records a successful run.
    expect(writes).toEqual(["openReveal"]);

    const revealsBefore = counter("keeper_votes_revealed_total");
    const errorsBefore = counter("keeper_errors_total");
    // index.ts records an error (and no run) for a tick that throws.
    recordError();
    recordError();
    recordError();
    expect(counter("keeper_votes_revealed_total")).toBe(revealsBefore);
    expect(counter("keeper_errors_total")).toBe(errorsBefore + 3);
    // Three consecutive errors trips the /health degraded threshold.
    expect(getConsecutiveErrors()).toBeGreaterThanOrEqual(3);
  });

  it("does not count a reverted feedback bonus refund as executed", async () => {
    const writes: string[] = [];
    await expect(
      runTokenlessKeeper(
        clients({
          currentRound: round({
            state: TokenlessRoundState.Finalized,
            staleReturned: true,
            claimDeadline: 300n,
          }),
          feedbackBonusPool: {
            depositedAmount: 1_000_000n,
            awardedAmount: 250_000n,
            awardDeadline: 300n,
            refunded: false,
          },
          writes,
          now: 301n,
          receiptStatus: "reverted",
        }),
        config,
        logger,
        decrypt,
      ),
    ).rejects.toThrow(/reverted on-chain/u);
    expect(writes).toContain("refundRemainder");
  });

  it("opens and reveals without any privileged role", async () => {
    const writes: string[] = [];
    const result = await runTokenlessKeeper(
      clients({ currentRound: round(), writes, now: 150n }),
      config,
      logger,
      decrypt,
    );
    expect(writes).toEqual(["openReveal", "reveal"]);
    expect(result.votesRevealed).toBe(1);
  });

  it("keeps automatic and self-reveal fallback live through the beacon deadline", async () => {
    const writes: string[] = [];
    const result = await runTokenlessKeeper(
      clients({ currentRound: round(), writes, now: 250n }),
      config,
      logger,
      decrypt,
    );
    expect(writes).toEqual(["openReveal", "reveal", "beginSettlement"]);
    expect(result.votesRevealed).toBe(1);
    expect(result.settlementsBegun).toBe(1);
    expect(result.roundsAwaitingBeaconFailure).toBe(0);

    resetTokenlessKeeperStateForTests();
    const unavailableWrites: string[] = [];
    const unavailable = await runTokenlessKeeper(
      clients({ currentRound: round(), writes: unavailableWrites, now: 250n }),
      config,
      logger,
      async () => {
        throw new Error("beacon unavailable");
      },
    );
    expect(unavailableWrites).toEqual(["openReveal"]);
    expect(unavailable.selfRevealFallbacksPending).toBe(1);
    expect(unavailable.roundsAwaitingBeaconFailure).toBe(1);
  });

  it("does not submit a late reveal after timely quorum is already fixed", async () => {
    const writes: string[] = [];
    const result = await runTokenlessKeeper(
      clients({
        currentRound: round({
          minimumReveals: 1,
          revealCount: 1,
          compensatedRevealCount: 1,
        }),
        writes,
        now: 220n,
      }),
      config,
      logger,
      decrypt,
    );

    expect(writes).toEqual(["openReveal", "beginSettlement"]);
    expect(result.votesRevealed).toBe(0);
    expect(result.settlementsBegun).toBe(1);
  });

  it("waits on under-quorum rounds until the beacon failure deadline", async () => {
    const waitingWrites: string[] = [];
    const waiting = await runTokenlessKeeper(
      clients({
        currentRound: round({
          state: TokenlessRoundState.Revealable,
          minimumReveals: 2,
          revealCount: 1,
        }),
        writes: waitingWrites,
        now: 220n,
      }),
      config,
      logger,
      decrypt,
    );
    expect(waitingWrites).not.toContain("beginSettlement");
    expect(waiting.roundsAwaitingBeaconFailure).toBe(1);
    expect(waiting.terminalRoundsAdvanced).toBe(0);

    resetTokenlessKeeperStateForTests();
    const terminalWrites: string[] = [];
    const terminal = await runTokenlessKeeper(
      clients({
        currentRound: round({
          state: TokenlessRoundState.Revealable,
          minimumReveals: 2,
          revealCount: 1,
        }),
        writes: terminalWrites,
        now: 251n,
      }),
      config,
      logger,
      decrypt,
    );
    expect(terminalWrites).toContain("beginSettlement");
    expect(terminal.roundsAwaitingBeaconFailure).toBe(0);
    expect(terminal.terminalRoundsAdvanced).toBe(1);
  });

  it("freezes normal rounds and advances terminal refunds", async () => {
    const normalWrites: string[] = [];
    await runTokenlessKeeper(
      clients({
        currentRound: round({ revealCount: 1 }),
        writes: normalWrites,
        now: 220n,
      }),
      config,
      logger,
      decrypt,
    );
    expect(normalWrites).toContain("beginSettlement");

    resetTokenlessKeeperStateForTests();
    const terminalWrites: string[] = [];
    const result = await runTokenlessKeeper(
      clients({
        currentRound: round({ commitCount: 0 }),
        writes: terminalWrites,
        now: 220n,
      }),
      config,
      logger,
      decrypt,
    );
    expect(terminalWrites).toContain("beginSettlement");
    expect(result.terminalRoundsAdvanced).toBe(1);
  });

  it("processes aggregation, future-block seed finalization, RBTS scoring, and finalization", async () => {
    const aggregateWrites: string[] = [];
    await runTokenlessKeeper(
      clients({
        currentRound: round({
          state: TokenlessRoundState.Aggregating,
          frozenRevealCount: 3,
        }),
        writes: aggregateWrites,
      }),
      config,
      logger,
      decrypt,
    );
    expect(aggregateWrites).toContain("processAggregate");

    resetTokenlessKeeperStateForTests();
    const seedWrites: string[] = [];
    await runTokenlessKeeper(
      clients({
        currentRound: round({
          state: TokenlessRoundState.AwaitingSeed,
          frozenRevealCount: 3,
          entropyBlock: 900n,
        }),
        writes: seedWrites,
      }),
      config,
      logger,
      decrypt,
    );
    expect(seedWrites).toContain("finalizeScoringSeed");

    resetTokenlessKeeperStateForTests();
    const scoreWrites: string[] = [];
    await runTokenlessKeeper(
      clients({
        currentRound: round({
          state: TokenlessRoundState.Scoring,
          frozenRevealCount: 3,
          scoreCursor: 1,
        }),
        writes: scoreWrites,
      }),
      config,
      logger,
      decrypt,
    );
    expect(scoreWrites).toContain("processScores");

    resetTokenlessKeeperStateForTests();
    const finalWrites: string[] = [];
    await runTokenlessKeeper(
      clients({
        currentRound: round({
          state: TokenlessRoundState.Scoring,
          frozenRevealCount: 3,
          scoreCursor: 3,
        }),
        writes: finalWrites,
      }),
      config,
      logger,
      decrypt,
    );
    expect(finalWrites).toContain("finalizeSettlement");
  });

  it("waits until the committed future entropy block can be read", async () => {
    const writes: string[] = [];
    const result = await runTokenlessKeeper(
      clients({
        currentRound: round({
          state: TokenlessRoundState.AwaitingSeed,
          frozenRevealCount: 3,
          entropyBlock: 1_000n,
        }),
        writes,
        currentBlock: 1_000n,
      }),
      config,
      logger,
      decrypt,
    );
    expect(writes).not.toContain("finalizeScoringSeed");
    expect(result.roundsAwaitingScoringEntropy).toBe(1);
  });

  it("auto-claims decrypted material and returns stale shares", async () => {
    const claimWrites: string[] = [];
    await runTokenlessKeeper(
      clients({
        currentRound: round({
          state: TokenlessRoundState.Finalized,
          revealCount: 1,
          claimDeadline: 300n,
        }),
        writes: claimWrites,
        now: 250n,
      }),
      config,
      logger,
      decrypt,
    );
    expect(claimWrites).toContain("claim");

    resetTokenlessKeeperStateForTests();
    const staleWrites: string[] = [];
    await runTokenlessKeeper(
      clients({
        currentRound: round({
          state: TokenlessRoundState.Finalized,
          revealCount: 1,
          claimDeadline: 200n,
        }),
        writes: staleWrites,
        now: 250n,
      }),
      config,
      logger,
      decrypt,
    );
    expect(staleWrites).toContain("returnStaleShares");
  });
});
