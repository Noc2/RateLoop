import {
  type TokenlessCommitQueueStore,
  type TokenlessQueuedCommit,
  dueTokenlessCommits,
  enqueueTokenlessCommit,
  recordTokenlessCommitRelayFailure,
} from "./queue";
import assert from "node:assert/strict";
import { test } from "node:test";

function memoryQueue(): TokenlessCommitQueueStore {
  const records = new Map<string, TokenlessQueuedCommit>();
  return {
    async get(queueId) {
      return records.get(queueId) ?? null;
    },
    async list() {
      return [...records.values()];
    },
    async put(record) {
      records.set(record.queueId, structuredClone(record));
    },
    async remove(queueId) {
      records.delete(queueId);
    },
  };
}

test("queues only public relay material and retries before the immutable deadline", async () => {
  const store = memoryQueue();
  const now = new Date("2026-07-12T12:00:00.000Z");
  const queued = await enqueueTokenlessCommit(store, {
    queueId: "commit:round:42",
    roundId: 42n,
    commitDeadline: new Date(now.getTime() + 60_000),
    relayPayload: { voucher: { voteKey: "0x1111" }, sealedPayload: "0xabcd", voteKeySignature: "0x1234" },
    now,
  });
  assert.equal((await dueTokenlessCommits(store, now))[0]?.queueId, queued.queueId);
  const failure = await recordTokenlessCommitRelayFailure(store, queued.queueId, "relayer_unavailable", now);
  assert.equal(failure.expired, false);
  assert.equal(failure.record.attempts, 1);
  assert.equal(failure.record.nextAttemptAt, new Date(now.getTime() + 1_000).toISOString());
  assert.deepEqual(await dueTokenlessCommits(store, new Date(now.getTime() + 500)), []);
});

test("purges expired commits and rejects plaintext key or reveal material", async () => {
  const store = memoryQueue();
  const now = new Date("2026-07-12T12:00:00.000Z");
  await assert.rejects(
    () =>
      enqueueTokenlessCommit(store, {
        queueId: "commit:secret:42",
        roundId: 42n,
        commitDeadline: new Date(now.getTime() + 60_000),
        relayPayload: { votePrivateKey: `0x${"11".repeat(32)}` },
        now,
      }),
    /must not contain client secret field votePrivateKey/,
  );
  await enqueueTokenlessCommit(store, {
    queueId: "commit:expires:42",
    roundId: 42n,
    commitDeadline: new Date(now.getTime() + 1_000),
    relayPayload: { sealedPayload: "0xabcd" },
    now,
  });
  assert.deepEqual(await dueTokenlessCommits(store, new Date(now.getTime() + 1_001)), []);
  assert.equal(await store.get("commit:expires:42"), null);
});
