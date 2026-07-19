export function createOriginTtlCache<T>(params: {
  ttlMs: number;
  now?: () => number;
}) {
  if (!Number.isSafeInteger(params.ttlMs) || params.ttlMs <= 0) {
    throw new Error("Origin cache ttlMs must be a positive integer.");
  }
  const now = params.now ?? Date.now;
  let cached: { expiresAt: number; value: T } | undefined;
  let inFlight: Promise<T> | undefined;

  return {
    async get(load: () => Promise<T>) {
      if (cached && cached.expiresAt > now()) return cached.value;
      if (inFlight) return inFlight;
      inFlight = load()
        .then((value) => {
          cached = { expiresAt: now() + params.ttlMs, value };
          return value;
        })
        .finally(() => {
          inFlight = undefined;
        });
      return inFlight;
    },
  };
}
