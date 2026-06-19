import { HttpCachingChain, HttpChainClient, mainnetClient } from "tlock-js";

const RATELOOP_TLOCK_USER_AGENT = "rateloop-foundry-tlock";

export const MAINNET_QUICKNET = {
  name: "quicknet",
  url: "https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  chainHash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  publicKey:
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  genesisTime: 1_692_803_367n,
  period: 3n,
};

export const QUICKNET_T = {
  name: "quicknet-t",
  url: "https://testnet-api.drand.cloudflare.com/cc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5",
  chainHash: "cc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5",
  publicKey:
    "b15b65b46fb29104f6a4b5d1e11a8da6344463973d423661bb0804846a0ecd1ef93c25057f1c0baab2ac53e56c662b66072f6d84ee791a3382bfb055afab1e6a375538d8ffc451104ac971d2dc9b168e2d3246b0be2015969cbaac298f6502da",
  genesisTime: 1_689_232_296n,
  period: 3n,
};

const SUPPORTED_TLOCK_CHAINS = [MAINNET_QUICKNET, QUICKNET_T];

function normalizeDrandChainHash(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  const stripped = normalized.startsWith("0x")
    ? normalized.slice(2)
    : normalized;
  if (!/^[0-9a-f]{64}$/.test(stripped)) {
    throw new Error("Invalid drand chain hash");
  }
  return stripped;
}

function assertDrandTimingMatches(spec, drandGenesisTime, drandPeriod) {
  const genesisTime = BigInt(drandGenesisTime);
  const period = BigInt(drandPeriod);
  if (genesisTime === spec.genesisTime && period === spec.period) {
    return;
  }
  throw new Error(
    `On-chain drand config (0x${spec.chainHash}, ${genesisTime}, ${period}) does not match supported ${spec.name} config (0x${spec.chainHash}, ${spec.genesisTime}, ${spec.period})`
  );
}

export function resolveTlockChainSpec({
  drandChainHash,
  drandGenesisTime,
  drandPeriod,
}) {
  const normalizedHash = normalizeDrandChainHash(drandChainHash);
  const spec = SUPPORTED_TLOCK_CHAINS.find(
    (chain) => chain.chainHash === normalizedHash
  );
  if (!spec) {
    throw new Error(
      `Unsupported drand chain 0x${normalizedHash}. Update generateTlockCommit.js before seeding votes for this deployment.`
    );
  }
  assertDrandTimingMatches(spec, drandGenesisTime, drandPeriod);
  return spec;
}

function createCustomTlockClient(spec) {
  const options = {
    disableBeaconVerification: false,
    noCache: false,
    chainVerificationParams: {
      chainHash: spec.chainHash,
      publicKey: spec.publicKey,
    },
  };
  const chain = new HttpCachingChain(spec.url, options);
  return new HttpChainClient(chain, options, {
    userAgent: RATELOOP_TLOCK_USER_AGENT,
  });
}

export function createTlockClientForDrandConfig(config) {
  const spec = resolveTlockChainSpec(config);
  const client =
    spec === MAINNET_QUICKNET ? mainnetClient() : createCustomTlockClient(spec);
  return { client, spec };
}
