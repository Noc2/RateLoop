import { TOKENLESS_VERCEL_PROJECT } from "./check-identity-deployment.mjs";
import {
  deriveHostedDatabaseIdentity,
  hostedMigrationEnabled,
  validateHostedDatabaseIdentity,
  validateHostedMigrationEnvironment,
  validateMigrationState,
} from "./migrate-hosted-database.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const databaseUrl = "postgresql://example.invalid/tokenless";
const hostedEnv = {
  VERCEL_ENV: "production",
  VERCEL_PROJECT_ID: TOKENLESS_VERCEL_PROJECT.projectId,
  VERCEL_PROJECT_NAME: TOKENLESS_VERCEL_PROJECT.projectName,
  DATABASE_URL: databaseUrl,
  TOKENLESS_DATABASE_IDENTITY: deriveHostedDatabaseIdentity(databaseUrl),
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

test("hosted migrations bind the checked-in environment to one credential-independent database endpoint", () => {
  assert.equal(
    deriveHostedDatabaseIdentity("postgresql://rotated:other-secret@example.invalid/tokenless?sslmode=require"),
    hostedEnv.TOKENLESS_DATABASE_IDENTITY,
  );
  assert.deepEqual(validateHostedDatabaseIdentity(hostedEnv), []);
  assert.match(
    validateHostedDatabaseIdentity({
      ...hostedEnv,
      DATABASE_URL: "postgresql://example.invalid/tokenless-clone",
    }).join("\n"),
    /does not match/i,
  );
  assert.match(
    validateHostedDatabaseIdentity({ ...hostedEnv, TOKENLESS_DATABASE_IDENTITY: "sha256:wrong" }).join("\n"),
    /immutable SHA-256 identity/i,
  );
  assert.deepEqual(
    validateHostedDatabaseIdentity({ ...hostedEnv, DATABASE_URL: "postgresql://example.invalid/bad%zz" }),
    ["DATABASE_URL must identify a Postgres database endpoint."],
  );
});

test("migration state rejects unjournaled and divergent databases", () => {
  const migrations = [{ folderMillis: 100, hash: "expected" }];
  assert.match(
    validateMigrationState({
      hasMigrationTable: false,
      hasCoreSchema: true,
      databaseMigrations: [],
      migrations,
    }).join("\n"),
    /no drizzle migration journal/i,
  );
  assert.match(
    validateMigrationState({
      hasMigrationTable: true,
      hasCoreSchema: true,
      databaseMigrations: [{ createdAt: 99, hash: "other" }],
      migrations,
    }).join("\n"),
    /does not match checked-in journal position/i,
  );
  assert.match(
    validateMigrationState({
      hasMigrationTable: true,
      hasCoreSchema: true,
      databaseMigrations: [{ createdAt: 100, hash: "other" }],
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
      databaseMigrations: [],
      migrations,
    }),
    [],
  );
  assert.deepEqual(
    validateMigrationState({
      hasMigrationTable: true,
      hasCoreSchema: true,
      databaseMigrations: [{ createdAt: 100, hash: "first" }],
      migrations,
    }),
    [],
  );
});

test("migration state verifies every applied row as an exact checked-in prefix", () => {
  const migrations = [
    { folderMillis: 100, hash: "first" },
    { folderMillis: 200, hash: "second" },
    { folderMillis: 300, hash: "third" },
  ];
  assert.deepEqual(
    validateMigrationState({
      hasMigrationTable: true,
      hasCoreSchema: true,
      databaseMigrations: [
        { createdAt: 100, hash: "first" },
        { createdAt: 200, hash: "second" },
      ],
      migrations,
    }),
    [],
  );
  assert.match(
    validateMigrationState({
      hasMigrationTable: true,
      hasCoreSchema: true,
      databaseMigrations: [
        { createdAt: 100, hash: "first" },
        { createdAt: 150, hash: "unknown-middle" },
        { createdAt: 200, hash: "second" },
      ],
      migrations,
    }).join("\n"),
    /position 1/i,
  );
  assert.match(
    validateMigrationState({
      hasMigrationTable: true,
      hasCoreSchema: true,
      databaseMigrations: [
        { createdAt: 100, hash: "first" },
        { createdAt: 200, hash: "changed" },
      ],
      migrations,
    }).join("\n"),
    /hash does not match/i,
  );
  assert.match(
    validateMigrationState({
      hasMigrationTable: true,
      hasCoreSchema: true,
      databaseMigrations: [
        { createdAt: 100, hash: "first" },
        { createdAt: 200, hash: "second" },
        { createdAt: 300, hash: "third" },
        { createdAt: 400, hash: "fourth" },
      ],
      migrations,
    }).join("\n"),
    /longer than/i,
  );
});
