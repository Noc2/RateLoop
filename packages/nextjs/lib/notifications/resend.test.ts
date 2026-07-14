import { normalizeResendFromEmail, sendTokenlessNotificationEmail } from "./resend";
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

test("notification email transport sets provider idempotency and unsubscribe headers", async () => {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.RESEND_FROM_EMAIL;
  process.env.RESEND_API_KEY = "resend-test-key";
  process.env.RESEND_FROM_EMAIL = "RateLoop <notifications@example.test>";
  try {
    let request: RequestInit | undefined;
    const sent = await sendTokenlessNotificationEmail(
      {
        actionUrl: "https://tokenless.example.test/human?tab=discover",
        body: "A generic update is ready.",
        email: "reviewer@example.test",
        idempotencyKey: "delivery-id-1",
        title: "RateLoop update",
        unsubscribeUrl: "https://tokenless.example.test/api/notifications/email/unsubscribe?token=v1.test.signature",
      },
      async (_url, init) => {
        request = init;
        return new Response(JSON.stringify({ id: "resend-id" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    assert.deepEqual(sent, { id: "resend-id" });
    assert.equal((request?.headers as Record<string, string>)["Idempotency-Key"], "delivery-id-1");
    const body = JSON.parse(String(request?.body)) as { headers: Record<string, string>; html: string };
    assert.match(body.headers["List-Unsubscribe"]!, /^<https:\/\//u);
    assert.equal(body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    assert.match(body.html, /intentionally omits question, answer, payment, and workspace details/u);
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previousFrom;
  }
});
