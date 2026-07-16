import type { DatabaseClient, DatabaseResources, QueryInput } from "../index";
import * as schema from "../schema";
import { drizzle as drizzlePgProxy } from "drizzle-orm/pg-proxy";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type Pool } from "pg";
import { DataType, newDb } from "pg-mem";

const MIGRATION_BREAKPOINT = "--> statement-breakpoint";

function normalizeQuery(input: QueryInput) {
  const text = typeof input === "string" ? input : input.sql;
  const values = typeof input === "string" ? [] : (input.args ?? []);

  let placeholderIndex = 0;
  const parameterizedText = values.length > 0 ? text.replace(/\?/g, () => `$${++placeholderIndex}`) : text;

  return {
    text: parameterizedText,
    values,
  };
}

function getMigrationDirectory() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../drizzle");
}

function applySqlStatements(sqlText: string, execute: (statement: string) => void) {
  for (const statement of sqlText
    .split(MIGRATION_BREAKPOINT)
    .map(part => part.trim())
    .filter(Boolean)) {
    execute(statement);
  }
}

function memoryCompatibleMigrationStatement(file: string, statement: string): string | null {
  if (
    ["0060_human_review_opportunity_transition_events.sql", "0063_human_review_result_observations.sql"].includes(
      file,
    ) &&
    (/^CREATE OR REPLACE FUNCTION/u.test(statement) || /^CREATE TRIGGER/u.test(statement))
  ) {
    // pg-mem does not implement PostgreSQL trigger functions. The production
    // migration installs the append-only guard; migration source tests cover it.
    return null;
  }
  if (file !== "0058_human_review_binding_backfill.sql") return statement;

  // The in-memory test database applies migrations to a guaranteed-empty schema.
  // pg-mem cannot parse the PostgreSQL backfill's temporary CREATE TABLE AS WITH,
  // LATERAL joins, or correlated DISTINCT ON expressions. Apply the structural
  // constraints here and cover the production-only data migration separately.
  return /^ALTER TABLE/u.test(statement) ? statement : null;
}

function createDatabaseClient(pool: Pool): DatabaseClient {
  return {
    async execute(input) {
      const query = normalizeQuery(input);
      return pool.query(query);
    },
  };
}

export function createMemoryDatabaseResources(): DatabaseResources {
  const migrationDirectory = getMigrationDirectory();
  const memoryDb = newDb();
  memoryDb.public.registerFunction({
    name: "hashtext",
    args: [DataType.text],
    returns: DataType.integer,
    implementation: value => [...value].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) | 0, 0),
  });
  memoryDb.public.registerFunction({
    name: "convert_to",
    args: [DataType.text, DataType.text],
    returns: DataType.bytea,
    implementation: (value, encoding) => {
      if (encoding.toUpperCase() !== "UTF8") throw new Error("Only UTF8 test encoding is supported.");
      return Buffer.from(value, "utf8");
    },
  });
  memoryDb.public.registerFunction({
    name: "digest",
    args: [DataType.bytea, DataType.text],
    returns: DataType.bytea,
    implementation: (value, algorithm) => createHash(algorithm).update(value).digest(),
  });
  memoryDb.public.registerFunction({
    name: "encode",
    args: [DataType.bytea, DataType.text],
    returns: DataType.text,
    implementation: (value, encoding) => {
      if (encoding !== "hex") throw new Error("Only hex test encoding is supported.");
      return value.toString("hex");
    },
  });
  memoryDb.public.registerFunction({
    name: "pg_advisory_lock",
    args: [DataType.integer],
    returns: DataType.bool,
    implementation: () => true,
  });
  memoryDb.public.registerFunction({
    name: "pg_advisory_unlock",
    args: [DataType.integer],
    returns: DataType.bool,
    implementation: () => true,
  });
  memoryDb.public.registerFunction({
    name: "jsonb_typeof",
    args: [DataType.jsonb],
    returns: DataType.text,
    implementation: value => (Array.isArray(value) ? "array" : value === null ? "null" : typeof value),
  });
  memoryDb.public.registerFunction({
    name: "jsonb_array_length",
    args: [DataType.jsonb],
    returns: DataType.integer,
    implementation: value => (Array.isArray(value) ? value.length : 0),
  });
  memoryDb.public.registerFunction({
    name: "char_length",
    args: [DataType.text],
    returns: DataType.integer,
    implementation: value => value.length,
  });
  memoryDb.public.registerOperator({
    operator: "<@",
    left: DataType.jsonb,
    right: DataType.jsonb,
    returns: DataType.bool,
    implementation: (left, right) =>
      Array.isArray(left) && Array.isArray(right) && left.every(value => right.includes(value)),
  });
  memoryDb.public.registerOperator({
    operator: "@>",
    left: DataType.jsonb,
    right: DataType.jsonb,
    returns: DataType.bool,
    implementation: (left, right) =>
      Array.isArray(left) && Array.isArray(right) && right.every(value => left.includes(value)),
  });
  memoryDb.public.registerOperator({
    operator: "~",
    left: DataType.text,
    right: DataType.text,
    returns: DataType.bool,
    implementation: (value, pattern) => new RegExp(pattern).test(value),
  });

  if (fs.existsSync(migrationDirectory)) {
    const files = fs
      .readdirSync(migrationDirectory)
      .filter(file => file.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));

    for (const file of files) {
      const sqlText = fs.readFileSync(path.join(migrationDirectory, file), "utf8");
      applySqlStatements(sqlText, statement => {
        if (/^CREATE EXTENSION IF NOT EXISTS pgcrypto;?$/iu.test(statement)) return;
        const compatibleStatement = memoryCompatibleMigrationStatement(file, statement);
        if (compatibleStatement === null) return;
        memoryDb.public.none(compatibleStatement);
      });
    }
  }

  const adapter = memoryDb.adapters.createPg();
  const pool = new adapter.Pool() as unknown as Pool;
  const client = createDatabaseClient(pool);
  const database = drizzlePgProxy(
    async (query, params, method) => {
      const result = await pool.query({
        text: query,
        values: params,
      });

      return {
        rows: method === "all" ? result.rows.map(row => (Array.isArray(row) ? row : Object.values(row))) : result.rows,
      };
    },
    { schema },
  ) as unknown as DatabaseResources["database"] & {
    transaction: <T>(callback: (tx: DatabaseResources["database"]) => Promise<T>) => Promise<T>;
  };

  (
    database as unknown as {
      transaction: <T>(callback: (tx: DatabaseResources["database"]) => Promise<T>) => Promise<T>;
    }
  ).transaction = async callback => callback(database as unknown as DatabaseResources["database"]);

  return {
    client,
    database,
    pool,
  };
}
