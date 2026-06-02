import {
  getFallbackReputationAvatarDataUrl,
  getReputationAvatarStatsCacheKey,
  getReputationAvatarUrl,
} from "./profileImage";
import assert from "node:assert/strict";
import test from "node:test";

test("getReputationAvatarUrl returns null for invalid addresses", () => {
  assert.equal(getReputationAvatarUrl("not-an-address"), null);
});

test("getReputationAvatarUrl includes the selected chain id when provided", () => {
  assert.equal(
    getReputationAvatarUrl("0xc1CD80C7cD37b5499560C362b164cbA1CfF71b44", 96, "#ff5500", 480),
    "/api/reputation-avatar?address=0xc1cd80c7cd37b5499560c362b164cba1cff71b44&size=96&accent=ff5500&chainId=480",
  );
});

test("getReputationAvatarUrl includes a stats cache key when provided", () => {
  assert.equal(
    getReputationAvatarUrl("0xc1CD80C7cD37b5499560C362b164cbA1CfF71b44", 24, null, 480, "stats-2-1-1-5000"),
    "/api/reputation-avatar?address=0xc1cd80c7cd37b5499560c362b164cba1cff71b44&size=24&chainId=480&v=stats-2-1-1-5000",
  );
});

test("getReputationAvatarStatsCacheKey tracks settled vote accuracy", () => {
  assert.equal(
    getReputationAvatarStatsCacheKey({
      totalSettledVotes: 2,
      totalWins: 1,
      totalLosses: 1,
      currentStreak: -1,
      bestWinStreak: 1,
      winRate: 0.5,
    }),
    "stats-2-1-1-5000",
  );
  assert.equal(getReputationAvatarStatsCacheKey(null), null);
});

test("getFallbackReputationAvatarDataUrl returns an inline no-accuracy logo-ring svg", () => {
  const dataUrl = getFallbackReputationAvatarDataUrl("0xc1CD80C7cD37b5499560C362b164cbA1CfF71b44", 24);

  assert.ok(dataUrl);
  assert.match(dataUrl, /^data:image\/svg\+xml;charset=utf-8,/);

  const svg = decodeURIComponent(dataUrl!.split(",")[1] ?? "");
  assert.match(svg, /logo-ring-avatar-rail/);
  assert.doesNotMatch(svg, /logo-ring-avatar-progress/);
  assert.doesNotMatch(svg, /signal-disc-avatar/);
  assert.doesNotMatch(svg, /fill="#05070B"/);
  assert.doesNotMatch(svg, /orbital-avatar/);
});
