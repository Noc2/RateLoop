export const DEFAULT_PONDER_DATABASE_SCHEMA = "rateloop_ponder";
export const LEGACY_PONDER_DATABASE_SCHEMA = "ponder";

const SCHEMA_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function readEnv(env, key) {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export function resolvePonderDatabaseSchema(env = process.env) {
  const rateloopSchema = readEnv(env, "RATELOOP_PONDER_DATABASE_SCHEMA");
  const databaseSchema = readEnv(env, "DATABASE_SCHEMA");
  const isLegacyDatabaseSchema =
    rateloopSchema === undefined && databaseSchema === LEGACY_PONDER_DATABASE_SCHEMA;
  const schema =
    rateloopSchema ??
    (isLegacyDatabaseSchema ? DEFAULT_PONDER_DATABASE_SCHEMA : databaseSchema) ??
    DEFAULT_PONDER_DATABASE_SCHEMA;

  if (!SCHEMA_NAME_PATTERN.test(schema)) {
    throw new Error(
      `Invalid Ponder database schema "${schema}". Use letters, numbers, and underscores, starting with a letter or underscore.`,
    );
  }

  return {
    schema,
    source:
      rateloopSchema !== undefined
        ? "RATELOOP_PONDER_DATABASE_SCHEMA"
        : databaseSchema !== undefined && !isLegacyDatabaseSchema
          ? "DATABASE_SCHEMA"
          : "default",
    ignoredLegacyDatabaseSchema: isLegacyDatabaseSchema,
  };
}

export function hasSchemaFlag(args) {
  return args.some((arg) => arg === "--schema" || arg.startsWith("--schema="));
}

export function buildPonderStartArgs(args, env = process.env) {
  if (hasSchemaFlag(args)) {
    return {
      args: ["start", ...args],
      env,
      schemaInfo: null,
    };
  }

  const schemaInfo = resolvePonderDatabaseSchema(env);

  return {
    args: ["start", "--schema", schemaInfo.schema, ...args],
    env: {
      ...env,
      DATABASE_SCHEMA: schemaInfo.schema,
    },
    schemaInfo,
  };
}
