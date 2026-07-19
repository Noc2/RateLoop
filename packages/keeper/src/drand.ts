import { HttpCachingChain, HttpChainClient, type ChainClient } from "tlock-js";
import type { Hex } from "viem";
import { incrementCounter } from "./metrics.js";

type DrandChain = ReturnType<ChainClient["chain"]>;

export const MAINNET_QUICKNET_CHAIN_HASH =
  "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";
export const QUICKNET_T_CHAIN_HASH =
  "cc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5";

interface DrandChainSpec {
  chainHash: string;
  publicKey: string;
  relayHosts: readonly string[];
}

const CHAINS: readonly DrandChainSpec[] = [
  {
    chainHash: MAINNET_QUICKNET_CHAIN_HASH,
    publicKey:
      "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
    relayHosts: [
      "https://api.drand.sh",
      "https://api2.drand.sh",
      "https://api3.drand.sh",
      "https://drand.cloudflare.com",
    ],
  },
  {
    chainHash: QUICKNET_T_CHAIN_HASH,
    publicKey:
      "b15b65b46fb29104f6a4b5d1e11a8da6344463973d423661bb0804846a0ecd1ef93c25057f1c0baab2ac53e56c662b66072f6d84ee791a3382bfb055afab1e6a375538d8ffc451104ac971d2dc9b168e2d3246b0be2015969cbaac298f6502da",
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

  constructor(private readonly clients: readonly ChainClient[]) {
    if (clients.length === 0) {
      throw new Error("FailoverChainClient requires at least one relay client");
    }
    this.options = clients[0].options;
  }

  latest(): ReturnType<ChainClient["latest"]> {
    return this.withFailover("latest beacon", (client) => client.latest());
  }

  get(roundNumber: number): ReturnType<ChainClient["get"]> {
    return this.withFailover(`beacon round ${roundNumber}`, (client) =>
      client.get(roundNumber)
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
    request: (client: ChainClient) => Promise<T>
  ) {
    const failures: string[] = [];
    for (let attempt = 0; attempt < this.clients.length; attempt += 1) {
      const index = (this.preferredIndex + attempt) % this.clients.length;
      const client = this.clients[index];
      try {
        const value = await request(client);
        this.preferredIndex = index;
        return value;
      } catch (error) {
        failures.push(
          `${client.chain().baseUrl}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        if (attempt < this.clients.length - 1) {
          incrementCounter("keeper_drand_relay_failovers_total");
        }
      }
    }
    throw new DrandUnavailableError(
      `All drand relays failed fetching ${label}: ${failures.join("; ")}`
    );
  }
}

function relayClient(spec: DrandChainSpec, host: string): ChainClient {
  const options = {
    disableBeaconVerification: false,
    noCache: false,
    chainVerificationParams: {
      chainHash: spec.chainHash,
      publicKey: spec.publicKey,
    },
  };
  const chain = new HttpCachingChain(`${host}/${spec.chainHash}`, options);
  return new HttpChainClient(chain, options, {
    userAgent: "rateloop-tokenless-keeper",
  });
}

const cache = new Map<string, ChainClient>();

export function resetTlockClientCacheForTests() {
  cache.clear();
}

export function resolveTlockClientForDrandChain(
  chainHash: `0x${string}` | string
) {
  const normalized = chainHash.toLowerCase().replace(/^0x/u, "");
  if (!/^[0-9a-f]{64}$/u.test(normalized)) {
    throw new Error("Invalid drand chain hash");
  }
  const configuredChainId = Number(process.env.CHAIN_ID ?? 0);
  if (configuredChainId === 84532 && normalized !== QUICKNET_T_CHAIN_HASH) {
    throw new Error(
      `Base Sepolia tokenless keeper requires quicknet-t chain 0x${QUICKNET_T_CHAIN_HASH}.`
    );
  }
  const spec = CHAINS.find((candidate) => candidate.chainHash === normalized);
  if (!spec) {
    throw new Error(`Unsupported drand chain 0x${normalized}.`);
  }
  let client = cache.get(normalized);
  if (!client) {
    client = new FailoverChainClient(
      spec.relayHosts.map((host) => relayClient(spec, host))
    );
    cache.set(normalized, client);
  }
  return client;
}

export interface VerifiedDrandBeacon {
  randomness: Hex;
  proof: Hex;
}

/// Fetch and locally verify the exact frozen beacon round. The raw drand
/// signature is forwarded as the proof for the panel's immutable on-chain verifier.
export async function fetchVerifiedDrandBeacon(
  chainHash: Hex,
  round: bigint
): Promise<VerifiedDrandBeacon> {
  const roundNumber = Number(round);
  if (!Number.isSafeInteger(roundNumber) || roundNumber <= 0) {
    throw new Error("Drand round is outside the supported safe-integer range.");
  }
  const beacon = await resolveTlockClientForDrandChain(chainHash).get(
    roundNumber
  );
  if (
    beacon.round !== roundNumber ||
    !/^[0-9a-fA-F]{64}$/u.test(beacon.randomness) ||
    !/^[0-9a-fA-F]+$/u.test(beacon.signature) ||
    beacon.signature.length % 2 !== 0
  ) {
    throw new Error("Verified drand relay returned malformed beacon evidence.");
  }
  return {
    randomness: `0x${beacon.randomness}`,
    proof: `0x${beacon.signature}`,
  };
}
