import assert from "node:assert/strict";
import test from "node:test";
import type { ReputationAvatarPayload } from "~~/lib/avatar/avatarPayload";
import { buildLogoRingAvatarModel, renderLogoRingAvatarSvg } from "~~/lib/avatar/logoRingAvatar";
import { buildSignalDiscAvatarModel, renderSignalDiscAvatarSvg } from "~~/lib/avatar/signalDiscAvatar";

const NOW_SECONDS = 1_900_000_000;

function secondsAgo(days: number) {
  return String(NOW_SECONDS - days * 24 * 60 * 60);
}

function buildPayload(overrides?: Partial<ReputationAvatarPayload>): ReputationAvatarPayload {
  return {
    address: "0x1111111111111111111111111111111111111111",
    balance: "250000000",
    avatarAccentHex: null,
    voterId: {
      tokenId: "1",
      mintedAt: "1700000000",
    },
    stats: {
      totalSettledVotes: 24,
      totalWins: 16,
      totalLosses: 8,
      currentStreak: 3,
      bestWinStreak: 6,
      winRate: 16 / 24,
    },
    streak: {
      currentDailyStreak: 5,
      bestDailyStreak: 8,
      totalActiveDays: 12,
      lastActiveDate: "2026-03-14",
      lastMilestoneDay: 7,
    },
    categories90d: [
      {
        categoryId: "1",
        categoryName: "Alpha",
        settledVotes90d: 12,
        wins90d: 9,
        losses90d: 3,
        stakeWon90d: "120000000",
        stakeLost90d: "30000000",
        totalStake90d: "150000000",
        winRate90d: 0.75,
        lastSettledAt: secondsAgo(4),
      },
    ],
    ...overrides,
  };
}

test("logo-ring avatars vary the ring gradient by address", () => {
  const modelA = buildLogoRingAvatarModel(buildPayload({ address: "0x0000000000000000000000000000000000ff3300" }), {
    nowSeconds: NOW_SECONDS,
  });
  const modelB = buildLogoRingAvatarModel(buildPayload({ address: "0x00000000000000000000000000000000003366ff" }), {
    nowSeconds: NOW_SECONDS,
  });

  assert.notDeepEqual(modelA.ring.gradientStops, modelB.ring.gradientStops);
  assert.notEqual(modelA.ring.gradientAngleDegrees, modelB.ring.gradientAngleDegrees);
  assert.equal(modelA.progress?.startDegrees, -90);
  assert.equal(modelB.progress?.startDegrees, -90);
});

test("avatar accent override changes the ring gradient", () => {
  const base = buildLogoRingAvatarModel(buildPayload(), {
    nowSeconds: NOW_SECONDS,
  });
  const custom = buildLogoRingAvatarModel(
    buildPayload({
      avatarAccentHex: "#00ccff",
    }),
    {
      nowSeconds: NOW_SECONDS,
    },
  );

  assert.notDeepEqual(base.ring.gradientStops, custom.ring.gradientStops);
  assert.match(custom.ring.gradientId, /logo-ring-avatar-gradient-00ccff/);
  assert.equal(custom.ring.gradientStops[0]?.offset, "0%");
  assert.equal(custom.ring.gradientStops.at(-1)?.offset, "100%");
});

test("same avatar accent keeps the same ring gradient across addresses", () => {
  const modelA = buildLogoRingAvatarModel(
    buildPayload({
      address: "0x0000000000000000000000000000000000111111",
      avatarAccentHex: "#359eee",
    }),
    {
      nowSeconds: NOW_SECONDS,
    },
  );
  const modelB = buildLogoRingAvatarModel(
    buildPayload({
      address: "0x0000000000000000000000000000000000222222",
      avatarAccentHex: "#359eee",
    }),
    {
      nowSeconds: NOW_SECONDS,
    },
  );

  assert.deepEqual(modelA.ring.gradientStops, modelB.ring.gradientStops);
  assert.equal(modelA.ring.gradientAngleDegrees, modelB.ring.gradientAngleDegrees);
});

