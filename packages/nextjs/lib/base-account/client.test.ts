import { signInWithBaseAccount } from "./client";
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

const address = "0x1111111111111111111111111111111111111111";
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("browser sign-in obtains a server nonce and returns only the server-verified account", async () => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ input: url, init });
    if (url === "/api/auth/nonce") {
      return Response.json({ nonce: "1234567890abcdef" });
    }
    return Response.json({ address });
  }) as typeof fetch;

  let walletRequest: { method: string; params?: readonly unknown[] } | undefined;
  const provider = {
    async request(input: { method: string; params?: readonly unknown[] }) {
      walletRequest = input;
      return {
        accounts: [
          {
            address,
            capabilities: { signInWithEthereum: { message: "signed message", signature: "0x11" } },
          },
        ],
      };
    },
  };

  assert.equal(await signInWithBaseAccount(provider), address);
  assert.deepEqual(walletRequest, {
    method: "wallet_connect",
    params: [
      {
        version: "1",
        capabilities: { signInWithEthereum: { nonce: "1234567890abcdef", chainId: "0x14a34" } },
      },
    ],
  });
  assert.equal(requests[0]?.input, "/api/auth/nonce");
  assert.equal(requests[1]?.input, "/api/auth/verify");
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    address,
    message: "signed message",
    signature: "0x11",
  });
});
