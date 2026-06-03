import {
  buildWalletDisplaySummary,
  getWalletDisplayLiquidMicro,
  getWalletDisplaySummaryQueryKey,
  reconcileWalletDisplaySummary,
} from "./useWalletDisplaySummary";
import assert from "node:assert/strict";
import test from "node:test";

const MICRO = 1_000_000n;

test("buildWalletDisplaySummary initializes pending stake to zero", () => {
  const snapshot = buildWalletDisplaySummary(
    {
      liquidMicro: 700n * MICRO,
      votingStakedMicro: 300n * MICRO,
      submissionStakedMicro: 0n,
      frontendStakedMicro: 0n,
    },
    { updatedAt: 123 },
  );

  assert.equal(snapshot.pendingStakedMicro, 0n);
  assert.equal(snapshot.totalStakedMicro, 300n * MICRO);
  assert.equal(snapshot.totalMicro, 1000n * MICRO);
  assert.equal(snapshot.updatedAt, 123);
});

test("getWalletDisplaySummaryQueryKey partitions cache entries by chain", () => {
  const address = "0x00000000000000000000000000000000000000AA";

  assert.deepEqual(getWalletDisplaySummaryQueryKey(address, 480), [
    "wallet-display-summary",
    480,
    "0x00000000000000000000000000000000000000aa",
  ]);
  assert.notDeepEqual(getWalletDisplaySummaryQueryKey(address, 480), getWalletDisplaySummaryQueryKey(address, 31337));
});

test("reconcileWalletDisplaySummary treats an outgoing transfer as a fresh lower total", () => {
  const current = buildWalletDisplaySummary(
    {
      liquidMicro: 250n * MICRO,
      votingStakedMicro: 0n,
      submissionStakedMicro: 0n,
      frontendStakedMicro: 0n,
    },
    { updatedAt: 1_000 },
  );

  const raw = buildWalletDisplaySummary(
    {
      liquidMicro: 239n * MICRO,
      votingStakedMicro: 0n,
      submissionStakedMicro: 0n,
      frontendStakedMicro: 0n,
    },
    { updatedAt: 2_000 },
  );

  const reconciled = reconcileWalletDisplaySummary(current, raw, 2_500);
  assert.ok(reconciled);
  assert.equal(reconciled.liquidMicro, 239n * MICRO);
  assert.equal(reconciled.pendingStakedMicro, 0n);
  assert.equal(reconciled.totalStakedMicro, 0n);
  assert.equal(reconciled.totalMicro, 239n * MICRO);
});

test("reconcileWalletDisplaySummary does not turn a transfer into extra stake when stake already exists", () => {
  const current = buildWalletDisplaySummary(
    {
      liquidMicro: 850n * MICRO,
      votingStakedMicro: 150n * MICRO,
      submissionStakedMicro: 0n,
      frontendStakedMicro: 0n,
    },
    { updatedAt: 3_000 },
  );

  const raw = buildWalletDisplaySummary(
    {
      liquidMicro: 839n * MICRO,
      votingStakedMicro: 150n * MICRO,
      submissionStakedMicro: 0n,
      frontendStakedMicro: 0n,
    },
    { updatedAt: 4_000 },
  );

  const reconciled = reconcileWalletDisplaySummary(current, raw, 4_500);
  assert.ok(reconciled);
  assert.equal(reconciled.liquidMicro, 839n * MICRO);
  assert.equal(reconciled.pendingStakedMicro, 0n);
  assert.equal(reconciled.totalStakedMicro, 150n * MICRO);
  assert.equal(reconciled.totalMicro, 989n * MICRO);
});

