import { assertVoteWalletContext } from "./walletContext";
import assert from "node:assert/strict";
import test from "node:test";

const SNAPSHOT = {
  voterAddress: "0x1111111111111111111111111111111111111111" as const,
  chainId: 8453,
};

test("assertVoteWalletContext accepts matching address and chain", () => {
  assert.deepEqual(
    assertVoteWalletContext(SNAPSHOT, {
      address: "0x1111111111111111111111111111111111111111",
      chainId: 8453,
      targetChainId: 8453,
    }),
    { ok: true },
  );
});

test("assertVoteWalletContext accepts matching address with case differences", () => {
  assert.deepEqual(
    assertVoteWalletContext(SNAPSHOT, {
      address: "0x1111111111111111111111111111111111111111".toUpperCase(),
      chainId: 8453,
      targetChainId: 8453,
    }),
    { ok: true },
  );
});

test("assertVoteWalletContext rejects wallet address changes", () => {
  const result = assertVoteWalletContext(SNAPSHOT, {
    address: "0x2222222222222222222222222222222222222222",
    chainId: 8453,
    targetChainId: 8453,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /wallet changed/i);
  }
});

test("assertVoteWalletContext rejects missing address", () => {
  const result = assertVoteWalletContext(SNAPSHOT, {
    address: undefined,
    chainId: 8453,
    targetChainId: 8453,
  });

  assert.equal(result.ok, false);
});

test("assertVoteWalletContext rejects network changes", () => {
  const result = assertVoteWalletContext(SNAPSHOT, {
    address: "0x1111111111111111111111111111111111111111",
    chainId: 4801,
    targetChainId: 8453,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /network changed/i);
  }
});

test("assertVoteWalletContext falls back to targetChainId when chainId is missing", () => {
  assert.deepEqual(
    assertVoteWalletContext(SNAPSHOT, {
      address: "0x1111111111111111111111111111111111111111",
      chainId: undefined,
      targetChainId: 8453,
    }),
    { ok: true },
  );
});
