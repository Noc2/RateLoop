import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { __benchmarkResearchPersistenceTestUtils } from "~~/lib/tokenless/benchmarkResearchPersistence";

const databaseUrl = process.env.BENCHMARK_RESEARCH_TEST_DATABASE_URL;
const committedTransaction = __benchmarkResearchPersistenceTestUtils.withPostgresCommittedTransaction;

test("real PostgreSQL reveals no bytes or snapshot when COMMIT fails", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const suffix = `${process.pid}_${Date.now()}`;
  const parent = `tokenless_test_commit_parent_${suffix}`;
  const snapshots = `tokenless_test_commit_snapshot_${suffix}`;
  try {
    await pool.query(`CREATE TABLE "${parent}" (id integer PRIMARY KEY)`);
    await pool.query(
      `CREATE TABLE "${snapshots}" (
         id integer PRIMARY KEY,
         parent_id integer NOT NULL REFERENCES "${parent}"(id) DEFERRABLE INITIALLY DEFERRED,
         response_bytes bytea NOT NULL
       )`,
    );
    let exposed: Uint8Array | undefined;
    await assert.rejects(async () => {
      const result = await committedTransaction(pool, async client => {
        const bytes = new TextEncoder().encode('{"private":"must-not-escape"}');
        await client.query(`INSERT INTO "${snapshots}" (id,parent_id,response_bytes) VALUES (1,404,$1)`, [
          Buffer.from(bytes),
        ]);
        return { value: bytes, stagedEventDigest: null };
      });
      exposed = result.value;
    }, /foreign key constraint/iu);
    assert.equal(exposed, undefined);
    const stored = await pool.query(`SELECT count(*)::integer AS count FROM "${snapshots}"`);
    assert.equal(stored.rows[0].count, 0);
  } finally {
    await pool.query(`DROP TABLE IF EXISTS "${snapshots}"`);
    await pool.query(`DROP TABLE IF EXISTS "${parent}"`);
    await pool.end();
  }
});

test("real PostgreSQL replay returns the exact committed bytes", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const table = `tokenless_test_replay_${process.pid}_${Date.now()}`;
  const bytes = new TextEncoder().encode('{"schemaVersion":"rateloop.byte-exact-replay.v1","unicode":"💩"}');
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  try {
    await pool.query(
      `CREATE TABLE "${table}" (access_id text PRIMARY KEY,response_bytes bytea NOT NULL,bytes_digest text NOT NULL)`,
    );
    await committedTransaction(pool, async client => {
      await client.query(`INSERT INTO "${table}" (access_id,response_bytes,bytes_digest) VALUES ('access-1',$1,$2)`, [
        Buffer.from(bytes),
        digest,
      ]);
      return { value: null, stagedEventDigest: null };
    });
    const replay = await committedTransaction(pool, async client => {
      const result = await client.query(
        `SELECT response_bytes,bytes_digest FROM "${table}" WHERE access_id='access-1' FOR UPDATE`,
      );
      const replayBytes = new Uint8Array(result.rows[0].response_bytes as Buffer);
      assert.equal(`sha256:${createHash("sha256").update(replayBytes).digest("hex")}`, result.rows[0].bytes_digest);
      return { value: replayBytes, stagedEventDigest: null };
    });
    assert.deepEqual(replay.value, bytes);
  } finally {
    await pool.query(`DROP TABLE IF EXISTS "${table}"`);
    await pool.end();
  }
});

test("real PostgreSQL serializes the locked access recheck against revocation", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 });
  const table = `tokenless_test_revocation_lock_${process.pid}_${Date.now()}`;
  let releaseRead!: () => void;
  let readLocked!: () => void;
  const readMayCommit = new Promise<void>(resolve => {
    releaseRead = resolve;
  });
  const readHasLock = new Promise<void>(resolve => {
    readLocked = resolve;
  });
  try {
    await pool.query(`CREATE TABLE "${table}" (grant_id text PRIMARY KEY,revoked boolean NOT NULL)`);
    await pool.query(`INSERT INTO "${table}" (grant_id,revoked) VALUES ('grant-1',false)`);
    const read = committedTransaction(pool, async client => {
      const result = await client.query(`SELECT revoked FROM "${table}" WHERE grant_id='grant-1' FOR UPDATE`);
      assert.equal(result.rows[0].revoked, false);
      readLocked();
      await readMayCommit;
      return { value: "read-committed", stagedEventDigest: null };
    });
    await readHasLock;
    let revocationAcquired = false;
    const revoke = committedTransaction(pool, async client => {
      await client.query(`SELECT revoked FROM "${table}" WHERE grant_id='grant-1' FOR UPDATE`);
      revocationAcquired = true;
      await client.query(`UPDATE "${table}" SET revoked=true WHERE grant_id='grant-1'`);
      return { value: "revoked", stagedEventDigest: null };
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(revocationAcquired, false);
    releaseRead();
    assert.equal((await read).value, "read-committed");
    assert.equal((await revoke).value, "revoked");
    const stored = await pool.query(`SELECT revoked FROM "${table}" WHERE grant_id='grant-1'`);
    assert.equal(stored.rows[0].revoked, true);
  } finally {
    releaseRead();
    await pool.query(`DROP TABLE IF EXISTS "${table}"`);
    await pool.end();
  }
});
