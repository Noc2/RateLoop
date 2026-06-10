import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodePacked, keccak256 } from "viem";

const VOTER = "0x3333333333333333333333333333333333333333" as const;
const ACCOUNT = "0x4444444444444444444444444444444444444444" as const;
const COMMIT_KEY_1 =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const COMMIT_KEY_2 =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const ADVISORY_COMMIT_KEY =
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as const;
const QUESTION_REWARD_POOL_ESCROW =
  "0x6666666666666666666666666666666666666666" as const;
const TOO_EARLY_TLOCK_ERROR =
  "It's too early to decrypt the ciphertext - decryptable at round 27013021";
const zeroHash = `0x${"0".repeat(64)}` as const;

const {
  mockConfig,
  timelockDecrypt,
  mainnetClient,
  testnetClient,
  httpCachingChain,
  httpChainClient,
} = vi.hoisted(() => ({
  mockConfig: {
    contracts: {
      votingEngine: "0x1111111111111111111111111111111111111111",
      contentRegistry: "0x2222222222222222222222222222222222222222",
      advisoryVoteRecorder: "0x5555555555555555555555555555555555555555",
    },
    ponderBaseUrl: "https://ponder.example.test",
    keeperWorkDiscovery: {
      enabled: false,
      reconciliationEveryTicks: 120,
      maxCandidates: 500,
    },
    dormancyPeriod: 30n * 24n * 60n * 60n,
    cleanupBatchSize: 25,
    logFallbackLookbackBlocks: 300_000,
  },
  timelockDecrypt: vi.fn(),
  mainnetClient: vi.fn(() => ({ kind: "mainnet" })),
  testnetClient: vi.fn(() => ({ kind: "testnet" })),
  httpCachingChain: vi.fn(function (
    this: { url?: string; options?: unknown },
    url: string,
    options: unknown,
  ) {
    this.url = url;
    this.options = options;
  }),
  httpChainClient: vi.fn(function (
    this: {
      kind?: string;
      chain?: unknown;
      options?: unknown;
      httpOptions?: unknown;
    },
    chain: unknown,
    options: unknown,
    httpOptions: unknown,
  ) {
    this.kind = "quicknet-t";
    this.chain = chain;
    this.options = options;
    this.httpOptions = httpOptions;
  }),
}));

vi.mock("../config.js", () => ({
  config: mockConfig,
}));

vi.mock("tlock-js", () => ({
  timelockDecrypt,
  mainnetClient,
  testnetClient,
  HttpCachingChain: httpCachingChain,
  HttpChainClient: httpChainClient,
}));

import { resolveRounds, resetKeeperStateForTests } from "../keeper.js";
import { FailoverChainClient } from "../drand.js";

type RoundStateValue = 0 | 1 | 2 | 3 | 4;

interface RoundData {
  startTime: bigint;
  state: RoundStateValue;
  voteCount: bigint;
  revealedCount: bigint;
  settledAt: bigint;
  thresholdReachedAt: bigint;
}

interface CommitData {
  voter: `0x${string}`;
  stakeAmount: bigint;
  ciphertextHash: `0x${string}`;
  ciphertext: `0x${string}`;
  targetRound?: bigint;
  drandChainHash?: `0x${string}`;
  frontend: `0x${string}`;
  revealableAfter: bigint;
  revealed: boolean;
  isUp: boolean;
  epochIndex: number;
}

const MAINNET_QUICKNET_DRAND_CHAIN_HASH =
  "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971" as const;
const QUICKNET_T_DRAND_CHAIN_HASH =
  "0xcc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5" as const;

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeRound({
  state,
  voteCount,
  revealedCount,
  settledAt = 0n,
  thresholdReachedAt = 0n,
}: {
  state: RoundStateValue;
  voteCount: bigint;
  revealedCount: bigint;
  settledAt?: bigint;
  thresholdReachedAt?: bigint;
}): RoundData {
  return {
    startTime: 1n,
    state,
    voteCount,
    revealedCount,
    settledAt,
    thresholdReachedAt,
  };
}

function makeTlockCiphertext(params: {
  isUp: boolean;
  salt: `0x${string}`;
  targetRound: bigint;
  drandChainHash: `0x${string}`;
  plaintextMarker?: string;
}): `0x${string}` {
  const chunkBase64 = (input: string, chunkSize = 64): string => {
    const chunks: string[] = [];
    for (let i = 0; i < input.length; i += chunkSize) {
      chunks.push(input.slice(i, i + chunkSize));
    }
    return chunks.join("\n");
  };
  const toUnpaddedBase64 = (input: Buffer | string): string =>
    Buffer.from(input).toString("base64").replace(/=+$/u, "");
  const encryptedBody = Buffer.concat([
    Buffer.from(
      params.plaintextMarker ??
        `${params.isUp ? "1" : "0"}:${params.salt.slice(2)}`,
      "utf8",
    ),
    Buffer.alloc(
      Math.max(
        0,
        65 -
          Buffer.byteLength(
            params.plaintextMarker ??
              `${params.isUp ? "1" : "0"}:${params.salt.slice(2)}`,
            "utf8",
          ),
      ),
      0x58,
    ),
  ]);
  const recipientBody = chunkBase64(toUnpaddedBase64(Buffer.alloc(128, 0x42)));
  const mac = toUnpaddedBase64(Buffer.alloc(32, 0x24));
  const agePayload = Buffer.concat([
    Buffer.from(
      [
        "age-encryption.org/v1",
        `-> tlock ${params.targetRound.toString()} ${params.drandChainHash.slice(2)}`,
        recipientBody,
        `--- ${mac}`,
        "",
      ].join("\n"),
      "utf8",
    ),
    encryptedBody,
  ]);

  return `0x${Buffer.from(
    [
      "-----BEGIN AGE ENCRYPTED FILE-----",
      chunkBase64(agePayload.toString("base64")),
      "-----END AGE ENCRYPTED FILE-----",
      "",
    ].join("\n"),
    "utf-8",
  ).toString("hex")}` as `0x${string}`;
}

