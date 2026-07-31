import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { isLocale } from "~~/i18n/config";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  getAccountProfile,
  normalizeAccountProfileUpdate,
  updateAccountProfile,
} from "~~/lib/tokenless/accountProfile";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { parseThemePreference } from "~~/lib/ui/themePreference";

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
  assert.equal(initial.preferredLocale, null);
  assert.equal(initial.preferredTheme, null);

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

test("locale and theme updates preserve profile fields that were not supplied", async () => {
  await updateAccountProfile({
    principalAddress: ADDRESS,
    providerDisplayName: "Provider Name",
    displayName: "Private Name",
  });

  const localized = await updateAccountProfile({
    principalAddress: ADDRESS,
    providerDisplayName: "Provider Name",
    preferredLocale: "de",
  });
  assert.equal(localized.profileDisplayName, "Private Name");
  assert.equal(localized.preferredLocale, "de");
  assert.equal(localized.preferredTheme, null);

  const themed = await updateAccountProfile({
    principalAddress: ADDRESS,
    providerDisplayName: "Provider Name",
    preferredTheme: "dark",
  });
  assert.equal(themed.profileDisplayName, "Private Name");
  assert.equal(themed.preferredLocale, "de");
  assert.equal(themed.preferredTheme, "dark");

  const followsSystem = await updateAccountProfile({
    principalAddress: ADDRESS,
    providerDisplayName: "Provider Name",
    preferredTheme: null,
  });
  assert.equal(followsSystem.profileDisplayName, "Private Name");
  assert.equal(followsSystem.preferredLocale, "de");
  assert.equal(followsSystem.preferredTheme, null);
});

test("empty profile updates are no-ops", async () => {
  const initial = await updateAccountProfile({
    principalAddress: ADDRESS,
    providerDisplayName: "Provider Name",
    displayName: "Private Name",
  });
  const unchanged = await updateAccountProfile({
    principalAddress: ADDRESS,
    providerDisplayName: "Provider Name",
  });

  assert.deepEqual(unchanged, initial);
});

test("profile update input accepts only the supported locale, theme, and optional fields", () => {
  assert.deepEqual(normalizeAccountProfileUpdate({ preferredLocale: "en", preferredTheme: "light" }), {
    preferredLocale: "en",
    preferredTheme: "light",
  });
  assert.deepEqual(normalizeAccountProfileUpdate({ preferredLocale: null, preferredTheme: null }), {
    preferredLocale: null,
    preferredTheme: null,
  });

  for (const [update, field, message] of [
    [{ preferredLocale: "fr" }, "preferredLocale", /Locale must be en or de/u],
    [{ preferredTheme: "system" }, "preferredTheme", /Theme must be light or dark/u],
    [{ preferredTheme: 1 }, "preferredTheme", /Theme must be light or dark/u],
    [{ admin: true }, "admin", /unsupported fields/u],
  ] as const) {
    assert.throws(
      () => normalizeAccountProfileUpdate(update),
      error => error instanceof TokenlessServiceError && error.field === field && message.test(error.message),
    );
  }
  assert.throws(() => normalizeAccountProfileUpdate(null), /must be an object/u);
});

test("profile persistence and UI preference consumers share the same locale and theme invariants", () => {
  for (const locale of ["en", "de", "EN", "fr", ""]) {
    if (isLocale(locale)) {
      assert.deepEqual(normalizeAccountProfileUpdate({ preferredLocale: locale }), { preferredLocale: locale });
    } else {
      assert.throws(() => normalizeAccountProfileUpdate({ preferredLocale: locale }), /Locale must be/u);
    }
  }

  for (const theme of ["light", "dark", "system", "LIGHT", ""]) {
    const parsed = parseThemePreference(theme);
    if (parsed) {
      assert.deepEqual(normalizeAccountProfileUpdate({ preferredTheme: theme }), { preferredTheme: parsed });
    } else {
      assert.throws(() => normalizeAccountProfileUpdate({ preferredTheme: theme }), /Theme must be/u);
    }
  }
});

test("database constraints enforce the same locale and theme values as the profile service", async () => {
  await assert.rejects(
    dbClient.execute({
      sql: `INSERT INTO tokenless_account_profiles
            (principal_address, preferred_locale, created_at, updated_at)
            VALUES (?, 'fr', ?, ?)`,
      args: [ADDRESS, new Date(), new Date()],
    }),
  );
  await assert.rejects(
    dbClient.execute({
      sql: `INSERT INTO tokenless_account_profiles
            (principal_address, preferred_theme, created_at, updated_at)
            VALUES (?, 'system', ?, ?)`,
      args: [ADDRESS, new Date(), new Date()],
    }),
  );

  const valid = await updateAccountProfile({
    principalAddress: ADDRESS,
    providerDisplayName: null,
    preferredLocale: "de",
    preferredTheme: "dark",
  });
  assert.equal(valid.preferredLocale, "de");
  assert.equal(valid.preferredTheme, "dark");
});

test("profile names are bounded", async () => {
  await assert.rejects(async () => {
    try {
      await updateAccountProfile({
        principalAddress: ADDRESS,
        providerDisplayName: null,
        displayName: "x".repeat(81),
      });
    } catch (error) {
      assert.ok(error instanceof TokenlessServiceError);
      assert.equal(error.field, "displayName");
      throw error;
    }
  }, /at most 80 characters/);
  await assert.rejects(async () => {
    try {
      await updateAccountProfile({
        principalAddress: ADDRESS,
        providerDisplayName: null,
        displayName: 42,
      });
    } catch (error) {
      assert.ok(error instanceof TokenlessServiceError);
      assert.equal(error.field, "displayName");
      throw error;
    }
  }, /must be text or empty/);
});
