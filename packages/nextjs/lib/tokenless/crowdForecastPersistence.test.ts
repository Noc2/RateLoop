import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient, dbPool } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  __crowdForecastPersistenceTestUtils,
  erasePrincipalForecastIntegrityInTransaction,
  listPrincipalForecastIntegrity,
  openPrincipalForecastAppeal,
} from "~~/lib/tokenless/crowdForecastPersistence";
import { createWorkspace } from "~~/lib/tokenless/productCore";

const OWNER = "0x1111111111111111111111111111111111111111";
const REVIEWER = "0x2222222222222222222222222222222222222222";
const originalLookupKey = process.env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY;
const originalLookupVersion = process.env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY_VERSION;

beforeEach(() => {
  process.env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY = Buffer.alloc(32, 29).toString("base64url");
  process.env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY_VERSION = "forecast-persistence-test-v1";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalLookupKey === undefined) delete process.env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY;
  else process.env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY = originalLookupKey;
  if (originalLookupVersion === undefined) delete process.env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY_VERSION;
  else process.env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY_VERSION = originalLookupVersion;
});

test("running sums create append-only payout-neutral findings and an appeal suspends assignment consequences", async () => {
  const workspace = await createWorkspace({
    ownerAddress: OWNER,
    name: "Forecast persistence",
  });
  for (let index = 0; index < 16; index += 1) {
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      await __crowdForecastPersistenceTestUtils.aggregateInvitedBatch(client, {
        workspaceId: workspace.workspaceId,
        observations: [{ principalId: REVIEWER, predictedPositiveBps: 5_000, vote: index % 2 === 0 ? 1 : 0 }],
        outcome: index % 2 === 0 ? 1 : 0,
        now: new Date(1_786_000_000_000 + index * 1_000),
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  const record = await listPrincipalForecastIntegrity(REVIEWER);
  assert.equal(record.items.length, 1);
  assert.equal(record.items[0]?.observationCount, 16);
  assert.equal(record.items[0]?.payoutEffect, "none");
  assert.equal(record.items[0]?.consequence, "future_assignment_restriction");
  assert.ok(record.items[0]?.reasonCodes.includes("forecast_invariant"));
  assert.ok(record.items[0]?.reasonCodes.includes("forecast_discrimination_absent"));
  const finding = record.items[0]?.findings.find(value => value.reasonCode === "forecast_invariant");
  assert.ok(finding);

  const appeal = await openPrincipalForecastAppeal({
    principalId: REVIEWER,
    findingId: finding.findingId,
    reasonCode: "measurement_error",
  });
  assert.equal(appeal.consequence, "suspended_by_open_appeal");
  const appealed = await listPrincipalForecastIntegrity(REVIEWER);
  assert.equal(appealed.items[0]?.consequence, "suspended_by_open_appeal");

  const appendOnly = await dbClient.execute(
    "SELECT finding_id,payout_effect FROM tokenless_forecast_integrity_findings ORDER BY created_at",
  );
  assert.ok(appendOnly.rows.length >= 2);
  assert.ok(appendOnly.rows.every(row => row.payout_effect === "none"));
});

test("account erasure removes invited accumulators, pair pseudonyms, findings, and appeals", async () => {
  const workspace = await createWorkspace({
    ownerAddress: OWNER,
    name: "Forecast erasure",
  });
  const peer = "0x3333333333333333333333333333333333333333";
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await __crowdForecastPersistenceTestUtils.aggregateInvitedBatch(client, {
      workspaceId: workspace.workspaceId,
      observations: [
        { principalId: REVIEWER, predictedPositiveBps: 5_000, vote: 1 },
        { principalId: peer, predictedPositiveBps: 5_000, vote: 1 },
      ],
      outcome: 1,
      now: new Date("2026-07-26T12:00:00.000Z"),
    });
    const erased = await erasePrincipalForecastIntegrityInTransaction(client, { principalId: REVIEWER });
    assert.ok(erased.deletedRows >= 2);
    assert.equal(erased.remainingRows, 0);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const remainingPairs = await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_forecast_pair_accumulators");
  assert.equal(Number(remainingPairs.rows[0]?.count), 0);
});
