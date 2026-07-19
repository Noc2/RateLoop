const QUEUE_DB_NAME = "rateloop-tokenless-rater";
const QUEUE_DB_VERSION = 2;
const QUEUE_STORE = "commit-queue";
const MAX_QUEUE_RECORD_BYTES = 32_768;
const MAX_RETRY_DELAY_MS = 30_000;
const FORBIDDEN_SECRET_KEYS = new Set(["votePrivateKey", "payoutPrivateKey", "salt", "payoutAddress", "reveal"]);

export type TokenlessQueuedCommit = {
  schemaVersion: "rateloop.tokenless.commit-queue.v2";
  queueId: string;
  principalId: string;
  roundId: string;
  commitDeadline: string;
  relayPayload: Record<string, unknown>;
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
  lastErrorCode: string | null;
};

export interface TokenlessCommitQueueStore {
  get(queueId: string, principalId: string): Promise<TokenlessQueuedCommit | null>;
  list(principalId: string): Promise<TokenlessQueuedCommit[]>;
  put(record: TokenlessQueuedCommit): Promise<void>;
  remove(queueId: string, principalId: string): Promise<void>;
}

function assertNoSecrets(value: unknown, depth = 0): void {
  if (depth > 20) throw new Error("Commit relay payload is too deeply nested.");
  if (Array.isArray(value)) {
    for (const item of value) assertNoSecrets(item, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_SECRET_KEYS.has(key)) {
      throw new Error(`Commit relay payload must not contain client secret field ${key}.`);
    }
    assertNoSecrets(item, depth + 1);
  }
}

function validateQueuedCommit(record: TokenlessQueuedCommit, now = Date.now()) {
  if (record.schemaVersion !== "rateloop.tokenless.commit-queue.v2")
    throw new Error("Unsupported commit queue record.");
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(record.queueId)) throw new Error("Invalid commit queue id.");
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(record.principalId)) throw new Error("Invalid commit queue owner.");
  if (!/^[1-9][0-9]*$/.test(record.roundId)) throw new Error("Invalid queued round id.");
  const deadline = Date.parse(record.commitDeadline);
  if (!Number.isFinite(deadline) || deadline <= now) throw new Error("The commit deadline has passed.");
  if (!Number.isSafeInteger(record.attempts) || record.attempts < 0 || record.attempts > 100) {
    throw new Error("Invalid commit retry count.");
  }
  assertNoSecrets(record.relayPayload);
  const encoded = new TextEncoder().encode(JSON.stringify(record));
  if (encoded.byteLength > MAX_QUEUE_RECORD_BYTES) throw new Error("Queued commit exceeds its storage size bound.");
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
  });
}

async function openQueueDatabase() {
  if (!globalThis.indexedDB) throw new Error("IndexedDB is required for deadline-aware commit recovery.");
  const request = indexedDB.open(QUEUE_DB_NAME, QUEUE_DB_VERSION);
  request.onupgradeneeded = event => {
    const database = request.result;
    if ((event.oldVersion ?? 0) < 2 && database.objectStoreNames.contains(QUEUE_STORE)) {
      database.deleteObjectStore(QUEUE_STORE);
    }
    if (!database.objectStoreNames.contains(QUEUE_STORE)) {
      database.createObjectStore(QUEUE_STORE, { keyPath: "queueId" });
    }
  };
  return requestResult(request);
}

export function createIndexedDbTokenlessCommitQueue(): TokenlessCommitQueueStore {
  return {
    async get(queueId, principalId) {
      const database = await openQueueDatabase();
      try {
        const transaction = database.transaction(QUEUE_STORE, "readonly");
        const result = await requestResult(transaction.objectStore(QUEUE_STORE).get(queueId));
        await transactionDone(transaction);
        const record = (result as TokenlessQueuedCommit | undefined) ?? null;
        return record?.principalId === principalId ? record : null;
      } finally {
        database.close();
      }
    },
    async list(principalId) {
      const database = await openQueueDatabase();
      try {
        const transaction = database.transaction(QUEUE_STORE, "readonly");
        const result = await requestResult(transaction.objectStore(QUEUE_STORE).getAll());
        await transactionDone(transaction);
        return (result as TokenlessQueuedCommit[])
          .filter(record => record.principalId === principalId)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      } finally {
        database.close();
      }
    },
    async put(record) {
      validateQueuedCommit(record);
      const database = await openQueueDatabase();
      try {
        const transaction = database.transaction(QUEUE_STORE, "readwrite");
        transaction.objectStore(QUEUE_STORE).put(record);
        await transactionDone(transaction);
      } finally {
        database.close();
      }
    },
    async remove(queueId, principalId) {
      const database = await openQueueDatabase();
      try {
        const transaction = database.transaction(QUEUE_STORE, "readwrite");
        const store = transaction.objectStore(QUEUE_STORE);
        const existing = (await requestResult(store.get(queueId))) as TokenlessQueuedCommit | undefined;
        if (existing?.principalId === principalId) store.delete(queueId);
        await transactionDone(transaction);
      } finally {
        database.close();
      }
    },
  };
}

export async function enqueueTokenlessCommit(
  store: TokenlessCommitQueueStore,
  input: {
    queueId: string;
    principalId: string;
    roundId: bigint;
    commitDeadline: Date;
    relayPayload: Record<string, unknown>;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const record: TokenlessQueuedCommit = {
    schemaVersion: "rateloop.tokenless.commit-queue.v2",
    queueId: input.queueId,
    principalId: input.principalId,
    roundId: input.roundId.toString(),
    commitDeadline: input.commitDeadline.toISOString(),
    relayPayload: input.relayPayload,
    attempts: 0,
    nextAttemptAt: now.toISOString(),
    createdAt: now.toISOString(),
    lastErrorCode: null,
  };
  validateQueuedCommit(record, now.getTime());
  await store.put(record);
  return record;
}

export async function recordTokenlessCommitRelayFailure(
  store: TokenlessCommitQueueStore,
  queueId: string,
  principalId: string,
  errorCode: string,
  now = new Date(),
) {
  const record = await store.get(queueId, principalId);
  if (!record) throw new Error("Queued commit was not found.");
  const deadline = Date.parse(record.commitDeadline);
  if (deadline <= now.getTime()) {
    await store.remove(queueId, principalId);
    return { expired: true as const, record: null };
  }
  const attempts = record.attempts + 1;
  const retryDelay = Math.min(1_000 * 2 ** Math.min(attempts - 1, 5), MAX_RETRY_DELAY_MS);
  const nextAttempt = Math.min(now.getTime() + retryDelay, deadline - 250);
  const updated = {
    ...record,
    attempts,
    lastErrorCode: errorCode.slice(0, 80),
    nextAttemptAt: new Date(nextAttempt).toISOString(),
  };
  validateQueuedCommit(updated, now.getTime());
  await store.put(updated);
  return { expired: false as const, record: updated };
}

export async function dueTokenlessCommits(store: TokenlessCommitQueueStore, principalId: string, now = new Date()) {
  const records = await store.list(principalId);
  const due: TokenlessQueuedCommit[] = [];
  for (const record of records) {
    if (Date.parse(record.commitDeadline) <= now.getTime()) {
      await store.remove(record.queueId, principalId);
    } else if (Date.parse(record.nextAttemptAt) <= now.getTime()) {
      due.push(record);
    }
  }
  return due;
}

export function __tokenlessQueueTestUtils() {
  return { validateQueuedCommit };
}
