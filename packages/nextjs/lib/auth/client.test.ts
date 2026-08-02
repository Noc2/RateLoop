import {
  __resetBrowserSessionReadForTests,
  notifyBrowserAuthSessionChanged,
  readBrowserSession,
  subscribeToBrowserAuthSessionChanges,
} from "./client";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadAuthenticatedAccountPreferences } from "~~/components/tokenless/preferences/authenticatedAccountPreferences";
import { installTestDom } from "~~/components/tokenless/testing/dom";

const SESSION = {
  authenticated: true as const,
  principalId: "rlp_123456789012345678901234",
  authProvider: "better_auth:email_otp",
  displayName: "Reviewer",
  expiresAt: "2026-08-03T00:00:00.000Z",
  wallets: { funding: null, payout: null, recovery: null },
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => (resolve = done));
  return { promise, resolve };
}

test("concurrent session consumers share only the active browser request", async () => {
  __resetBrowserSessionReadForTests();
  const previousFetch = globalThis.fetch;
  const sessionGate = deferred();
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input);
    requests.push(url);
    if (url === "/api/auth/session") {
      await sessionGate.promise;
      return Response.json(SESSION);
    }
    if (url === "/api/account/profile") {
      return Response.json({ preferredLocale: "de", preferredTheme: "dark" });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const directRead = readBrowserSession();
    const preferenceRead = loadAuthenticatedAccountPreferences();
    assert.deepEqual(requests, ["/api/auth/session"]);

    sessionGate.resolve();
    assert.deepEqual(await directRead, SESSION);
    assert.deepEqual(await preferenceRead, { preferredLocale: "de", preferredTheme: "dark" });
    assert.deepEqual(requests, ["/api/auth/session", "/api/account/profile"]);
  } finally {
    globalThis.fetch = previousFetch;
    __resetBrowserSessionReadForTests();
  }
});

test("one caller aborting does not cancel another caller's shared session read", async () => {
  __resetBrowserSessionReadForTests();
  const previousFetch = globalThis.fetch;
  const sessionGate = deferred();
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    await sessionGate.promise;
    return Response.json(SESSION);
  };

  try {
    const controller = new AbortController();
    const abortedRead = readBrowserSession(controller.signal);
    const survivingRead = readBrowserSession();
    const aborted = assert.rejects(abortedRead, { name: "AbortError" });
    controller.abort();

    await aborted;
    assert.equal(requests, 1);
    sessionGate.resolve();
    assert.deepEqual(await survivingRead, SESSION);
  } finally {
    globalThis.fetch = previousFetch;
    __resetBrowserSessionReadForTests();
  }
});

test("auth invalidation replaces an in-flight read without letting the old completion clear the new one", async () => {
  const restoreDom = installTestDom();
  __resetBrowserSessionReadForTests();
  const previousFetch = globalThis.fetch;
  const gates = [deferred(), deferred(), deferred()];
  let requests = 0;
  globalThis.fetch = async () => {
    const requestIndex = requests++;
    await gates[requestIndex].promise;
    return Response.json(requestIndex === 0 ? { authenticated: false } : SESSION);
  };

  try {
    const oldRead = readBrowserSession();
    notifyBrowserAuthSessionChanged();
    const currentRead = readBrowserSession();
    assert.equal(requests, 2);

    gates[0].resolve();
    assert.equal(await oldRead, null);
    const concurrentCurrentRead = readBrowserSession();
    assert.equal(concurrentCurrentRead, currentRead);
    assert.equal(requests, 2);

    gates[1].resolve();
    assert.deepEqual(await currentRead, SESSION);
    assert.deepEqual(await concurrentCurrentRead, SESSION);

    const freshRead = readBrowserSession();
    assert.equal(requests, 3, "a completed identity is never retained as a session cache");
    gates[2].resolve();
    assert.deepEqual(await freshRead, SESSION);
  } finally {
    globalThis.fetch = previousFetch;
    __resetBrowserSessionReadForTests();
    restoreDom();
  }
});

test("one auth-change event invalidates before all subscribers share the replacement read", async () => {
  const restoreDom = installTestDom();
  __resetBrowserSessionReadForTests();
  const previousFetch = globalThis.fetch;
  const sessionGate = deferred();
  const reads: Array<Promise<unknown>> = [];
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    await sessionGate.promise;
    return Response.json(SESSION);
  };
  const unsubscribeFirst = subscribeToBrowserAuthSessionChanges(() => reads.push(readBrowserSession()));
  const unsubscribeSecond = subscribeToBrowserAuthSessionChanges(() => reads.push(readBrowserSession()));

  try {
    notifyBrowserAuthSessionChanged();
    assert.equal(reads.length, 2);
    assert.equal(requests, 1);
    sessionGate.resolve();
    await Promise.all(reads);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(reads.length, 2, "the local BroadcastChannel echo must not notify the same tab twice");
    assert.equal(requests, 1);
  } finally {
    unsubscribeFirst();
    unsubscribeSecond();
    globalThis.fetch = previousFetch;
    __resetBrowserSessionReadForTests();
    restoreDom();
  }
});

test("browser session consumers share the authenticated client boundary", () => {
  const consumers = [
    "../../components/thirdweb/ThirdwebSessionButton.tsx",
    "../../components/tokenless/TokenlessHandoffClient.tsx",
    "../../components/tokenless/answer/AnswerPageClient.tsx",
    "../../components/tokenless/human/HumanInboxBadge.tsx",
    "../../components/tokenless/preferences/authenticatedAccountPreferences.ts",
  ];

  for (const file of consumers) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /\breadBrowserSession\b/u, file);
    assert.doesNotMatch(source, /["'`]\/api\/auth\/session["'`]/u, file);
  }
});
