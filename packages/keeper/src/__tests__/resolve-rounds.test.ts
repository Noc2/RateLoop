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
const FEEDBACK_BONUS_ESCROW =
  "0x7777777777777777777777777777777777777777" as const;
const FEEDBACK_REGISTRY =
  "0x8888888888888888888888888888888888888888" as const;
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
    chainId: 31337,
    contracts: {
      votingEngine: "0x1111111111111111111111111111111111111111",
      contentRegistry: "0x2222222222222222222222222222222222222222",
      feedbackRegistry: "0x8888888888888888888888888888888888888888",
      advisoryVoteRecorder: "0x5555555555555555555555555555555555555555",
      feedbackBonusEscrow: "0x7777777777777777777777777777777777777777",
    },
    ponderBaseUrl: "https://ponder.example.test",
    keeperWorkDiscovery: {
      enabled: false,
      reconciliationEveryTicks: 120,
      maxCandidates: 500,
      chainScanPerTick: 5,
    },
    proactiveRoundOpening: {
      enabled: false,
      maxPerTick: 2,
      recentSeconds: 6n * 60n * 60n,
    },
    rewardPoolQualifications: {
      enabled: true,
      maxRoundsPerTick: 25,
      maxBundleSyncsPerTick: 10,
      bundleMaxRoundsPerSync: 25,
    },
    feedbackBonusForfeits: {
      enabled: true,
      maxPoolsPerTick: 25,
      minAgeSeconds: 60,
    },
    dormancyPeriod: 30n * 24n * 60n * 60n,
    cleanupBatchSize: 25,
    logFallbackLookbackBlocks: 300_000,
    maxGasPerTx: 2_000_000,
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
import { getMetricsText } from "../metrics.js";

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

function matchingPonderDeployment() {
  return {
    configured: true,
    chainId: mockConfig.chainId,
    contentRegistryAddress: mockConfig.contracts.contentRegistry,
    feedbackRegistryAddress: mockConfig.contracts.feedbackRegistry,
    deploymentKey: `${mockConfig.chainId}:${mockConfig.contracts.contentRegistry.toLowerCase()}:${mockConfig.contracts.feedbackRegistry.toLowerCase()}`,
  };
}

