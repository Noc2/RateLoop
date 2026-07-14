import { normalizeResendFromEmail } from "./resend";
import assert from "node:assert/strict";
import test from "node:test";

test("Resend sender accepts verified addresses and display names", () => {
  assert.equal(
    normalizeResendFromEmail("RateLoop <notifications@example.com>"),
    "RateLoop <notifications@example.com>",
  );
  assert.equal(normalizeResendFromEmail("notifications@example.com"), "notifications@example.com");
  assert.equal(normalizeResendFromEmail("not-an-email"), null);
});
