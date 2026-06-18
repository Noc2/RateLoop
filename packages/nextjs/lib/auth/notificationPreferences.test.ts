import assert from "node:assert/strict";
import test from "node:test";
import {
  hashNotificationPreferencesPayload,
  normalizeNotificationPreferencesInput,
} from "~~/lib/auth/notificationPreferences";

const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

const fullPreferencesBody = {
  address: ADDRESS,
  roundResolved: false,
  settlingSoonHour: true,
  settlingSoonDay: false,
  followedSubmission: true,
  followedResolution: false,
  contextNowPublic: true,
  breachReported: false,
  cohortBreachAnnouncement: true,
};

test("notification preference normalization includes confidentiality preferences", () => {
  const normalized = normalizeNotificationPreferencesInput(fullPreferencesBody);

  assert.equal(normalized.ok, true);
  if (!normalized.ok) return;
  assert.equal(normalized.payload.normalizedAddress, ADDRESS);
  assert.equal(normalized.payload.contextNowPublic, true);
  assert.equal(normalized.payload.breachReported, false);
  assert.equal(normalized.payload.cohortBreachAnnouncement, true);
});

test("notification preference normalization requires confidentiality booleans", () => {
  const normalized = normalizeNotificationPreferencesInput({
    ...fullPreferencesBody,
    contextNowPublic: undefined,
  });

  assert.deepEqual(normalized, { ok: false, error: "Invalid preference: contextNowPublic" });
});

test("notification preference hashes bind confidentiality preferences", () => {
  const normalized = normalizeNotificationPreferencesInput(fullPreferencesBody);
  const changed = normalizeNotificationPreferencesInput({
    ...fullPreferencesBody,
    cohortBreachAnnouncement: false,
  });

  assert.equal(normalized.ok, true);
  assert.equal(changed.ok, true);
  if (!normalized.ok || !changed.ok) return;
  assert.notEqual(
    hashNotificationPreferencesPayload(normalized.payload),
    hashNotificationPreferencesPayload(changed.payload),
  );
});