test("logo-ring geometry stays fixed across LREP balances", () => {
  const lowBalance = buildLogoRingAvatarModel(
    buildPayload({
      balance: "10000000",
    }),
    { nowSeconds: NOW_SECONDS },
  );
  const highBalance = buildLogoRingAvatarModel(
    buildPayload({
      balance: "1000000000000",
    }),
    { nowSeconds: NOW_SECONDS },
  );

  assert.equal(lowBalance.ring.radius, highBalance.ring.radius);
  assert.equal(lowBalance.ring.width, highBalance.ring.width);
  assert.equal(lowBalance.outerRadius, highBalance.outerRadius);
});

test("logo ring stays inside the square crop", () => {
  const model = buildLogoRingAvatarModel(
    buildPayload({
      balance: "1000000000000",
      stats: {
        totalSettledVotes: 80,
        totalWins: 80,
        totalLosses: 0,
        currentStreak: 10,
        bestWinStreak: 10,
        winRate: 1,
      },
    }),
    { nowSeconds: NOW_SECONDS },
  );

  assert.ok(model.progress);
  assert.ok(model.outerRadius < 256);
  assert.ok(model.ring.radius + model.ring.width / 2 < 256);
  assert.equal(model.progress.radius, model.ring.radius);
  assert.equal(model.progress.width, model.ring.width);
});

test("accuracy directly controls gradient ring coverage", () => {
  const half = buildLogoRingAvatarModel(
    buildPayload({
      stats: {
        totalSettledVotes: 48,
        totalWins: 24,
        totalLosses: 24,
        currentStreak: 1,
        bestWinStreak: 3,
        winRate: 0.5,
      },
    }),
    { nowSeconds: NOW_SECONDS },
  );
  const full = buildLogoRingAvatarModel(
    buildPayload({
      stats: {
        totalSettledVotes: 48,
        totalWins: 48,
        totalLosses: 0,
        currentStreak: 6,
        bestWinStreak: 10,
        winRate: 1,
      },
    }),
    { nowSeconds: NOW_SECONDS },
  );

  assert.ok(half.progress);
  assert.ok(full.progress);
  assert.equal(half.progress.sweepDegrees, 180);
  assert.equal(half.progress.startDegrees, -90);
  assert.equal(full.progress.sweepDegrees, 360);
  assert.equal(full.progress.startDegrees, -90);
});

test("settled vote count does not change ring length or strength", () => {
  const lowCount = buildLogoRingAvatarModel(
    buildPayload({
      stats: {
        totalSettledVotes: 2,
        totalWins: 1,
        totalLosses: 1,
        currentStreak: 0,
        bestWinStreak: 1,
        winRate: 0.5,
      },
    }),
    { nowSeconds: NOW_SECONDS },
  );
  const highCount = buildLogoRingAvatarModel(
    buildPayload({
      stats: {
        totalSettledVotes: 60,
        totalWins: 30,
        totalLosses: 30,
        currentStreak: 0,
        bestWinStreak: 4,
        winRate: 0.5,
      },
    }),
    { nowSeconds: NOW_SECONDS },
  );

  assert.ok(lowCount.progress);
  assert.ok(highCount.progress);
  assert.equal(lowCount.progress.sweepDegrees, highCount.progress.sweepDegrees);
  assert.equal(lowCount.progress.width, highCount.progress.width);
});

test("renderer draws partial accuracy as a smooth gradient path", () => {
  const svg = renderLogoRingAvatarSvg(buildPayload(), {
    size: 96,
    nowSeconds: NOW_SECONDS,
  });

  assert.match(svg, /<linearGradient id="logo-ring-avatar-gradient-[0-9a-f]{6}"/);
  assert.match(svg, /<circle class="logo-ring-avatar-rail"/);
  assert.match(svg, /<path class="logo-ring-avatar-progress" d="M [^"]+A [^"]+"/);
  assert.match(svg, /stroke="url\(#logo-ring-avatar-gradient-[0-9a-f]{6}\)"/);
  assert.doesNotMatch(svg, /signal-disc-avatar/);
  assert.doesNotMatch(svg, /orbital-avatar/);
  assert.doesNotMatch(svg, /flare/);
  assert.doesNotMatch(svg, /fold/);
  assert.doesNotMatch(svg, /stroke="#FFFFFF"[^>]+logo-ring-avatar-progress/);
});

