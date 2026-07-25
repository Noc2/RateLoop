import * as schema from "./lib/db/schema";
import type { Config } from "drizzle-kit";
import { getTableName, isTable } from "drizzle-orm";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultDatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:5432/rateloop_tokenless";
const currentFile = fileURLToPath(import.meta.url);
const projectDir = path.dirname(currentFile);

function stripMatchingQuotes(value: string) {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function readEnvFileDatabaseUrl(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined;

  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line
      .slice(0, separatorIndex)
      .trim()
      .replace(/^export\s+/, "");
    if (key !== "DATABASE_URL") continue;

    const value = stripMatchingQuotes(line.slice(separatorIndex + 1).trim()).trim();
    return value || undefined;
  }

  return undefined;
}

const rawDatabaseUrl = process.env.DATABASE_URL?.trim() ?? readEnvFileDatabaseUrl(path.join(projectDir, ".env.local"));
const url = rawDatabaseUrl || defaultDatabaseUrl;

// `drizzle/` migrates far more tables than `lib/db/schema.ts` maps. Any drizzle-kit command that
// diffs the live database against the schema (`push`, `pull`, `studio`) would treat every unmapped
// table as removed and drop it. Deriving the filter from the schema itself keeps drizzle-kit blind
// to those tables and cannot drift as the schema changes. `db:migrate` replays the checked-in SQL
// and is unaffected. The trade-off is that `db:studio` only browses the mapped tables.
const mappedTables = Object.values(schema)
  .filter(isTable)
  .map(table => getTableName(table))
  .sort();

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  tablesFilter: mappedTables,
  dbCredentials: {
    url,
  },
} satisfies Config;
