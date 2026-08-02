import { loadAuthenticatedAccountPreferences } from "./AccountPreferenceHydrator";
import assert from "node:assert/strict";
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
