import { assertSignedCollectionWalletContext } from "./signedCollectionWalletContext";
import assert from "node:assert/strict";
import test from "node:test";

test("assertSignedCollectionWalletContext accepts matching addresses", () => {
  assert.deepEqual(
    assertSignedCollectionWalletContext(
      "0x1111111111111111111111111111111111111111",
      "0x1111111111111111111111111111111111111111",
    ),
    { ok: true },
  );
});

test("assertSignedCollectionWalletContext accepts case-insensitive matches", () => {
  assert.deepEqual(
    assertSignedCollectionWalletContext(
      "0xAbCdEf0000000000000000000000000000000000",
      "0xabcdef0000000000000000000000000000000000",
    ),
    { ok: true },
  );
});

test("assertSignedCollectionWalletContext rejects wallet changes", () => {
  assert.deepEqual(
    assertSignedCollectionWalletContext(
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
    ),
    { ok: false, reason: "wallet_changed" },
  );
});

test("assertSignedCollectionWalletContext rejects missing current address", () => {
  assert.deepEqual(assertSignedCollectionWalletContext("0x1111111111111111111111111111111111111111", undefined), {
    ok: false,
    reason: "wallet_changed",
  });
});
