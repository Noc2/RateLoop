#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);
const DEFAULT_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/rateloop_app";
const IN_MEMORY_DATABASE_URL = "memory:";
const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), "..");
const composeFile = path.join(repoRoot, "docker-compose.dev.yml");
const nextEnvLocalFile = path.join(repoRoot, "packages", "nextjs", ".env.local");
const postgresServiceName = "next-postgres";
const localStateDir = path.join(repoRoot, ".local");
const homebrewPostgresBinDir = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackPostgresDataDir = path.join(localStateDir, "postgres-16");
const fallbackPostgresLogPath = path.join(localStateDir, "postgres-16.log");
const fallbackPostgresMarkerPath = path.join(fallbackPostgresDataDir, ".rateloop-dev-db");

export class MissingDockerComposeError extends Error {
  constructor() {
    super("Docker Compose is required. Install Docker Desktop to use local Postgres.");
    this.name = "MissingDockerComposeError";
  }
}

function stripMatchingQuotes(value) {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};

  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim().replace(/^export\s+/, "");
    const value = stripMatchingQuotes(line.slice(separatorIndex + 1).trim());
    if (key) values[key] = value;
  }

  return values;
}

function redactDatabaseUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "<invalid DATABASE_URL>";
  }
}

export function resolveNextDatabaseConfig() {
  const envFileValues = parseEnvFile(nextEnvLocalFile);
  const envDatabaseUrl = process.env.DATABASE_URL?.trim();
  const fileDatabaseUrl = envFileValues.DATABASE_URL?.trim();
  const rawUrl = envDatabaseUrl || fileDatabaseUrl;
  const url = rawUrl || DEFAULT_DATABASE_URL;

  if (url === IN_MEMORY_DATABASE_URL) {
    return {
      url,
      host: "memory",
      port: 0,
      databaseName: "memory",
      user: "memory",
      password: "",
      isLocal: false,
      isMemory: true,
    };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`DATABASE_URL must be a valid PostgreSQL URL. Received: ${redactDatabaseUrl(url)}`);
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`DATABASE_URL must use the postgres:// or postgresql:// scheme. Received: ${redactDatabaseUrl(url)}`);
  }

  const databaseName = parsed.pathname.replace(/^\//, "");
  if (!databaseName) {
    throw new Error(`DATABASE_URL must include a database name. Received: ${redactDatabaseUrl(url)}`);
  }

  return {
    url,
    host: parsed.hostname,
    port: Number.parseInt(parsed.port || "5432", 10),
    databaseName: decodeURIComponent(databaseName),
    user: decodeURIComponent(parsed.username || "postgres"),
    password: decodeURIComponent(parsed.password || ""),
    isLocal: LOCAL_HOSTNAMES.has(parsed.hostname),
    isMemory: false,
  };
}

export function formatDatabaseTarget(config) {
  if (config.isMemory) {
    return "in-memory database";
  }

  return `${config.user}@${config.host}:${config.port}/${config.databaseName}`;
}

function getComposeCommand() {
  const dockerCompose = spawnSync("docker", ["compose", "version"], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  if (dockerCompose.status === 0) {
    return { command: "docker", args: ["compose"] };
  }

  throw new MissingDockerComposeError();
}

export function resolveComposeBindHost(host) {
  // Docker publishes on an IP, so map the localhost alias to 127.0.0.1 and
  // forward other local hosts (e.g. ::1) verbatim so pg_isready inside the
  // container only passes when the published host actually accepts clients.
  return host === "localhost" ? "127.0.0.1" : host;
}

function getComposeEnv(config = resolveNextDatabaseConfig()) {
  return {
    ...process.env,
    RATELOOP_LOCAL_DB_HOST: resolveComposeBindHost(config.host),
    RATELOOP_LOCAL_DB_NAME: config.databaseName,
    RATELOOP_LOCAL_DB_USER: config.user,
    RATELOOP_LOCAL_DB_PASSWORD: config.password,
    RATELOOP_LOCAL_DB_PORT: String(config.port),
  };
}

function runCompose(composeArgs, options = {}) {
  const compose = getComposeCommand();
  return spawnSync(compose.command, [...compose.args, "-f", composeFile, ...composeArgs], {
    cwd: repoRoot,
    stdio: options.stdio ?? "inherit",
    encoding: options.encoding,
    env: options.env ?? process.env,
  });
}

function formatSpawnOutput(output) {
  return Buffer.isBuffer(output) ? output.toString("utf8") : String(output ?? "");
}

function getSpawnOutput(result) {
  return `${formatSpawnOutput(result.stdout)}${formatSpawnOutput(result.stderr)}`;
}

function replaySpawnOutput(result) {
  const stdout = formatSpawnOutput(result.stdout);
  const stderr = formatSpawnOutput(result.stderr);
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

export function composeOutputHasPortConflict(output, port) {
  const escapedPort = String(port).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escapedPort}\\b[\\s\\S]*port is already allocated`, "i").test(output);
}

function listDockerContainersPublishingPort(port) {
  const result = spawnSync(
    "docker",
    ["ps", "--filter", `publish=${port}`, "--format", "{{.Names}}\t{{.Ports}}"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [name, ports = ""] = line.split("\t");
      return { name, ports };
    });
}

export function buildLocalDatabasePortConflictMessage(config, containers = []) {
  const nextPort = config.port === 5432 ? 55432 : config.port + 1;
  const containerSummary = containers.length
    ? ` Containers publishing host port ${config.port}: ${containers
        .map(container => `${container.name} (${container.ports})`)
        .join(", ")}.`
    : "";

  return (
    `Local Postgres host port ${config.port} is already in use, so Docker cannot start the RateLoop Postgres container for ${formatDatabaseTarget(config)}.` +
    containerSummary +
    ` Stop the conflicting process/container, or set DATABASE_URL to this local database with a free host port such as ${nextPort} and rerun \`yarn dev:db\`.`
  );
}

