import { runBetterAuthAction } from "./BetterAuthSignIn";
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
    assert.deepEqual(errors, [null, `${family} network unavailable`]);
  });
}
