import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalDatabaseUrl = env.DATABASE_URL;
const originalNodeEnv = env.NODE_ENV;

env.DATABASE_URL = "memory:";
env.NODE_ENV = "test";

type DbModule = typeof import("~~/lib/db");
type DbTestMemoryModule = typeof import("~~/lib/db/testing/testMemory");
type SignedActionsModule = typeof import("./signedActions");

const WALLET = "0x1234567890abcdef1234567890abcdef12345678" as const;
const ACTION = "test_action";
const TITLE = "RateLoop test action";
const PAYLOAD_HASH = "f".repeat(64);

let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;
let signedActions: SignedActionsModule;

before(async () => {
  dbModule = await import("~~/lib/db");
  dbTestMemory = await import("~~/lib/db/testing/testMemory");
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());
  signedActions = await import("./signedActions");
});

beforeEach(async () => {
  signedActions.__setSignedActionVerificationClientForTests(null);
  await dbModule.dbClient.execute("DELETE FROM signed_action_challenges");
});

after(() => {
  signedActions.__setSignedActionVerificationClientForTests(null);
  dbModule.__setDatabaseResourcesForTests(null);
  if (originalDatabaseUrl === undefined) {
    delete env.DATABASE_URL;
  } else {
    env.DATABASE_URL = originalDatabaseUrl;
  }
  if (originalNodeEnv === undefined) {
    delete env.NODE_ENV;
  } else {
    env.NODE_ENV = originalNodeEnv;
  }
});

test("verifyAndConsumeSignedActionChallenge uses the chain-backed verification client", async () => {
  const challenge = await signedActions.issueSignedActionChallenge({
    title: TITLE,
    action: ACTION,
    walletAddress: WALLET,
    payloadHash: PAYLOAD_HASH,
  });
  const seenMessages: string[] = [];

  signedActions.__setSignedActionVerificationClientForTests({
    async verifyMessage(params) {
      seenMessages.push(params.message);
      assert.equal(params.address, WALLET);
      assert.equal(params.signature, "0x1234");
      return params.message === challenge.message;
    },
  });

  await dbModule.db.transaction(async tx => {
    await signedActions.verifyAndConsumeSignedActionChallenge(tx, {
      challengeId: challenge.challengeId,
      action: ACTION,
      walletAddress: WALLET,
      payloadHash: PAYLOAD_HASH,
      signature: "0x1234",
      buildMessage: ({ nonce, expiresAt }) =>
        signedActions.buildSignedActionMessage({
          title: TITLE,
          action: ACTION,
          address: WALLET,
          payloadHash: PAYLOAD_HASH,
          nonce,
          expiresAt,
        }),
    });
  });

  assert.deepEqual(seenMessages, [challenge.message]);

  const rows = await dbModule.dbClient.execute({
    sql: "SELECT used_at FROM signed_action_challenges WHERE id = ?",
    args: [challenge.challengeId],
  });
  assert.equal(rows.rowCount, 1);
  assert.ok(rows.rows[0].used_at);
});

test("verifyAndConsumeSignedActionChallenge forwards the verification chain", async () => {
  const challenge = await signedActions.issueSignedActionChallenge({
    title: TITLE,
    action: ACTION,
    walletAddress: WALLET,
    payloadHash: PAYLOAD_HASH,
  });
  const seenChainIds: Array<number | undefined> = [];

  signedActions.__setSignedActionVerificationClientForTests(options => {
    seenChainIds.push(options.chainId);
    return {
      async verifyMessage(params) {
        assert.equal(params.message, challenge.message);
        return true;
      },
    };
  });

  await dbModule.db.transaction(async tx => {
    await signedActions.verifyAndConsumeSignedActionChallenge(tx, {
      challengeId: challenge.challengeId,
      action: ACTION,
      walletAddress: WALLET,
      payloadHash: PAYLOAD_HASH,
      signature: "0x1234",
      chainId: 84532,
      buildMessage: ({ nonce, expiresAt }) =>
        signedActions.buildSignedActionMessage({
          title: TITLE,
          action: ACTION,
          address: WALLET,
          payloadHash: PAYLOAD_HASH,
          nonce,
          expiresAt,
        }),
    });
  });

  assert.deepEqual(seenChainIds, [84532]);
});

test("verifyAndConsumeSignedActionChallenge rejects chain verifier failures", async () => {
  const challenge = await signedActions.issueSignedActionChallenge({
    title: TITLE,
    action: ACTION,
    walletAddress: WALLET,
    payloadHash: PAYLOAD_HASH,
  });

  signedActions.__setSignedActionVerificationClientForTests({
    async verifyMessage() {
      return false;
    },
  });

  await assert.rejects(
    dbModule.db.transaction(async tx => {
      await signedActions.verifyAndConsumeSignedActionChallenge(tx, {
        challengeId: challenge.challengeId,
        action: ACTION,
        walletAddress: WALLET,
        payloadHash: PAYLOAD_HASH,
        signature: "0x1234",
        buildMessage: ({ nonce, expiresAt }) =>
          signedActions.buildSignedActionMessage({
            title: TITLE,
            action: ACTION,
            address: WALLET,
            payloadHash: PAYLOAD_HASH,
            nonce,
            expiresAt,
          }),
      });
    }),
    /INVALID_SIGNATURE/,
  );
});
