import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCommitHash,
  buildRbtsCommitHash,
  bpsToPredictionPercent,
  createTlockVoteCommit,
  createTlockRbtsVoteCommit,
  deriveVoteTlockRevealAvailableAtSeconds,
  decodeRbtsVotePlaintext,
  encodeRbtsVotePlaintext,
  getVoteTlockChainInfo,
  predictionPercentToBps,
  parseTlockCiphertextMetadata,
} from "./voting";

const fakeClient = {
  chain: () => ({
    info: async () => ({
      period: 3,
      genesis_time: 1692803367,
      hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
    }),
  }),
} as any;

const fakeNow = () => 1692803367 * 1000;
function chunkBase64(input: string, chunkSize = 64): string {
  const chunks: string[] = [];
  for (let i = 0; i < input.length; i += chunkSize) {
    chunks.push(input.slice(i, i + chunkSize));
  }
  return chunks.join("\n");
}

function toUnpaddedBase64(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=+$/u, "");
}

function makeFakeArmoredTlockCiphertext(params: {
  targetRound: bigint;
  drandChainHash: `0x${string}`;
  plaintextMarker: string;
}): `0x${string}` {
  const encryptedBody = Buffer.concat([
    Buffer.from(params.plaintextMarker, "utf8"),
    Buffer.alloc(
      Math.max(0, 65 - Buffer.byteLength(params.plaintextMarker, "utf8")),
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

test("parseTlockCiphertextMetadata extracts round and chain hash from the armored payload", () => {
  const drandChainHash = ("0x" + "ab".repeat(32)) as `0x${string}`;
  const ciphertext = makeFakeArmoredTlockCiphertext({
    targetRound: 123n,
    drandChainHash,
    plaintextMarker: "1:" + "11".repeat(32),
  });

  assert.deepEqual(parseTlockCiphertextMetadata(ciphertext), {
    targetRound: 123n,
    drandChainHash,
  });
});

test("parseTlockCiphertextMetadata rejects shallow pseudo-tlock envelopes", () => {
  const ciphertext = `0x${Buffer.from(
    [
      "-----BEGIN AGE ENCRYPTED FILE-----",
      Buffer.from(
        [
          "age-encryption.org/v1",
          `-> tlock 123 ${"ab".repeat(32)}`,
          "payload 1:" + "11".repeat(32),
          "--- bWFj",
        ].join("\n"),
        "binary",
      ).toString("base64"),
      "-----END AGE ENCRYPTED FILE-----",
      "",
    ].join("\n"),
    "utf-8",
  ).toString("hex")}` as `0x${string}`;

  assert.equal(parseTlockCiphertextMetadata(ciphertext), null);
});

test("parseTlockCiphertextMetadata rejects unchunked AGE armor lines", () => {
  const drandChainHash = ("0x" + "ab".repeat(32)) as `0x${string}`;
  const ciphertext = makeFakeArmoredTlockCiphertext({
    targetRound: 123n,
    drandChainHash,
    plaintextMarker: "1:" + "11".repeat(32),
  });
  const armored = Buffer.from(ciphertext.slice(2), "hex").toString("utf8");
  const lines = armored.trimEnd().split("\n");
  const decodedPayload = Buffer.from(lines.slice(1, -1).join(""), "base64");
  const unchunked = `0x${Buffer.from(
    [
      "-----BEGIN AGE ENCRYPTED FILE-----",
      decodedPayload.toString("base64"),
      "-----END AGE ENCRYPTED FILE-----",
      "",
    ].join("\n"),
    "utf8",
  ).toString("hex")}` as `0x${string}`;

  assert.equal(parseTlockCiphertextMetadata(unchunked), null);
});

test("parseTlockCiphertextMetadata accepts a chunked armor payload whose final line is exactly 64 chars", () => {
  const drandChainHash = ("0x" + "ab".repeat(32)) as `0x${string}`;
  const salt = "11".repeat(32);
  const targetRound = 123n;
  const recipientBody = Buffer.alloc(80);
  recipientBody.writeBigUInt64BE(targetRound, 24);
  Buffer.from(drandChainHash.slice(2), "hex").copy(recipientBody, 32);
  const mac = toUnpaddedBase64(Buffer.alloc(32, 0x24));
  const payloadPrefix = [
    "age-encryption.org/v1",
    `-> tlock ${targetRound.toString()} ${drandChainHash.slice(2)}`,
    chunkBase64(toUnpaddedBase64(recipientBody)),
    `--- ${mac}`,
  ].join("\n");

  let filler = "";
  let armoredPayload = "";
  for (let fillerLength = 0; fillerLength < 64; fillerLength++) {
    const candidatePayload = Buffer.from(
      `${payloadPrefix}\npayload u:${salt}\n${"X".repeat(fillerLength)}`,
      "utf8",
    );
    const candidateArmoredPayload = candidatePayload.toString("base64");
    if ((candidateArmoredPayload.length % 64 || 64) === 64) {
      filler = "X".repeat(fillerLength);
      armoredPayload = candidateArmoredPayload;
      break;
    }
  }

  assert.notEqual(armoredPayload, "");
  const finalLineLength = armoredPayload.length % 64 || 64;
  assert.equal(finalLineLength, 64);

  const ciphertext = `0x${Buffer.from(
    [
      "-----BEGIN AGE ENCRYPTED FILE-----",
      chunkBase64(armoredPayload),
      "-----END AGE ENCRYPTED FILE-----",
      "",
    ].join("\n"),
    "utf8",
  ).toString("hex")}` as `0x${string}`;

  assert.deepEqual(parseTlockCiphertextMetadata(ciphertext), {
    targetRound,
    drandChainHash,
  });
  assert.notEqual(filler, "");
});

test("buildCommitHash includes the tlock round metadata", () => {
  const salt = ("0x" + "22".repeat(32)) as `0x${string}`;
  const ciphertext = "0x1234" as `0x${string}`;
  const drandChainHash = ("0x" + "33".repeat(32)) as `0x${string}`;
  const roundReferenceRatingBps = 5_000;
  const voter = "0x2222222222222222222222222222222222222222";

  const commitHash = buildCommitHash(
    false,
    6_900,
    salt,
    voter,
    42n,
    4n,
    roundReferenceRatingBps,
    123n,
    drandChainHash,
    ciphertext,
  );

  assert.equal(
    commitHash,
    buildCommitHash(
      false,
      6_900,
      salt,
      voter,
      42n,
      4n,
      roundReferenceRatingBps,
      123n,
      drandChainHash,
      ciphertext,
    ),
  );
  assert.notEqual(
    commitHash,
    buildCommitHash(
      false,
      6_900,
      salt,
      voter,
      42n,
      5n,
      roundReferenceRatingBps,
      123n,
      drandChainHash,
      ciphertext,
    ),
  );
});

test("prediction helpers normalize the RBTS percentage scale", () => {
  assert.equal(predictionPercentToBps(1), 100);
  assert.equal(predictionPercentToBps(69), 6_900);
  assert.equal(predictionPercentToBps(99), 9_900);
  assert.equal(bpsToPredictionPercent(8_875), 88.75);
  assert.throws(
    () => predictionPercentToBps(0),
    /predicted up percentage must be from 1 to 99/,
  );
  assert.throws(
    () => predictionPercentToBps(100),
    /predicted up percentage must be from 1 to 99/,
  );
  assert.throws(
    () => predictionPercentToBps(0.99),
    /predicted up percentage must be from 1 to 99/,
  );
  assert.throws(
    () => predictionPercentToBps(101),
    /predicted up percentage must be from 1 to 99/,
  );
});

test("RBTS plaintext stores the binary signal, population prediction, and salt", () => {
  const salt = ("0x" + "55".repeat(32)) as `0x${string}`;
  const plaintext = encodeRbtsVotePlaintext(true, 6_900, salt);

  assert.deepEqual(decodeRbtsVotePlaintext(plaintext), {
    isUp: true,
    predictedUpBps: 6_900,
    predictedUpPercent: 69,
    salt,
  });
  assert.equal(
    decodeRbtsVotePlaintext(
      new Uint8Array([1, 1, 0x1a, 0xf4, ...new Uint8Array(32)]),
    ),
    null,
  );
});

test("buildRbtsCommitHash includes the binary signal, crowd prediction, and tlock metadata", () => {
  const salt = ("0x" + "22".repeat(32)) as `0x${string}`;
  const ciphertext = "0x1234" as `0x${string}`;
  const drandChainHash = ("0x" + "33".repeat(32)) as `0x${string}`;
  const roundReferenceRatingBps = 5_000;
  const voter = "0x2222222222222222222222222222222222222222";

  const commitHash = buildRbtsCommitHash(
    true,
    6_900,
    salt,
    voter,
    42n,
    4n,
    roundReferenceRatingBps,
    123n,
    drandChainHash,
    ciphertext,
  );

  assert.equal(
    commitHash,
    buildRbtsCommitHash(
      true,
      6_900,
      salt,
      voter,
      42n,
      4n,
      roundReferenceRatingBps,
      123n,
      drandChainHash,
      ciphertext,
    ),
  );
  assert.notEqual(
    commitHash,
    buildRbtsCommitHash(
      false,
      6_900,
      salt,
      voter,
      42n,
      4n,
      roundReferenceRatingBps,
      123n,
      drandChainHash,
      ciphertext,
    ),
  );
  assert.notEqual(
    commitHash,
    buildRbtsCommitHash(
      true,
      6_901,
      salt,
      voter,
      42n,
      4n,
      roundReferenceRatingBps,
      123n,
      drandChainHash,
      ciphertext,
    ),
  );
});

test("createTlockRbtsVoteCommit returns the RBTS metadata used in the commit hash", async () => {
  const voter = "0x2222222222222222222222222222222222222222";
  const commit = await createTlockRbtsVoteCommit(
    {
      voter,
      isUp: true,
      predictedUpBps: 6_900,
      salt: ("0x" + "66".repeat(32)) as `0x${string}`,
      contentId: 7n,
      roundId: 3n,
      roundReferenceRatingBps: 5_000,
      epochDurationSeconds: 1200,
    },
    {
      client: fakeClient,
      now: fakeNow,
      encryptFn: async (targetRound, payload) => {
        const decoded = decodeRbtsVotePlaintext(payload);
        assert.deepEqual(decoded, {
          isUp: true,
          predictedUpBps: 6_900,
          predictedUpPercent: 69,
          salt: ("0x" + "66".repeat(32)) as `0x${string}`,
        });
        return Buffer.from(
          makeFakeArmoredTlockCiphertext({
            targetRound: BigInt(targetRound),
            drandChainHash:
              "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
            plaintextMarker: `r:${decoded?.isUp ? 1 : 0}:${decoded?.predictedUpBps}:${decoded?.salt.slice(2)}`,
          }).slice(2),
          "hex",
        ).toString("utf8");
      },
    },
  );

  assert.equal(commit.isUp, true);
  assert.equal(commit.predictedUpBps, 6_900);
  assert.equal(commit.predictedUpPercent, 69);
  assert.equal(commit.targetRound > 0n, true);
  assert.equal(
    commit.drandChainHash,
    "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  );
  assert.equal(
    commit.commitHash,
    buildRbtsCommitHash(
      true,
      6_900,
      ("0x" + "66".repeat(32)) as `0x${string}`,
      voter,
      7n,
      3n,
      5_000,
      commit.targetRound,
      commit.drandChainHash,
      commit.ciphertext,
    ),
  );
});

test("createTlockRbtsVoteCommit uses the latest shared drand target round", async () => {
  const commit = await createTlockRbtsVoteCommit(
    {
      voter: "0x2222222222222222222222222222222222222222",
      isUp: true,
      predictedUpBps: 6_900,
      salt: ("0x" + "66".repeat(32)) as `0x${string}`,
      contentId: 7n,
      roundId: 3n,
      roundReferenceRatingBps: 5_000,
      epochDurationSeconds: 1200,
    },
    {
      client: fakeClient,
      now: fakeNow,
      encryptFn: async (targetRound) =>
        Buffer.from(
          makeFakeArmoredTlockCiphertext({
            targetRound: BigInt(targetRound),
            drandChainHash:
              "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
            plaintextMarker: "1:" + "66".repeat(32),
          }).slice(2),
          "hex",
        ).toString("utf8"),
    },
  );

  assert.equal(commit.targetRound, 403n);
});

test("createTlockRbtsVoteCommit lowercases the drand chain hash", async () => {
  const uppercaseHashClient = {
    chain: () => ({
      info: async () => ({
        period: 3,
        genesis_time: 1692803367,
        hash: "52DB9BA70E0CC0F6EAF7803DD07447A1F5477735FD3F661792BA94600C84E971",
      }),
    }),
  } as any;

  const commit = await createTlockRbtsVoteCommit(
    {
      voter: "0x2222222222222222222222222222222222222222",
      isUp: true,
      predictedUpBps: 6_900,
      salt: ("0x" + "66".repeat(32)) as `0x${string}`,
      contentId: 7n,
      roundId: 3n,
      roundReferenceRatingBps: 5_000,
      epochDurationSeconds: 1200,
    },
    {
      client: uppercaseHashClient,
      now: fakeNow,
      encryptFn: async (targetRound) =>
        Buffer.from(
          makeFakeArmoredTlockCiphertext({
            targetRound: BigInt(targetRound),
            drandChainHash:
              "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
            plaintextMarker: "1:" + "66".repeat(32),
          }).slice(2),
          "hex",
        ).toString("utf8"),
    },
  );

  assert.equal(
    commit.drandChainHash,
    "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  );
});

test("createTlockVoteCommit returns the tlock metadata used in the commit hash", async () => {
  const voter = "0x2222222222222222222222222222222222222222";
  const commit = await createTlockVoteCommit(
    {
      voter,
      isUp: true,
      predictedUpBps: 6_900,
      salt: ("0x" + "33".repeat(32)) as `0x${string}`,
      contentId: 7n,
      roundId: 3n,
      roundReferenceRatingBps: 5_000,
      epochDurationSeconds: 1200,
    },
    {
      client: fakeClient,
      now: fakeNow,
      encryptFn: async (targetRound, payload) => {
        const marker = payload[0] === 1 ? "1" : "0";
        const plaintextMarker = `${marker}:${Buffer.from(payload.slice(1)).toString("hex")}`;
        return Buffer.from(
          makeFakeArmoredTlockCiphertext({
            targetRound: BigInt(targetRound),
            drandChainHash:
              "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
            plaintextMarker,
          }).slice(2),
          "hex",
        ).toString("utf8");
      },
    },
  );

  assert.equal(commit.targetRound > 0n, true);
  assert.equal(
    commit.drandChainHash,
    "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  );
  assert.equal(commit.roundReferenceRatingBps, 5_000);
  assert.equal(
    commit.commitHash,
    buildCommitHash(
      true,
      6_900,
      ("0x" + "33".repeat(32)) as `0x${string}`,
      voter,
      7n,
      3n,
      5_000,
      commit.targetRound,
      commit.drandChainHash,
      commit.ciphertext,
    ),
  );
});

test("createTlockVoteCommit rounds non-aligned tlock targets up to the next drand round", async () => {
  const voter = "0x2222222222222222222222222222222222222222";
  const commit = await createTlockVoteCommit(
    {
      voter,
      isUp: true,
      predictedUpBps: 6_900,
      salt: ("0x" + "44".repeat(32)) as `0x${string}`,
      contentId: 8n,
      roundId: 4n,
      roundReferenceRatingBps: 5_000,
      epochDurationSeconds: 1200,
    },
    {
      client: fakeClient,
      now: () => fakeNow() + 1000,
      encryptFn: async (targetRound) => {
        return Buffer.from(
          makeFakeArmoredTlockCiphertext({
            targetRound: BigInt(targetRound),
            drandChainHash:
              "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
            plaintextMarker: "1:" + "44".repeat(32),
          }).slice(2),
          "hex",
        ).toString("utf8");
      },
    },
  );

  assert.equal(commit.targetRound, 403n);
});

test("createTlockVoteCommit tolerates a first vote mined two seconds later", async () => {
  const voter = "0x2222222222222222222222222222222222222222";
  const targetRounds: number[] = [];
  const commit = await createTlockVoteCommit(
    {
      voter,
      isUp: true,
      predictedUpBps: 6_900,
      salt: ("0x" + "44".repeat(32)) as `0x${string}`,
      contentId: 8n,
      roundId: 4n,
      roundReferenceRatingBps: 5_000,
      epochDurationSeconds: 1200,
    },
    {
      client: fakeClient,
      now: fakeNow,
      encryptFn: async (targetRound) => {
        targetRounds.push(targetRound);
        return Buffer.from(
          makeFakeArmoredTlockCiphertext({
            targetRound: BigInt(targetRound),
            drandChainHash:
              "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
            plaintextMarker: "1:" + "44".repeat(32),
          }).slice(2),
          "hex",
        ).toString("utf8");
      },
    },
  );

  assert.deepEqual(targetRounds, [403]);
  assert.equal(commit.targetRound, 403n);
});

test("createTlockVoteCommit shares a drift-safe target across the formerly bad window", async () => {
  const voter = "0x2222222222222222222222222222222222222222";
  const commit = await createTlockVoteCommit(
    {
      voter,
      isUp: true,
      predictedUpBps: 6_900,
      salt: ("0x" + "44".repeat(32)) as `0x${string}`,
      contentId: 8n,
      roundId: 4n,
      roundReferenceRatingBps: 5_000,
      epochDurationSeconds: 1199,
    },
    {
      client: fakeClient,
      now: fakeNow,
      encryptFn: async (targetRound) =>
        Buffer.from(
          makeFakeArmoredTlockCiphertext({
            targetRound: BigInt(targetRound),
            drandChainHash:
              "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
            plaintextMarker: "1:" + "44".repeat(32),
          }).slice(2),
          "hex",
        ).toString("utf8"),
    },
  );

  assert.equal(commit.targetRound, 402n);
});

test("createTlockVoteCommit rejects windows without a shared drift-safe target", async () => {
  const voter = "0x2222222222222222222222222222222222222222";
  await assert.rejects(
    createTlockVoteCommit(
      {
        voter,
        isUp: true,
        predictedUpBps: 6_900,
        salt: ("0x" + "44".repeat(32)) as `0x${string}`,
        contentId: 8n,
        roundId: 4n,
        roundReferenceRatingBps: 5_000,
        epochDurationSeconds: 1199,
      },
      {
        client: fakeClient,
        now: fakeNow,
        candidateTimestampOffsetsSeconds: [0, 7],
        encryptFn: async (targetRound) =>
          Buffer.from(
            makeFakeArmoredTlockCiphertext({
              targetRound: BigInt(targetRound),
              drandChainHash:
                "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
              plaintextMarker: "1:" + "44".repeat(32),
            }).slice(2),
            "hex",
          ).toString("utf8"),
      },
    ),
    /No shared drand target round/,
  );
});

test("createTlockVoteCommit targets the next active round epoch boundary", async () => {
  const voter = "0x2222222222222222222222222222222222222222";
  const commit = await createTlockVoteCommit(
    {
      voter,
      isUp: true,
      predictedUpBps: 6_900,
      salt: ("0x" + "55".repeat(32)) as `0x${string}`,
      contentId: 8n,
      roundId: 4n,
      roundReferenceRatingBps: 5_000,
      epochDurationSeconds: 1200,
    },
    {
      client: fakeClient,
      now: () => fakeNow() + 1000 * 1000,
      roundStartTimeSeconds: 1692803367,
      encryptFn: async (targetRound) => {
        return Buffer.from(
          makeFakeArmoredTlockCiphertext({
            targetRound: BigInt(targetRound),
            drandChainHash:
              "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
            plaintextMarker: "1:" + "55".repeat(32),
          }).slice(2),
          "hex",
        ).toString("utf8");
      },
    },
  );

  assert.equal(commit.targetRound, 403n);
});

test("createTlockVoteCommit can encrypt to an explicit target round", async () => {
  const voter = "0x2222222222222222222222222222222222222222";
  const explicitTargetRound = 987_654n;
  const commit = await createTlockVoteCommit(
    {
      voter,
      isUp: false,
      predictedUpBps: 4_200,
      salt: ("0x" + "44".repeat(32)) as `0x${string}`,
      contentId: 8n,
      roundId: 4n,
      roundReferenceRatingBps: 4_500,
      epochDurationSeconds: 1200,
    },
    {
      client: fakeClient,
      targetRound: explicitTargetRound,
      encryptFn: async (targetRound, payload) => {
        assert.equal(targetRound, Number(explicitTargetRound));
        const marker = payload[0] === 1 ? "1" : "0";
        const plaintextMarker = `${marker}:${Buffer.from(payload.slice(1)).toString("hex")}`;
        return Buffer.from(
          makeFakeArmoredTlockCiphertext({
            targetRound: BigInt(targetRound),
            drandChainHash:
              "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
            plaintextMarker,
          }).slice(2),
          "hex",
        ).toString("utf8");
      },
    },
  );

  assert.equal(commit.targetRound, explicitTargetRound);
  assert.equal(
    commit.commitHash,
    buildCommitHash(
      false,
      4_200,
      ("0x" + "44".repeat(32)) as `0x${string}`,
      voter,
      8n,
      4n,
      4_500,
      explicitTargetRound,
      commit.drandChainHash,
      commit.ciphertext,
    ),
  );
});

test("getVoteTlockChainInfo returns the canonical drand metadata from the tlock client", async () => {
  const chainInfo = await getVoteTlockChainInfo({ client: fakeClient });

  assert.deepEqual(chainInfo, {
    periodSeconds: 3n,
    genesisTimeSeconds: 1692803367n,
    drandChainHash:
      "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  });
});

test("getVoteTlockChainInfo rejects unsupported on-chain drand configs before voting", async () => {
  await assert.rejects(
    getVoteTlockChainInfo({
      drandChainHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }),
    /Unsupported drand chain/,
  );
});

test("createTlockRbtsVoteCommit rejects a tlock client that does not match the vote round drand config", async () => {
  await assert.rejects(
    createTlockRbtsVoteCommit(
      {
        voter: "0x2222222222222222222222222222222222222222",
        isUp: true,
        predictedUpBps: 6_900,
        salt: ("0x" + "66".repeat(32)) as `0x${string}`,
        contentId: 7n,
        roundId: 3n,
        roundReferenceRatingBps: 5_000,
        epochDurationSeconds: 1200,
      },
      {
        client: fakeClient,
        drandChainHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        encryptFn: async () => {
          throw new Error("encrypt should not be called");
        },
      },
    ),
    /does not match vote round drand chain/,
  );
});

test("deriveVoteTlockRevealAvailableAtSeconds converts a committed round into its reveal timestamp", () => {
  assert.equal(
    deriveVoteTlockRevealAvailableAtSeconds(401n, {
      periodSeconds: 3n,
      genesisTimeSeconds: 1692803367n,
      drandChainHash:
        "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
    }),
    1692804567n,
  );
});

// C-3 (2026-05-22 audit): pin the boundary cases for deriveVoteTlockRevealAvailableAtSeconds
// so any future change to the formula is forced through an explicit test update plus
// alignment with the local "round R == genesis + (R-1)*period" convention used by
// computeTargetRoundForBeaconTime (see voting.ts:528) and the drand chain's actual
// signature-availability schedule. If a follow-up confirms drand publishes round R at
// genesis + R*period rather than genesis + (R-1)*period, this test must be updated
// in lockstep with the formula in voting.ts.
test("deriveVoteTlockRevealAvailableAtSeconds: round 1 == genesis (local convention)", () => {
  assert.equal(
    deriveVoteTlockRevealAvailableAtSeconds(1n, {
      periodSeconds: 3n,
      genesisTimeSeconds: 1_000_000n,
      drandChainHash:
        "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
    }),
    1_000_000n,
  );
});

test("deriveVoteTlockRevealAvailableAtSeconds: round 2 == genesis + period", () => {
  assert.equal(
    deriveVoteTlockRevealAvailableAtSeconds(2n, {
      periodSeconds: 3n,
      genesisTimeSeconds: 1_000_000n,
      drandChainHash:
        "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
    }),
    1_000_003n,
  );
});

test("deriveVoteTlockRevealAvailableAtSeconds: nonsense inputs collapse to 0", () => {
  const chain = {
    periodSeconds: 3n,
    genesisTimeSeconds: 1_000_000n,
    drandChainHash:
      "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971" as const,
  };
  assert.equal(deriveVoteTlockRevealAvailableAtSeconds(0n, chain), 0n);
  assert.equal(deriveVoteTlockRevealAvailableAtSeconds(-1n, chain), 0n);
  assert.equal(
    deriveVoteTlockRevealAvailableAtSeconds(401n, {
      ...chain,
      periodSeconds: 0n,
    }),
    0n,
  );
});
