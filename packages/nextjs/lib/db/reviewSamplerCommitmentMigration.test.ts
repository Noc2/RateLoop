import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DataType, newDb } from "pg-mem";

const MIGRATION_BREAKPOINT = "--> statement-breakpoint";

test("sampler commitment migration backfills existing decisions and rejects non-canonical writes", () => {
  const database = newDb();
  database.public.registerOperator({
    operator: "~",
    left: DataType.text,
    right: DataType.text,
    returns: DataType.bool,
    implementation: (value: string, pattern: string) => new RegExp(pattern, "u").test(value),
  });
  database.public.none(`
    CREATE TABLE tokenless_agent_review_opportunities (
      opportunity_id text PRIMARY KEY,
      sampler_commitment text NOT NULL
    );
    INSERT INTO tokenless_agent_review_opportunities (opportunity_id, sampler_commitment)
    VALUES
      ('legacy', '${"a".repeat(64)}'),
      ('canonical', 'sha256:${"b".repeat(64)}');
  `);

  const migration = readFileSync(join(process.cwd(), "drizzle", "0165_review_sampler_commitment_format.sql"), "utf8");
  for (const statement of migration
    .split(MIGRATION_BREAKPOINT)
    .map(value => value.trim())
    .filter(Boolean)) {
    database.public.none(statement);
  }

  assert.deepEqual(
    database.public.many(
      "SELECT opportunity_id, sampler_commitment FROM tokenless_agent_review_opportunities ORDER BY opportunity_id",
    ),
    [
      { opportunity_id: "canonical", sampler_commitment: `sha256:${"b".repeat(64)}` },
      { opportunity_id: "legacy", sampler_commitment: `sha256:${"a".repeat(64)}` },
    ],
  );
  assert.throws(() =>
    database.public.none(`
      INSERT INTO tokenless_agent_review_opportunities (opportunity_id, sampler_commitment)
      VALUES ('invalid', '${"c".repeat(64)}')
    `),
  );
});
