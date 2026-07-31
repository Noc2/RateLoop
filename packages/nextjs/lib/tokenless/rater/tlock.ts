import { encodeTokenlessRevealPayload, tokenlessPayoutCommitment, tokenlessRevealCommitment } from "./material";
import type { TokenlessDrandNetwork, TokenlessRevealMaterial, TokenlessSealedReveal } from "./types";
import { PINNED_DRAND_CHAINS, type PinnedDrandChain, assertPinnedDrandChainInfo } from "@rateloop/node-utils/drand";
import { Buffer, type ChainClient, HttpCachingChain, HttpChainClient, roundAt, timelockEncrypt } from "tlock-js";
import { hexToBytes, isHex, keccak256, size, stringToHex } from "viem";

export const TOKENLESS_MAX_TLOCK_CIPHERTEXT_BYTES = 16_384;

interface DrandNetworkSpec extends PinnedDrandChain {
  relayHosts: readonly string[];
}

export const TOKENLESS_DRAND_NETWORKS: Record<TokenlessDrandNetwork, DrandNetworkSpec> = {
  quicknet: {
    ...PINNED_DRAND_CHAINS.quicknet,
    relayHosts: [
      "https://api.drand.sh",
      "https://api2.drand.sh",
      "https://api3.drand.sh",
      "https://drand.cloudflare.com",
    ],
  },
  "quicknet-t": {
    ...PINNED_DRAND_CHAINS["quicknet-t"],
    relayHosts: ["https://testnet-api.drand.cloudflare.com", "https://pl-us.testnet.drand.sh"],
  },
};

function createClient(spec: DrandNetworkSpec, relayHost: string): ChainClient {
  const options = {
    disableBeaconVerification: false,
    noCache: false,
    chainVerificationParams: { chainHash: spec.chainHash, publicKey: spec.publicKey },
  };
  const chain = new HttpCachingChain(`${relayHost}/${spec.chainHash}`, options);
  return new HttpChainClient(chain, options, { userAgent: "rateloop-tokenless-rater" });
}

async function assertExpectedChain(client: ChainClient, spec: DrandNetworkSpec, beaconRound: number): Promise<void> {
  const info = await client.chain().info();
  try {
    assertPinnedDrandChainInfo(spec, info);
  } catch (error) {
    throw new Error("The drand relay returned a chain that does not match the selected network.", {
      cause: error,
    });
  }
  const currentRound = roundAt(Date.now(), info);
  if (beaconRound <= currentRound) {
    throw new Error("beaconRound must be a future round so the vote remains sealed.");
  }
}

export async function sealTokenlessRevealWithClient(params: {
  material: TokenlessRevealMaterial;
  drandNetwork: TokenlessDrandNetwork;
  beaconRound: number;
  client: ChainClient;
  maxCiphertextBytes?: number;
}): Promise<TokenlessSealedReveal> {
  if (!Number.isSafeInteger(params.beaconRound) || params.beaconRound <= 0) {
    throw new Error("beaconRound must be a positive safe integer.");
  }
  const maxCiphertextBytes = params.maxCiphertextBytes ?? TOKENLESS_MAX_TLOCK_CIPHERTEXT_BYTES;
  if (
    !Number.isSafeInteger(maxCiphertextBytes) ||
    maxCiphertextBytes < 512 ||
    maxCiphertextBytes > TOKENLESS_MAX_TLOCK_CIPHERTEXT_BYTES
  ) {
    throw new Error(`maxCiphertextBytes must be between 512 and ${TOKENLESS_MAX_TLOCK_CIPHERTEXT_BYTES}.`);
  }
  const spec = TOKENLESS_DRAND_NETWORKS[params.drandNetwork];
  if (!spec) throw new Error("Unsupported drand network.");
  await assertExpectedChain(params.client, spec, params.beaconRound);
  const plaintext = encodeTokenlessRevealPayload(params.material);
  const armored = await timelockEncrypt(params.beaconRound, Buffer.from(hexToBytes(plaintext)), params.client);
  const sealedPayload = stringToHex(armored);
  if (!isHex(sealedPayload, { strict: true }) || size(sealedPayload) > maxCiphertextBytes) {
    throw new Error("Tokenless tlock ciphertext exceeds its configured size bound.");
  }
  return {
    roundId: params.material.roundId,
    drandNetwork: params.drandNetwork,
    beaconRound: params.beaconRound,
    sealedPayload,
    sealedPayloadHash: keccak256(sealedPayload),
    sealedCommitment: tokenlessRevealCommitment(params.material),
    payoutCommitment: tokenlessPayoutCommitment(params.material.payoutAddress, params.material.salt),
  };
}

export async function sealTokenlessReveal(params: {
  material: TokenlessRevealMaterial;
  drandNetwork: TokenlessDrandNetwork;
  beaconRound: number;
  maxCiphertextBytes?: number;
}): Promise<TokenlessSealedReveal> {
  const spec = TOKENLESS_DRAND_NETWORKS[params.drandNetwork];
  if (!spec) throw new Error("Unsupported drand network.");
  const failures: string[] = [];
  for (const relayHost of spec.relayHosts) {
    try {
      return await sealTokenlessRevealWithClient({
        ...params,
        client: createClient(spec, relayHost),
      });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`All verified drand relays failed: ${failures.join("; ")}`);
}

/**
 * Reads the disclosure round and chain hash out of a tlock ciphertext.
 *
 * The round a payload unlocks at lives only in its age recipient stanza. Nothing else carries it:
 * the round terms record a *declared* round, so without reading the ciphertext a client can seal to
 * any round it likes. Sealing to an already-past round makes the commit publicly decryptable the
 * moment it lands on chain, and sealing to a far-future one produces a commit the keeper can never
 * open in time. Both are checkable here and nowhere later, because the ciphertext is permanent once
 * committed.
 */
export function readTokenlessTlockRecipient(sealedPayload: string): { beaconRound: number; chainHash: string } {
  const armored = Buffer.from(sealedPayload.replace(/^0x/u, ""), "hex").toString("utf8");
  const body = armored
    .split(/\r?\n/u)
    .filter(line => line.length > 0 && !line.startsWith("-----"))
    .join("");
  if (!/^[A-Za-z0-9+/=]*$/u.test(body) || body.length === 0) {
    throw new Error("sealedPayload is not an armored tlock ciphertext.");
  }
  // The age header is ASCII at the start of the decoded file, so only its first bytes are needed.
  const header = Buffer.from(body, "base64").subarray(0, 512).toString("latin1");
  const stanza = /^-> tlock (\d+) ([0-9a-f]{64})$/mu.exec(header);
  if (!stanza) throw new Error("sealedPayload does not carry a tlock recipient stanza.");
  const beaconRound = Number(stanza[1]);
  if (!Number.isSafeInteger(beaconRound) || beaconRound <= 0) {
    throw new Error("sealedPayload declares an unusable tlock round.");
  }
  return { beaconRound, chainHash: stanza[2]! };
}

/** Fails closed unless the ciphertext really unlocks at the round and chain the terms froze. */
export function assertTokenlessTlockRecipient(input: {
  sealedPayload: string;
  beaconRound: number;
  chainHash: string;
}) {
  const recipient = readTokenlessTlockRecipient(input.sealedPayload);
  if (recipient.beaconRound !== input.beaconRound || recipient.chainHash !== input.chainHash.toLowerCase()) {
    throw new Error("sealedPayload unlocks at a different drand round or chain than the round terms.");
  }
}
