import {
  TOKENLESS_COMMIT_TYPES,
  TOKENLESS_DRAND_NETWORKS,
  TOKENLESS_RECOVERY_KDF_ITERATIONS,
  TOKENLESS_REVEAL_PAYLOAD_MAGIC,
  TOKENLESS_REVEAL_PAYLOAD_VERSION,
  TOKENLESS_REVEAL_TYPEHASH,
  type TokenlessRaterRoundSecrets,
  createTokenlessRaterRoundSecrets,
  encodeTokenlessRevealPayload,
  exportTokenlessRecoveryPackage,
  importTokenlessRecoveryPackage,
  parseTokenlessRecoveryPackage,
  sealTokenlessRevealWithClient,
  signTokenlessCommit,
  tokenlessCommitTypedData,
  tokenlessPayoutCommitment,
  tokenlessRevealCommitment,
  tokenlessSelfRevealArguments,
  validateTokenlessRaterRoundSecrets,
  validateTokenlessRevealMaterial,
} from "./index";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChainClient, ChainInfo } from "tlock-js";
import {
  type Hex,
  decodeAbiParameters,
  encodeAbiParameters,
  getAddress,
  hashTypedData,
  keccak256,
  parseAbiParameters,
  recoverTypedDataAddress,
  size,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const VOTE_PRIVATE_KEY = `0x${"11".repeat(32)}` as Hex;
const PAYOUT_PRIVATE_KEY = `0x${"22".repeat(32)}` as Hex;
const SALT = `0x${"33".repeat(32)}` as Hex;
const RESPONSE_HASH = `0x${"44".repeat(32)}` as Hex;
const NULLIFIER = `0x${"55".repeat(32)}` as Hex;
const PANEL = "0x1234567890123456789012345678901234567890";

function fixedSecrets(): TokenlessRaterRoundSecrets {
  return {
    schemaVersion: "rateloop.tokenless.rater-secrets.v1",
    votePrivateKey: VOTE_PRIVATE_KEY,
    payoutPrivateKey: PAYOUT_PRIVATE_KEY,
    reveal: {
      roundId: 42n,
      voteKey: privateKeyToAccount(VOTE_PRIVATE_KEY).address,
      vote: 1,
      predictedUpBps: 7000,
      responseHash: RESPONSE_HASH,
      payoutAddress: privateKeyToAccount(PAYOUT_PRIVATE_KEY).address,
      salt: SALT,
    },
  };
}

function mainnetChainClient(): ChainClient {
  const spec = TOKENLESS_DRAND_NETWORKS.quicknet;
  const info: ChainInfo = {
    public_key: spec.publicKey,
    period: spec.period,
    genesis_time: spec.genesisTime,
    hash: spec.chainHash,
    groupHash: spec.groupHash,
    schemeID: spec.schemeId,
    metadata: { beaconID: spec.beaconId },
  };
  return {
    options: {
      disableBeaconVerification: false,
      noCache: true,
      chainVerificationParams: { chainHash: spec.chainHash, publicKey: spec.publicKey },
    },
    chain: () => ({ baseUrl: "https://test.invalid", info: async () => info }),
    latest: async () => {
      throw new Error("not used for encryption");
    },
    get: async () => {
      throw new Error("not used for encryption");
    },
  };
}

test("generates independent one-time vote and payout accounts entirely client-side", () => {
  const secrets = createTokenlessRaterRoundSecrets({
    roundId: 9n,
    vote: 0,
    predictedUpBps: 3_700,
    responseHash: RESPONSE_HASH,
  });
  validateTokenlessRaterRoundSecrets(secrets);
  assert.notEqual(secrets.votePrivateKey, secrets.payoutPrivateKey);
  assert.equal(getAddress(privateKeyToAccount(secrets.votePrivateKey).address), secrets.reveal.voteKey);
  assert.equal(getAddress(privateKeyToAccount(secrets.payoutPrivateKey).address), secrets.reveal.payoutAddress);
});

test("rejects malformed reveal material and mismatched spend keys deterministically", () => {
  const secrets = fixedSecrets();
  assert.throws(() => validateTokenlessRevealMaterial({ ...secrets.reveal, roundId: 0n }), /roundId must be positive/);
  assert.throws(() => validateTokenlessRevealMaterial({ ...secrets.reveal, vote: 2 as 0 }), /vote must be 0 or 1/);
  assert.throws(
    () => validateTokenlessRevealMaterial({ ...secrets.reveal, predictedUpBps: 3_333 }),
    /one-percent grid/,
  );
  assert.doesNotThrow(() => validateTokenlessRevealMaterial({ ...secrets.reveal, predictedUpBps: 100 }));
  assert.doesNotThrow(() => validateTokenlessRevealMaterial({ ...secrets.reveal, predictedUpBps: 9_900 }));
  assert.throws(
    () => validateTokenlessRevealMaterial({ ...secrets.reveal, salt: "0x12" }),
    /salt must be exactly 32 bytes/,
  );
  assert.throws(
    () => validateTokenlessRaterRoundSecrets({ ...secrets, payoutPrivateKey: VOTE_PRIVATE_KEY }),
    /payoutPrivateKey does not control payoutAddress/,
  );
});

test("encodes the keeper reveal payload and contract commitments byte-for-byte", () => {
  const material = fixedSecrets().reveal;
  const payload = encodeTokenlessRevealPayload(material);
  const parameters = parseAbiParameters("bytes4,uint8,uint256,address,uint8,uint16,bytes32,address,bytes32");
  const decoded = decodeAbiParameters(parameters, payload);
  assert.deepEqual(decoded, [
    TOKENLESS_REVEAL_PAYLOAD_MAGIC,
    TOKENLESS_REVEAL_PAYLOAD_VERSION,
    material.roundId,
    material.voteKey,
    material.vote,
    material.predictedUpBps,
    material.responseHash,
    material.payoutAddress,
    material.salt,
  ]);
  assert.ok(size(payload) <= 1024);

  const expectedPayout = keccak256(
    encodeAbiParameters(parseAbiParameters("address,bytes32"), [material.payoutAddress, material.salt]),
  );
  const expectedReveal = keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32,uint256,address,uint8,uint16,bytes32,address,bytes32"), [
      TOKENLESS_REVEAL_TYPEHASH,
      material.roundId,
      material.voteKey,
      material.vote,
      material.predictedUpBps,
      material.responseHash,
      material.payoutAddress,
      material.salt,
    ]),
  );
  assert.equal(tokenlessPayoutCommitment(material.payoutAddress, material.salt), expectedPayout);
  assert.equal(tokenlessRevealCommitment(material), expectedReveal);
});

