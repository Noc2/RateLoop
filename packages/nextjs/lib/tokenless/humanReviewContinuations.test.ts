import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { Pool } from "pg";
import { DataType, newDb } from "pg-mem";
import { type DatabaseResources, __setDatabaseResourcesForTests } from "~~/lib/db";
import {
  type HumanReviewContinuationCredential,
  consumeHumanReviewContinuation,
  issueHumanReviewContinuation,
  revokeHumanReviewContinuation,
  revokeWorkspaceHumanReviewContinuations,
  rotateHumanReviewContinuation,
} from "~~/lib/tokenless/humanReviewContinuations";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const migration = readFileSync(join(process.cwd(), "drizzle", "0065_human_review_continuations.sql"), "utf8");
const NOW = new Date("2026-07-16T11:00:00.000Z");
const API_CREDENTIAL: HumanReviewContinuationCredential = {
  integrationId: "agi_api",
  kind: "api_key",
  id: "key_api",
};
const OAUTH_CREDENTIAL: HumanReviewContinuationCredential = {
  integrationId: "agi_oauth",
  kind: "oauth_token_family",
  id: "atf_oauth",
};

let pool: Pool;

function resourcesFor(database: ReturnType<typeof newDb>): DatabaseResources {
  const adapter = database.adapters.createPg();
  const memoryPool = new adapter.Pool() as unknown as Pool;
  return {
    client: {
      async execute(input) {
        if (typeof input === "string") return memoryPool.query(input);
        let index = 0;
        const text = input.args?.length ? input.sql.replaceAll("?", () => `$${++index}`) : input.sql;
        return memoryPool.query(text, input.args ?? []);
      },
    },
    database: {} as DatabaseResources["database"],
    pool: memoryPool,
  };
}

async function createDatabase() {
  const database = newDb();
  database.public.registerOperator({
    operator: "~",
    left: DataType.text,
    right: DataType.text,
    returns: DataType.bool,
    implementation: (value, pattern) => new RegExp(pattern).test(value),
  });
  database.public.none(`
    CREATE TABLE tokenless_workspaces (workspace_id text PRIMARY KEY);
    CREATE TABLE tokenless_agent_integrations (
      integration_id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES tokenless_workspaces(workspace_id),
      agent_id text NOT NULL,
      agent_version_id text NOT NULL,
      api_key_id text,
      token_family_id text,
      status text NOT NULL
    );
    CREATE TABLE tokenless_agent_review_opportunities (
      opportunity_id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES tokenless_workspaces(workspace_id),
      agent_id text NOT NULL,
      agent_version_id text NOT NULL,
      request_profile_id text NOT NULL,
      request_profile_version integer NOT NULL,
      request_profile_hash text NOT NULL,
      operation_key text,
      created_at timestamp with time zone NOT NULL,
      UNIQUE (workspace_id, opportunity_id)
    );
    CREATE TABLE tokenless_agent_review_request_profiles (
      workspace_id text NOT NULL,
      profile_id text NOT NULL,
      version integer NOT NULL,
      profile_hash text NOT NULL,
      response_window_seconds integer NOT NULL,
      PRIMARY KEY (profile_id, version),
      UNIQUE (workspace_id, profile_id, version, profile_hash)
    );
    CREATE TABLE tokenless_private_review_requests (
      private_review_id text PRIMARY KEY,
      workspace_id text NOT NULL,
      response_deadline timestamp with time zone NOT NULL
    );
    CREATE TABLE tokenless_private_unpaid_review_deliveries (
      workspace_id text NOT NULL,
      opportunity_id text NOT NULL,
      private_review_id text NOT NULL,
      response_deadline timestamp with time zone NOT NULL
    );
    CREATE TABLE tokenless_chain_executions (
      operation_key text PRIMARY KEY,
      round_terms_json text
    );
    CREATE TABLE tokenless_agent_review_approval_requests (
      workspace_id text NOT NULL,
      opportunity_id text NOT NULL,
      revision integer NOT NULL,
      status text NOT NULL,
      expires_at timestamp with time zone NOT NULL
    );
    CREATE TABLE tokenless_agent_review_opportunity_lifecycles (
      workspace_id text NOT NULL,
      opportunity_id text NOT NULL,
      state text NOT NULL,
      state_revision integer NOT NULL,
      terminal_at timestamp with time zone,
      PRIMARY KEY (workspace_id, opportunity_id),
      FOREIGN KEY (workspace_id, opportunity_id)
        REFERENCES tokenless_agent_review_opportunities(workspace_id, opportunity_id)
    );
  `);
  for (const statement of migration.split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (!sql || /^CREATE OR REPLACE FUNCTION/u.test(sql) || /^CREATE TRIGGER/u.test(sql)) continue;
    database.public.none(sql.replaceAll(" USING btree", ""));
  }
  const resources = resourcesFor(database);
  pool = resources.pool;
  __setDatabaseResourcesForTests(resources);
  await pool.query(`
    INSERT INTO tokenless_workspaces (workspace_id) VALUES ('ws_api'), ('ws_oauth');
    INSERT INTO tokenless_agent_integrations
      (integration_id,workspace_id,agent_id,agent_version_id,api_key_id,token_family_id,status)
    VALUES
      ('agi_api','ws_api','agent_api','version_api','key_api',NULL,'active'),
      ('agi_other','ws_api','agent_other','version_other','key_other',NULL,'active'),
      ('agi_oauth','ws_oauth','agent_oauth','version_oauth',NULL,'atf_oauth','active');
    INSERT INTO tokenless_agent_review_opportunities
      (opportunity_id,workspace_id,agent_id,agent_version_id,request_profile_id,
       request_profile_version,request_profile_hash,operation_key,created_at)
    VALUES
      ('opp_api','ws_api','agent_api','version_api','profile_api',1,'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',NULL,'2026-07-16T11:00:00Z'),
      ('opp_oauth','ws_oauth','agent_oauth','version_oauth','profile_oauth',1,'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',NULL,'2026-07-16T11:00:00Z');
    INSERT INTO tokenless_agent_review_request_profiles
      (workspace_id,profile_id,version,profile_hash,response_window_seconds)
    VALUES
      ('ws_api','profile_api',1,'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',3600),
      ('ws_oauth','profile_oauth',1,'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',3600);
    INSERT INTO tokenless_agent_review_opportunity_lifecycles
      (workspace_id,opportunity_id,state,state_revision,terminal_at)
    VALUES
      ('ws_api','opp_api','request_ready',2,NULL),
      ('ws_oauth','opp_oauth','approval_required',4,NULL);
  `);
}