function makeCommit(overrides: Partial<CommitData> = {}): CommitData {
  const salt = `0x${"aa".repeat(32)}` as `0x${string}`;
  const targetRound = overrides.targetRound ?? 123n;
  const drandChainHash =
    overrides.drandChainHash ?? MAINNET_QUICKNET_DRAND_CHAIN_HASH;
  const ciphertext =
    overrides.ciphertext ??
    makeTlockCiphertext({
      isUp: true,
      salt,
      targetRound,
      drandChainHash,
    });
  return {
    voter: VOTER,
    stakeAmount: 100n,
    ciphertextHash: keccak256(ciphertext),
    ciphertext,
    targetRound,
    drandChainHash,
    frontend: "0x0000000000000000000000000000000000000000",
    revealableAfter: 10n,
    revealed: false,
    isUp: true,
    epochIndex: 0,
    ...overrides,
  };
}

function toRoundCoreTuple(round: RoundData) {
  return [
    round.startTime,
    round.state,
    round.voteCount,
    round.revealedCount,
    round.voteCount,
    round.thresholdReachedAt,
    round.settledAt,
  ] as const;
}

function toCommitRevealTuple(commit: CommitData) {
  return [
    commit.ciphertextHash,
    commit.targetRound ?? 0n,
    commit.drandChainHash ?? `0x${"0".repeat(64)}`,
    commit.revealableAfter,
    commit.revealed,
    commit.stakeAmount,
  ] as const;
}

function toRoundConfigTuple(config: {
  epochDuration: bigint;
  maxDuration: bigint;
  minVoters: bigint;
  maxVoters: bigint;
}) {
  return [
    config.epochDuration,
    config.maxDuration,
    config.minVoters,
    config.maxVoters,
  ] as const;
}

function makePlaintext(isUp: boolean, fillByte: number): Buffer {
  const plaintext = Buffer.alloc(36, fillByte);
  const predictedUpBps = isUp ? 8_000 : 2_000;
  plaintext.writeUInt8(2, 0);
  plaintext.writeUInt8(isUp ? 1 : 0, 1);
  plaintext.writeUInt16BE(predictedUpBps, 2);
  return plaintext;
}

