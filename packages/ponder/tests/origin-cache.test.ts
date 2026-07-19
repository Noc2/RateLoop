import { describe, expect, it } from "vitest";
import { createOriginTtlCache } from "../src/origin-cache";

describe("origin TTL cache", () => {
  it("coalesces concurrent cache-busting requests and caches the aggregate", async () => {
    let now = 1_000;
    let loads = 0;
    const cache = createOriginTtlCache<number>({
      ttlMs: 60_000,
      now: () => now,
    });
    const load = async () => {
      loads += 1;
      await Promise.resolve();
      return loads;
    };

    await expect(
      Promise.all(Array.from({ length: 20 }, () => cache.get(load))),
    ).resolves.toEqual(Array(20).fill(1));
    expect(loads).toBe(1);

    now += 59_999;
    await expect(cache.get(load)).resolves.toBe(1);
    expect(loads).toBe(1);

    now += 2;
    await expect(cache.get(load)).resolves.toBe(2);
    expect(loads).toBe(2);
  });

  it("does not cache loader failures", async () => {
    const cache = createOriginTtlCache<number>({ ttlMs: 1_000 });
    let loads = 0;
    const load = async () => {
      loads += 1;
      if (loads === 1) throw new Error("database unavailable");
      return 2;
    };

    await expect(cache.get(load)).rejects.toThrow("database unavailable");
    await expect(cache.get(load)).resolves.toBe(2);
    expect(loads).toBe(2);
  });
});
