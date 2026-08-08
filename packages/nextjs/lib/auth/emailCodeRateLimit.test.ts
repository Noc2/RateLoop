import { consumeEmailCodeRateLimit } from "./emailCodeRateLimit";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SECRET = "x".repeat(32);

function stubClient(rows: { request_count: number }[]) {
  const calls: { args: unknown[]; sql: string }[] = [];
  return {
    calls,
    execute: async (query: { args: unknown[]; sql: string }) => {
      calls.push(query);
      return { rows: [rows[calls.length - 1] ?? rows.at(-1)] };
    },
  } as never;
}

/** Must await `run` before restoring: the limiter reads the variable lazily, so a
 *  synchronous finally would put it back before the call under test looked. */
async function withSecret<T>(value: string | undefined, run: () => Promise<T>) {
  const previous = process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET;
  if (value === undefined) delete process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET;
  else process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET;
    else process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET = previous;
  }
}

test("an address is capped once it has had ten codes in the hour", async () => {
  const now = new Date("2026-08-08T10:17:00.000Z");
  await withSecret(SECRET, async () => {
    const tenth = await consumeEmailCodeRateLimit("person@example.com", now, stubClient([{ request_count: 10 }]));
    assert.equal(tenth.allowed, true, "the tenth code is still sent");

    const eleventh = await consumeEmailCodeRateLimit("person@example.com", now, stubClient([{ request_count: 11 }]));
    assert.equal(eleventh.allowed, false);
    // Until the top of the next hour: 10:17 → 11:00 is 43 minutes.
    assert.equal(eleventh.retryAfterSeconds, 43 * 60);
  });
});

test("the address is keyed by its normalised form and never stored in plain text", async () => {
  const now = new Date("2026-08-08T10:00:00.000Z");
  await withSecret(SECRET, async () => {
    const keyFor = async (email: string) => {
      const client = stubClient([{ request_count: 1 }]);
      await consumeEmailCodeRateLimit(email, now, client);
      return (client as unknown as { calls: { args: unknown[] }[] }).calls[0]!.args[0] as string;
    };
    const canonical = await keyFor("Person@Example.com");
    assert.equal(canonical, await keyFor("  person@example.com  "), "case and padding must not open a second budget");
    assert.notEqual(canonical, await keyFor("someone-else@example.com"));
    assert.match(canonical, /^[\da-f]{64}$/u, "the stored key is an HMAC digest");
    assert.doesNotMatch(canonical, /example\.com/u, "the address itself must never reach the table");
  });
});

test("the limiter fails open, because a lost control must not become a sign-in outage", async () => {
  const now = new Date("2026-08-08T10:00:00.000Z");
  // No secret configured — the value is blank in .env.example, so this is the
  // state a fresh deployment is in.
  const withoutSecret = await withSecret(undefined, () =>
    consumeEmailCodeRateLimit("person@example.com", now, stubClient([{ request_count: 99 }])),
  );
  assert.equal(withoutSecret.allowed, true);

  // Too short to be a credible secret.
  const shortSecret = await withSecret("tooshort", () =>
    consumeEmailCodeRateLimit("person@example.com", now, stubClient([{ request_count: 99 }])),
  );
  assert.equal(shortSecret.allowed, true);

  // Database unavailable.
  const brokenClient = {
    execute: async () => {
      throw new Error("connection terminated");
    },
  } as never;
  const onDatabaseFailure = await withSecret(SECRET, () =>
    consumeEmailCodeRateLimit("person@example.com", now, brokenClient),
  );
  assert.equal(onDatabaseFailure.allowed, true);
});

test("only the send path is capped, and it answers 429 with Retry-After", () => {
  // Capping /sign-in/email-otp too would let an attacker lock a victim out by
  // burning their budget on verification attempts, which sends no mail at all.
  const route = readFileSync(new URL("../../app/api/auth/better/[...all]/route.ts", import.meta.url), "utf8");
  assert.match(
    route,
    /relativePath === "\/email-otp\/send-verification-otp"\) \{\s*const limit = await consumeEmailCodeRateLimit/u,
  );
  assert.match(route, /status: 429/u);
  assert.match(route, /"Retry-After": String\(limit\.retryAfterSeconds\)/u);
});
