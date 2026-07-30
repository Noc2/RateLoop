import {
  RESEND_REQUEST_TIMEOUT_MS,
  __resendTestUtils,
  normalizeResendFromEmail,
  sendTokenlessLoginOtpEmail,
  sendTokenlessNotificationEmail,
  sendTokenlessVerificationEmail,
  sendWorkspaceReviewerInvitationEmail,
} from "./resend";
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

test("Resend signals enforce the provider deadline and preserve parent cancellation", async () => {
  const deadline = __resendTestUtils.resendRequestSignal(undefined, 1);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(deadline.aborted, true);
  assert.ok(deadline.reason instanceof DOMException);
  assert.equal(deadline.reason.name, "TimeoutError");

  const controller = new AbortController();
  const composed = __resendTestUtils.resendRequestSignal(controller.signal, RESEND_REQUEST_TIMEOUT_MS);
  const cancellation = new Error("maintenance cancelled");
  controller.abort(cancellation);
  assert.equal(composed.aborted, true);
  assert.equal(composed.reason, cancellation);
});

test("sign-in email uses the branded RateLoop code design", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.RESEND_FROM_EMAIL;
  process.env.RESEND_API_KEY = "resend-test-key";
  process.env.RESEND_FROM_EMAIL = "RateLoop <login@example.test>";
  try {
    let request: RequestInit | undefined;
    globalThis.fetch = async (_url, init) => {
      request = init;
      return new Response(JSON.stringify({ id: "resend-id" }), { status: 200 });
    };

    await sendTokenlessLoginOtpEmail({ email: "reviewer@example.test", otp: "123456" });

    const body = JSON.parse(String(request?.body)) as {
      html: string;
      subject: string;
      text: string;
      to: string[];
    };
    assert.equal(body.subject, "Your RateLoop sign-in code");
    assert.equal(body.to[0], "reviewer@example.test");
    assert.match(body.text, /Your one-time code: 123456/u);
    assert.match(body.text, /If you did not request it/u);
    assert.match(body.html, /The Human Assurance Loop/u);
    assert.match(body.html, /Secure sign-in/u);
    assert.match(body.html, />\s*123456\s*</u);
    assert.match(body.html, /Use this one-time code to finish signing in/u);
    assert.doesNotMatch(body.html, /<a\b/iu);
    assert.ok(request?.signal instanceof AbortSignal);
    assert.equal(request.signal.aborted, false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previousFrom;
  }
});

test("notification verification email uses the branded RateLoop action design", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.RESEND_FROM_EMAIL;
  process.env.RESEND_API_KEY = "resend-test-key";
  process.env.RESEND_FROM_EMAIL = "RateLoop <notifications@example.test>";
  try {
    let request: RequestInit | undefined;
    globalThis.fetch = async (_url, init) => {
      request = init;
      return new Response(JSON.stringify({ id: "resend-id" }), { status: 200 });
    };

    await sendTokenlessVerificationEmail({
      email: "reviewer@example.test",
      verifyUrl: "https://tokenless.example.test/api/notifications/email/verify?token=test&next=<unsafe>",
    });

    const body = JSON.parse(String(request?.body)) as { html: string; subject: string; text: string };
    assert.equal(body.subject, "Verify your RateLoop notification email");
    assert.match(body.text, /Verify your RateLoop notification email/u);
    assert.match(body.html, /The Human Assurance Loop/u);
    assert.match(body.html, /Email verification/u);
    assert.match(body.html, />\s*Verify email\s*</u);
    assert.match(body.html, /token=test&amp;next=&lt;unsafe&gt;/u);
    assert.doesNotMatch(body.html, /next=<unsafe>/u);
    assert.ok(request?.signal instanceof AbortSignal);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previousFrom;
  }
});

test("lifecycle email uses the branded design and preserves delivery headers", async () => {
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
    assert.ok(request?.signal instanceof AbortSignal);
    const body = JSON.parse(String(request?.body)) as { headers: Record<string, string>; html: string };
    assert.match(body.headers["List-Unsubscribe"]!, /^<https:\/\//u);
    assert.equal(body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    assert.match(body.html, /The Human Assurance Loop/u);
    assert.match(body.html, /RateLoop notification/u);
    assert.match(body.html, />\s*Open RateLoop\s*</u);
    assert.match(body.html, /intentionally omits question, answer, payment, and workspace details/u);
    assert.match(body.html, /Unsubscribe from RateLoop email notifications/u);
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previousFrom;
  }
});

test("workspace reviewer invitation email uses an idempotent personal action link", async () => {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.RESEND_FROM_EMAIL;
  process.env.RESEND_API_KEY = "resend-test-key";
  process.env.RESEND_FROM_EMAIL = "RateLoop <notifications@example.test>";
  try {
    let request: RequestInit | undefined;
    const sent = await sendWorkspaceReviewerInvitationEmail(
      {
        destinationUrl:
          "https://tokenless.example.test/human?tab=discover&invite=1#invite=rlri_0123456789abcdef_secret",
        email: "reviewer@example.test",
        invitationId: "wri_0123456789abcdef",
      },
      async (_url, init) => {
        request = init;
        return Response.json({ id: "reviewer-invite-message" });
      },
    );
    assert.deepEqual(sent, { id: "reviewer-invite-message" });
    assert.equal(
      (request?.headers as Record<string, string>)["Idempotency-Key"],
      "workspace-reviewer-invitation:wri_0123456789abcdef",
    );
    assert.ok(request?.signal instanceof AbortSignal);
    const body = JSON.parse(String(request?.body)) as { html: string; subject: string; text: string; to: string[] };
    assert.equal(body.to[0], "reviewer@example.test");
    assert.equal(body.subject, "You’re invited to review with RateLoop");
    assert.match(body.html, />\s*Review invitation\s*</u);
    assert.match(body.text, /Do not forward it/u);
    assert.match(body.text, /#invite=rlri_/u);
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previousFrom;
  }
});
