import { DEADLINE_REMINDER_REMAINING_FRACTION, __notificationDeliveryTestUtils } from "./delivery";
import assert from "node:assert/strict";
import test from "node:test";

const { dueSoonRows, privateUnpaidAssignmentCandidateSql } = __notificationDeliveryTestUtils;

const NOW = new Date("2026-08-07T12:00:00.000Z");

function row(input: { remainingSeconds: number; windowSeconds: number }) {
  return {
    principal_address: "0x1111111111111111111111111111111111111111",
    response_deadline: new Date(NOW.getTime() + input.remainingSeconds * 1_000),
    response_window_seconds: input.windowSeconds,
    source_key: "prua_test",
  };
}

test("a reminder fires only inside the last quarter of the configured window", () => {
  const threeDays = 259_200;
  // Just outside the last quarter: 25% + 1 second remaining.
  assert.equal(
    dueSoonRows(
      [row({ remainingSeconds: threeDays * DEADLINE_REMINDER_REMAINING_FRACTION + 1, windowSeconds: threeDays })],
      NOW,
    ).length,
    0,
  );
  // Exactly at the boundary counts as due.
  assert.equal(
    dueSoonRows(
      [row({ remainingSeconds: threeDays * DEADLINE_REMINDER_REMAINING_FRACTION, windowSeconds: threeDays })],
      NOW,
    ).length,
    1,
  );
  assert.equal(dueSoonRows([row({ remainingSeconds: 60, windowSeconds: threeDays })], NOW).length, 1);
});

test("the fraction scales across the whole permitted window range", () => {
  // The window now spans 20 minutes to 30 days, which is why the threshold is a
  // fraction and not a fixed lead time. A fixed 24-hour warning would never fire
  // on the short end and would fire immediately on the long end.
  const twentyMinutes = 1_200;
  const thirtyDays = 2_592_000;
  assert.equal(dueSoonRows([row({ remainingSeconds: 299, windowSeconds: twentyMinutes })], NOW).length, 1);
  assert.equal(dueSoonRows([row({ remainingSeconds: 301, windowSeconds: twentyMinutes })], NOW).length, 0);
  assert.equal(dueSoonRows([row({ remainingSeconds: 7 * 86_400, windowSeconds: thirtyDays })], NOW).length, 1);
  assert.equal(dueSoonRows([row({ remainingSeconds: 8 * 86_400, windowSeconds: thirtyDays })], NOW).length, 0);
});

test("an elapsed or unusable deadline never produces a reminder", () => {
  // Past the deadline there is nothing to chase: the review is already resolved
  // or forced inconclusive, and a reminder would be actively misleading.
  assert.equal(dueSoonRows([row({ remainingSeconds: 0, windowSeconds: 259_200 })], NOW).length, 0);
  assert.equal(dueSoonRows([row({ remainingSeconds: -60, windowSeconds: 259_200 })], NOW).length, 0);
  assert.equal(
    dueSoonRows([{ ...row({ remainingSeconds: 60, windowSeconds: 259_200 }), response_window_seconds: 0 }], NOW).length,
    0,
  );
  assert.equal(
    dueSoonRows([{ ...row({ remainingSeconds: 60, windowSeconds: 259_200 }), response_deadline: "not a date" }], NOW)
      .length,
    0,
  );
});

test("the reminder query carries the same reviewer eligibility as the original notice", () => {
  const available = privateUnpaidAssignmentCandidateSql({
    orderBy: "a.created_at ASC",
    sourceType: "assignment.available",
  });
  const reminder = privateUnpaidAssignmentCandidateSql({
    orderBy: "a.response_deadline ASC",
    selectColumns: ", a.response_deadline, rp.response_window_seconds",
    sourceType: "assignment.deadline_approaching",
  });

  // There is no point chasing someone whose grant has expired, and no excuse for
  // skipping someone still able to answer -- so the two queries must differ only
  // in the notification kind, the extra columns and the ordering.
  const normalize = (sql: string) =>
    sql
      .replace(", a.response_deadline, rp.response_window_seconds", "")
      .replace("assignment.deadline_approaching", "SOURCE")
      .replace("assignment.available", "SOURCE")
      .replace("ORDER BY a.response_deadline ASC", "ORDER BY")
      .replace("ORDER BY a.created_at ASC", "ORDER BY");
  assert.equal(normalize(reminder), normalize(available));

  for (const predicate of [
    "reviewer.status = 'active'",
    "principal.status = 'active'",
    "access_grant.revoked_at IS NULL",
    "a.response_deadline > ?",
    "rp.compensation_mode = 'unpaid'",
  ]) {
    assert.ok(reminder.includes(predicate), `reminder query lost: ${predicate}`);
  }
  assert.ok(reminder.includes("n.source_type = 'assignment.deadline_approaching'"));
});