function makeHarness(options: {
  now?: bigint;
  activeRoundId?: bigint;
  latestRoundId?: bigint;
  currentRoundId?: bigint;
  tupleResults?: boolean;
  dormancyEligible?: boolean;
  round: RoundData;
  roundConfig?: {
    epochDuration: bigint;
    maxDuration: bigint;
    minVoters: bigint;
    maxVoters: bigint;
  };
  commitKeys?: readonly `0x${string}`[];
  commits?: Record<string, CommitData>;
  questionRewardPoolEscrow?: `0x${string}`;
  advisoryCommitKeys?: readonly `0x${string}`[];
  advisoryCommitCores?: Record<string, unknown[]>;
  advisoryCommits?: Record<string, CommitData>;
  revealGracePeriod?: bigint;
  lastCommitRevealableAfter?: bigint;
  roundHasHumanVerifiedCommit?: boolean;
  ponderAvailable?: boolean;
  ponderCommits?: Record<string, CommitData>;
  onChainLogs?: { vote?: unknown[]; advisory?: unknown[] };
  settleRoundResultState?: RoundStateValue;
  estimateContractGas?: (args: { functionName: string }) => Promise<bigint>;
}) {
  const roundConfig = options.roundConfig || {
    epochDuration: 1200n,
    maxDuration: 604800n,
    minVoters: 3n,
    maxVoters: 1000n,
  };
  const now = options.now ?? 10_000n;
  const latestRoundId = options.latestRoundId ?? 1n;
  const activeRoundId = options.activeRoundId ?? 0n;
  const currentRoundId =
    options.currentRoundId ??
    (latestRoundId > 0n ? latestRoundId : activeRoundId);
  const tupleResults = options.tupleResults ?? false;
  const dormancyEligible = options.dormancyEligible ?? false;
  const commitKeys = options.commitKeys ?? [];
  const commits = options.commits ?? {};
  const advisoryCommitKeys = options.advisoryCommitKeys ?? [];
  const advisoryCommitCores = options.advisoryCommitCores ?? {};
  const advisoryCommits = options.advisoryCommits ?? {};
  const round = options.round;

  const fetchMock = vi.fn(async () => {
    if (options.ponderAvailable === false) {
      throw new Error("fetch failed");
    }
    const items = Object.entries(options.ponderCommits ?? commits).map(
      ([commitKey, commit]) => ({
        commitKey,
        ciphertextHash: commit.ciphertextHash,
        ciphertext: commit.ciphertext,
      }),
    );
    return {
      ok: true,
      status: 200,
      json: async () => ({ items }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);

  const publicClient = {
    getBlock: vi.fn().mockResolvedValue({ timestamp: now }),
    getBlockNumber: vi.fn().mockResolvedValue(2_000_000n),
    getLogs: vi.fn(async ({ event }: { event?: { name?: string } }) => {
      if (event?.name === "VoteCommitted") {
        return options.onChainLogs?.vote ?? [];
      }
      if (event?.name === "AdvisoryVoteRecorded") {
        return options.onChainLogs?.advisory ?? [];
      }
      return [];
    }),
    ...(options.estimateContractGas
      ? { estimateContractGas: vi.fn(options.estimateContractGas) }
      : {}),
    readContract: vi.fn(
      async ({
        functionName,
        args = [],
      }: {
        functionName: string;
        args?: readonly unknown[];
      }) => {
        switch (functionName) {
          case "nextContentId":
            return 2n;
          case "currentRoundId":
            return currentRoundId;
          case "nextRoundId":
            return latestRoundId;
          case "roundCore":
            return tupleResults ? toRoundCoreTuple(round) : round;
          case "roundConfigSnapshot":
            return tupleResults ? toRoundConfigTuple(roundConfig) : roundConfig;
          case "roundLifecycleState": {
            const revealGracePeriod = options.revealGracePeriod ?? 3600n;
            const lastRevealableAfter =
              options.lastCommitRevealableAfter ??
              Object.values(commits).reduce((max, commit) => {
                return commit.revealableAfter > max
                  ? commit.revealableAfter
                  : max;
              }, 0n);
            return tupleResults
              ? ([revealGracePeriod, lastRevealableAfter, 0n, 0n] as const)
              : {
                  revealGracePeriod,
                  lastRevealableAfter,
                  cleanupRemaining: 0n,
                  clusterPayoutReadyAt: 0n,
                };
          }
          case "isDormancyBlocked":
            return options.roundHasHumanVerifiedCommit ?? true;
          case "revealGracePeriod":
            return options.revealGracePeriod ?? 3600n;
          case "getRoundCommitKey":
            return commitKeys[Number(args[2])] ?? zeroHash;
          case "commitRevealData":
            return tupleResults
              ? toCommitRevealTuple(
                  commits[String(args[2])] ??
                    makeCommit({ revealed: true, stakeAmount: 0n }),
                )
              : (commits[String(args[2])] ??
                  makeCommit({ revealed: true, stakeAmount: 0n }));
          case "questionRewardPoolEscrow":
            return (
              options.questionRewardPoolEscrow ??
              "0x0000000000000000000000000000000000000000"
            );
          case "contents": {
            const lastActivityAt = dormancyEligible
              ? now - mockConfig.dormancyPeriod - 1n
              : now;
            return tupleResults
              ? ([
                  args[0] ?? 1n,
                  zeroHash,
                  ACCOUNT,
                  1n,
                  lastActivityAt,
                  0,
                  0,
                  "0x0000000000000000000000000000000000000000",
                  50,
                  1n,
                ] as const)
              : {
                  id: args[0] ?? 1n,
                  contentHash: zeroHash,
                  submitter: ACCOUNT,
                  createdAt: 1n,
                  lastActivityAt,
                  status: 0,
                  dormantCount: 0,
                  reviver: "0x0000000000000000000000000000000000000000",
                  rating: 50,
                  categoryId: 1n,
                };
          }
          case "roundAdvisoryCommitCount":
            return BigInt(advisoryCommitKeys.length);
          case "getRoundAdvisoryCommitKey":
            return advisoryCommitKeys[Number(args[2])] ?? zeroHash;
          case "advisoryCommitRevealData":
            return (
              advisoryCommits[String(args[0])] ??
              makeCommit({ revealed: true, stakeAmount: 0n })
            );
          case "advisoryCommitCore":
            return (
              advisoryCommitCores[String(args[0])] ?? [
                "0x0000000000000000000000000000000000000000",
                0n,
                0n,
                0n,
                false,
                false,
                false,
                false,
                true,
              ]
            );
          default:
            throw new Error(`Unexpected readContract(${functionName})`);
        }
      },
    ),
  };

  const walletClient = {
    writeContract: vi.fn(
      async ({
        functionName,
        args,
      }: {
        functionName: string;
        args: readonly unknown[];
      }) => {
        if (functionName === "finalizeRevealFailedRound") {
          round.state = 4;
          round.settledAt = now;
          return "0xfinalized";
        }

        if (functionName === "processUnrevealedVotes") {
          const startIndex = Number(args[2]);
          const count = Number(args[3]);
          const endIndex = Math.min(commitKeys.length, startIndex + count);
          let processed = false;
          for (let i = startIndex; i < endIndex; i++) {
            const commit = commits[String(commitKeys[i])];
            if (commit && !commit.revealed && commit.stakeAmount > 0n) {
              commit.stakeAmount = 0n;
              processed = true;
            }
          }
          if (!processed) {
            throw new Error("NothingProcessed");
          }
          return "0xcleanup";
        }

        if (functionName === "revealVoteByCommitKey") {
          const commitKey = String(args[2]);
          const commit = commits[commitKey];
          if (!commit || commit.revealed) {
            throw new Error("AlreadyRevealed");
          }
          commit.revealed = true;
          round.revealedCount += 1n;
          const rbtsRevealQuorum =
            roundConfig.minVoters > 3n ? roundConfig.minVoters : 3n;
          if (
            round.revealedCount >= rbtsRevealQuorum &&
            round.thresholdReachedAt === 0n
          ) {
            round.thresholdReachedAt = now;
          }
          return "0xrevealed";
        }

        if (functionName === "settleRound") {
          round.state = options.settleRoundResultState ?? 1;
          if (round.state !== 0) {
            round.settledAt = now;
          }
          return "0xsettled";
        }

        if (functionName === "syncBundleQuestionTerminal") {
          return "0xsync";
        }

        if (functionName === "revealAdvisoryVote") {
          const commitKey = String(args[0]);
          const commit = advisoryCommits[commitKey];
          if (!commit || commit.revealed) {
            throw new Error("AlreadyRevealed");
          }
          commit.revealed = true;
          return "0xadvisoryrevealed";
        }

        if (functionName === "claimAdvisoryLaunchCredit") {
          const commitKey = String(args[0]);
          const core = advisoryCommitCores[commitKey];
          if (core) {
            core[8] = true;
          }
          return "0xadvisoryclaim";
        }

        if (functionName === "cancelExpiredRound") {
          round.state = 2;
          return "0xcancelled";
        }

        if (functionName === "markDormant") {
          return "0xdormant";
        }

        throw new Error(`Unexpected writeContract(${functionName})`);
      },
    ),
  };

  return { publicClient, walletClient, round, commits, fetchMock };
}

describe("resolveRounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockConfig.keeperWorkDiscovery.enabled = false;
    mockConfig.keeperWorkDiscovery.reconciliationEveryTicks = 120;
    mockConfig.keeperWorkDiscovery.maxCandidates = 500;
    mockConfig.cleanupBatchSize = 25;
    resetKeeperStateForTests();
  });

  it("uses Ponder keeper work candidates without scanning every content id", async () => {
    mockConfig.keeperWorkDiscovery.enabled = true;

    const round = makeRound({
      state: 1,
      voteCount: 0n,
      revealedCount: 0n,
    });
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 0n,
      latestRoundId: 0n,
      round,
      dormancyEligible: true,
      now: 3_000_000n,
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      expect(url.pathname).toBe("/keeper/work");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          openRounds: [],
          cleanupRounds: [],
          dormantContent: [{ contentId: "1", reason: "dormant" }],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result.contentMarkedDormant).toBe(1);
    expect(publicClient.readContract).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "nextContentId" }),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "markDormant",
        args: [1n],
      }),
    );
  });

  it("finalizes reveal-failed rounds and cleans up unrevealed stake", async () => {
    timelockDecrypt.mockRejectedValue(new Error("beacon unavailable"));

    const round = makeRound({
      state: 0,
      voteCount: 3n,
      revealedCount: 2n,
    });
    const commit = makeCommit({
      revealableAfter: 100n,
    });
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      commitKeys: [COMMIT_KEY_1],
      commits: {
        [COMMIT_KEY_1]: commit,
      },
      revealGracePeriod: 60n,
      lastCommitRevealableAfter: 100n,
      now: 610_000n,
    });
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result).toMatchObject({
      roundsRevealFailedFinalized: 1,
      cleanupBatchesProcessed: 1,
      roundsSettled: 0,
      roundsCancelled: 0,
      votesRevealed: 0,
      roundsAwaitingRevealQuorum: 1,
      minRevealGraceSecondsRemaining: 0,
    });
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "finalizeRevealFailedRound" }),
    );
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "processUnrevealedVotes" }),
    );
  });

  it("reveals and settles a round once reveal quorum is met", async () => {
    timelockDecrypt
      .mockResolvedValueOnce(makePlaintext(true, 1))
      .mockResolvedValueOnce(makePlaintext(true, 2))
      .mockResolvedValueOnce(makePlaintext(false, 3));

    const round = makeRound({
      state: 0,
      voteCount: 3n,
      revealedCount: 0n,
    });
    const { publicClient, walletClient, commits, fetchMock } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      commitKeys: [
        COMMIT_KEY_1,
        COMMIT_KEY_2,
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      ],
      commits: {
        [COMMIT_KEY_1]: makeCommit({ revealableAfter: 100n }),
        [COMMIT_KEY_2]: makeCommit({ revealableAfter: 100n }),
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc":
          makeCommit({
            revealableAfter: 100n,
            isUp: false,
          }),
      },
      now: 1_000n,
    });
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result).toMatchObject({
      votesRevealed: 3,
      roundsSettled: 1,
      roundsRevealFailedFinalized: 0,
    });
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "settleRound" }),
    );
    expect(commits[COMMIT_KEY_1].revealed).toBe(true);
    expect(commits[COMMIT_KEY_2].revealed).toBe(true);
    expect(round.state).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not count RBTS seed capture as terminal settlement", async () => {
    const round = makeRound({
      state: 0,
      voteCount: 3n,
      revealedCount: 3n,
    });
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      questionRewardPoolEscrow: QUESTION_REWARD_POOL_ESCROW,
      settleRoundResultState: 0,
      now: 1_000n,
    });
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result).toMatchObject({
      roundsSettled: 0,
      advisoryLaunchCreditsClaimed: 0,
      cleanupBatchesProcessed: 0,
    });
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "settleRound" }),
    );
    expect(walletClient.writeContract).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "syncBundleQuestionTerminal" }),
    );
    expect(round.state).toBe(0);
    expect(logger.info).toHaveBeenCalledWith(
      "Captured RBTS settlement seed",
      expect.objectContaining({
        contentId: "1",
        roundId: 1,
      }),
    );
  });

  it("reveals a World Chain Sepolia quicknet-t commit with the quicknet-t client", async () => {
    timelockDecrypt.mockResolvedValueOnce(makePlaintext(true, 1));

    const round = makeRound({
      state: 0,
      voteCount: 1n,
      revealedCount: 0n,
    });
    const { publicClient, walletClient, commits } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      commitKeys: [COMMIT_KEY_1],
      commits: {
        [COMMIT_KEY_1]: makeCommit({
          revealableAfter: 100n,
          drandChainHash: QUICKNET_T_DRAND_CHAIN_HASH,
        }),
      },
      now: 1_000n,
    });
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result.votesRevealed).toBe(1);
    expect(commits[COMMIT_KEY_1].revealed).toBe(true);
    expect(vi.mocked(timelockDecrypt).mock.calls[0]?.[1]).toBeInstanceOf(
      FailoverChainClient,
    );
    expect(httpChainClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining(QUICKNET_T_DRAND_CHAIN_HASH.slice(2)),
      }),
      expect.any(Object),
      { userAgent: "rateloop-keeper" },
    );
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "revealVoteByCommitKey" }),
    );
  });

  it("paginates indexed vote ciphertexts beyond the first Ponder page", async () => {
    timelockDecrypt.mockResolvedValueOnce(makePlaintext(true, 1));

    const round = makeRound({
      state: 0,
      voteCount: 1n,
      revealedCount: 0n,
    });
    const commit = makeCommit({ revealableAfter: 100n });
    const { publicClient, walletClient, commits } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      commitKeys: [COMMIT_KEY_1],
      commits: {
        [COMMIT_KEY_1]: commit,
      },
      now: 1_000n,
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      const offset = url.searchParams.get("offset");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items:
            offset === "0"
              ? Array.from({ length: 200 }, (_, index) => ({
                  commitKey: `0x${index.toString(16).padStart(64, "0")}`,
                }))
              : [
                  {
                    commitKey: COMMIT_KEY_1,
                    ciphertextHash: commit.ciphertextHash,
                    ciphertext: commit.ciphertext,
                  },
                ],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result.votesRevealed).toBe(1);
    expect(commits[COMMIT_KEY_1].revealed).toBe(true);
    expect(
      fetchMock.mock.calls.map(([input]) =>
        new URL(input.toString()).searchParams.get("offset"),
      ),
    ).toEqual(["0", "200"]);
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "revealVoteByCommitKey" }),
    );
  });

  it("syncs bundle question terminal after settling a round", async () => {
    const round = makeRound({
      state: 0,
      voteCount: 3n,
      revealedCount: 3n,
    });
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      questionRewardPoolEscrow: QUESTION_REWARD_POOL_ESCROW,
      now: 1_000n,
    });
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result.roundsSettled).toBe(1);
    expect(walletClient.writeContract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        functionName: "settleRound",
        args: [1n, 1n],
      }),
    );
    expect(walletClient.writeContract).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        address: QUESTION_REWARD_POOL_ESCROW,
        functionName: "syncBundleQuestionTerminal",
        args: [1n, 1n],
      }),
    );
  });

  it("claims revealed advisory launch credits after settlement", async () => {
    const round = makeRound({
      state: 0,
      voteCount: 3n,
      revealedCount: 3n,
    });
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      advisoryCommitKeys: [ADVISORY_COMMIT_KEY],
      advisoryCommitCores: {
        [ADVISORY_COMMIT_KEY]: [
          VOTER,
          1n,
          1n,
          0n,
          true,
          true,
          false,
          false,
          false,
        ],
      },
      now: 1_000n,
    });
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result.advisoryLaunchCreditsClaimed).toBe(1);
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "claimAdvisoryLaunchCredit",
        args: [ADVISORY_COMMIT_KEY],
      }),
    );
  });

  it("treats malformed tlock ciphertext metadata as a permanent failure without decrypting", async () => {
    const round = makeRound({
      state: 0,
      voteCount: 1n,
      revealedCount: 0n,
    });
    const badCommit = makeCommit({ revealableAfter: 100n });
    badCommit.ciphertext = "0x1234";
    badCommit.ciphertextHash = keccak256(badCommit.ciphertext);
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      commitKeys: [COMMIT_KEY_1],
      commits: {
        [COMMIT_KEY_1]: badCommit,
      },
      now: 1_000n,
    });
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result.votesRevealed).toBe(0);
    expect(timelockDecrypt).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "tlock ciphertext metadata invalid",
      expect.objectContaining({
        contentId: "1",
        roundId: "1",
        commitKey: COMMIT_KEY_1,
        permanent: true,
        error: "malformed tlock ciphertext metadata",
      }),
    );
    expect(walletClient.writeContract).not.toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "revealVoteByCommitKey",
      }),
    );
  });

  it("treats shallow pseudo-tlock envelopes as a permanent failure without decrypting", async () => {
    const round = makeRound({
      state: 0,
      voteCount: 1n,
      revealedCount: 0n,
    });
    const badCommit = makeCommit({ revealableAfter: 100n });
    badCommit.ciphertext = `0x${Buffer.from(
      [
        "-----BEGIN AGE ENCRYPTED FILE-----",
        Buffer.from(
          [
            "age-encryption.org/v1",
            `-> tlock ${badCommit.targetRound!.toString()} ${badCommit.drandChainHash!.slice(2)}`,
            "payload 1:" + "11".repeat(32),
            "--- bWFj",
          ].join("\n"),
          "binary",
        ).toString("base64"),
        "-----END AGE ENCRYPTED FILE-----",
        "",
      ].join("\n"),
      "utf8",
    ).toString("hex")}` as `0x${string}`;
    badCommit.ciphertextHash = keccak256(badCommit.ciphertext);
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      commitKeys: [COMMIT_KEY_1],
      commits: {
        [COMMIT_KEY_1]: badCommit,
      },
      now: 1_000n,
    });
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result.votesRevealed).toBe(0);
    expect(timelockDecrypt).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "tlock ciphertext metadata invalid",
      expect.objectContaining({
        contentId: "1",
        roundId: "1",
        commitKey: COMMIT_KEY_1,
        permanent: true,
        error: "malformed tlock ciphertext metadata",
      }),
    );
  });

  it("treats mismatched tlock metadata as a permanent failure without decrypting", async () => {
    const round = makeRound({
      state: 0,
      voteCount: 1n,
      revealedCount: 0n,
    });
    const badCommit = makeCommit({ revealableAfter: 100n });
    badCommit.targetRound = badCommit.targetRound! + 1n;
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      commitKeys: [COMMIT_KEY_1],
      commits: {
        [COMMIT_KEY_1]: badCommit,
      },
      now: 1_000n,
    });
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result.votesRevealed).toBe(0);
    expect(timelockDecrypt).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "tlock ciphertext metadata invalid",
      expect.objectContaining({
        contentId: "1",
        roundId: "1",
        commitKey: COMMIT_KEY_1,
        permanent: true,
        error: expect.stringContaining("tlock metadata mismatch"),
      }),
    );
  });

  it("keeps retrying when tlock says the ciphertext is not decryptable yet", async () => {
    timelockDecrypt.mockRejectedValue(new Error(TOO_EARLY_TLOCK_ERROR));

    const round = makeRound({
      state: 0,
      voteCount: 1n,
      revealedCount: 0n,
    });
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      commitKeys: [COMMIT_KEY_1],
      commits: {
        [COMMIT_KEY_1]: makeCommit({ revealableAfter: 100n }),
      },
      now: 1_000n,
    });
    const logger = makeLogger();

    for (let i = 0; i < 12; i++) {
      await resolveRounds(
        publicClient as any,
        walletClient as any,
        {} as any,
        { address: ACCOUNT } as any,
        logger as any,
      );
    }

    expect(timelockDecrypt).toHaveBeenCalledTimes(12);
    expect(walletClient.writeContract).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "revealVoteByCommitKey" }),
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      "tlock decryption failed",
      expect.anything(),
    );
    expect(logger.error).not.toHaveBeenCalledWith(
      "tlock decryption failed",
      expect.anything(),
    );
    expect(logger.debug).toHaveBeenCalledTimes(12);
    expect(logger.debug).toHaveBeenLastCalledWith(
      "tlock ciphertext not decryptable yet",
      expect.objectContaining({
        contentId: "1",
        roundId: "1",
        commitKey: COMMIT_KEY_1,
        decryptableAtRound: "27013021",
        error: TOO_EARLY_TLOCK_ERROR,
      }),
    );
  });

  it("stops retrying permanently bad ciphertext after the max retry budget", async () => {
    timelockDecrypt.mockRejectedValue(new Error("beacon unavailable"));

    const round = makeRound({
      state: 0,
      voteCount: 1n,
      revealedCount: 0n,
    });
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      commitKeys: [COMMIT_KEY_1],
      commits: {
        [COMMIT_KEY_1]: makeCommit({ revealableAfter: 100n }),
      },
      now: 1_000n,
    });
    const logger = makeLogger();

    for (let i = 0; i < 12; i++) {
      await resolveRounds(
        publicClient as any,
        walletClient as any,
        {} as any,
        { address: ACCOUNT } as any,
        logger as any,
      );
    }

    expect(timelockDecrypt).toHaveBeenCalledTimes(10);
    expect(logger.warn).toHaveBeenCalledTimes(9);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenLastCalledWith(
      "tlock decryption failed",
      expect.objectContaining({
        contentId: "1",
        roundId: "1",
        commitKey: COMMIT_KEY_1,
        attempt: 10,
        permanent: true,
        error: "beacon unavailable",
      }),
    );
    expect(logger.warn).toHaveBeenLastCalledWith(
      "tlock decryption failed",
      expect.objectContaining({
        contentId: "1",
        roundId: "1",
        commitKey: COMMIT_KEY_1,
        attempt: 9,
        permanent: false,
        error: "beacon unavailable",
      }),
    );
    expect(walletClient.writeContract).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "revealVoteByCommitKey" }),
    );
  });

  it("handles tuple-shaped viem reads from live contracts", async () => {
    timelockDecrypt
      .mockResolvedValueOnce(makePlaintext(true, 1))
      .mockResolvedValueOnce(makePlaintext(true, 2))
      .mockResolvedValueOnce(makePlaintext(false, 3));

    const round = makeRound({
      state: 0,
      voteCount: 3n,
      revealedCount: 0n,
    });
    const { publicClient, walletClient, commits } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      tupleResults: true,
      round,
      commitKeys: [
        COMMIT_KEY_1,
        COMMIT_KEY_2,
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      ],
      commits: {
        [COMMIT_KEY_1]: makeCommit({ revealableAfter: 100n }),
        [COMMIT_KEY_2]: makeCommit({ revealableAfter: 100n }),
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc":
          makeCommit({
            revealableAfter: 100n,
            isUp: false,
          }),
      },
      now: 1_000n,
    });
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result).toMatchObject({
      votesRevealed: 3,
      roundsSettled: 1,
    });
    expect(commits[COMMIT_KEY_1].revealed).toBe(true);
    expect(commits[COMMIT_KEY_2].revealed).toBe(true);
    expect(round.state).toBe(1);
  });

  it("processes terminal-round cleanup in configured batches", async () => {
    mockConfig.cleanupBatchSize = 1;

    const round = makeRound({
      state: 1,
      voteCount: 2n,
      revealedCount: 2n,
      settledAt: 500n,
      thresholdReachedAt: 400n,
    });
    const { publicClient, walletClient, commits } = makeHarness({
      activeRoundId: 0n,
      latestRoundId: 1n,
      round,
      commitKeys: [COMMIT_KEY_1, COMMIT_KEY_2],
      commits: {
        [COMMIT_KEY_1]: makeCommit({ revealableAfter: 100n }),
        [COMMIT_KEY_2]: makeCommit({ revealableAfter: 200n }),
      },
      now: 1_000n,
    });
    const logger = makeLogger();

    const firstResult = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(firstResult.cleanupBatchesProcessed).toBe(1);
    expect(walletClient.writeContract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        functionName: "processUnrevealedVotes",
        args: [1n, 1n, 0n, 1n],
      }),
    );

    const secondResult = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(secondResult.cleanupBatchesProcessed).toBe(1);
    expect(walletClient.writeContract).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        functionName: "processUnrevealedVotes",
        args: [1n, 1n, 1n, 1n],
      }),
    );
    expect(commits[COMMIT_KEY_1].stakeAmount).toBe(0n);
    expect(commits[COMMIT_KEY_2].stakeAmount).toBe(0n);
  });

  it("cancels an expired below-quorum round at the exact deadline", async () => {
    timelockDecrypt.mockReset();

    const round = makeRound({
      state: 0,
      voteCount: 2n,
      revealedCount: 0n,
    });
    round.startTime = 100n;
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      roundConfig: {
        epochDuration: 1200n,
        maxDuration: 900n,
        minVoters: 3n,
        maxVoters: 1000n,
      },
      now: 1_000n,
    });
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result.roundsCancelled).toBe(1);
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "cancelExpiredRound" }),
    );
  });

  it("cancels an expired quorum round with no human verified commit", async () => {
    timelockDecrypt.mockReset();

    const round = makeRound({
      state: 0,
      voteCount: 3n,
      revealedCount: 0n,
    });
    round.startTime = 100n;
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      roundConfig: {
        epochDuration: 1200n,
        maxDuration: 900n,
        minVoters: 3n,
        maxVoters: 1000n,
      },
      now: 1_000n,
      roundHasHumanVerifiedCommit: false,
      revealGracePeriod: 60n,
      lastCommitRevealableAfter: 200n,
    });
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result).toMatchObject({
      roundsCancelled: 1,
      roundsRevealFailedFinalized: 0,
    });
    expect(publicClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "isDormancyBlocked",
        args: [1n],
      }),
    );
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "cancelExpiredRound" }),
    );
    expect(walletClient.writeContract).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "finalizeRevealFailedRound" }),
    );
  });

  it("does not finalize reveal-failed before maxDuration even when reveal grace has passed", async () => {
    timelockDecrypt.mockRejectedValue(new Error("beacon unavailable"));

    const round = makeRound({
      state: 0,
      voteCount: 3n,
      revealedCount: 2n,
    });
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      roundConfig: {
        epochDuration: 1200n,
        maxDuration: 5_000n,
        minVoters: 3n,
        maxVoters: 1000n,
      },
      commitKeys: [COMMIT_KEY_1],
      commits: {
        [COMMIT_KEY_1]: makeCommit({ revealableAfter: 100n }),
      },
      revealGracePeriod: 60n,
      lastCommitRevealableAfter: 950n,
      now: 1_000n,
    });
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result.roundsRevealFailedFinalized).toBe(0);
    expect(walletClient.writeContract).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "finalizeRevealFailedRound" }),
    );
    // The round is reported as at-risk with the time left until finalization
    // eligibility: (startTime 1 + maxDuration 5000 + 24x grace 60) - now 1000.
    expect(result.roundsAwaitingRevealQuorum).toBe(1);
    expect(result.minRevealGraceSecondsRemaining).toBe(5441);
  });

  it("does not finalize reveal-failed when ciphertexts are unavailable from all sources", async () => {
    timelockDecrypt.mockResolvedValue(makePlaintext(true, 1));

    const round = makeRound({
      state: 0,
      voteCount: 3n,
      revealedCount: 2n,
    });
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      commitKeys: [COMMIT_KEY_1],
      commits: {
        [COMMIT_KEY_1]: makeCommit({ revealableAfter: 100n }),
      },
      // Ponder is down and the on-chain log fallback yields nothing.
      ponderAvailable: false,
      revealGracePeriod: 60n,
      lastCommitRevealableAfter: 100n,
      now: 610_000n,
    });
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result.roundsRevealFailedFinalized).toBe(0);
    expect(walletClient.writeContract).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "finalizeRevealFailedRound" }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Skipping reveal-failed finalization; reveal pipeline was unhealthy this tick",
      expect.objectContaining({ contentId: "1", roundId: 1 }),
    );
  });

  it("does not finalize reveal-failed when every drand relay is unavailable", async () => {
    const relayOutage = new Error(
      "All drand relays failed fetching beacon round 123",
    );
    relayOutage.name = "DrandUnavailableError";
    timelockDecrypt.mockRejectedValue(relayOutage);

    const round = makeRound({
      state: 0,
      voteCount: 3n,
      revealedCount: 2n,
    });
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      commitKeys: [COMMIT_KEY_1],
      commits: {
        [COMMIT_KEY_1]: makeCommit({ revealableAfter: 100n }),
      },
      revealGracePeriod: 60n,
      lastCommitRevealableAfter: 100n,
      now: 610_000n,
    });
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result.roundsRevealFailedFinalized).toBe(0);
    expect(walletClient.writeContract).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "finalizeRevealFailedRound" }),
    );
    // A relay outage must not burn the commit's permanent decrypt-failure budget.
    expect(logger.warn).toHaveBeenCalledWith(
      "All drand relays unavailable; retrying next tick",
      expect.objectContaining({ commitKey: COMMIT_KEY_1 }),
    );
  });

  it("reveals votes from on-chain VoteCommitted logs when Ponder is unavailable", async () => {
    timelockDecrypt.mockResolvedValue(makePlaintext(true, 1));

    const commitHash = `0x${"11".repeat(32)}` as const;
    const commitKey = keccak256(
      encodePacked(["address", "bytes32"], [VOTER, commitHash]),
    );
    const commit = makeCommit({ revealableAfter: 100n });
    const round = makeRound({ state: 0, voteCount: 3n, revealedCount: 2n });
    const { publicClient, walletClient, fetchMock } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      commitKeys: [commitKey],
      commits: { [commitKey]: commit },
      ponderAvailable: false,
      onChainLogs: {
        vote: [
          {
            args: {
              contentId: 1n,
              roundId: 1n,
              voter: VOTER,
              commitHash,
              ciphertextHash: commit.ciphertextHash,
              ciphertext: commit.ciphertext,
            },
          },
        ],
      },
      now: 10_000n,
    });
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(fetchMock).toHaveBeenCalled();
    expect(publicClient.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        address: mockConfig.contracts.votingEngine,
        args: { contentId: 1n, roundId: 1n },
      }),
    );
    expect(result.votesRevealed).toBe(1);
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "revealVoteByCommitKey",
        args: expect.arrayContaining([commitKey]),
      }),
    );
  });

  it("falls back to on-chain logs for commits missing from the Ponder response", async () => {
    timelockDecrypt.mockResolvedValue(makePlaintext(true, 1));

    const commitHash = `0x${"22".repeat(32)}` as const;
    const commitKey = keccak256(
      encodePacked(["address", "bytes32"], [VOTER, commitHash]),
    );
    const commit = makeCommit({ revealableAfter: 100n });
    const round = makeRound({ state: 0, voteCount: 3n, revealedCount: 2n });
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      commitKeys: [commitKey],
      commits: { [commitKey]: commit },
      // Ponder responds, but its index is lagging and is missing this commit.
      ponderCommits: {},
      onChainLogs: {
        vote: [
          {
            args: {
              contentId: 1n,
              roundId: 1n,
              voter: VOTER,
              commitHash,
              ciphertextHash: commit.ciphertextHash,
              ciphertext: commit.ciphertext,
            },
          },
        ],
      },
      now: 10_000n,
    });
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result.votesRevealed).toBe(1);
    expect(publicClient.getLogs).toHaveBeenCalled();
  });

  it("rejects fallback ciphertexts whose bytes do not match the on-chain hash", async () => {
    timelockDecrypt.mockResolvedValue(makePlaintext(true, 1));

    const commitHash = `0x${"33".repeat(32)}` as const;
    const commitKey = keccak256(
      encodePacked(["address", "bytes32"], [VOTER, commitHash]),
    );
    const commit = makeCommit({ revealableAfter: 100n });
    const forged = makeTlockCiphertext({
      isUp: false,
      salt: `0x${"bb".repeat(32)}`,
      targetRound: commit.targetRound!,
      drandChainHash: commit.drandChainHash!,
    });
    const round = makeRound({ state: 0, voteCount: 3n, revealedCount: 2n });
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      commitKeys: [commitKey],
      commits: { [commitKey]: commit },
      ponderAvailable: false,
      onChainLogs: {
        vote: [
          {
            args: {
              contentId: 1n,
              roundId: 1n,
              voter: VOTER,
              commitHash,
              // Claims the expected hash but carries different bytes.
              ciphertextHash: commit.ciphertextHash,
              ciphertext: forged,
            },
          },
        ],
      },
      now: 10_000n,
    });
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result.votesRevealed).toBe(0);
    expect(walletClient.writeContract).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "revealVoteByCommitKey" }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      "Indexed ciphertext bytes do not hash to on-chain ciphertext hash",
      expect.objectContaining({ commitKey }),
    );
  });

  it("reveals advisory votes from on-chain logs when Ponder is unavailable", async () => {
    timelockDecrypt.mockResolvedValue(makePlaintext(true, 1));

    const advisoryCommit = makeCommit({ revealableAfter: 100n });
    const round = makeRound({ state: 0, voteCount: 0n, revealedCount: 0n });
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      ponderAvailable: false,
      advisoryCommitKeys: [ADVISORY_COMMIT_KEY],
      advisoryCommits: { [ADVISORY_COMMIT_KEY]: advisoryCommit },
      advisoryCommitCores: {
        [ADVISORY_COMMIT_KEY]: [
          VOTER,
          0n,
          0n,
          0n,
          false,
          true,
          false,
          false,
          true,
        ],
      },
      onChainLogs: {
        advisory: [
          {
            args: {
              contentId: 1n,
              roundId: 1n,
              voter: VOTER,
              advisoryCommitKey: ADVISORY_COMMIT_KEY,
              ciphertextHash: advisoryCommit.ciphertextHash,
              ciphertext: advisoryCommit.ciphertext,
            },
          },
        ],
      },
      now: 10_000n,
    });
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result.advisoryVotesRevealed).toBe(1);
    expect(publicClient.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        address: mockConfig.contracts.advisoryVoteRecorder,
      }),
    );
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "revealAdvisoryVote",
        args: expect.arrayContaining([ADVISORY_COMMIT_KEY]),
      }),
    );
  });

  it("skips broadcasting silently when gas estimation reverts with an expected reason", async () => {
    const round = makeRound({
      state: 0,
      voteCount: 3n,
      revealedCount: 3n,
    });
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      now: 1_000n,
      estimateContractGas: async ({ functionName }) => {
        if (functionName === "settleRound") {
          throw new Error("ThresholdReached");
        }
        return 100_000n;
      },
    });
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result.roundsSettled).toBe(0);
    expect(walletClient.writeContract).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "settleRound" }),
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      "Failed to settle round",
      expect.anything(),
    );
  });

  it("warns without broadcasting when gas estimation reverts unexpectedly", async () => {
    const round = makeRound({
      state: 0,
      voteCount: 3n,
      revealedCount: 3n,
    });
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      now: 1_000n,
      estimateContractGas: async ({ functionName }) => {
        if (functionName === "settleRound") {
          throw new Error("SomethingWentVeryWrong");
        }
        return 100_000n;
      },
    });
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result.roundsSettled).toBe(0);
    expect(walletClient.writeContract).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "settleRound" }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Failed to settle round",
      expect.objectContaining({ error: "SomethingWentVeryWrong" }),
    );
  });
});