function countNonDeploymentFetches(fetchMock: { mock: { calls: Array<[RequestInfo | URL, ...unknown[]]> } }) {
  return fetchMock.mock.calls.filter(([input]) => !new URL(input.toString()).pathname.endsWith("/deployment")).length;
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
  commitRevealDataErrorFor?: readonly `0x${string}`[];
  revealVoteErrorFor?: readonly `0x${string}`[];
  qualifyRoundErrors?: Record<string, string>;
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
  const commitRevealDataErrorFor = new Set(options.commitRevealDataErrorFor ?? []);
  const revealVoteErrorFor = new Set(options.revealVoteErrorFor ?? []);
  const qualifyRoundErrors = options.qualifyRoundErrors ?? {};
  const advisoryCommitKeys = options.advisoryCommitKeys ?? [];
  const advisoryCommitCores = options.advisoryCommitCores ?? {};
  const advisoryCommits = options.advisoryCommits ?? {};
  const round = options.round;

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (options.ponderAvailable === false) {
      throw new Error("fetch failed");
    }
    const url = new URL(input.toString());
    if (url.pathname.endsWith("/deployment")) {
      return {
        ok: true,
        status: 200,
        json: async () => matchingPonderDeployment(),
      };
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
            if (commitRevealDataErrorFor.has(String(args[2]) as `0x${string}`)) {
              throw new Error("RPC read failed");
            }
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
          if (revealVoteErrorFor.has(commitKey as `0x${string}`)) {
            throw new Error("transaction underpriced");
          }
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

        if (functionName === "qualifyRound") {
          const key = `${String(args[0])}:${String(args[1])}`;
          const error = qualifyRoundErrors[key];
          if (error) {
            throw new Error(error);
          }
          return "0xqualify";
        }

        if (functionName === "advanceQualificationCursor") {
          return "0xadvancequalificationcursor";
        }

        if (functionName === "syncQuestionBundleTerminals") {
          return "0xbundlesync";
        }

        if (functionName === "openRound") {
          return "0xopenround";
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

        if (functionName === "forfeitExpiredFeedbackBonus") {
          return "0xfeedbackbonusforfeit";
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
    mockConfig.proactiveRoundOpening.enabled = false;
    mockConfig.proactiveRoundOpening.maxPerTick = 2;
    mockConfig.proactiveRoundOpening.recentSeconds = 6n * 60n * 60n;
    mockConfig.rewardPoolQualifications.enabled = true;
    mockConfig.rewardPoolQualifications.maxRoundsPerTick = 25;
    mockConfig.rewardPoolQualifications.maxBundleSyncsPerTick = 10;
    mockConfig.rewardPoolQualifications.bundleMaxRoundsPerSync = 25;
    mockConfig.feedbackBonusForfeits.enabled = true;
    mockConfig.feedbackBonusForfeits.maxPoolsPerTick = 25;
    mockConfig.feedbackBonusForfeits.minAgeSeconds = 60;
    mockConfig.contracts.feedbackBonusEscrow = FEEDBACK_BONUS_ESCROW;
    mockConfig.cleanupBatchSize = 25;
    mockConfig.ponderBaseUrl = "https://ponder.example.test";
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
    const requestSignals: Array<AbortSignal | null | undefined> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestSignals.push(init?.signal);
      const url = new URL(input.toString());
      if (url.pathname === "/deployment") {
        return {
          ok: true,
          status: 200,
          json: async () => matchingPonderDeployment(),
        };
      }
      expect(url.pathname).toBe("/keeper/work");
      expect(url.searchParams.get("feedbackBonusForfeitMinAge")).toBe("60");
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
    expect(publicClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "nextContentId" }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestSignals).toHaveLength(2);
    expect(requestSignals[0]).toBeInstanceOf(AbortSignal);
    expect(requestSignals[1]).toBeInstanceOf(AbortSignal);
    expect(requestSignals[1]).not.toBe(requestSignals[0]);
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "markDormant",
        args: [1n],
      }),
    );
  });

  it("exports the oldest settle-ready backlog age from Ponder work discovery", async () => {
    mockConfig.keeperWorkDiscovery.enabled = true;
    mockConfig.keeperWorkDiscovery.reconciliationEveryTicks = 2;

    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 0n,
      latestRoundId: 0n,
      round: makeRound({ state: 1, voteCount: 0n, revealedCount: 0n }),
      now: 3_000n,
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.pathname === "/deployment") {
        return {
          ok: true,
          status: 200,
          json: async () => matchingPonderDeployment(),
        };
      }
      expect(url.pathname).toBe("/keeper/work");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          openRounds: [
            {
              contentId: "1",
              roundId: "1",
              reason: "settle",
              settlementReadyAt: "2500",
            },
            {
              contentId: "2",
              roundId: "1",
              reason: "settle",
              settlementReadyAt: "2000",
            },
            {
              contentId: "3",
              roundId: "1",
              reason: "reveal",
              settlementReadyAt: "1000",
            },
          ],
          cleanupRounds: [],
          dormantContent: [],
          feedbackBonusForfeits: [],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      makeLogger() as any,
    );

    expect(getMetricsText()).toContain(
      "keeper_settlement_backlog_oldest_seconds 1000",
    );
  });

  it("proactively opens requested rating rounds from Ponder work discovery", async () => {
    mockConfig.keeperWorkDiscovery.enabled = true;
    mockConfig.proactiveRoundOpening.enabled = true;
    mockConfig.proactiveRoundOpening.maxPerTick = 1;
    mockConfig.proactiveRoundOpening.recentSeconds = 900n;

    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 0n,
      latestRoundId: 0n,
      round: makeRound({ state: 1, voteCount: 0n, revealedCount: 0n }),
      now: 3_000_000n,
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.pathname === "/deployment") {
        return {
          ok: true,
          status: 200,
          json: async () => matchingPonderDeployment(),
        };
      }
      expect(url.pathname).toBe("/keeper/work");
      expect(url.searchParams.get("roundOpenLimit")).toBe("1");
      expect(url.searchParams.get("roundOpenRecentSeconds")).toBe("900");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          roundOpenRequests: [{ contentId: "1", reason: "proactive_open" }],
          openRounds: [],
          cleanupRounds: [],
          dormantContent: [],
          feedbackBonusForfeits: [],
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

    expect(result.roundsOpened).toBe(1);
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "openRound",
        args: [1n],
      }),
    );
  });

  it("qualifies reward pool rounds returned by Ponder work discovery", async () => {
    mockConfig.keeperWorkDiscovery.enabled = true;

    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 0n,
      latestRoundId: 0n,
      round: makeRound({ state: 1, voteCount: 0n, revealedCount: 0n }),
      now: 3_000_000n,
      questionRewardPoolEscrow: QUESTION_REWARD_POOL_ESCROW,
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.pathname === "/deployment") {
        return {
          ok: true,
          status: 200,
          json: async () => matchingPonderDeployment(),
        };
      }
      expect(url.pathname).toBe("/keeper/work");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          openRounds: [],
          cleanupRounds: [],
          dormantContent: [],
          feedbackBonusForfeits: [],
          rewardPoolQualifications: [
            {
              rewardPoolId: "42",
              contentId: "9",
              roundId: "3",
              reason: "reward_pool_qualification",
            },
          ],
          bundleTerminalSyncs: [],
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

    expect(result.rewardPoolRoundsQualified).toBe(1);
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: QUESTION_REWARD_POOL_ESCROW,
        functionName: "qualifyRound",
        args: [42n, 3n],
      }),
    );
  });

  it("advances non-qualifying reward pool cursor rounds before later candidates", async () => {
    mockConfig.keeperWorkDiscovery.enabled = true;

    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 0n,
      latestRoundId: 0n,
      round: makeRound({ state: 1, voteCount: 0n, revealedCount: 0n }),
      now: 3_000_000n,
      questionRewardPoolEscrow: QUESTION_REWARD_POOL_ESCROW,
      qualifyRoundErrors: {
        "42:3": "Too few eligible voters",
      },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.pathname === "/deployment") {
        return {
          ok: true,
          status: 200,
          json: async () => matchingPonderDeployment(),
        };
      }
      expect(url.pathname).toBe("/keeper/work");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          openRounds: [],
          cleanupRounds: [],
          dormantContent: [],
          feedbackBonusForfeits: [],
          rewardPoolQualifications: [
            {
              rewardPoolId: "42",
              contentId: "9",
              roundId: "3",
              reason: "reward_pool_qualification",
            },
            {
              rewardPoolId: "42",
              contentId: "9",
              roundId: "4",
              reason: "reward_pool_qualification",
            },
          ],
          bundleTerminalSyncs: [],
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

    expect(result.rewardPoolRoundsQualified).toBe(1);
    const rewardPoolWrites = walletClient.writeContract.mock.calls.map(
      ([request]) => ({
        functionName: request.functionName,
        args: request.args,
      }),
    );
    expect(rewardPoolWrites).toEqual([
      { functionName: "qualifyRound", args: [42n, 3n] },
      { functionName: "qualifyRound", args: [42n, 3n] },
      { functionName: "qualifyRound", args: [42n, 3n] },
      { functionName: "advanceQualificationCursor", args: [42n, 1n] },
      { functionName: "qualifyRound", args: [42n, 4n] },
    ]);
  });

  it("does not advance reward pool cursor before the bounty window opens", async () => {
    mockConfig.keeperWorkDiscovery.enabled = true;

    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 0n,
      latestRoundId: 0n,
      round: makeRound({ state: 1, voteCount: 0n, revealedCount: 0n }),
      now: 3_000_000n,
      questionRewardPoolEscrow: QUESTION_REWARD_POOL_ESCROW,
      qualifyRoundErrors: {
        "42:3": "Bounty not started",
      },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.pathname === "/deployment") {
        return {
          ok: true,
          status: 200,
          json: async () => matchingPonderDeployment(),
        };
      }
      expect(url.pathname).toBe("/keeper/work");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          openRounds: [],
          cleanupRounds: [],
          dormantContent: [],
          feedbackBonusForfeits: [],
          rewardPoolQualifications: [
            {
              rewardPoolId: "42",
              contentId: "9",
              roundId: "3",
              reason: "reward_pool_qualification",
            },
          ],
          bundleTerminalSyncs: [],
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

    expect(result.rewardPoolRoundsQualified).toBe(0);
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: QUESTION_REWARD_POOL_ESCROW,
        functionName: "qualifyRound",
        args: [42n, 3n],
      }),
    );
    expect(walletClient.writeContract).not.toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "advanceQualificationCursor",
      }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("treats pending cluster snapshots as expected qualification waits", async () => {
    mockConfig.keeperWorkDiscovery.enabled = true;

    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 0n,
      latestRoundId: 0n,
      round: makeRound({ state: 1, voteCount: 0n, revealedCount: 0n }),
      now: 3_000_000n,
      questionRewardPoolEscrow: QUESTION_REWARD_POOL_ESCROW,
      qualifyRoundErrors: {
        "42:3": "Cluster snapshot pending",
      },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.pathname === "/deployment") {
        return {
          ok: true,
          status: 200,
          json: async () => matchingPonderDeployment(),
        };
      }
      expect(url.pathname).toBe("/keeper/work");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          openRounds: [],
          cleanupRounds: [],
          dormantContent: [],
          feedbackBonusForfeits: [],
          rewardPoolQualifications: [
            {
              rewardPoolId: "42",
              contentId: "9",
              roundId: "3",
              reason: "reward_pool_qualification",
            },
          ],
          bundleTerminalSyncs: [],
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

    expect(result.rewardPoolRoundsQualified).toBe(0);
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: QUESTION_REWARD_POOL_ESCROW,
        functionName: "qualifyRound",
        args: [42n, 3n],
      }),
    );
    expect(walletClient.writeContract).not.toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "advanceQualificationCursor",
      }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("syncs bounded question bundle terminals returned by Ponder work discovery", async () => {
    mockConfig.keeperWorkDiscovery.enabled = true;
    mockConfig.rewardPoolQualifications.maxBundleSyncsPerTick = 1;
    mockConfig.rewardPoolQualifications.bundleMaxRoundsPerSync = 9;

    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 0n,
      latestRoundId: 0n,
      round: makeRound({ state: 1, voteCount: 0n, revealedCount: 0n }),
      now: 3_000_000n,
      questionRewardPoolEscrow: QUESTION_REWARD_POOL_ESCROW,
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.pathname === "/deployment") {
        return {
          ok: true,
          status: 200,
          json: async () => matchingPonderDeployment(),
        };
      }
      expect(url.pathname).toBe("/keeper/work");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          openRounds: [],
          cleanupRounds: [],
          dormantContent: [],
          feedbackBonusForfeits: [],
          rewardPoolQualifications: [],
          bundleTerminalSyncs: [
            { bundleId: "31", reason: "bundle_terminal_sync" },
            { bundleId: "32", reason: "bundle_terminal_sync" },
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

    expect(result.questionBundleTerminalSyncs).toBe(1);
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: QUESTION_REWARD_POOL_ESCROW,
        functionName: "syncQuestionBundleTerminals",
        args: [31n, 9n],
      }),
    );
    expect(walletClient.writeContract).not.toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "syncQuestionBundleTerminals",
        args: [32n, 9n],
      }),
    );
  });

  it("fails closed in production when Ponder deployment metadata does not match", async () => {
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
      now: 3_000_000n,
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      expect(url.pathname).toBe("/deployment");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ...matchingPonderDeployment(),
          chainId: 8453,
          contentRegistryAddress: "0x9999999999999999999999999999999999999999",
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const logger = makeLogger();
    const originalNodeEnv = process.env.NODE_ENV;
    const originalKeeperWorkToken = process.env.PONDER_KEEPER_WORK_TOKEN;
    process.env.NODE_ENV = "production";
    process.env.PONDER_KEEPER_WORK_TOKEN = "test-token";

    try {
      await expect(
        resolveRounds(
          publicClient as any,
          walletClient as any,
          {} as any,
          { address: ACCOUNT } as any,
          logger as any,
        ),
      ).rejects.toThrow(/Ponder deployment does not match keeper config/);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalKeeperWorkToken === undefined) {
        delete process.env.PONDER_KEEPER_WORK_TOKEN;
      } else {
        process.env.PONDER_KEEPER_WORK_TOKEN = originalKeeperWorkToken;
      }
    }
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("fails closed in production when Ponder FeedbackRegistry metadata does not match", async () => {
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
      now: 3_000_000n,
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      expect(url.pathname).toBe("/deployment");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ...matchingPonderDeployment(),
          feedbackRegistryAddress: "0x9999999999999999999999999999999999999999",
          deploymentKey: `${mockConfig.chainId}:${mockConfig.contracts.contentRegistry.toLowerCase()}:0x9999999999999999999999999999999999999999`,
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const logger = makeLogger();
    const originalNodeEnv = process.env.NODE_ENV;
    const originalKeeperWorkToken = process.env.PONDER_KEEPER_WORK_TOKEN;
    process.env.NODE_ENV = "production";
    process.env.PONDER_KEEPER_WORK_TOKEN = "test-token";

    try {
      await expect(
        resolveRounds(
          publicClient as any,
          walletClient as any,
          {} as any,
          { address: ACCOUNT } as any,
          logger as any,
        ),
      ).rejects.toThrow(/feedbackRegistryAddress=.* expected/);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalKeeperWorkToken === undefined) {
        delete process.env.PONDER_KEEPER_WORK_TOKEN;
      } else {
        process.env.PONDER_KEEPER_WORK_TOKEN = originalKeeperWorkToken;
      }
    }
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("preserves path-prefixed Ponder URLs for keeper work discovery", async () => {
    mockConfig.keeperWorkDiscovery.enabled = true;
    mockConfig.ponderBaseUrl = "https://ponder.example.test/indexer";

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
      if (url.pathname === "/indexer/deployment") {
        return {
          ok: true,
          status: 200,
          json: async () => matchingPonderDeployment(),
        };
      }
      expect(url.pathname).toBe("/indexer/keeper/work");
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("merges a bounded chain content scan with Ponder keeper work candidates", async () => {
    mockConfig.keeperWorkDiscovery.enabled = true;
    mockConfig.keeperWorkDiscovery.chainScanPerTick = 3;

    const round = makeRound({
      state: 1,
      voteCount: 0n,
      revealedCount: 0n,
    });
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 0n,
      latestRoundId: 0n,
      round,
      now: 3_000_000n,
    });
    publicClient.readContract.mockImplementation(
      async ({
        functionName,
        args = [],
      }: {
        functionName: string;
        args?: readonly unknown[];
      }) => {
        if (functionName === "nextContentId") {
          return 100n;
        }
        if (functionName === "contents") {
          return {
            id: args[0] ?? 1n,
            contentHash: zeroHash,
            submitter: ACCOUNT,
            createdAt: 1n,
            lastActivityAt: 3_000_000n,
            status: 0,
            dormantCount: 0,
            reviver: "0x0000000000000000000000000000000000000000",
            rating: 50,
            categoryId: 1n,
          };
        }
        if (functionName === "currentRoundId") {
          return 0n;
        }
        if (functionName === "nextRoundId") {
          return 0n;
        }
        throw new Error(`Unexpected readContract(${functionName})`);
      },
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.pathname === "/deployment") {
        return {
          ok: true,
          status: 200,
          json: async () => matchingPonderDeployment(),
        };
      }
      expect(url.pathname).toBe("/keeper/work");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          openRounds: [],
          cleanupRounds: [],
          dormantContent: [{ contentId: "99", reason: "dormant" }],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const logger = makeLogger();

    await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    const processedContentIds = publicClient.readContract.mock.calls
      .filter(
        (call: [{ functionName?: string }]) =>
          call[0]?.functionName === "contents",
      )
      .map((call: [{ args?: readonly unknown[] }]) => call[0]?.args?.[0]);
    expect(processedContentIds).toEqual(
      expect.arrayContaining([1n, 2n, 3n, 99n]),
    );
  });

  it("forfeits expired Feedback Bonus pools discovered by Ponder", async () => {
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
      now: 3_000_000n,
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.pathname === "/deployment") {
        return {
          ok: true,
          status: 200,
          json: async () => matchingPonderDeployment(),
        };
      }
      expect(url.pathname).toBe("/keeper/work");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          openRounds: [],
          cleanupRounds: [],
          dormantContent: [],
          feedbackBonusForfeits: [
            {
              poolId: "7",
              contentId: "9",
              roundId: "2",
              awardDeadline: "2999900",
              remainingAmount: "1000000",
              reason: "feedback_bonus_forfeit",
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

    expect(result.feedbackBonusPoolsForfeited).toBe(1);
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: FEEDBACK_BONUS_ESCROW,
        functionName: "forfeitExpiredFeedbackBonus",
        args: [7n],
      }),
    );
  });

  it("skips stale Feedback Bonus forfeit candidates without broadcasting", async () => {
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
      now: 3_000_000n,
      estimateContractGas: async ({ functionName }) => {
        if (functionName === "forfeitExpiredFeedbackBonus") {
          throw new Error("Not expired");
        }
        return 100n;
      },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.pathname === "/deployment") {
        return {
          ok: true,
          status: 200,
          json: async () => matchingPonderDeployment(),
        };
      }
      expect(url.pathname).toBe("/keeper/work");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          openRounds: [],
          cleanupRounds: [],
          dormantContent: [],
          feedbackBonusForfeits: [
            {
              poolId: "7",
              contentId: "9",
              roundId: "2",
              awardDeadline: "2999900",
              remainingAmount: "1000000",
              reason: "feedback_bonus_forfeit",
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

    expect(result.feedbackBonusPoolsForfeited).toBe(0);
    expect(walletClient.writeContract).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      "Skipped Feedback Bonus forfeit candidate",
      expect.objectContaining({
        poolId: "7",
        error: "Not expired",
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
    expect(countNonDeploymentFetches(fetchMock)).toBe(1);
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

  it("reveals a testnet quicknet-t commit with the quicknet-t client", async () => {
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
      if (url.pathname === "/deployment") {
        return {
          ok: true,
          status: 200,
          json: async () => matchingPonderDeployment(),
        };
      }
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
      ).filter((offset): offset is string => offset !== null),
    ).toEqual(["0", "200"]);
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "revealVoteByCommitKey" }),
    );
  });

  it("returns partial indexed ciphertexts when a later Ponder page fails", async () => {
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
      if (url.pathname === "/deployment") {
        return {
          ok: true,
          status: 200,
          json: async () => matchingPonderDeployment(),
        };
      }
      const offset = url.searchParams.get("offset");
      if (offset === "0") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                commitKey: COMMIT_KEY_1,
                ciphertextHash: commit.ciphertextHash,
                ciphertext: commit.ciphertext,
              },
              ...Array.from({ length: 199 }, (_, index) => ({
                commitKey: `0x${(index + 1).toString(16).padStart(64, "0")}`,
              })),
            ],
          }),
        };
      }
      return {
        ok: false,
        status: 503,
        json: async () => ({}),
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
    expect(logger.warn).toHaveBeenCalledWith(
      "Failed to fetch indexed vote ciphertext",
      expect.objectContaining({ status: 503 }),
    );
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "revealVoteByCommitKey" }),
    );
  });

  it("re-verifies Ponder deployment on every production tick and fails on mismatch", async () => {
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
      now: 3_000_000n,
    });
    const stableDeployment = matchingPonderDeployment();
    const mismatchedDeploymentKey = `${stableDeployment.deploymentKey}:repoint`;
    let deploymentFetchCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.pathname === "/deployment") {
        deploymentFetchCount += 1;
        if (deploymentFetchCount === 2) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ...stableDeployment,
              deploymentKey: mismatchedDeploymentKey,
              chainId: 8453,
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => stableDeployment,
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          openRounds: [],
          cleanupRounds: [],
          dormantContent: [],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const logger = makeLogger();
    const originalNodeEnv = process.env.NODE_ENV;
    const originalKeeperWorkToken = process.env.PONDER_KEEPER_WORK_TOKEN;
    process.env.NODE_ENV = "production";
    process.env.PONDER_KEEPER_WORK_TOKEN = "test-token";

    try {
      await resolveRounds(
        publicClient as any,
        walletClient as any,
        {} as any,
        { address: ACCOUNT } as any,
        logger as any,
      );
      await expect(
        resolveRounds(
          publicClient as any,
          walletClient as any,
          {} as any,
          { address: ACCOUNT } as any,
          logger as any,
        ),
      ).rejects.toThrow(/Ponder deployment does not match keeper config/);
      await resolveRounds(
        publicClient as any,
        walletClient as any,
        {} as any,
        { address: ACCOUNT } as any,
        logger as any,
      );
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalKeeperWorkToken === undefined) {
        delete process.env.PONDER_KEEPER_WORK_TOKEN;
      } else {
        process.env.PONDER_KEEPER_WORK_TOKEN = originalKeeperWorkToken;
      }
    }

    expect(deploymentFetchCount).toBe(3);
  });

  it("warns when the indexed ciphertext page limit truncates a round", async () => {
    const round = makeRound({
      state: 0,
      voteCount: 1n,
      revealedCount: 0n,
    });
    const commit = makeCommit({ revealableAfter: 100n });
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 1n,
      latestRoundId: 1n,
      round,
      commitKeys: [COMMIT_KEY_1],
      commits: {
        [COMMIT_KEY_1]: commit,
      },
      now: 1_000n,
    });
    // Every page is full of other commits, so pagination hits the page cap without
    // ever returning a short page.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.pathname === "/deployment") {
        return {
          ok: true,
          status: 200,
          json: async () => matchingPonderDeployment(),
        };
      }
      const offset = Number(url.searchParams.get("offset"));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: Array.from({ length: 200 }, (_, index) => ({
            commitKey: `0x${(offset + index + 1).toString(16).padStart(64, "0")}`,
          })),
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

    expect(result.votesRevealed).toBe(0);
    expect(countNonDeploymentFetches(fetchMock)).toBe(6);
    expect(logger.warn).toHaveBeenCalledWith(
      "Indexed ciphertext page limit reached; commits beyond the limit fall back to on-chain logs",
      expect.objectContaining({
        kind: "vote",
        contentId: 1,
        roundId: 1,
        maxCommits: 1_200,
      }),
    );
    expect(walletClient.writeContract).not.toHaveBeenCalledWith(
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

  it("does not finalize reveal-failed when commit reveal data is unreadable", async () => {
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
      commitRevealDataErrorFor: [COMMIT_KEY_1],
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

  it("does not finalize reveal-failed when reveal submission fails transiently", async () => {
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
      revealVoteErrorFor: [COMMIT_KEY_1],
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
      "Failed to reveal vote",
      expect.objectContaining({
        commitKey: COMMIT_KEY_1,
        error: "transaction underpriced",
      }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Skipping reveal-failed finalization; reveal pipeline was unhealthy this tick",
      expect.objectContaining({ contentId: "1", roundId: 1 }),
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

  it("marks eligible content dormant", async () => {
    const round = makeRound({ state: 1, voteCount: 0n, revealedCount: 0n });
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 0n,
      latestRoundId: 1n,
      round,
      dormancyEligible: true,
      now: 10_000_000n,
    });
    const logger = makeLogger();

    const result = await resolveRounds(
      publicClient as any,
      walletClient as any,
      {} as any,
      { address: ACCOUNT } as any,
      logger as any,
    );

    expect(result.contentMarkedDormant).toBe(1);
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "markDormant", args: [1n] }),
    );
  });

  it.each([
    // ContentRegistry gates markDormant on dormancyAnchorAt and contentBundleId, neither
    // of which is exposed via a view — the keeper discovers them via the pre-broadcast
    // estimation revert and must treat both as expected skips.
    ["Bundled content"],
    ["Dormancy period not elapsed"],
  ])("treats a %s dormancy revert as an expected skip", async revertReason => {
    const round = makeRound({ state: 1, voteCount: 0n, revealedCount: 0n });
    const { publicClient, walletClient } = makeHarness({
      activeRoundId: 0n,
      latestRoundId: 1n,
      round,
      dormancyEligible: true,
      now: 10_000_000n,
      estimateContractGas: async ({ functionName }) => {
        if (functionName === "markDormant") {
          throw new Error(revertReason);
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

    expect(result.contentMarkedDormant).toBe(0);
    expect(walletClient.writeContract).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "markDormant" }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalledWith(
      "Could not check dormancy",
      expect.anything(),
    );
  });

  it("rejects when the current block time cannot be resolved", async () => {
    const round = makeRound({ state: 0, voteCount: 0n, revealedCount: 0n });
    const { publicClient, walletClient } = makeHarness({ round });
    publicClient.getBlock.mockRejectedValue(new Error("rpc down"));
    const logger = makeLogger();

    // Total RPC outage must propagate so tick() records an error and /health degrades,
    // instead of looking like an endless successful empty run.
    await expect(
      resolveRounds(
        publicClient as any,
        walletClient as any,
        {} as any,
        { address: ACCOUNT } as any,
        logger as any,
      ),
    ).rejects.toThrow(/Cannot resolve current block time/);
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("rejects when the content registry cannot be read", async () => {
    const round = makeRound({ state: 0, voteCount: 0n, revealedCount: 0n });
    const { publicClient, walletClient } = makeHarness({ round });
    publicClient.readContract.mockImplementation(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "nextContentId") {
          throw new Error("connection refused");
        }
        throw new Error(`Unexpected readContract(${functionName})`);
      },
    );
    const logger = makeLogger();

    await expect(
      resolveRounds(
        publicClient as any,
        walletClient as any,
        {} as any,
        { address: ACCOUNT } as any,
        logger as any,
      ),
    ).rejects.toThrow(/Keeper work discovery failed: connection refused/);
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });
});
