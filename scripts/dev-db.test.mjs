import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLocalDatabasePortConflictMessage,
  composeOutputHasPortConflict,
  ensureComposeDatabaseExists,
  resolveComposeBindHost,
  selectLocalDatabaseLogSource,
} from "./dev-db.mjs";

const localDatabaseConfig = {
  url: "postgresql://postgres:postgres@127.0.0.1:5432/rateloop_app",
  host: "127.0.0.1",
  port: 5432,
  databaseName: "rateloop_app",
  user: "postgres",
  password: "postgres",
  isLocal: true,
  isMemory: false,
};

test("forwards the DATABASE_URL host as the Docker bind host", () => {
  assert.equal(resolveComposeBindHost("127.0.0.1"), "127.0.0.1");
  assert.equal(resolveComposeBindHost("localhost"), "127.0.0.1");
  assert.equal(resolveComposeBindHost("::1"), "::1");
});

test("detects Docker Compose port allocation failures", () => {
  const output =
    "Error response from daemon: failed to set up container networking: " +
    "Bind for 0.0.0.0:5432 failed: port is already allocated";

  assert.equal(composeOutputHasPortConflict(output, 5432), true);
  assert.equal(composeOutputHasPortConflict(output, 55432), false);
});

test("builds actionable help for local database port conflicts", () => {
  const message = buildLocalDatabasePortConflictMessage(localDatabaseConfig, [
    {
      name: "rater-postgres-1",
      ports: "0.0.0.0:5432->5432/tcp",
    },
  ]);

  assert.match(message, /Local Postgres host port 5432 is already in use/);
  assert.match(message, /rater-postgres-1/);
  assert.match(message, /55432/);
  assert.match(message, /yarn dev:db/);
});

test("uses Homebrew fallback logs only while the fallback database is running", () => {
  assert.equal(
    selectLocalDatabaseLogSource({
      fallbackInitialized: true,
      fallbackLogExists: true,
      fallbackRunning: true,
    }),
    "fallback",
  );
  assert.equal(
    selectLocalDatabaseLogSource({
      fallbackInitialized: true,
      fallbackLogExists: true,
      fallbackRunning: false,
    }),
    "compose",
  );
  assert.equal(
    selectLocalDatabaseLogSource({
      fallbackInitialized: false,
      fallbackLogExists: true,
      fallbackRunning: true,
    }),
    "compose",
  );
});

test("creates and verifies a requested database after a retained Compose volume starts", () => {
  const calls = [];
  const statuses = [1, 0, 0];
  ensureComposeDatabaseExists(localDatabaseConfig, (args, options) => {
    calls.push({ args, options });
    return { status: statuses.shift(), stdout: "", stderr: "" };
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].args.slice(3), [
    "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "rateloop_app", "-c", "select 1",
  ]);
  assert.deepEqual(calls[1].args.slice(3), ["createdb", "-U", "postgres", "--", "rateloop_app"]);
  assert.deepEqual(calls[2].args, calls[0].args);
});

test("does not recreate a Compose database that accepts a real SQL connection", () => {
  const calls = [];
  ensureComposeDatabaseExists(localDatabaseConfig, (args, options) => {
    calls.push({ args, options });
    return { status: 0, stdout: "", stderr: "" };
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[3], "psql");
});
