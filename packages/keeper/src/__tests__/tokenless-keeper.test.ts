import { beforeEach, describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import {
  resetTokenlessKeeperStateForTests,
  runTokenlessKeeper,
  validateTokenlessKeeperDeployment,
  type TokenlessKeeperClients,
} from "../keeper.js";
import type { Logger } from "../logger.js";
import { TokenlessPanelAbi } from "../tokenless-abi.js";
import {
  TokenlessRoundState,
  type TokenlessRound,
} from "../tokenless-types.js";

const PANEL = "0x0000000000000000000000000000000000000011";
const ISSUER = "0x0000000000000000000000000000000000000022";
const ADAPTER = "0x0000000000000000000000000000000000000023";
const VOTE_KEY = "0x0000000000000000000000000000000000000033" as Address;
const PAYOUT = "0x0000000000000000000000000000000000000044" as Address;
const COMMIT_KEY = `0x${"55".repeat(32)}` as Hex;
const SEALED_PAYLOAD = "0x1234" as Hex;
const RESPONSE_HASH = `0x${"66".repeat(32)}` as Hex;
const SALT = `0x${"77".repeat(32)}` as Hex;
const ADMISSION_POLICY_HASH = `0x${"99".repeat(32)}` as Hex;

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const config = {
  chainId: 84532,
  deployment: {
    key: `tokenless-v2:84532:${PANEL}:${ISSUER}:0x0000000000000000000000000000000000000000`,
    blockNumber: 100n,
    panel: PANEL,
    credentialIssuer: ISSUER,
    x402PanelSubmitter: "0x0000000000000000000000000000000000000000",
  },
  maxRoundsPerTick: 100,
  settlementBatchSize: 25,
  maxCiphertextBytes: 16384,
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
    compensationPerRecipient: 0n,
    totalAccuracyScore: 0n,
    totalPaid: 0n,
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
    frozenRevealCount: 0,
    aggregateCursor: 0,
    weightCursor: 0,
    upVotes: 0,
    state: TokenlessRoundState.Open,
    staleReturned: false,
    ...overrides,
  };
}

function clients(params: {
  currentRound: TokenlessRound;
  now?: bigint;
  writes?: string[];
  commitClaimed?: boolean;
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
        return 1000n;
      },
      async getBlock() {
        return { timestamp: params.now ?? 150n };
      },
      async getBytecode({ address }: { address: Address }) {
        return address === PANEL || address === ISSUER ? "0x6000" : undefined;
      },
      async getBalance() {
        return 1n;
      },
      async waitForTransactionReceipt() {},
      async getLogs() {
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
          case "nextRoundId":
            return 2n;
          case "getRound":
            return currentRound;
          case "getCommit":
            return {
              roundId: 1n,
              voteKey: VOTE_KEY,
              sealedCommitment: `0x${"11".repeat(32)}`,
              sealedPayloadHash: `0x${"22".repeat(32)}`,
              payoutCommitment: `0x${"33".repeat(32)}`,
              responseHash: RESPONSE_HASH,
              accuracyScore: 0n,
              predictedUpBps: 7000,
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
  it("uses the policy-bound v2 round tuple", () => {
    const getRound = TokenlessPanelAbi.find(
      (entry) => entry.type === "function" && entry.name === "getRound"
    );
    expect(getRound?.outputs[0]?.components).toContainEqual(
      expect.objectContaining({
        name: "admissionPolicyHash",
        type: "bytes32",
      })
    );
    expect(getRound?.outputs[0]?.components).toContainEqual(
      expect.objectContaining({ name: "claimDeadline", type: "uint256" })
    );
    expect(
      getRound?.outputs[0]?.components.some(
        (component) => String(component.name) === "requiredTier"
      )
    ).toBe(false);
  });

  it("fails closed when panel issuer wiring differs", async () => {
    const instance = clients({ currentRound: round() });
    instance.publicClient.readContract = async () =>
      "0x00000000000000000000000000000000000000ff";
    await expect(
      validateTokenlessKeeperDeployment(instance, config)
    ).rejects.toThrow(/credentialIssuer does not match/);
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
      })
    ).rejects.toThrow(/X402_PANEL_SUBMITTER_ADDRESS has no deployed bytecode/);
  });

  it("opens and reveals without any privileged role", async () => {
    const writes: string[] = [];
    const result = await runTokenlessKeeper(
      clients({ currentRound: round(), writes, now: 150n }),
      config,
      logger,
      decrypt
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
      decrypt
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
      }
    );
    expect(unavailableWrites).toEqual(["openReveal"]);
    expect(unavailable.selfRevealFallbacksPending).toBe(1);
    expect(unavailable.roundsAwaitingBeaconFailure).toBe(1);
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
      decrypt
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
      decrypt
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
      decrypt
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
      decrypt
    );
    expect(terminalWrites).toContain("beginSettlement");
    expect(result.terminalRoundsAdvanced).toBe(1);
  });

  it("processes both settlement phases and finalizes", async () => {
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
      decrypt
    );
    expect(aggregateWrites).toContain("processAggregate");

    resetTokenlessKeeperStateForTests();
    const finalWrites: string[] = [];
    await runTokenlessKeeper(
      clients({
        currentRound: round({
          state: TokenlessRoundState.Weighting,
          frozenRevealCount: 3,
          weightCursor: 3,
        }),
        writes: finalWrites,
      }),
      config,
      logger,
      decrypt
    );
    expect(finalWrites).toContain("finalizeSettlement");
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
      decrypt
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
      decrypt
    );
    expect(staleWrites).toContain("returnStaleShares");
  });
});