function getHomebrewPostgresCommand(name) {
  const commandPath = path.join(homebrewPostgresBinDir, name);
  return existsSync(commandPath) ? commandPath : null;
}

function runHomebrewPostgresCommand(name, args, options = {}) {
  const command = getHomebrewPostgresCommand(name);
  if (!command) {
    return {
      status: 127,
      error: new Error(`Homebrew postgresql@16 command not found: ${name}`),
    };
  }

  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: options.encoding ?? "utf8",
    stdio: options.stdio ?? "pipe",
    env: {
      ...process.env,
      PGCONNECT_TIMEOUT: "2",
      ...options.env,
    },
  });
}

function isFallbackPostgresAvailable() {
  return ["initdb", "pg_ctl", "createdb", "psql"].every(name => Boolean(getHomebrewPostgresCommand(name)));
}

function fallbackPostgresEnv(config) {
  return {
    PGHOST: config.host,
    PGPORT: String(config.port),
    PGUSER: config.user,
    PGPASSWORD: config.password,
  };
}

function postgresConnectionIsReady(config, databaseName = config.databaseName) {
  const result = runHomebrewPostgresCommand(
    "psql",
    ["-h", config.host, "-p", String(config.port), "-U", config.user, "-d", databaseName, "-c", "select 1"],
    {
      stdio: "ignore",
      env: fallbackPostgresEnv(config),
    },
  );

  return result.status === 0;
}

function ensureDatabaseOnExistingPostgres(config) {
  if (postgresConnectionIsReady(config)) {
    return true;
  }

  const maintenanceDatabaseName = ["postgres", "template1"].find(databaseName =>
    postgresConnectionIsReady(config, databaseName),
  );
  if (!maintenanceDatabaseName) {
    return false;
  }

  console.log(`[dev-db] Creating local database ${config.databaseName} on existing Postgres...`);
  const result = runHomebrewPostgresCommand(
    "createdb",
    ["-h", config.host, "-p", String(config.port), "-U", config.user, config.databaseName],
    {
      env: fallbackPostgresEnv(config),
    },
  );

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0 && !/already exists/i.test(output)) {
    throw new Error(`Failed to create local database ${config.databaseName}. ${output.trim()}`);
  }

  return postgresConnectionIsReady(config);
}

function initFallbackPostgres(config) {
  mkdirSync(localStateDir, { recursive: true });

  if (existsSync(fallbackPostgresDataDir)) {
    return;
  }

  console.log(`[dev-db] Initializing fallback Homebrew Postgres at ${path.relative(repoRoot, fallbackPostgresDataDir)}...`);
  const result = runHomebrewPostgresCommand("initdb", [
    "-D",
    fallbackPostgresDataDir,
    "--auth=trust",
    "--username",
    config.user,
  ]);

  if (result.status !== 0) {
    throw new Error(
      `Failed to initialize fallback Homebrew Postgres. ${String(result.stderr || result.error?.message || "").trim()}`,
    );
  }

  writeFileSync(fallbackPostgresMarkerPath, "RateLoop dev database\n");
}

async function waitForFallbackPostgresReady(config) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    if (postgresConnectionIsReady(config)) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 1_000));
  }

  throw new Error(`Fallback Homebrew Postgres did not become ready at ${formatDatabaseTarget(config)} within 30 seconds.`);
}

