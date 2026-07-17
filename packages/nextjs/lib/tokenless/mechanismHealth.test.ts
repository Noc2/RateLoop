import { __mechanismHealthTestUtils } from "./mechanismHealth";
import assert from "node:assert/strict";
import { test } from "node:test";

test("late partial transparency evidence keeps a completed run refreshable", () => {
  const sql = __mechanismHealthTestUtils.refreshSelectionSql;
  assert.match(sql, /mh\.indexed_chain_case_count<>current_counts\.indexed_chain_case_count/u);
  assert.match(sql, /COUNT\(DISTINCT CASE/u);
  assert.match(sql, /te\.event_type='finalized'/u);
  assert.match(sql, /gold\.case_id IS NULL/u);
  assert.doesNotMatch(sql, /mh\.rbts_score_count=0/u);
});

test("RBTS aggregates preserve integer precision and reject impossible variance", () => {
  assert.deepEqual(
    __mechanismHealthTestUtils.rbtsAggregateFromEvidence(
      JSON.stringify({
        revealCount: "9007199254740993",
        scoring: {
          totalRbtsScoreBps: "90071992547409930000",
          totalSquaredRbtsScoreBps2: "900719925474099300000000",
        },
      }),
    ),
    {
      count: 9_007_199_254_740_993n,
      sum: 90_071_992_547_409_930_000n,
      squared: 900_719_925_474_099_300_000_000n,
    },
  );
  assert.throws(
    () =>
      __mechanismHealthTestUtils.rbtsAggregateFromEvidence(
        JSON.stringify({
          revealCount: 2,
          scoring: { totalRbtsScoreBps: "20000", totalSquaredRbtsScoreBps2: "1" },
        }),
      ),
    /internally inconsistent/u,
  );
  assert.throws(
    () =>
      __mechanismHealthTestUtils.rbtsAggregateFromEvidence(
        JSON.stringify({
          revealCount: 1.5,
          scoring: { totalRbtsScoreBps: "1000", totalSquaredRbtsScoreBps2: "1000000" },
        }),
      ),
    /reveal count is invalid/u,
  );
});
