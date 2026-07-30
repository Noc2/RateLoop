import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { sendTokenlessNotificationEmail } from "~~/lib/notifications/resend";
import { createDrataGrcAdapter } from "~~/lib/tokenless/assuranceGrcProviders";
import { MaintenanceCancellationError } from "~~/lib/tokenless/maintenanceCancellation";
import { createPrivateBlobStorage } from "~~/lib/tokenless/privateBlobStorage";

const previousResendKey = process.env.RESEND_API_KEY;
const previousResendFrom = process.env.RESEND_FROM_EMAIL;

afterEach(() => {
  if (previousResendKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = previousResendKey;
  if (previousResendFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
  else process.env.RESEND_FROM_EMAIL = previousResendFrom;
});

test("scheduled external consumers reject the shared cancellation before provider I/O", async () => {
  const controller = new AbortController();
  const cancellation = new MaintenanceCancellationError();
  controller.abort(cancellation);
  let emailCalls = 0;
  let grcCalls = 0;
  let blobLoads = 0;

  process.env.RESEND_API_KEY = "resend-test-key";
  process.env.RESEND_FROM_EMAIL = "RateLoop <notifications@example.test>";
  await assert.rejects(
    sendTokenlessNotificationEmail(
      {
        actionUrl: "https://tokenless.example.test/human",
        body: "A result is ready.",
        email: "reviewer@example.test",
        idempotencyKey: "notification:cancelled",
        title: "Result ready",
        unsubscribeUrl: "https://tokenless.example.test/unsubscribe",
      },
      async () => {
        emailCalls += 1;
        return Response.json({ id: "email_unexpected" });
      },
      controller.signal,
    ),
    error => error === cancellation,
  );

  const grc = createDrataGrcAdapter(async () => {
    grcCalls += 1;
    return Response.json({});
  });
  await assert.rejects(
    grc.deliver({
      bundle: null as never,
      credential: "credential",
      idempotencyKey: "grc:cancelled",
      providerConfig: null as never,
      signal: controller.signal,
    }),
    error => error === cancellation,
  );

  const blob = createPrivateBlobStorage({
    loadApi: async () => {
      blobLoads += 1;
      return null as never;
    },
  });
  await assert.rejects(
    blob.delete("https://blob.example.test/private", controller.signal),
    error => error === cancellation,
  );

  assert.deepEqual({ emailCalls, grcCalls, blobLoads }, { emailCalls: 0, grcCalls: 0, blobLoads: 0 });
});