function startFallbackPostgres(config) {
  initFallbackPostgres(config);

  const statusResult = runHomebrewPostgresCommand("pg_ctl", ["-D", fallbackPostgresDataDir, "status"], {
    stdio: "ignore",
  });

  if (statusResult.status === 0) {
    return;
  }

  console.log(`[dev-db] Starting fallback Homebrew Postgres for ${formatDatabaseTarget(config)}...`);
  const result = runHomebrewPostgresCommand(
    "pg_ctl",
    [
      "-D",
      fallbackPostgresDataDir,
      "-l",
      fallbackPostgresLogPath,
      "-o",
      `-F -h ${config.host} -p ${config.port}`,
      "start",
    ],
    { stdio: "pipe" },
  );

  if (result.status !== 0) {
    throw new Error(
      `Failed to start fallback Homebrew Postgres. ${String(result.stderr || result.stdout || result.error?.message || "").trim()}`,
    );
  }
}

function ensureFallbackDatabaseExists(config) {
  if (postgresConnectionIsReady(config)) {
    return;
  }

  const result = runHomebrewPostgresCommand(
    "createdb",
    ["-h", config.host, "-p", String(config.port), "-U", config.user, config.databaseName],
    {
      env: fallbackPostgresEnv(config),
    },
  );

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0 && !/already exists/i.test(output)) {
    throw new Error(`Failed to create fallback database ${config.databaseName}. ${output.trim()}`);
  }
}

async function ensureFallbackLocalDatabase(config) {
  if (!isFallbackPostgresAvailable()) {
    throw new Error(
      "Docker is not running and Homebrew postgresql@16 is not available. Start Docker Desktop or install postgresql@16.",
    );
  }

  startFallbackPostgres(config);
  ensureFallbackDatabaseExists(config);
  await waitForFallbackPostgresReady(config);
  console.log(`[dev-db] Fallback Homebrew Postgres is ready at ${formatDatabaseTarget(config)}.`);
}

function fallbackPostgresWasInitialized() {
  return existsSync(fallbackPostgresDataDir) && existsSync(fallbackPostgresMarkerPath);
}

function fallbackPostgresIsRunning() {
  if (!fallbackPostgresWasInitialized()) {
    return false;
  }

  const result = runHomebrewPostgresCommand("pg_ctl", ["-D", fallbackPostgresDataDir, "status"], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function stopFallbackPostgres() {
  if (!fallbackPostgresIsRunning()) {
    return false;
  }

  const result = runHomebrewPostgresCommand("pg_ctl", ["-D", fallbackPostgresDataDir, "stop", "-m", "fast"], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("Failed to stop fallback Homebrew Postgres.");
  }

  return true;
}

async function waitForDatabaseReady(config) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const result = runCompose(["exec", "-T", postgresServiceName, "pg_isready", "-U", config.user, "-d", config.databaseName], {
      env: getComposeEnv(config),
      stdio: "ignore",
    });

    if (result.status === 0) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 1_000));
  }

  throw new Error(`Local Postgres did not become ready at ${formatDatabaseTarget(config)} within 30 seconds.`);
}

export function ensureComposeDatabaseExists(config, composeRunner = runCompose) {
  const connectionArgs = [
    "exec", "-T", postgresServiceName, "psql", "-v", "ON_ERROR_STOP=1",
    "-U", config.user, "-d", config.databaseName, "-c", "select 1",
  ];
  const connectionOptions = { env: getComposeEnv(config), stdio: "ignore" };
  if (composeRunner(connectionArgs, connectionOptions).status === 0) return;

  console.log(`[dev-db] Creating local database ${config.databaseName} in the Docker-managed Postgres...`);
  const createResult = composeRunner(
    ["exec", "-T", postgresServiceName, "createdb", "-U", config.user, "--", config.databaseName],
    { env: getComposeEnv(config), stdio: "pipe", encoding: "utf8" },
  );
  const createOutput = getSpawnOutput(createResult);
  if (createResult.status !== 0 && !/already exists/i.test(createOutput)) {
    throw new Error(`Failed to create local database ${config.databaseName}. ${createOutput.trim()}`);
  }
  if (composeRunner(connectionArgs, connectionOptions).status !== 0) {
    throw new Error(`Local Postgres accepted connections but database ${config.databaseName} is unavailable.`);
  }
}

