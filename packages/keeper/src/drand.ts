import {
  PINNED_DRAND_CHAINS,
  verifyDrandBeaconEvidence as verifyPinnedDrandBeaconEvidence,
  type DrandChainInfo,
  type PinnedDrandChain,
} from "@rateloop/node-utils/drand";
import { HttpCachingChain, HttpChainClient, type ChainClient } from "tlock-js";
import { type Hex } from "viem";
import { incrementCounter } from "./metrics.js";

type DrandChain = ReturnType<ChainClient["chain"]>;

export const MAINNET_QUICKNET_CHAIN_HASH =
  PINNED_DRAND_CHAINS.quicknet.chainHash;
export const QUICKNET_T_CHAIN_HASH =
  PINNED_DRAND_CHAINS["quicknet-t"].chainHash;
export const QUICKNET_T_GENESIS_SECONDS = 1_689_232_296n;
export const QUICKNET_T_PERIOD_SECONDS = 3n;
export const QUICKNET_T_SCORING_MARGIN_SECONDS = 24n * 60n * 60n;
export const QUICKNET_T_MINIMUM_REVEAL_WINDOW_SECONDS = 5n * 60n;
export const QUICKNET_T_MINIMUM_BEACON_GRACE_SECONDS = 6n * 60n * 60n;
export const DRAND_RELAY_REQUEST_TIMEOUT_MS = 5_000;

const MAX_UINT64 = (1n << 64n) - 1n;

function normalizeDrandChainHash(chainHash: `0x${string}` | string) {
  const normalized = chainHash.toLowerCase().replace(/^0x/u, "");
  if (!/^[0-9a-f]{64}$/u.test(normalized)) {
    throw new Error("Invalid drand chain hash");
  }
  return normalized;
}

function assertUint64(value: bigint, label: string) {
  if (value < 0n || value > MAX_UINT64) {
    throw new Error(`Frozen scoring beacon ${label} is outside uint64.`);
  }
}

export function firstQuicknetTRoundAfter(timestamp: bigint) {
  if (timestamp < 0n) {
    throw new Error("Quicknet-t cutoff timestamp cannot be negative.");
  }
  if (timestamp < QUICKNET_T_GENESIS_SECONDS) return 1n;
  return (
    (timestamp - QUICKNET_T_GENESIS_SECONDS) / QUICKNET_T_PERIOD_SECONDS + 2n
  );
}

export function quicknetTRoundTimestamp(round: bigint) {
  assertUint64(round, "round");
  if (round === 0n) {
    throw new Error("Frozen scoring beacon round must be positive.");
  }
  return QUICKNET_T_GENESIS_SECONDS + (round - 1n) * QUICKNET_T_PERIOD_SECONDS;
}

export function validateQuicknetTScoringSchedule(params: {
  beaconNetworkHash: Hex;
  commitDeadline: bigint;
  revealDeadline: bigint;
  beaconFailureDeadline: bigint;
  beaconRound: bigint;
  scoringBeaconRound: bigint;
}) {
  if (
    normalizeDrandChainHash(params.beaconNetworkHash) !== QUICKNET_T_CHAIN_HASH
  ) {
    throw new Error(
      "Frozen scoring beacon schedule must use the pinned quicknet-t network.",
    );
  }
  assertUint64(params.commitDeadline, "commit deadline");
  assertUint64(params.revealDeadline, "reveal deadline");
  assertUint64(params.beaconFailureDeadline, "failure deadline");
  assertUint64(params.beaconRound, "disclosure round");
  assertUint64(params.scoringBeaconRound, "scoring round");

  const expectedDisclosureRound = firstQuicknetTRoundAfter(
    params.commitDeadline,
  );
  const expectedScoringRound = firstQuicknetTRoundAfter(
    params.revealDeadline + QUICKNET_T_SCORING_MARGIN_SECONDS,
  );
  if (
    params.revealDeadline <
      params.commitDeadline + QUICKNET_T_MINIMUM_REVEAL_WINDOW_SECONDS ||
    params.beaconRound !== expectedDisclosureRound ||
    params.scoringBeaconRound !== expectedScoringRound
  ) {
    throw new Error(
      "Frozen scoring beacon schedule does not match the immutable quicknet-t timing rules.",
    );
  }

  const scoringTimestamp = quicknetTRoundTimestamp(expectedScoringRound);
  if (
    params.beaconFailureDeadline <
    scoringTimestamp + QUICKNET_T_MINIMUM_BEACON_GRACE_SECONDS
  ) {
    throw new Error(
      "Frozen scoring beacon failure deadline is shorter than the immutable grace.",
    );
  }
  return scoringTimestamp;
}

interface DrandChainSpec {
  chain: PinnedDrandChain;
  relayHosts: readonly string[];
}

const CHAINS: readonly DrandChainSpec[] = [
  {
    chain: PINNED_DRAND_CHAINS.quicknet,
    relayHosts: [
      "https://api.drand.sh",
      "https://api2.drand.sh",
      "https://api3.drand.sh",
      "https://drand.cloudflare.com",
    ],
  },
  {
    chain: PINNED_DRAND_CHAINS["quicknet-t"],
    relayHosts: [
      "https://testnet-api.drand.cloudflare.com",
      "https://pl-us.testnet.drand.sh",
    ],
  },
];

export class DrandUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrandUnavailableError";
  }
}

export class FailoverChainClient implements ChainClient {
  readonly options: ChainClient["options"];
  private preferredIndex = 0;

