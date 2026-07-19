import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { buildTokenlessSignedUnsubscribeToken } from "~~/lib/notifications/tokenless";

const NOW = new Date("2026-07-14T16:00:00.000Z");
const PRINCIPAL = "0x1111111111111111111111111111111111111111";
const SECRET = "notification-unsubscribe-route-secret-0001";
const UNSUBSCRIBE_HASH = createHash("sha256").update("route-unsubscribe-seed").digest("hex");
let previousSecret: string | undefined;

beforeEach(async () => {
  previousSecret = process.env.TOKENLESS_NOTIFICATION_UNSUBSCRIBE_SECRET;
  process.env.TOKENLESS_NOTIFICATION_UNSUBSCRIBE_SECRET = SECRET;
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  await dbClient.execute({
    sql: `INSERT INTO tokenless_browser_identities
          (principal_address, auth_provider, email_verified, created_at, updated_at, last_login_at)
          VALUES (?, 'email', true, ?, ?, ?)`,
    args: [PRINCIPAL, NOW, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_notification_email_subscriptions
          (principal_address, email, verified_at, unsubscribe_token_hash, created_at, updated_at)
          VALUES (?, 'reviewer@example.test', ?, ?, ?, ?)`,
    args: [PRINCIPAL, NOW, UNSUBSCRIBE_HASH, NOW, NOW],
  });
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (previousSecret === undefined) delete process.env.TOKENLESS_NOTIFICATION_UNSUBSCRIBE_SECRET;
  else process.env.TOKENLESS_NOTIFICATION_UNSUBSCRIBE_SECRET = previousSecret;
});

test("one-click unsubscribe rejects missing and tampered tokens but remains idempotent", async () => {
  assert.equal(
    (await POST(new NextRequest("https://tokenless.example.test/api/notifications/email/unsubscribe"))).status,
    400,
  );
  const token = buildTokenlessSignedUnsubscribeToken({
    principalAddress: PRINCIPAL,
    unsubscribeTokenHash: UNSUBSCRIBE_HASH,
  });
  assert.equal(
    (
      await POST(
        new NextRequest(
          `https://tokenless.example.test/api/notifications/email/unsubscribe?token=${encodeURIComponent(`${token}tampered`)}`,
        ),
      )
    ).status,
    404,
  );
  const url = `https://tokenless.example.test/api/notifications/email/unsubscribe?token=${encodeURIComponent(token)}`;
  assert.equal((await POST(new NextRequest(url))).status, 200);
  assert.equal((await POST(new NextRequest(url))).status, 200);
});

test("manual unsubscribe GET requires confirmation and does not consume scanner-fetched links", async () => {
  const token = buildTokenlessSignedUnsubscribeToken({
    principalAddress: PRINCIPAL,
    unsubscribeTokenHash: UNSUBSCRIBE_HASH,
  });
  const url = `https://tokenless.example.test/api/notifications/email/unsubscribe?token=${encodeURIComponent(token)}`;
  const response = await GET(new NextRequest(url));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html/u);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/u);
  assert.match(await response.text(), /<form method="post"[^>]+manual=1/u);
  const beforeConfirmation = await dbClient.execute({
    sql: "SELECT principal_address FROM tokenless_notification_email_subscriptions WHERE principal_address = ?",
    args: [PRINCIPAL],
  });
  assert.equal(beforeConfirmation.rows.length, 1);

  const confirmed = await POST(new NextRequest(`${url}&manual=1`, { method: "POST" }));
  assert.equal(confirmed.status, 303);
  assert.match(confirmed.headers.get("location") ?? "", /email=unsubscribed/u);
  const afterConfirmation = await dbClient.execute({
    sql: "SELECT principal_address FROM tokenless_notification_email_subscriptions WHERE principal_address = ?",
    args: [PRINCIPAL],
  });
  assert.equal(afterConfirmation.rows.length, 0);
});
