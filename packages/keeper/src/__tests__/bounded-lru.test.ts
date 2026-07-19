import { describe, expect, it } from "vitest";
import { BoundedLruMap } from "../bounded-lru.js";

describe("BoundedLruMap", () => {
  it("caps long-lived reveal state and evicts the least recently used entry", () => {
    const cache = new BoundedLruMap<string, number>(3);
    cache.set("round-1", 1);
    cache.set("round-2", 2);
    cache.set("round-3", 3);
    expect(cache.get("round-1")).toBe(1);

    cache.set("round-4", 4);

    expect(cache.size).toBe(3);
    expect(cache.get("round-2")).toBeUndefined();
    expect(cache.get("round-1")).toBe(1);
    expect(cache.get("round-4")).toBe(4);
  });
});
