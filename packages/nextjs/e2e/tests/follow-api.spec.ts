import "../helpers/fetch-shim";
import { E2E_BASE_URL } from "../helpers/service-urls";
import { expect, test } from "@playwright/test";

const BASE_URL = E2E_BASE_URL;
const TEST_ADDRESS = "0x63cada40e8acf7a1d47229af5be35b78b16035fa";

test.describe("Profile follow API routes", () => {
  test("follow session and challenge endpoints are retired", async () => {
    const sessionResponse = await fetch(`${BASE_URL}/api/follows/profiles/session?address=${TEST_ADDRESS}`);
    expect(sessionResponse.status).toBe(410);
    await expect(sessionResponse.json()).resolves.toMatchObject({
      error: "Profile follows are public and no longer use signed read or write sessions.",
      hasSession: false,
      hasReadSession: false,
      hasWriteSession: false,
    });

    const challengeResponse = await fetch(`${BASE_URL}/api/follows/profiles/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: TEST_ADDRESS, targetAddress: TEST_ADDRESS, action: "follow" }),
    });
    expect(challengeResponse.status).toBe(410);
    await expect(challengeResponse.json()).resolves.toMatchObject({
      error: "Profile follows are public and on-chain, so signed follow challenges are no longer issued.",
    });
  });

  test("public follow reads no longer require a signed session", async () => {
    const invalidResponse = await fetch(`${BASE_URL}/api/follows/profiles?address=not-an-address`);
    expect(invalidResponse.status).toBe(400);

    const response = await fetch(`${BASE_URL}/api/follows/profiles?address=${TEST_ADDRESS}`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.count).toBe("number");
    expect(typeof body.followerCount).toBe("number");
    expect(typeof body.followingCount).toBe("number");
  });

  test("follow mutations are retired in favor of on-chain writes", async () => {
    for (const method of ["POST", "PUT", "DELETE"] as const) {
      const response = await fetch(`${BASE_URL}/api/follows/profiles`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: TEST_ADDRESS,
          targetAddress: "0x1111111111111111111111111111111111111111",
        }),
      });

      expect(response.status).toBe(410);
      await expect(response.json()).resolves.toMatchObject({
        error:
          "Profile follows are public and on-chain. Read them here and submit follow transactions through RaterRegistry.",
      });
    }
  });
});