export async function ensureLocalDatabase(config = resolveNextDatabaseConfig()) {
  if (config.isMemory) {
    return {
      skipped: true,
      config,
      reason: "DATABASE_URL uses the in-memory development database",
    };
  }

  if (!config.isLocal) {
    return {
      skipped: true,
      config,
      reason: `DATABASE_URL points to ${formatDatabaseTarget(config)}`,
    };
  }

  if (!config.password) {
    throw new Error(
      "Local DATABASE_URL must include a password for the Docker-managed Postgres container. Update packages/nextjs/.env.local or export DATABASE_URL with credentials.",
    );
  }

  if (ensureDatabaseOnExistingPostgres(config)) {
    console.log(`[dev-db] Local Postgres is already ready at ${formatDatabaseTarget(config)}.`);
    return {
      skipped: false,
      config,
      existing: true,
    };
  }

  console.log(`[dev-db] Starting local Postgres for ${formatDatabaseTarget(config)}...`);
  const upResult = runCompose(["up", "-d", postgresServiceName], {
    env: getComposeEnv(config),
    stdio: "pipe",
    encoding: "utf8",
  });
  if (upResult.status !== 0) {
    const composeOutput = getSpawnOutput(upResult);
    replaySpawnOutput(upResult);

    if (composeOutputHasPortConflict(composeOutput, config.port)) {
      throw new Error(buildLocalDatabasePortConflictMessage(config, listDockerContainersPublishingPort(config.port)));
    }

    console.warn("[dev-db] Docker-managed Postgres could not start; trying fallback Homebrew postgresql@16.");
    await ensureFallbackLocalDatabase(config);
    return {
      skipped: false,
      config,
      fallback: "homebrew-postgres",
    };
  }

  replaySpawnOutput(upResult);
  await waitForDatabaseReady(config);
  ensureComposeDatabaseExists(config);
  console.log(`[dev-db] Local Postgres is ready at ${formatDatabaseTarget(config)}.`);

  return {
    skipped: false,
    config,
  };
}

export function stopLocalDatabase() {
  try {
    const result = runCompose(["down"]);
    if (result.status === 0) {
      stopFallbackPostgres();
      return;
    }
  } catch (error) {
    if (!(error instanceof MissingDockerComposeError)) {
      throw error;
    }
  }

  if (!stopFallbackPostgres()) {
    throw new Error("Failed to stop the local Postgres container.");
  }
}

export function resetLocalDatabase() {
  try {
    const result = runCompose(["down", "-v"]);
    if (result.status !== 0 && !fallbackPostgresWasInitialized()) {
      throw new Error("Failed to reset the local Postgres container and volume.");
    }
  } catch (error) {
    if (!(error instanceof MissingDockerComposeError)) {
      throw error;
    }
  }

  stopFallbackPostgres();
  if (fallbackPostgresWasInitialized()) {
    rmSync(fallbackPostgresDataDir, { recursive: true, force: true });
  }
  if (existsSync(fallbackPostgresLogPath)) {
    rmSync(fallbackPostgresLogPath, { force: true });
  }
}

export function streamLocalDatabaseLogs() {
  if (
    selectLocalDatabaseLogSource({
      fallbackInitialized: fallbackPostgresWasInitialized(),
      fallbackLogExists: existsSync(fallbackPostgresLogPath),
      fallbackRunning: fallbackPostgresIsRunning(),
    }) === "fallback"
  ) {
    const result = spawnSync("tail", ["-f", fallbackPostgresLogPath], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    process.exit(result.status ?? 0);
  }

  const result = runCompose(["logs", "-f", postgresServiceName]);
  process.exit(result.status ?? 0);
}

export function selectLocalDatabaseLogSource({
  fallbackInitialized,
  fallbackLogExists,
  fallbackRunning,
}) {
  return fallbackInitialized && fallbackRunning && fallbackLogExists ? "fallback" : "compose";
}

function printUsage() {
  console.log(`Usage: node scripts/dev-db.mjs [up|down|reset|logs]

Commands:
  up    Start the local Postgres container for the Next app
  down  Stop the local Postgres container
  reset Stop the local Postgres container and delete its data volume
  logs  Follow Postgres logs
`);
}

async function main() {
  const command = process.argv[2] ?? "up";

  if (command === "--help" || command === "-h" || command === "help") {
    printUsage();
    return;
  }

  if (command === "up") {
    const result = await ensureLocalDatabase();
    if (result.skipped) {
      console.log(`[dev-db] Skipping local Postgres because ${result.reason}.`);
    }
    return;
  }

  if (command === "down") {
    stopLocalDatabase();
    console.log("[dev-db] Local Postgres stopped.");
    return;
  }

  if (command === "reset") {
    resetLocalDatabase();
    console.log("[dev-db] Local Postgres volume reset.");
    return;
  }

  if (command === "logs") {
    streamLocalDatabaseLogs();
    return;
  }

  printUsage();
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(`[dev-db] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