test("reconcileWalletDisplaySummary keeps optimistic stake while indexed stake catches up", () => {
  const current = buildWalletDisplaySummary(
    {
      liquidMicro: 700n * MICRO,
      votingStakedMicro: 300n * MICRO,
      submissionStakedMicro: 0n,
      frontendStakedMicro: 0n,
    },
    { updatedAt: 5_000 },
  );

  const raw = buildWalletDisplaySummary(
    {
      liquidMicro: 700n * MICRO,
      votingStakedMicro: 150n * MICRO,
      submissionStakedMicro: 0n,
      frontendStakedMicro: 0n,
    },
    { updatedAt: 6_000 },
  );

  const reconciled = reconcileWalletDisplaySummary(current, raw, 6_500);
  assert.equal(reconciled, current);
});

test("reconcileWalletDisplaySummary clears pending stake once the fresh snapshot is coherent", () => {
  const current = buildWalletDisplaySummary(
    {
      liquidMicro: 700n * MICRO,
      votingStakedMicro: 150n * MICRO,
      submissionStakedMicro: 0n,
      frontendStakedMicro: 0n,
    },
    {
      pendingStakedMicro: 150n * MICRO,
      totalMicro: 1000n * MICRO,
      updatedAt: 3_000,
    },
  );

  const raw = buildWalletDisplaySummary(
    {
      liquidMicro: 700n * MICRO,
      votingStakedMicro: 300n * MICRO,
      submissionStakedMicro: 0n,
      frontendStakedMicro: 0n,
    },
    { updatedAt: 4_000 },
  );

  const reconciled = reconcileWalletDisplaySummary(current, raw, 4_100);
  assert.ok(reconciled);
  assert.equal(reconciled.pendingStakedMicro, 0n);
  assert.equal(reconciled.totalStakedMicro, 300n * MICRO);
  assert.equal(reconciled.totalMicro, 1000n * MICRO);
});

test("reconcileWalletDisplaySummary keeps the previous coherent snapshot when liquid rises before stake releases settle", () => {
  const current = buildWalletDisplaySummary(
    {
      liquidMicro: 700n * MICRO,
      votingStakedMicro: 300n * MICRO,
      submissionStakedMicro: 0n,
      frontendStakedMicro: 0n,
    },
    { updatedAt: 5_000 },
  );

  const raw = buildWalletDisplaySummary(
    {
      liquidMicro: 1000n * MICRO,
      votingStakedMicro: 300n * MICRO,
      submissionStakedMicro: 0n,
      frontendStakedMicro: 0n,
    },
    { updatedAt: 6_000 },
  );

  const reconciled = reconcileWalletDisplaySummary(current, raw, 6_100);
  assert.equal(reconciled, current);
});

test("reconcileWalletDisplaySummary keeps the previous coherent snapshot when stake rises before liquid catches up", () => {
  const current = buildWalletDisplaySummary(
    {
      liquidMicro: 900n * MICRO,
      votingStakedMicro: 100n * MICRO,
      submissionStakedMicro: 0n,
      frontendStakedMicro: 0n,
    },
    { updatedAt: 7_000 },
  );

  const raw = buildWalletDisplaySummary(
    {
      liquidMicro: 900n * MICRO,
      votingStakedMicro: 150n * MICRO,
      submissionStakedMicro: 0n,
      frontendStakedMicro: 0n,
    },
    { updatedAt: 8_000 },
  );

  const reconciled = reconcileWalletDisplaySummary(current, raw, 8_100);
  assert.equal(reconciled, current);
});

test("getWalletDisplayLiquidMicro prefers the reconciled snapshot over a raw balance", () => {
  const summary = buildWalletDisplaySummary(
    {
      liquidMicro: 850n * MICRO,
      votingStakedMicro: 150n * MICRO,
      submissionStakedMicro: 0n,
      frontendStakedMicro: 0n,
    },
    { updatedAt: 9_000 },
  );

  assert.equal(getWalletDisplayLiquidMicro(summary, 900n * MICRO), 850n * MICRO);
  assert.equal(getWalletDisplayLiquidMicro(null, 900n * MICRO), 900n * MICRO);
});
