import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeScryptParams,
  resolveKeystorePath,
} from "./keystore";

test("resolveKeystorePath rejects traversal and nested names", () => {
  assert.throws(() => resolveKeystorePath("../keeper"), /Invalid keystore account name/);
  assert.throws(() => resolveKeystorePath("nested/keeper"), /Invalid keystore account name/);
  assert.throws(() => resolveKeystorePath("keeper profile"), /Invalid keystore account name/);

  assert.match(
    resolveKeystorePath("keeper-prod_1.json"),
    /\/\.foundry\/keystores\/keeper-prod_1\.json$/,
  );
});

test("assertSafeScryptParams accepts bounded Foundry-style costs", () => {
  assert.doesNotThrow(() =>
    assertSafeScryptParams({
      dklen: 32,
      n: 262_144,
      p: 1,
      r: 8,
    }),
  );
});

test("assertSafeScryptParams rejects expensive or malformed costs", () => {
  assert.throws(
    () =>
      assertSafeScryptParams({
        dklen: 32,
        n: 2 ** 24,
        p: 1,
        r: 8,
      }),
    /memory cost is too high/,
  );
  assert.throws(
    () =>
      assertSafeScryptParams({
        dklen: 32,
        n: 262_145,
        p: 1,
        r: 8,
      }),
    /power of two/,
  );
  assert.throws(
    () =>
      assertSafeScryptParams({
        dklen: 32,
        n: 262_144,
        p: 32,
        r: 8,
      }),
    /parallelization is too high/,
  );
  assert.throws(
    () =>
      assertSafeScryptParams({
        dklen: 1024,
        n: 262_144,
        p: 1,
        r: 8,
      }),
    /Invalid keystore scrypt parameters/,
  );
});

test("assertSafeScryptParams rejects dklen below the 32-byte V3 minimum", () => {
  for (const dklen of [16, 31]) {
    assert.throws(
      () =>
        assertSafeScryptParams({
          dklen,
          n: 262_144,
          p: 1,
          r: 8,
        }),
      /Invalid keystore scrypt parameters/,
    );
  }
});
