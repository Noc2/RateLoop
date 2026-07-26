import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0139_paid_assignment_terminal_states.sql", import.meta.url),
  "utf8",
);
const journal = readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8");

test("0139 journals terminal paid-assignment operations and seats", () => {
  assert.match(journal, /"idx": 139[\s\S]*"tag": "0139_paid_assignment_terminal_states"/u);
  assert.match(migration, /'round_bound',\s*'active',\s*'settling',\s*'terminal'/u);
  assert.match(migration, /'voucher_prepared','accepted','committed','revealed','terminal'/u);
  assert.match(migration, /"terminal_outcome" = 'all_seats_terminal'/u);
});

test("0139 enforces monotonic receipted transitions and immutable terminal evidence", () => {
  assert.match(migration, /new_rank = old_rank \+ 1/u);
  assert.match(migration, /terminal paid-assignment operations are immutable/u);
  assert.match(migration, /'seat_accepted','seat_committed'/u);
  assert.match(migration, /'seat_revealed','seat_terminal'/u);
  assert.match(migration, /settlement_evidence_hash/u);
  assert.match(migration, /tokenless_private_review_responses_settlement_check/u);
});
