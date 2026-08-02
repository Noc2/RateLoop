import { maskedEmailDestination, runBetterAuthAction, visibleSignInMethods } from "./BetterAuthSignIn";
import assert from "node:assert/strict";
import test from "node:test";

for (const family of ["email OTP", "passkey", "SSO", "social provider"]) {
  test(`${family} promise rejection reports an error and always releases the busy state`, async () => {
    const busy: boolean[] = [];
    const errors: Array<string | null> = [];

    await runBetterAuthAction({
      action: async () => {
        throw new Error(`${family} network unavailable`);
      },
      fallbackMessage: `${family} failed`,
      setBusy: value => busy.push(value),
      setError: value => errors.push(value),
    });

    assert.deepEqual(busy, [true, false]);
    assert.deepEqual(errors, [null, `${family} failed`]);
  });
}

test("email code destinations keep the domain recognizable without repeating the full address", () => {
  assert.equal(maskedEmailDestination("david@example.com"), "d••••@example.com");
  assert.equal(maskedEmailDestination("a@example.com"), "•@example.com");
  assert.equal(maskedEmailDestination("invalid"), "your email address");
});

test("sign-in renders only methods enabled by the server configuration", () => {
  const base = { emailOtp: false, passkey: false, google: false, apple: false, sso: false };

  assert.deepEqual(visibleSignInMethods({ ...base, passkey: true }), {
    emailForm: false,
    emailCode: false,
    passkey: true,
    google: false,
    apple: false,
    sso: false,
  });
  assert.deepEqual(visibleSignInMethods({ ...base, sso: true }), {
    emailForm: true,
    emailCode: false,
    passkey: false,
    google: false,
    apple: false,
    sso: true,
  });
  assert.deepEqual(visibleSignInMethods({ ...base, emailOtp: true, google: true, apple: true }), {
    emailForm: true,
    emailCode: true,
    passkey: false,
    google: true,
    apple: true,
    sso: false,
  });
});
