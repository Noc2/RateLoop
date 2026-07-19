import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DataType, newDb } from "pg-mem";

const migration = readFileSync(new URL("../../drizzle/0120_private_quote_ownership.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

function apply0120(seed?: (database: ReturnType<typeof newDb>) => void) {
  const database = newDb();
  database.public.registerFunction({
    name: "jsonb_build_object",
    args: [DataType.text, DataType.text, DataType.text, DataType.text],
    returns: DataType.jsonb,
    implementation: (firstKey, firstValue, secondKey, secondValue) => ({
      [firstKey]: firstValue,
      [secondKey]: secondValue,
    }),
  });
  database.public.registerFunction({
    name: "jsonb_build_object",
    args: [DataType.text, DataType.text, DataType.text, DataType.text, DataType.text, DataType.text],
    returns: DataType.jsonb,
    implementation: (firstKey, firstValue, secondKey, secondValue, thirdKey, thirdValue) => ({
      [firstKey]: firstValue,
      [secondKey]: secondValue,
      [thirdKey]: thirdValue,
    }),
  });
  database.public.none(`
    CREATE TABLE tokenless_agent_quotes (
      quote_id text PRIMARY KEY,
      request_hash text NOT NULL,
      request_json text NOT NULL,
      response_json text NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE tokenless_agent_asks (
      operation_key text PRIMARY KEY,
      quote_id text NOT NULL REFERENCES tokenless_agent_quotes(quote_id),
      status text NOT NULL DEFAULT 'completed',
      result_json text
    );
    CREATE TABLE tokenless_content_records (
      content_id text PRIMARY KEY, content_hash text NOT NULL, content_json text NOT NULL,
      updated_at timestamptz NOT NULL
    );
    CREATE TABLE tokenless_question_records (
      question_id text PRIMARY KEY, content_id text NOT NULL REFERENCES tokenless_content_records(content_id)
    );
    CREATE TABLE tokenless_ask_ownership (
      operation_key text PRIMARY KEY REFERENCES tokenless_agent_asks(operation_key),
      question_id text NOT NULL REFERENCES tokenless_question_records(question_id)
    );
  `);
  seed?.(database);
  for (const statement of migration
    .split("--> statement-breakpoint")
    .map(value => value.trim())
    .filter(Boolean)) {
    if (
      /\bCREATE OR REPLACE FUNCTION\b/u.test(statement) ||
      /\bCREATE TRIGGER\b/u.test(statement) ||
      /^DO \$\$/u.test(statement)
    )
      continue;
    database.public.none(statement.replaceAll(" USING btree", ""));
  }
  return database;
}

test("0120 adds ownership, invalidates legacy capabilities, and fences old private writers", () => {
  assert.match(migration, /ADD COLUMN "owner_principal_id" text/u);
  assert.match(migration, /ADD COLUMN "owner_workspace_id" text/u);
  assert.match(migration, /ADD COLUMN "owner_api_key_id" text/u);
  assert.match(migration, /DELETE FROM "tokenless_agent_quotes"/u);
  assert.match(migration, /tokenless_0120_active_legacy_private_ask_guard/u);
  assert.match(migration, /CHECK \("marker" = 0\)/u);
  assert.match(migration, /rateloop\.erased-private-content\.v1/u);
  assert.match(migration, /rateloop\.erased-private-quote\.v1/u);
  assert.match(migration, /legacy-invalidated:/u);
  assert.match(migration, /tokenless_agent_quotes_visibility_owner_check/u);
  assert.match(migration, /tokenless_agent_quotes_private_payload_immutable/u);
  assert.match(migration, /private quote payloads are immutable/u);
  assert.match(migration, /private quote owner is not active/u);
  assert.match(migration, /FOR KEY SHARE OF "workspace", "api_key"/u);
  assert.match(migration, /BEFORE INSERT OR UPDATE/u);
  assert.equal(journal.entries.find(entry => entry.idx === 120)?.tag, "0120_private_quote_ownership");
});

test("0120 deletes unused legacy private quotes and tombstones referenced legacy capabilities", () => {
  const database = apply0120(db => {
    db.public.none(`
      INSERT INTO tokenless_agent_quotes
        (quote_id, request_hash, request_json, response_json, expires_at, created_at)
      VALUES
        ('legacy_public', 'hash-public', '{"visibility":"public"}', '{}', NOW(), NOW()),
        ('legacy_unused_private', 'hash-unused', '{"visibility":"private"}', '{}', NOW(), NOW()),
        ('legacy_used_private', 'hash-used', '{"visibility":"private"}', '{}', NOW(), NOW());
      INSERT INTO tokenless_agent_asks (operation_key, quote_id)
      VALUES ('legacy_operation', 'legacy_used_private');
    `);
  });
  assert.deepEqual(
    database.public.many(
      "SELECT quote_id, owner_principal_id, request_json FROM tokenless_agent_quotes ORDER BY quote_id",
    ),
    [
      { owner_principal_id: null, quote_id: "legacy_public", request_json: '{"visibility":"public"}' },
      {
        owner_principal_id: "legacy-invalidated:legacy_used_private",
        quote_id: "legacy_used_private",
        request_json:
          '{"requestCommitment":"hash-used","schemaVersion":"rateloop.erased-private-quote.v1","visibility":"private"}',
      },
    ],
  );
});

test("0120 refuses to scrub a nonterminal legacy private ask", () => {
  assert.throws(
    () =>
      apply0120(db => {
        db.public.none(`
          INSERT INTO tokenless_agent_quotes
            (quote_id, request_hash, request_json, response_json, expires_at, created_at)
          VALUES ('legacy_active_private', 'hash-active', '{"visibility":"private"}', '{}', NOW(), NOW());
          INSERT INTO tokenless_agent_asks (operation_key, quote_id, status)
          VALUES ('legacy_active_operation', 'legacy_active_private', 'open');
        `);
      }),
    /check constraint/iu,
  );
});

test("0120 scrubs a submitted legacy private ask after its terminal result exists", () => {
  const database = apply0120(db => {
    db.public.none(`
      INSERT INTO tokenless_agent_quotes
        (quote_id, request_hash, request_json, response_json, expires_at, created_at)
      VALUES ('legacy_terminal_private', 'hash-terminal',
              '{"visibility":"private","secret":"quote customer plaintext"}', '{}', NOW(), NOW());
      INSERT INTO tokenless_agent_asks (operation_key, quote_id, status, result_json)
      VALUES ('legacy_terminal_operation', 'legacy_terminal_private', 'submitted', '{"terminal":true}');
      INSERT INTO tokenless_content_records (content_id, content_hash, content_json, updated_at)
      VALUES ('legacy_secret_content', 'hash-secret-content', '{"secret":"customer plaintext"}', NOW());
      INSERT INTO tokenless_question_records (question_id, content_id)
      VALUES ('legacy_secret_question', 'legacy_secret_content');
      INSERT INTO tokenless_ask_ownership (operation_key, question_id)
      VALUES ('legacy_terminal_operation', 'legacy_secret_question');
    `);
  });
  const quote = database.public.one("SELECT owner_principal_id,request_json FROM tokenless_agent_quotes");
  assert.deepEqual(quote, {
    owner_principal_id: "legacy-invalidated:legacy_terminal_private",
    request_json:
      '{"requestCommitment":"hash-terminal","schemaVersion":"rateloop.erased-private-quote.v1","visibility":"private"}',
  });
  const content = database.public.one("SELECT content_json FROM tokenless_content_records");
  assert.equal(
    content.content_json,
    '{"contentCommitment":"hash-secret-content","schemaVersion":"rateloop.erased-private-content.v1"}',
  );
  assert.doesNotMatch(`${quote.request_json}${content.content_json}`, /customer plaintext/u);
});

test("0120 binds visibility to exactly one supported owner shape", () => {
  const database = apply0120();
  database.public.none(`
    INSERT INTO tokenless_agent_quotes
      (quote_id, request_hash, request_json, response_json, expires_at, created_at)
      VALUES ('public_quote', 'hash', '{"visibility":"public"}', '{}', NOW(), NOW());
    INSERT INTO tokenless_agent_quotes
      (quote_id, request_hash, request_json, response_json, owner_principal_id, expires_at, created_at)
      VALUES ('session_quote', 'hash', '{"visibility":"private"}', '{}', 'rlp_principal', NOW(), NOW());
    INSERT INTO tokenless_agent_quotes
      (quote_id, request_hash, request_json, response_json, owner_workspace_id, owner_api_key_id, expires_at, created_at)
      VALUES ('api_quote', 'hash', '{"visibility":"private"}', '{}', 'ws_owner', 'key_owner', NOW(), NOW());
  `);
  assert.equal(database.public.many("SELECT quote_id FROM tokenless_agent_quotes").length, 3);
  for (const statement of [
    `INSERT INTO tokenless_agent_quotes
       (quote_id, request_hash, request_json, response_json, expires_at, created_at)
     VALUES ('unbound_private', 'hash', '{"visibility":"private"}', '{}', NOW(), NOW())`,
    `INSERT INTO tokenless_agent_quotes
       (quote_id, request_hash, request_json, response_json, owner_principal_id, expires_at, created_at)
     VALUES ('bound_public', 'hash', '{"visibility":"public"}', '{}', 'rlp_principal', NOW(), NOW())`,
    `INSERT INTO tokenless_agent_quotes
       (quote_id, request_hash, request_json, response_json, owner_workspace_id, expires_at, created_at)
     VALUES ('partial_api_quote', 'hash', '{"visibility":"private"}', '{}', 'ws_owner', NOW(), NOW())`,
  ]) {
    assert.throws(() => database.public.none(statement), /check constraint/iu);
  }
});