  constructor(
    private readonly clients: readonly ChainClient[],
    private readonly requestTimeoutMs = DRAND_RELAY_REQUEST_TIMEOUT_MS,
  ) {
    if (clients.length === 0) {
      throw new Error("FailoverChainClient requires at least one relay client");
    }
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new Error("Drand relay request timeout must be positive");
    }
    this.options = clients[0].options;
  }

  latest(): ReturnType<ChainClient["latest"]> {
    return this.withFailover("latest beacon", (client) => client.latest());
  }

  get(roundNumber: number): ReturnType<ChainClient["get"]> {
    return this.withFailover(`beacon round ${roundNumber}`, (client) =>
      client.get(roundNumber),
    );
  }

  chain(): DrandChain {
    return {
      baseUrl: this.clients[this.preferredIndex].chain().baseUrl,
      info: () =>
        this.withFailover("chain info", (client) => client.chain().info()),
    };
  }

  private async withFailover<T>(
    label: string,
    request: (client: ChainClient) => Promise<T>,
  ) {
    const failures: string[] = [];
    for (let attempt = 0; attempt < this.clients.length; attempt += 1) {
      const index = (this.preferredIndex + attempt) % this.clients.length;
      const client = this.clients[index];
      try {
        const value = await this.withDeadline(label, client, request);
        this.preferredIndex = index;
        return value;
      } catch (error) {
        failures.push(
          `${client.chain().baseUrl}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        if (attempt < this.clients.length - 1) {
          incrementCounter("keeper_drand_relay_failovers_total");
        }
      }
    }
    throw new DrandUnavailableError(
      `All drand relays failed fetching ${label}: ${failures.join("; ")}`,
    );
  }

  private withDeadline<T>(
    label: string,
    client: ChainClient,
    request: (client: ChainClient) => Promise<T>,
  ) {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(`${label} timed out after ${this.requestTimeoutMs}ms`),
        );
      }, this.requestTimeoutMs);
      void Promise.resolve()
        .then(() => request(client))
        .then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (error: unknown) => {
            clearTimeout(timer);
            reject(error);
          },
        );
    });
  }
}

function relayClient(spec: DrandChainSpec, host: string): ChainClient {
  const options = {
    disableBeaconVerification: false,
    noCache: false,
    chainVerificationParams: {
      chainHash: spec.chain.chainHash,
      publicKey: spec.chain.publicKey,
    },
  };
  const chain = new HttpCachingChain(
    `${host}/${spec.chain.chainHash}`,
    options,
  );
  return new HttpChainClient(chain, options, {
    userAgent: "rateloop-tokenless-keeper",
  });
}

const cache = new Map<string, ChainClient>();

export function resetTlockClientCacheForTests() {
  cache.clear();
}

export function resolveTlockClientForDrandChain(
  chainHash: `0x${string}` | string,
) {
  const normalized = normalizeDrandChainHash(chainHash);
  const configuredChainId = Number(process.env.CHAIN_ID ?? 0);
  if (configuredChainId === 84532 && normalized !== QUICKNET_T_CHAIN_HASH) {
    throw new Error(
      `Base Sepolia tokenless keeper requires quicknet-t chain 0x${QUICKNET_T_CHAIN_HASH}.`,
    );
  }
  const spec = CHAINS.find(
    (candidate) => candidate.chain.chainHash === normalized,
  );
  if (!spec) {
    throw new Error(`Unsupported drand chain 0x${normalized}.`);
  }
  let client = cache.get(normalized);
  if (!client) {
    client = new FailoverChainClient(
      spec.relayHosts.map((host) => relayClient(spec, host)),
    );
    cache.set(normalized, client);
  }
  return client;
}

export interface VerifiedDrandBeacon {
  randomness: Hex;
  proof: Hex;
}

function pinnedChainInfo(chain: PinnedDrandChain): DrandChainInfo {
  return {
    public_key: chain.publicKey,
    period: chain.period,
    genesis_time: chain.genesisTime,
    hash: chain.chainHash,
    groupHash: chain.groupHash,
    schemeID: chain.schemeId,
    metadata: { beaconID: chain.beaconId },
  };
}

export function validateDrandBeaconEvidence(
  beacon: {
    round: number;
    randomness: string;
    signature: string;
    previous_signature?: string;
  },
  expectedRound: number,
  chain: PinnedDrandChain = PINNED_DRAND_CHAINS["quicknet-t"],
  chainInfo: DrandChainInfo = pinnedChainInfo(chain),
): VerifiedDrandBeacon {
  const verified = verifyPinnedDrandBeaconEvidence({
    chain,
    chainInfo,
    beacon,
    expectedRound,
  });
  return {
    randomness: verified.randomness as Hex,
    proof: verified.signature as Hex,
  };
}

/// Fetch and locally verify the exact frozen beacon round. The raw drand
/// signature is forwarded as the proof for the panel's immutable on-chain verifier.
export async function fetchVerifiedDrandBeacon(
  chainHash: Hex,
  round: bigint,
): Promise<VerifiedDrandBeacon> {
  const roundNumber = Number(round);
  if (!Number.isSafeInteger(roundNumber) || roundNumber <= 0) {
    throw new Error("Drand round is outside the supported safe-integer range.");
  }
  const normalized = normalizeDrandChainHash(chainHash);
  const spec = CHAINS.find(
    (candidate) => candidate.chain.chainHash === normalized,
  );
  if (!spec) throw new Error(`Unsupported drand chain 0x${normalized}.`);
  const client = resolveTlockClientForDrandChain(chainHash);
  const [beacon, chainInfo] = await Promise.all([
    client.get(roundNumber),
    client.chain().info(),
  ]);
  return validateDrandBeaconEvidence(
    beacon,
    roundNumber,
    spec.chain,
    chainInfo,
  );
}
