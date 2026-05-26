import { spawn } from "node:child_process";
import { buildPonderStartArgs } from "./databaseSchema.mjs";

const { args, env, schemaInfo } = buildPonderStartArgs(process.argv.slice(2), process.env);

if (schemaInfo?.ignoredLegacyDatabaseSchema) {
  console.warn(
    `[ponder:start] Ignoring DATABASE_SCHEMA=ponder to avoid colliding with legacy Ponder app metadata; using ${schemaInfo.schema}.`,
  );
  console.warn("[ponder:start] Set RATELOOP_PONDER_DATABASE_SCHEMA to choose a different Ponder schema.");
} else if (schemaInfo?.source === "RAILWAY_DEPLOYMENT_ID") {
  console.warn(
    `[ponder:start] Using Railway deployment-scoped Ponder schema ${schemaInfo.schema}.`,
  );
} else if (schemaInfo?.source === "default") {
  console.warn(
    `[ponder:start] DATABASE_SCHEMA is not set; using RateLoop's production default schema ${schemaInfo.schema}.`,
  );
}

const child = spawn("ponder", args, {
  env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`[ponder:start] Failed to start Ponder: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exitCode = code ?? 1;
});
