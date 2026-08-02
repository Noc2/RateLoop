import {
  loadAuthenticatedAccountPreferences,
  persistAuthenticatedAccountPreference,
} from "./authenticatedAccountPreferences";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const preferences = {
  preferredLocale: "de",
  preferredTheme: "dark",
};

test("signed-out preference hydration never requests the protected profile", async () => {
  const requests: string[] = [];
  const fetcher: typeof fetch = async input => {
    requests.push(String(input));
    return Response.json({ authenticated: false });
  };

  assert.equal(await loadAuthenticatedAccountPreferences({ fetcher }), null);
  assert.deepEqual(requests, ["/api/auth/session"]);
});

test("authenticated preference hydration loads the profile after the session", async () => {
  const requests: string[] = [];
  const fetcher: typeof fetch = async input => {
    const url = String(input);
    requests.push(url);
    if (url === "/api/auth/session") return Response.json({ authenticated: true });
    if (url === "/api/account/profile") return Response.json(preferences);
    throw new Error(`Unexpected request: ${url}`);
  };

  assert.deepEqual(await loadAuthenticatedAccountPreferences({ fetcher }), preferences);
  assert.deepEqual(requests, ["/api/auth/session", "/api/account/profile"]);
});

test("preference hydration fails closed when the session response is unavailable", async () => {
  const requests: string[] = [];
  const fetcher: typeof fetch = async input => {
    requests.push(String(input));
    return Response.json({ error: "unavailable" }, { status: 503 });
  };

  assert.equal(await loadAuthenticatedAccountPreferences({ fetcher }), null);
  assert.deepEqual(requests, ["/api/auth/session"]);
});

test("signed-out preference changes remain local and never PATCH the protected profile", async () => {
  const requests: Array<{ method: string; url: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ method: init?.method ?? "GET", url: String(input) });
    return Response.json({ authenticated: false });
  };

  assert.equal(await persistAuthenticatedAccountPreference({ preferredTheme: "dark" }, { fetcher }), false);
  assert.deepEqual(requests, [{ method: "GET", url: "/api/auth/session" }]);
});

test("authenticated preference changes PATCH only after session confirmation", async () => {
  const requests: Array<{ body?: string; method: string; url: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = {
      body: typeof init?.body === "string" ? init.body : undefined,
      method: init?.method ?? "GET",
      url: String(input),
    };
    requests.push(request);
    if (request.url === "/api/auth/session") return Response.json({ authenticated: true });
    if (request.url === "/api/account/profile") return Response.json({ ok: true });
    throw new Error(`Unexpected request: ${request.url}`);
  };

  assert.equal(await persistAuthenticatedAccountPreference({ preferredLocale: "de" }, { fetcher }), true);
  assert.deepEqual(requests, [
    { body: undefined, method: "GET", url: "/api/auth/session" },
    { body: JSON.stringify({ preferredLocale: "de" }), method: "PATCH", url: "/api/account/profile" },
  ]);
});

test("global preference controls share auth-gated persistence", () => {
  for (const file of ["LocaleToggle.tsx", "ThemeToggle.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /persistAuthenticatedAccountPreference/u, file);
    assert.doesNotMatch(source, /fetch\("\/api\/account\/profile"/u, file);
  }
});
