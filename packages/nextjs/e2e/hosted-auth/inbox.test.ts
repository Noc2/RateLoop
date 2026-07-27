import { ResendReceivingInbox, extractRateLoopOtp, redactHostedAuthSecrets } from "./inbox";
import assert from "node:assert/strict";
import test from "node:test";

const RUN_STARTED_AT = new Date("2026-07-27T10:00:00.000Z");
const REQUESTED_AT = new Date("2026-07-27T10:00:01.000Z");
const RECIPIENT = "reviewer-one@auth-harness.example";
const SENDER = "login@info.rateloop.ai";

test("OTP parsing requires one labeled six-digit code across text and HTML", () => {
  assert.equal(
    extractRateLoopOtp({
      text: "Sign in to RateLoop\n\nYour one-time code: 123456\n\nThe code expires in five minutes.",
    }),
    "123456",
  );
  assert.equal(
    extractRateLoopOtp({
      html: '<p>One-time code</p><p style="letter-spacing:.2em">654321</p>',
      text: null,
    }),
    "654321",
  );
  assert.equal(
    extractRateLoopOtp({
      html: "<p>One-time code</p><p>123456</p>",
      text: "Your one-time code: 123456",
    }),
    "123456",
  );
  assert.throws(() => extractRateLoopOtp({ text: "A random number 123456" }), /exactly one labeled/u);
  assert.throws(
    () => extractRateLoopOtp({ html: "<p>One-time code 123456</p>", text: "Your one-time code: 654321" }),
    /exactly one labeled/u,
  );
});

test("Resend Receiving polls by exact recipient, sender, subject, and run timestamps", async () => {
  const requests: Array<{ authorization: string | null; url: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input.toString();
    requests.push({ authorization: new Headers(init?.headers).get("authorization"), url });
    if (url.endsWith("/emails/receiving")) {
      return Response.json({
        object: "list",
        has_more: false,
        data: [
          {
            id: "old-exact",
            to: [RECIPIENT],
            from: SENDER,
            created_at: "2026-07-27T09:59:59.000Z",
            subject: "Your RateLoop sign-in code",
          },
          {
            id: "new-wrong-recipient",
            to: ["reviewer-two@auth-harness.example"],
            from: SENDER,
            created_at: "2026-07-27T10:00:02.000Z",
            subject: "Your RateLoop sign-in code",
          },
          {
            id: "new-wrong-sender",
            to: [RECIPIENT],
            from: "attacker@example.test",
            created_at: "2026-07-27T10:00:02.000Z",
            subject: "Your RateLoop sign-in code",
          },
          {
            id: "new-exact",
            to: [RECIPIENT],
            from: `RateLoop <${SENDER}>`,
            created_at: "2026-07-27T10:00:02.000Z",
            subject: "Your RateLoop sign-in code",
          },
        ],
      });
    }
    assert.equal(url, "https://api.resend.com/emails/receiving/new-exact");
    return Response.json({
      object: "email",
      id: "new-exact",
      to: [RECIPIENT],
      from: `RateLoop <${SENDER}>`,
      created_at: "2026-07-27T10:00:02.000Z",
      subject: "Your RateLoop sign-in code",
      html: "<p>One-time code</p><p>246810</p>",
      text: "Your one-time code: 246810",
    });
  };
  const inbox = new ResendReceivingInbox(
    {
      apiKey: "re_receiving_test_key",
      expectedFrom: SENDER,
      pollIntervalMs: 1,
      pollTimeoutMs: 100,
    },
    { fetchImpl, now: () => new Date("2026-07-27T10:00:03.000Z"), wait: async () => undefined },
  );

  assert.equal(
    await inbox.waitForOtp({
      recipient: RECIPIENT,
      requestedAt: REQUESTED_AT,
      runStartedAt: RUN_STARTED_AT,
    }),
    "246810",
  );
  assert.deepEqual(
    requests.map(request => request.url),
    ["https://api.resend.com/emails/receiving", "https://api.resend.com/emails/receiving/new-exact"],
  );
  assert.ok(requests.every(request => request.authorization === "Bearer re_receiving_test_key"));
});

test("Resend Receiving fails closed on multiple matching messages", async () => {
  const fetchImpl: typeof fetch = async () =>
    Response.json({
      data: ["first", "second"].map(id => ({
        id,
        to: [RECIPIENT],
        from: SENDER,
        created_at: "2026-07-27T10:00:02.000Z",
        subject: "Your RateLoop sign-in code",
      })),
    });
  const inbox = new ResendReceivingInbox(
    {
      apiKey: "re_receiving_test_key",
      expectedFrom: SENDER,
      pollIntervalMs: 1,
      pollTimeoutMs: 100,
    },
    { fetchImpl, now: () => new Date("2026-07-27T10:00:03.000Z"), wait: async () => undefined },
  );

  await assert.rejects(
    inbox.waitForOtp({ recipient: RECIPIENT, requestedAt: REQUESTED_AT, runStartedAt: RUN_STARTED_AT }),
    /More than one matching RateLoop sign-in email/u,
  );
});

test("hosted auth redaction removes OTPs, bearer credentials, API keys, sessions, and configured mailboxes", () => {
  const redacted = redactHostedAuthSecrets(
    `mail=${RECIPIENT} otp=123456 Authorization: Bearer secret-token re_live_secret_123 ` +
      `rlk_0123456789abcdef_${"x".repeat(43)} rateloop-session=session-secret`,
    [RECIPIENT],
  );
  assert.doesNotMatch(redacted, /reviewer-one|123456|secret-token|re_live|rlk_|session-secret/u);
  assert.match(redacted, /\[REDACTED_OTP\]/u);
  assert.match(redacted, /Bearer \[REDACTED\]/u);
});