test("renderer draws 100% accuracy as a full gradient circle", () => {
  const svg = renderLogoRingAvatarSvg(
    buildPayload({
      stats: {
        totalSettledVotes: 48,
        totalWins: 48,
        totalLosses: 0,
        currentStreak: 6,
        bestWinStreak: 10,
        winRate: 1,
      },
    }),
    { nowSeconds: NOW_SECONDS, size: 96 },
  );

  assert.match(
    svg,
    /<circle class="logo-ring-avatar-progress"[^>]+stroke="url\(#logo-ring-avatar-gradient-[0-9a-f]{6}\)"/,
  );
  assert.doesNotMatch(svg, /<path class="logo-ring-avatar-progress"/);
});

test("accuracy of zero leaves only the faint rail", () => {
  const model = buildLogoRingAvatarModel(
    buildPayload({
      stats: {
        totalSettledVotes: 48,
        totalWins: 0,
        totalLosses: 48,
        currentStreak: 0,
        bestWinStreak: 0,
        winRate: 0,
      },
    }),
    { nowSeconds: NOW_SECONDS },
  );
  const svg = renderLogoRingAvatarSvg(
    buildPayload({
      stats: {
        totalSettledVotes: 48,
        totalWins: 0,
        totalLosses: 48,
        currentStreak: 0,
        bestWinStreak: 0,
        winRate: 0,
      },
    }),
    { nowSeconds: NOW_SECONDS },
  );

  assert.equal(model.progress, null);
  assert.match(svg, /logo-ring-avatar-rail/);
  assert.doesNotMatch(svg, /logo-ring-avatar-progress/);
});

test("unclaimed wallets still render an address-colored rail without active accuracy", () => {
  const model = buildLogoRingAvatarModel(
    buildPayload({
      voterId: null,
      stats: null,
      categories90d: [],
      balance: "0",
    }),
    { nowSeconds: NOW_SECONDS },
  );

  assert.ok(model.ring.gradientStops.length >= 5);
  assert.equal(model.progress, null);
});

test("renderer returns svg markup for the no-accuracy fallback", () => {
  const svg = renderLogoRingAvatarSvg(
    buildPayload({
      voterId: null,
      stats: null,
      categories90d: [],
      balance: "0",
    }),
    { nowSeconds: NOW_SECONDS, size: 64 },
  );

  assert.match(svg, /logo-ring-avatar-rail/);
  assert.doesNotMatch(svg, /logo-ring-avatar-progress/);
  assert.doesNotMatch(svg, /signal-disc-avatar/);
  assert.doesNotMatch(svg, /fill="#05070B"/);
});

test("renderer returns svg markup for the logo-ring avatar", () => {
  const svg = renderLogoRingAvatarSvg(buildPayload(), { nowSeconds: NOW_SECONDS, size: 64 });

  assert.match(svg, /logo-ring-avatar-rail/);
  assert.match(svg, /logo-ring-avatar-progress/);
  assert.match(svg, /<svg[^>]+width="64"/);
  assert.doesNotMatch(svg, /signal-disc-avatar/);
  assert.doesNotMatch(svg, /fill="#05070B"/);
});

test("legacy signal-disc exports render the logo-ring avatar", () => {
  const model = buildSignalDiscAvatarModel(buildPayload(), { nowSeconds: NOW_SECONDS });
  const svg = renderSignalDiscAvatarSvg(buildPayload(), { nowSeconds: NOW_SECONDS, size: 64 });

  assert.ok(model.progress);
  assert.match(svg, /logo-ring-avatar-progress/);
  assert.doesNotMatch(svg, /signal-disc-avatar/);
});
