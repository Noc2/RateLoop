/**
 * drand relay resolution for tlock vote decryption.
 *
 * Reveal liveness (design review 2026-06, finding 3): the keeper previously pinned a
 * single drand relay per chain, so one relay outage stalled every reveal and could push
 * rounds into RevealFailed finalization. Each supported drand chain now carries an
 * ordered list of independent public relays, and `FailoverChainClient` walks that list
 * on any relay error, remembering the last healthy relay for subsequent requests.
 *
 * Beacon authenticity does not depend on relay trust: every relay client is constructed
 * with pinned `chainVerificationParams` (chain hash + group public key), and drand's
 * `fetchBeacon` verifies the BLS signature against those params after fetching.
 */
import { HttpCachingChain, HttpChainClient, type ChainClient } from "tlock-js";
import { incrementCounter } from "./metrics.js";

type DrandChain = ReturnType<ChainClient["chain"]>;

const KEEPER_TLOCK_USER_AGENT = "rateloop-keeper";
const ENABLE_LEGACY_TLOCK_JS_TESTNET_ENV =
  "KEEPER_ENABLE_LEGACY_TLOCK_JS_TESTNET";
const MAINNET_DEPLOYMENT_CHAIN_IDS = new Set([480, 8453]);

export const MAINNET_QUICKNET_CHAIN_HASH =
  "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";
export const QUICKNET_T_CHAIN_HASH =
  "cc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5";
export const TLOCK_JS_TESTNET_CHAIN_HASH =
  "7672797f548f3f4748ac4bf3352fc6c6b6468c9ad40ad456a397545c6e2df5bf";

interface DrandChainSpec {
  chainHash: string;
  publicKey: string;
  /** Independent relay base hosts, ordered by preference. */
  relayHosts: readonly string[];
}

// Quicknet on the drand League of Entropy mainnet relays. Hash and group public key
// match tlock-js's `mainnetClient()` pins.
const MAINNET_QUICKNET: DrandChainSpec = {
  chainHash: MAINNET_QUICKNET_CHAIN_HASH,
  publicKey:
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  relayHosts: [
    "https://api.drand.sh",
    "https://api2.drand.sh",
    "https://api3.drand.sh",
    "https://drand.cloudflare.com",
  ],
};

const QUICKNET_T: DrandChainSpec = {
  chainHash: QUICKNET_T_CHAIN_HASH,
  publicKey:
    "b15b65b46fb29104f6a4b5d1e11a8da6344463973d423661bb0804846a0ecd1ef93c25057f1c0baab2ac53e56c662b66072f6d84ee791a3382bfb055afab1e6a375538d8ffc451104ac971d2dc9b168e2d3246b0be2015969cbaac298f6502da",
  relayHosts: [
    "https://testnet-api.drand.cloudflare.com",
    "https://pl-us.testnet.drand.sh",
  ],
};

// Deprecated tlock-js testnet chain. Kept behind an explicit env gate only for
// old local fixtures; production/default traffic must stay pinned to quicknet.
const TLOCK_JS_TESTNET: DrandChainSpec = {
  chainHash: TLOCK_JS_TESTNET_CHAIN_HASH,
  publicKey:
    "8200fc249deb0148eb918d6e213980c5d01acd7fc251900d9260136da3b54836ce125172399ddc69c4e3e11429b62c11",
  relayHosts: [
    "https://pl-us.testnet.drand.sh",
    "https://testnet-api.drand.cloudflare.com",
  ],
};

const SUPPORTED_CHAINS: readonly DrandChainSpec[] = [
  MAINNET_QUICKNET,
  QUICKNET_T,
];

