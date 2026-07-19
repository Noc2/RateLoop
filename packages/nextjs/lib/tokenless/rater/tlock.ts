import { encodeTokenlessRevealPayload, tokenlessPayoutCommitment, tokenlessRevealCommitment } from "./material";
import type { TokenlessDrandNetwork, TokenlessRevealMaterial, TokenlessSealedReveal } from "./types";
import { Buffer, type ChainClient, HttpCachingChain, HttpChainClient, roundAt, timelockEncrypt } from "tlock-js";
import { hexToBytes, isHex, keccak256, size, stringToHex } from "viem";

export const TOKENLESS_MAX_TLOCK_CIPHERTEXT_BYTES = 16_384;

interface DrandNetworkSpec {
  chainHash: string;
  publicKey: string;
  schemeId: "bls-unchained-g1-rfc9380";
  genesisTime: number;
  period: number;
  groupHash: string;
  beaconId: string;
  relayHosts: readonly string[];
}

export const TOKENLESS_DRAND_NETWORKS: Record<TokenlessDrandNetwork, DrandNetworkSpec> = {
  quicknet: {
    chainHash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
    publicKey:
      "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
    schemeId: "bls-unchained-g1-rfc9380",
    genesisTime: 1_692_803_367,
    period: 3,
    groupHash: "f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e",
    beaconId: "quicknet",
    relayHosts: [
      "https://api.drand.sh",
      "https://api2.drand.sh",
      "https://api3.drand.sh",
      "https://drand.cloudflare.com",
    ],
  },
  "quicknet-t": {
    chainHash: "cc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5",
    publicKey:
      "b15b65b46fb29104f6a4b5d1e11a8da6344463973d423661bb0804846a0ecd1ef93c25057f1c0baab2ac53e56c662b66072f6d84ee791a3382bfb055afab1e6a375538d8ffc451104ac971d2dc9b168e2d3246b0be2015969cbaac298f6502da",
    schemeId: "bls-unchained-g1-rfc9380",
    genesisTime: 1_689_232_296,
    period: 3,
    groupHash: "40d49d910472d4adb1d67f65db8332f11b4284eecf05c05c5eacd5eef7d40e2d",
    beaconId: "quicknet-t",
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
  if (
    info.hash.toLowerCase() !== spec.chainHash ||
    info.public_key.toLowerCase() !== spec.publicKey ||
    info.schemeID !== spec.schemeId ||
    info.genesis_time !== spec.genesisTime ||
    info.period !== spec.period ||
    info.groupHash.toLowerCase() !== spec.groupHash ||
    info.metadata.beaconID !== spec.beaconId
  ) {
    throw new Error("The drand relay returned a chain that does not match the selected network.");
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
