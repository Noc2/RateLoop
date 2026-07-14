import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { getAccountProfile, updateAccountProfile } from "~~/lib/tokenless/accountProfile";

const ADDRESS = "0x1111111111111111111111111111111111111111";

beforeEach(async () => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  await dbClient.execute({
    sql: `INSERT INTO tokenless_browser_identities
          (principal_address, auth_provider, email_verified, created_at, updated_at, last_login_at)
          VALUES (?, 'thirdweb', false, ?, ?, ?)`,
    args: [ADDRESS, new Date(), new Date(), new Date()],
  });
});

afterEach(() => __setDatabaseResourcesForTests(null));

test("profile preference is private and provider identity remains the fallback", async () => {
  const initial = await getAccountProfile({ principalAddress: ADDRESS, providerDisplayName: "Provider Name" });
  assert.equal(initial.displayName, "Provider Name");
  assert.equal(initial.profileDisplayName, null);

  const updated = await updateAccountProfile({
    principalAddress: ADDRESS,
    providerDisplayName: "Provider Name",
    displayName: "Private Name",
  });
  assert.equal(updated.displayName, "Private Name");
  assert.equal(updated.providerDisplayName, "Provider Name");

  const cleared = await updateAccountProfile({
    principalAddress: ADDRESS,
    providerDisplayName: "Provider Name",
    displayName: null,
  });
  assert.equal(cleared.displayName, "Provider Name");
});

test("profile names are bounded", async () => {
  await assert.rejects(
    () =>
      updateAccountProfile({
        principalAddress: ADDRESS,
        providerDisplayName: null,
        displayName: "x".repeat(81),
      }),
    /at most 80 characters/,
  );
});