test("signs the exact TokenlessPanel EIP-712 commit without leaking either private key", async () => {
  const secrets = fixedSecrets();
  const sealedPayload = "0x746c6f636b2d63697068657274657874";
  const authorization = await signTokenlessCommit({
    secrets,
    sealedPayload,
    drandNetwork: "quicknet",
    beaconRound: 123,
    chainId: 84532,
    panelAddress: PANEL,
    nullifier: NULLIFIER,
  });
  const typedData = tokenlessCommitTypedData({
    chainId: authorization.chainId,
    panelAddress: authorization.panelAddress,
    roundId: authorization.roundId,
    sealedCommitment: authorization.sealedCommitment,
    sealedPayloadHash: authorization.sealedPayloadHash,
    payoutCommitment: authorization.payoutCommitment,
    nullifier: authorization.nullifier,
  });
  assert.deepEqual(typedData.types, TOKENLESS_COMMIT_TYPES);
  assert.equal(authorization.sealedPayloadHash, keccak256(sealedPayload));
  assert.equal(hashTypedData(typedData), hashTypedData({ ...typedData }));
  assert.equal(
    getAddress(await recoverTypedDataAddress({ ...typedData, signature: authorization.voteKeySignature })),
    secrets.reveal.voteKey,
  );
  const serializedPublicAuthorization = JSON.stringify(authorization, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  assert.ok(!serializedPublicAuthorization.includes(VOTE_PRIVATE_KEY.slice(2)));
  assert.ok(!serializedPublicAuthorization.includes(PAYOUT_PRIVATE_KEY.slice(2)));
  assert.deepEqual(tokenlessSelfRevealArguments(secrets), [
    42n,
    secrets.reveal.voteKey,
    1,
    7000,
    RESPONSE_HASH,
    secrets.reveal.payoutAddress,
    SALT,
  ]);
});

test("tlock-encrypts only for an allowlisted, verified drand chain and enforces bounds", async () => {
  const futureRound = 99_999_999;
  const sealed = await sealTokenlessRevealWithClient({
    material: fixedSecrets().reveal,
    drandNetwork: "quicknet",
    beaconRound: futureRound,
    client: mainnetChainClient(),
  });
  assert.equal(sealed.roundId, 42n);
  assert.ok(size(sealed.sealedPayload) > 0);
  assert.ok(size(sealed.sealedPayload) <= 16_384);
  assert.equal(sealed.sealedPayloadHash, keccak256(sealed.sealedPayload));

  const wrongClient = mainnetChainClient();
  const originalChain = wrongClient.chain;
  wrongClient.chain = () => ({
    ...originalChain(),
    info: async () => ({ ...(await originalChain().info()), hash: "00".repeat(32) }),
  });
  await assert.rejects(
    () =>
      sealTokenlessRevealWithClient({
        material: fixedSecrets().reveal,
        drandNetwork: "quicknet",
        beaconRound: futureRound,
        client: wrongClient,
      }),
    /does not match the selected network/,
  );
  await assert.rejects(
    () =>
      sealTokenlessRevealWithClient({
        material: fixedSecrets().reveal,
        drandNetwork: "quicknet",
        beaconRound: futureRound,
        client: mainnetChainClient(),
        maxCiphertextBytes: 511,
      }),
    /between 512 and 16384/,
  );
  await assert.rejects(
    () =>
      sealTokenlessRevealWithClient({
        material: fixedSecrets().reveal,
        drandNetwork: "quicknet",
        beaconRound: 1,
        client: mainnetChainClient(),
      }),
    /must be a future round/,
  );
});

test("exports and imports a Web Crypto recovery package without plaintext key material", async () => {
  const secrets = fixedSecrets();
  const exported = await exportTokenlessRecoveryPackage(secrets, "correct horse battery staple");
  const parsed = parseTokenlessRecoveryPackage(exported);
  assert.equal(parsed.kdf.iterations, TOKENLESS_RECOVERY_KDF_ITERATIONS);
  assert.equal(parsed.kdf.hash, "SHA-256");
  assert.equal(parsed.cipher.name, "AES-GCM");
  assert.ok(!exported.includes(VOTE_PRIVATE_KEY.slice(2)));
  assert.ok(!exported.includes(PAYOUT_PRIVATE_KEY.slice(2)));
  assert.deepEqual(await importTokenlessRecoveryPackage(exported, "correct horse battery staple"), secrets);
});

test("recovery import rejects tampering, wrong secrets, downgrades, and weak secrets", async () => {
  const exported = await exportTokenlessRecoveryPackage(fixedSecrets(), "correct horse battery staple");
  const tampered = JSON.parse(exported) as {
    cipher: { ciphertext: string };
    kdf: { iterations: number };
  };
  const first = tampered.cipher.ciphertext[0];
  tampered.cipher.ciphertext = `${first === "A" ? "B" : "A"}${tampered.cipher.ciphertext.slice(1)}`;
  await assert.rejects(
    () => importTokenlessRecoveryPackage(JSON.stringify(tampered), "correct horse battery staple"),
    /could not be decrypted/,
  );
  await assert.rejects(
    () => importTokenlessRecoveryPackage(exported, "this is the wrong recovery secret"),
    /could not be decrypted/,
  );
  const downgraded = JSON.parse(exported) as { kdf: { iterations: number } };
  downgraded.kdf.iterations = 1;
  assert.throws(
    () => parseTokenlessRecoveryPackage(JSON.stringify(downgraded)),
    /unsupported cryptography or versioning/,
  );
  await assert.rejects(() => exportTokenlessRecoveryPackage(fixedSecrets(), "too short"), /between 12 and 1024/);
});
