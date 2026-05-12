import { and, eq, inArray, sql } from "ponder";
import { db } from "ponder:api";
import { raterFollow } from "ponder:schema";

export interface FollowStats {
  followerCount: number;
  followingCount: number;
}

export async function listActiveFollowedAddresses(follower: `0x${string}`) {
  const rows = await db
    .select({
      walletAddress: raterFollow.target,
    })
    .from(raterFollow)
    .where(and(eq(raterFollow.follower, follower), eq(raterFollow.active, true)));

  return rows.map((row) => row.walletAddress);
}

export async function getFollowStatsMap(addresses: readonly `0x${string}`[]) {
  const uniqueAddresses = [...new Set(addresses.map((address) => address.toLowerCase() as `0x${string}`))];
  const stats = new Map<`0x${string}`, FollowStats>();

  for (const address of uniqueAddresses) {
    stats.set(address, { followerCount: 0, followingCount: 0 });
  }

  if (uniqueAddresses.length === 0) {
    return stats;
  }

  const [followers, following] = await Promise.all([
    db
      .select({
        address: raterFollow.target,
        count: sql<number>`count(*)`,
      })
      .from(raterFollow)
      .where(and(eq(raterFollow.active, true), inArray(raterFollow.target, uniqueAddresses)))
      .groupBy(raterFollow.target),
    db
      .select({
        address: raterFollow.follower,
        count: sql<number>`count(*)`,
      })
      .from(raterFollow)
      .where(and(eq(raterFollow.active, true), inArray(raterFollow.follower, uniqueAddresses)))
      .groupBy(raterFollow.follower),
  ]);

  for (const row of followers) {
    const existing = stats.get(row.address as `0x${string}`) ?? { followerCount: 0, followingCount: 0 };
    existing.followerCount = Number(row.count ?? 0);
    stats.set(row.address as `0x${string}`, existing);
  }

  for (const row of following) {
    const existing = stats.get(row.address as `0x${string}`) ?? { followerCount: 0, followingCount: 0 };
    existing.followingCount = Number(row.count ?? 0);
    stats.set(row.address as `0x${string}`, existing);
  }

  return stats;
}