beforeEach(createDatabase);

afterEach(async () => {
  __setDatabaseResourcesForTests(null);
  await pool.end();
});

async function rejectsWithCode(action: () => Promise<unknown>, code: string) {
  await assert.rejects(action, (error: unknown) => error instanceof TokenlessServiceError && error.code === code);
}

test("0065 stores only continuation hashes and installs scope, expiry, uniqueness, and append-only audit guards", () => {
  assert.match(migration, /"token_hash" text NOT NULL/u);
  assert.doesNotMatch(migration, /"token" text/u);
  assert.match(migration, /active_revision_operation_unique/u);
  assert.match(migration, /WHERE "status" = 'active'/u);
  assert.match(migration, /"caller_credential_kind" IN \('api_key', 'oauth_token_family'\)/u);
  assert.match(migration, /"retry_after_ms" BETWEEN 250 AND 60000/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE/u);
  assert.match(migration, /append-only/u);
  assert.doesNotMatch(migration, /source_artifact|suggestion_artifact|result_json|plaintext/iu);
});

test("idempotent issuance replaces an undelivered token without creating two active continuations", async () => {
  const first = await issueHumanReviewContinuation({
    credential: API_CREDENTIAL,
    opportunityId: "opp_api",
    lifecycleRevision: 2,
    allowedNextOperation: "request_review",
    issuanceKey: "issue:opp_api:request",
    now: NOW,
  });
  assert.ok(first.continuation);
  assert.equal(first.replayed, false);
  const stored = await pool.query(
    "SELECT token_hash FROM tokenless_agent_review_continuations WHERE status = 'active'",
  );
  assert.notEqual(stored.rows[0]?.token_hash, first.continuation.token);
  assert.match(String(stored.rows[0]?.token_hash), /^sha256:[0-9a-f]{64}$/u);

  const replay = await issueHumanReviewContinuation({
    credential: API_CREDENTIAL,
    opportunityId: "opp_api",
    lifecycleRevision: 2,
    allowedNextOperation: "request_review",
    issuanceKey: "issue:opp_api:request",
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.ok(replay.continuation);
  assert.equal(replay.replayed, true);
  assert.notEqual(replay.continuation.token, first.continuation.token);
  const statuses = await pool.query("SELECT status FROM tokenless_agent_review_continuations");
  assert.deepEqual(statuses.rows.map(row => row.status).sort(), ["active", "revoked"]);

  await rejectsWithCode(
    () =>
      issueHumanReviewContinuation({
        credential: API_CREDENTIAL,
        opportunityId: "opp_api",
        lifecycleRevision: 2,
        allowedNextOperation: "request_review",
        issuanceKey: "issue:opp_api:conflict",
        now: new Date(NOW.getTime() + 2_000),
      }),
    "review_continuation_conflict",
  );
  const afterConflict = await pool.query(
    "SELECT COUNT(*) AS count FROM tokenless_agent_review_continuations WHERE status = 'active'",
  );
  assert.equal(Number(afterConflict.rows[0]?.count), 1);
});

test("consumption and rotation are exact-replay safe across a lifecycle revision", async () => {
  const issued = await issueHumanReviewContinuation({
    credential: API_CREDENTIAL,
    opportunityId: "opp_api",
    lifecycleRevision: 2,
    allowedNextOperation: "request_review",
    issuanceKey: "issue:opp_api:consume",
    now: NOW,
  });
  const token = issued.continuation!.token;
  const consumed = await consumeHumanReviewContinuation({
    credential: API_CREDENTIAL,
    token,
    operation: "request_review",
    consumptionKey: "consume:opp_api:request",
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.equal(consumed.replayed, false);
  const replay = await consumeHumanReviewContinuation({
    credential: API_CREDENTIAL,
    token,
    operation: "request_review",
    consumptionKey: "consume:opp_api:request",
    now: new Date(NOW.getTime() + 2_000),
  });
  assert.equal(replay.replayed, true);
  await rejectsWithCode(
    () =>
      consumeHumanReviewContinuation({
        credential: API_CREDENTIAL,
        token,
        operation: "request_review",
        consumptionKey: "consume:opp_api:other",
        now: new Date(NOW.getTime() + 2_500),
      }),
    "review_continuation_consumption_conflict",
  );

  await pool.query(
    `UPDATE tokenless_agent_review_opportunity_lifecycles
     SET state = 'pending', state_revision = 3
     WHERE workspace_id = 'ws_api' AND opportunity_id = 'opp_api'`,
  );
  const rotated = await rotateHumanReviewContinuation({
    credential: API_CREDENTIAL,
    consumedToken: token,
    consumptionKey: "consume:opp_api:request",
    allowedNextOperation: "wait_for_review",
    retryAfterMs: 2_500,
    now: new Date(NOW.getTime() + 3_000),
  });
  assert.ok(rotated.continuation);
  assert.equal(rotated.continuation.lifecycleRevision, 3);
  assert.equal(rotated.continuation.retryAfterMs, 2_500);
  const lostSuccessor = rotated.continuation.token;

  const rotationReplay = await rotateHumanReviewContinuation({
    credential: API_CREDENTIAL,
    consumedToken: token,
    consumptionKey: "consume:opp_api:request",
    allowedNextOperation: "wait_for_review",
    retryAfterMs: 2_500,
    now: new Date(NOW.getTime() + 4_000),
  });
  assert.ok(rotationReplay.continuation);
  assert.equal(rotationReplay.replayed, true);
  assert.notEqual(rotationReplay.continuation.token, lostSuccessor);
  const active = await pool.query(
    "SELECT COUNT(*) AS count FROM tokenless_agent_review_continuations WHERE status = 'active'",
  );
  assert.equal(Number(active.rows[0]?.count), 1);
  await rejectsWithCode(
    () =>
      consumeHumanReviewContinuation({
        credential: API_CREDENTIAL,
        token: lostSuccessor,
        operation: "wait_for_review",
        consumptionKey: "consume:opp_api:wait",
        now: new Date(NOW.getTime() + 5_000),
      }),
    "review_continuation_inactive",
  );
});

test("continuations are capped by the frozen response deadline and cannot rotate after it", async () => {
  const issued = await issueHumanReviewContinuation({
    credential: API_CREDENTIAL,
    opportunityId: "opp_api",
    lifecycleRevision: 2,
    allowedNextOperation: "request_review",
    issuanceKey: "issue:opp_api:deadline-cap",
    ttlMs: 24 * 60 * 60_000,
    now: NOW,
  });
  assert.equal(issued.continuation?.expiresAt, "2026-07-16T12:00:00.000Z");
  await consumeHumanReviewContinuation({
    credential: API_CREDENTIAL,
    token: issued.continuation!.token,
    operation: "request_review",
    consumptionKey: "consume:opp_api:deadline-cap",
    now: new Date(NOW.getTime() + 1_000),
  });
  await pool.query(
    `UPDATE tokenless_agent_review_opportunity_lifecycles
     SET state = 'pending', state_revision = 3
     WHERE workspace_id = 'ws_api' AND opportunity_id = 'opp_api'`,
  );
  await rejectsWithCode(
    () =>
      rotateHumanReviewContinuation({
        credential: API_CREDENTIAL,
        consumedToken: issued.continuation!.token,
        consumptionKey: "consume:opp_api:deadline-cap",
        allowedNextOperation: "wait_for_review",
        now: new Date("2026-07-16T12:00:00.000Z"),
      }),
    "review_continuation_deadline_elapsed",
  );
  const successors = await pool.query(
    "SELECT COUNT(*) AS count FROM tokenless_agent_review_continuations WHERE status = 'active'",
  );
  assert.equal(Number(successors.rows[0]?.count), 0);
});

test("expired, revoked, conflicting, and cross-credential continuations fail closed", async () => {
  const expiring = await issueHumanReviewContinuation({
    credential: API_CREDENTIAL,
    opportunityId: "opp_api",
    lifecycleRevision: 2,
    allowedNextOperation: "request_review",
    issuanceKey: "issue:opp_api:expiring",
    ttlMs: 5_000,
    now: NOW,
  });
  await rejectsWithCode(
    () =>
      consumeHumanReviewContinuation({
        credential: API_CREDENTIAL,
        token: expiring.continuation!.token,
        operation: "request_review",
        consumptionKey: "consume:opp_api:expired",
        now: new Date(NOW.getTime() + 5_001),
      }),
    "review_continuation_expired",
  );
  const expired = await pool.query("SELECT status FROM tokenless_agent_review_continuations WHERE token_hash <> ''");
  assert.equal(expired.rows[0]?.status, "expired");

  const issued = await issueHumanReviewContinuation({
    credential: API_CREDENTIAL,
    opportunityId: "opp_api",
    lifecycleRevision: 2,
    allowedNextOperation: "request_review",
    issuanceKey: "issue:opp_api:revoked",
    now: new Date(NOW.getTime() + 6_000),
  });
  await rejectsWithCode(
    () =>
      consumeHumanReviewContinuation({
        credential: { integrationId: "agi_other", kind: "api_key", id: "key_other" },
        token: issued.continuation!.token,
        operation: "request_review",
        consumptionKey: "consume:opp_api:cross",
        now: new Date(NOW.getTime() + 7_000),
      }),
    "review_continuation_binding_mismatch",
  );
  assert.deepEqual(
    await revokeHumanReviewContinuation({
      credential: API_CREDENTIAL,
      token: issued.continuation!.token,
      now: new Date(NOW.getTime() + 8_000),
    }),
    { revoked: true, replayed: false },
  );
  await rejectsWithCode(
    () =>
      consumeHumanReviewContinuation({
        credential: API_CREDENTIAL,
        token: issued.continuation!.token,
        operation: "request_review",
        consumptionKey: "consume:opp_api:revoked",
        now: new Date(NOW.getTime() + 9_000),
      }),
    "review_continuation_inactive",
  );
});

test("OAuth bindings are exact and terminal states return no polling continuation", async () => {
  const oauth = await issueHumanReviewContinuation({
    credential: OAUTH_CREDENTIAL,
    opportunityId: "opp_oauth",
    lifecycleRevision: 4,
    allowedNextOperation: "wait_for_review",
    issuanceKey: "issue:opp_oauth:wait",
    now: NOW,
  });
  assert.ok(oauth.continuation);
  await rejectsWithCode(
    () =>
      consumeHumanReviewContinuation({
        credential: { integrationId: "agi_oauth", kind: "api_key", id: "atf_oauth" },
        token: oauth.continuation!.token,
        operation: "wait_for_review",
        consumptionKey: "consume:opp_oauth:wrong-kind",
        now: new Date(NOW.getTime() + 1_000),
      }),
    "review_continuation_binding_mismatch",
  );
  await pool.query(
    `UPDATE tokenless_agent_review_opportunity_lifecycles
     SET state = 'completed', state_revision = 5, terminal_at = $1
     WHERE workspace_id = 'ws_oauth' AND opportunity_id = 'opp_oauth'`,
    [new Date(NOW.getTime() + 2_000)],
  );
  const terminal = await issueHumanReviewContinuation({
    credential: OAUTH_CREDENTIAL,
    opportunityId: "opp_oauth",
    lifecycleRevision: 5,
    allowedNextOperation: "wait_for_review",
    issuanceKey: "issue:opp_oauth:terminal",
    now: new Date(NOW.getTime() + 3_000),
  });
  assert.equal(terminal.continuation, null);

  const consumed = await consumeHumanReviewContinuation({
    credential: OAUTH_CREDENTIAL,
    token: oauth.continuation!.token,
    operation: "wait_for_review",
    consumptionKey: "consume:opp_oauth:terminal",
    now: new Date(NOW.getTime() + 4_000),
  });
  assert.equal(consumed.currentLifecycle.terminal, true);
  const events = await pool.query(
    `SELECT event_type,event_commitment,actor_credential_commitment
     FROM tokenless_agent_review_continuation_events ORDER BY occurred_at,event_id`,
  );
  assert.ok(events.rows.some(row => row.event_type === "terminal_completed"));
  for (const row of events.rows) {
    assert.match(String(row.event_commitment), /^sha256:[0-9a-f]{64}$/u);
    assert.match(String(row.actor_credential_commitment), /^sha256:[0-9a-f]{64}$/u);
  }
});

test("a workspace stop revokes every active continuation in one workspace and appends revoked events", async () => {
  const api = await issueHumanReviewContinuation({
    credential: API_CREDENTIAL,
    opportunityId: "opp_api",
    lifecycleRevision: 2,
    allowedNextOperation: "request_review",
    issuanceKey: "issue:opp_api:stop",
    now: NOW,
  });
  const oauth = await issueHumanReviewContinuation({
    credential: OAUTH_CREDENTIAL,
    opportunityId: "opp_oauth",
    lifecycleRevision: 4,
    allowedNextOperation: "wait_for_review",
    issuanceKey: "issue:opp_oauth:stop",
    now: NOW,
  });
  assert.ok(api.continuation && oauth.continuation);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const revoked = await revokeWorkspaceHumanReviewContinuations(client, {
      workspaceId: "ws_api",
      reasonCode: "workspace_stop_engaged",
      now: new Date(NOW.getTime() + 1_000),
    });
    await client.query("COMMIT");
    assert.equal(revoked, 1);
  } finally {
    client.release();
  }

  const statuses = await pool.query(
    "SELECT workspace_id,status FROM tokenless_agent_review_continuations ORDER BY workspace_id",
  );
  assert.deepEqual(
    statuses.rows.map(row => `${row.workspace_id}:${row.status}`),
    ["ws_api:revoked", "ws_oauth:active"],
  );
  const events = await pool.query(
    `SELECT workspace_id,event_type,reason_code FROM tokenless_agent_review_continuation_events
     WHERE event_type = 'revoked'`,
  );
  assert.equal(events.rows.length, 1);
  assert.equal(events.rows[0]?.workspace_id, "ws_api");
  assert.equal(events.rows[0]?.reason_code, "workspace_stop_engaged");

  // Idempotent: a second stop finds nothing active to revoke.
  const again = await pool.connect();
  try {
    await again.query("BEGIN");
    assert.equal(
      await revokeWorkspaceHumanReviewContinuations(again, {
        workspaceId: "ws_api",
        reasonCode: "workspace_stop_engaged",
        now: new Date(NOW.getTime() + 2_000),
      }),
      0,
    );
    await again.query("COMMIT");
  } finally {
    again.release();
  }
});
