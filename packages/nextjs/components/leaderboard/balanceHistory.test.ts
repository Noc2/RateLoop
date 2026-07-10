import { buildBalanceHistoryPoints, formatLrepBalance } from "./balanceHistoryData";
import assert from "node:assert/strict";
import test from "node:test";
import type { PonderTokenTransfer } from "~~/services/ponder/client";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

function transfer(params: {
  amount: bigint;
  blockNumber: bigint;
  from: string;
  id: string;
  timestamp: bigint;
  to: string;
}): PonderTokenTransfer {
  return {
    id: params.id,
    from: params.from,
    to: params.to,
    amount: params.amount.toString(),
    blockNumber: params.blockNumber.toString(),
    timestamp: params.timestamp.toString(),
  };
}

test("buildBalanceHistoryPoints anchors a bounded newest-transfer window to the live balance", () => {
  const transfers = [
    transfer({
      amount: 10_000_000n,
      blockNumber: 501n,
      from: OTHER,
      id: "receive-10",
      timestamp: 1_001n,
      to: ADDRESS,
    }),
    transfer({
      amount: 20_000_000n,
      blockNumber: 502n,
      from: ADDRESS,
      id: "send-20",
      timestamp: 1_002n,
      to: OTHER,
    }),
    transfer({
      amount: 5_000_000n,
      blockNumber: 503n,
      from: OTHER,
      id: "receive-5",
      timestamp: 1_003n,
      to: ADDRESS,
    }),
  ];

  assert.deepEqual(
    buildBalanceHistoryPoints({
      address: ADDRESS,
      currentBalanceRaw: 95_000_000n,
      transfers,
    }),
    [
      { timestamp: 1_001, balance: 110 },
      { timestamp: 1_002, balance: 90 },
      { timestamp: 1_003, balance: 95 },
    ],
  );
});

test("buildBalanceHistoryPoints keeps the final balance for transfers sharing a timestamp", () => {
  const transfers = [
    transfer({
      amount: 10_000_000n,
      blockNumber: 501n,
      from: OTHER,
      id: "receive",
      timestamp: 1_001n,
      to: ADDRESS,
    }),
    transfer({
      amount: 4_000_000n,
      blockNumber: 502n,
      from: ADDRESS,
      id: "send",
      timestamp: 1_001n,
      to: OTHER,
    }),
  ];

  assert.deepEqual(
    buildBalanceHistoryPoints({
      address: ADDRESS,
      currentBalanceRaw: 106_000_000n,
      transfers,
    }),
    [{ timestamp: 1_001, balance: 106 }],
  );
});

test("formatLrepBalance always reflects the live on-chain value", () => {
  assert.equal(formatLrepBalance(123_456_789n), 123.456789);
  assert.equal(formatLrepBalance(undefined), 0);
});
