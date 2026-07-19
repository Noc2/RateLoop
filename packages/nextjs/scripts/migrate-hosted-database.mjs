import { TOKENLESS_VERCEL_PROJECT } from "./check-identity-deployment.mjs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_LOCK = "rateloop-tokenless-drizzle-migrations-v1";

export function hostedMigrationEnabled(env) {
  return env.VERCEL_ENV === "production";
}

export function deriveHostedDatabaseIdentity(databaseUrl) {
  let parsed;
  let databaseName;
  try {
    parsed = new URL(databaseUrl);
    databaseName = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    return null;
  }
  if (
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    !parsed.hostname ||
    !databaseName
  ) {
    return null;
  }
  const canonicalEndpoint = [
    parsed.hostname.toLowerCase(),
    parsed.port || "5432",
    databaseName,
  ].join("\0");
  return `sha256:${createHash("sha256").update(canonicalEndpoint).digest("hex")}`;
}

export function validateHostedDatabaseIdentity(env) {
  const configured = env.TOKENLESS_DATABASE_IDENTITY?.trim() || "";
  const derived = deriveHostedDatabaseIdentity(env.DATABASE_URL?.trim() || "");
  if (!derived) return ["DATABASE_URL must identify a Postgres database endpoint."];
  if (!/^sha256:[0-9a-f]{64}$/u.test(configured)) {
    return ["TOKENLESS_DATABASE_IDENTITY must be the immutable SHA-256 identity of the database endpoint."];
  }
  if (configured !== derived) {
    return ["TOKENLESS_DATABASE_IDENTITY does not match the configured database endpoint."];
  }
  return [];
}

export function validateHostedMigrationEnvironment(env) {
  if (!hostedMigrationEnabled(env)) return [];

  const errors = [];
  if (env.VERCEL_PROJECT_ID !== TOKENLESS_VERCEL_PROJECT.projectId) {
    errors.push(
      `Unexpected Vercel project ID ${env.VERCEL_PROJECT_ID ?? "missing"}; expected ${TOKENLESS_VERCEL_PROJECT.projectId}.`,
    );
  }
  if (env.VERCEL_PROJECT_NAME !== TOKENLESS_VERCEL_PROJECT.projectName) {
    errors.push(
      `Unexpected Vercel project name ${env.VERCEL_PROJECT_NAME ?? "missing"}; expected ${TOKENLESS_VERCEL_PROJECT.projectName}.`,
    );
  }
  if (!env.DATABASE_URL?.trim()) errors.push("DATABASE_URL is required for hosted tokenless migrations.");
  else errors.push(...validateHostedDatabaseIdentity(env));
  return errors;
}

export function validateMigrationState({ hasMigrationTable, hasCoreSchema, latestDatabaseMigration, migrations }) {
  if (!hasMigrationTable && hasCoreSchema) {
    return ["The tokenless database has application tables but no Drizzle migration journal; refusing to replay DDL."];
  }
  if (!latestDatabaseMigration) return [];

  const matchingMigration = migrations.find(
    migration => migration.folderMillis === Number(latestDatabaseMigration.createdAt),
  );
  if (!matchingMigration) {
    return [
      `Database migration timestamp ${latestDatabaseMigration.createdAt} is not present in the checked-in journal.`,
    ];
  }
  if (matchingMigration.hash !== latestDatabaseMigration.hash) {
    return [`Database migration hash does not match the checked-in journal at ${latestDatabaseMigration.createdAt}.`];
  }
  return [];
}

async function readDatabaseState(pool) {
  const relationResult = await pool.query(`
    select
      to_regclass('drizzle.__drizzle_migrations') is not null as has_migration_table,
      to_regclass('public.tokenless_agent_quotes') is not null as has_core_schema
  `);
  const relationState = relationResult.rows[0];
  if (!relationState.has_migration_table) {
    return {
      hasMigrationTable: false,
      hasCoreSchema: relationState.has_core_schema,
      latestDatabaseMigration: null,
    };
  }

  const latestResult = await pool.query(
    "select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1",
  );
  const latest = latestResult.rows[0];
  return {
    hasMigrationTable: true,
    hasCoreSchema: relationState.has_core_schema,
    latestDatabaseMigration: latest ? { hash: latest.hash, createdAt: Number(latest.created_at) } : null,
  };
}

async function main() {
  if (!hostedMigrationEnabled(process.env)) {
    console.log("Hosted database migration skipped outside Vercel production.");
    return;
  }

  const environmentErrors = validateHostedMigrationEnvironment(process.env);
  if (environmentErrors.length > 0) {
    throw new Error(`Hosted database migration refused:\n- ${environmentErrors.join("\n- ")}`);
  }

  const [{ Pool }, { drizzle }, { migrate }, { readMigrationFiles }] = await Promise.all([
    import("pg"),
    import("drizzle-orm/node-postgres"),
    import("drizzle-orm/node-postgres/migrator"),
    import("drizzle-orm/migrator"),
  ]);
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const migrationsFolder = path.join(packageRoot, "drizzle");
  const migrations = readMigrationFiles({ migrationsFolder });
  const expectedLatest = migrations.at(-1);
  if (!expectedLatest) throw new Error("The checked-in migration journal is empty.");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await pool.query("select pg_advisory_lock(hashtext($1)::bigint)", [MIGRATION_LOCK]);
    const identityErrors = validateHostedDatabaseIdentity(process.env);
    if (identityErrors.length > 0) {
      throw new Error(`Hosted database migration refused:\n- ${identityErrors.join("\n- ")}`);
    }
    const before = await readDatabaseState(pool);
    const stateErrors = validateMigrationState({ ...before, migrations });
    if (stateErrors.length > 0) {
      throw new Error(`Hosted database migration refused:\n- ${stateErrors.join("\n- ")}`);
    }

    await migrate(drizzle(pool), { migrationsFolder });

    const after = await readDatabaseState(pool);
    if (
      after.latestDatabaseMigration?.createdAt !== expectedLatest.folderMillis ||
      after.latestDatabaseMigration?.hash !== expectedLatest.hash
    ) {
      throw new Error("Hosted database migration did not reach the checked-in journal head.");
    }
    console.log(`Hosted database migrations verified through ${expectedLatest.folderMillis}.`);
  } finally {
    await pool.query("select pg_advisory_unlock(hashtext($1)::bigint)", [MIGRATION_LOCK]).catch(() => undefined);
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
