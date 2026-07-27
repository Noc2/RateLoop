import { HOSTED_AUTH_ENV, normalizeHostedAuthMailbox, readHostedAuthConfig } from "./config";
import assert from "node:assert/strict";
import test from "node:test";

function validEnvironment() {
  return {
    [HOSTED_AUTH_ENV.baseUrl]: "https://rateloop-tokenless.vercel.app",
    [HOSTED_AUTH_ENV.inboxProvider]: "resend",
    [HOSTED_AUTH_ENV.otpFromEmail]: "login@info.rateloop.ai",
    [HOSTED_AUTH_ENV.ownerEmail]: "owner@auth-harness.example",
    [HOSTED_AUTH_ENV.resendApiKey]: "re_receiving_test_key",
    [HOSTED_AUTH_ENV.reviewerOneEmail]: "reviewer-one@auth-harness.example",
    [HOSTED_AUTH_ENV.reviewerTwoEmail]: "reviewer-two@auth-harness.example",
  };
}

test("hosted auth config requires three exact mailboxes and isolated Vercel origin", () => {
  const config = readHostedAuthConfig(validEnvironment());

  assert.equal(config.baseUrl, "https://rateloop-tokenless.vercel.app");
  assert.deepEqual(
    Object.fromEntries(Object.entries(config.accounts).map(([role, account]) => [role, account.email])),
    {
      owner: "owner@auth-harness.example",
      reviewerOne: "reviewer-one@auth-harness.example",
      reviewerTwo: "reviewer-two@auth-harness.example",
    },
  );
  assert.equal(config.inbox.pollIntervalMs, 2_000);
  assert.equal(config.inbox.pollTimeoutMs, 90_000);
});

test("hosted auth config fails closed when any account mailbox is missing", () => {
  for (const name of [HOSTED_AUTH_ENV.ownerEmail, HOSTED_AUTH_ENV.reviewerOneEmail, HOSTED_AUTH_ENV.reviewerTwoEmail]) {
    const environment: Record<string, string | undefined> = validEnvironment();
    delete environment[name];
    assert.throws(() => readHostedAuthConfig(environment), new RegExp(`${name} is required`, "u"));
  }
});

test("hosted auth config rejects duplicate, plus-address, and Gmail dot aliases", () => {
  assert.throws(
    () =>
      readHostedAuthConfig({
        ...validEnvironment(),
        [HOSTED_AUTH_ENV.reviewerTwoEmail]: "OWNER@auth-harness.example",
      }),
    /must differ from TOKENLESS_E2E_OWNER_EMAIL/u,
  );
  assert.throws(
    () =>
      readHostedAuthConfig({
        ...validEnvironment(),
        [HOSTED_AUTH_ENV.reviewerOneEmail]: "reviewer+one@auth-harness.example",
      }),
    /dedicated mailbox, not a plus-address alias/u,
  );
  assert.throws(
    () =>
      readHostedAuthConfig({
        ...validEnvironment(),
        [HOSTED_AUTH_ENV.ownerEmail]: "owner.account@gmail.com",
        [HOSTED_AUTH_ENV.reviewerTwoEmail]: "owneraccount@googlemail.com",
      }),
    /must not alias TOKENLESS_E2E_OWNER_EMAIL/u,
  );
});

test("hosted auth config rejects legacy or preview origins and unsupported inbox providers", () => {
  for (const baseUrl of [
    "https://rateloop.ai",
    "https://rateloop-tokenless-preview.vercel.app",
    "http://localhost:3000",
  ]) {
    assert.throws(
      () => readHostedAuthConfig({ ...validEnvironment(), [HOSTED_AUTH_ENV.baseUrl]: baseUrl }),
      /must be exactly https:\/\/rateloop-tokenless\.vercel\.app/u,
    );
  }
  assert.throws(
    () => readHostedAuthConfig({ ...validEnvironment(), [HOSTED_AUTH_ENV.inboxProvider]: "imap" }),
    /must be exactly resend/u,
  );
});

test("mailbox normalization accepts only bare dedicated addresses", () => {
  assert.equal(normalizeHostedAuthMailbox(" Person@Example.COM "), "person@example.com");
  assert.throws(() => normalizeHostedAuthMailbox("Person <person@example.com>"), /bare email address/u);
  assert.throws(() => normalizeHostedAuthMailbox("person+ci@example.com"), /dedicated mailbox/u);
});
