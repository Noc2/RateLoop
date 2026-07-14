import { TOKENLESS_VERCEL_PROJECT } from "./check-thirdweb-deployment.mjs";
import {
  hostedMigrationEnabled,
  validateHostedMigrationEnvironment,
  validateMigrationState,
} from "./migrate-hosted-database.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const hostedEnv = {
  VERCEL_ENV: "production",
  VERCEL_PROJECT_ID: TOKENLESS_VERCEL_PROJECT.projectId,
  VERCEL_PROJECT_NAME: TOKENLESS_VERCEL_PROJECT.projectName,
  DATABASE_URL: "postgresql://example.invalid/tokenless",
};

test("hosted migrations run only for the isolated production deployment", () => {
  assert.equal(hostedMigrationEnabled(hostedEnv), true);
  assert.equal(hostedMigrationEnabled({ ...hostedEnv, VERCEL_ENV: "preview" }), false);
  assert.deepEqual(validateHostedMigrationEnvironment(hostedEnv), []);
});

test("hosted migrations reject a legacy project or missing database", () => {
  const errors = validateHostedMigrationEnvironment({
    VERCEL_ENV: "production",
    VERCEL_PROJECT_ID: "prj_legacy",
    VERCEL_PROJECT_NAME: "rate-loop-nextjs",
  });
  assert.match(errors.join("\n"), /unexpected vercel project id/i);
  assert.match(errors.join("\n"), /unexpected vercel project name/i);
  assert.match(errors.join("\n"), /database_url is required/i);
});

test("migration state rejects unjournaled and divergent databases", () => {
  const migrations = [{ folderMillis: 100, hash: "expected" }];
  assert.match(
    validateMigrationState({
      hasMigrationTable: false,
      hasCoreSchema: true,
      latestDatabaseMigration: null,
      migrations,
    }).join("\n"),
    /no drizzle migration journal/i,
  );
  assert.match(
    validateMigrationState({
      hasMigrationTable: true,
      hasCoreSchema: true,
      latestDatabaseMigration: { createdAt: 99, hash: "other" },
      migrations,
    }).join("\n"),
    /not present in the checked-in journal/i,
  );
  assert.match(
    validateMigrationState({
      hasMigrationTable: true,
      hasCoreSchema: true,
      latestDatabaseMigration: { createdAt: 100, hash: "other" },
      migrations,
    }).join("\n"),
    /hash does not match/i,
  );
});

test("migration state accepts an empty database or a matching journal boundary", () => {
  const migrations = [
    { folderMillis: 100, hash: "first" },
    { folderMillis: 200, hash: "second" },
  ];
  assert.deepEqual(
    validateMigrationState({
      hasMigrationTable: false,
      hasCoreSchema: false,
      latestDatabaseMigration: null,
      migrations,
    }),
    [],
  );
  assert.deepEqual(
    validateMigrationState({
      hasMigrationTable: true,
      hasCoreSchema: true,
      latestDatabaseMigration: { createdAt: 100, hash: "first" },
      migrations,
    }),
    [],
  );
});