function legacyTlockJsTestnetEnabled(): boolean {
  const value =
    process.env[ENABLE_LEGACY_TLOCK_JS_TESTNET_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function configuredChainId(): number | null {
  const value = process.env.CHAIN_ID?.trim();
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function assertDeploymentDrandChain(normalized: string): void {
  if (
    MAINNET_DEPLOYMENT_CHAIN_IDS.has(configuredChainId() ?? 0) &&
    normalized !== MAINNET_QUICKNET_CHAIN_HASH
  ) {
    throw new Error(
      `Mainnet keeper deployments require drand quicknet chain hash 0x${MAINNET_QUICKNET_CHAIN_HASH}; got 0x${normalized}.`,
    );
  }
}

/** Thrown when every configured relay for a drand chain failed a request. */
export class DrandUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrandUnavailableError";
  }
}

export function isDrandUnavailableError(err: unknown): boolean {
  return err instanceof Error && err.name === "DrandUnavailableError";
}

/**
 * ChainClient that delegates to an ordered list of single-relay clients, advancing to
 * the next relay on any error. The most recently healthy relay is tried first on
 * subsequent requests, so a dead primary relay costs one failed request per process,
 * not one per reveal.
 */
export class FailoverChainClient implements ChainClient {
  readonly options: ChainClient["options"];
  private readonly clients: readonly ChainClient[];
  private preferredIndex = 0;

  constructor(clients: readonly ChainClient[]) {
    if (clients.length === 0) {
      throw new Error("FailoverChainClient requires at least one relay client");
    }
    this.clients = clients;
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
    what: string,
    request: (client: ChainClient) => Promise<T>,
  ): Promise<T> {
    const failures: string[] = [];
    for (let attempt = 0; attempt < this.clients.length; attempt++) {
      const index = (this.preferredIndex + attempt) % this.clients.length;
      const client = this.clients[index];
      try {
        const value = await request(client);
        this.preferredIndex = index;
        return value;
      } catch (err: unknown) {
        const baseUrl = client.chain().baseUrl;
        const message = err instanceof Error ? err.message : String(err);
        failures.push(`${baseUrl}: ${message}`);
        if (attempt < this.clients.length - 1) {
          incrementCounter("keeper_drand_relay_failovers_total");
          console.warn(
            `[Keeper] drand relay failed for ${what}; failing over (${baseUrl}: ${message})`,
          );
        }
      }
    }
    throw new DrandUnavailableError(
      `All drand relays failed fetching ${what}: ${failures.join("; ")}`,
    );
  }
}

function createRelayClient(spec: DrandChainSpec, host: string): ChainClient {
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
    userAgent: KEEPER_TLOCK_USER_AGENT,
  });
}

const tlockClientCache = new Map<string, ChainClient>();

export function resetTlockClientCacheForTests(): void {
  tlockClientCache.clear();
}

function normalizeDrandChainHash(
  drandChainHash: `0x${string}` | string | null | undefined,
): string | null {
  if (!drandChainHash) return null;
  const normalized = drandChainHash.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/u.test(normalized)) {
    throw new Error("Invalid drand chain hash");
  }
  return normalized.slice(2);
}

export function resolveTlockClientForDrandChain(
  drandChainHash: `0x${string}` | string | null | undefined,
): ChainClient {
  const normalized =
    normalizeDrandChainHash(drandChainHash) ?? MAINNET_QUICKNET_CHAIN_HASH;
  assertDeploymentDrandChain(normalized);
  if (
    normalized === TLOCK_JS_TESTNET_CHAIN_HASH &&
    !legacyTlockJsTestnetEnabled()
  ) {
    throw new Error(
      `Unsupported deprecated drand chain 0x${normalized}. Set ${ENABLE_LEGACY_TLOCK_JS_TESTNET_ENV}=true only for legacy local test fixtures.`,
    );
  }

  const supportedChains = legacyTlockJsTestnetEnabled()
    ? [...SUPPORTED_CHAINS, TLOCK_JS_TESTNET]
    : SUPPORTED_CHAINS;
  const spec = supportedChains.find((chain) => chain.chainHash === normalized);
  if (!spec) {
    throw new Error(
      `Unsupported drand chain 0x${normalized}. Update the keeper tlock client allowlist before revealing votes for this deployment.`,
    );
  }

  let client = tlockClientCache.get(spec.chainHash);
  if (!client) {
    client = new FailoverChainClient(
      spec.relayHosts.map((host) => createRelayClient(spec, host)),
    );
    tlockClientCache.set(spec.chainHash, client);
  }
  return client;
}
