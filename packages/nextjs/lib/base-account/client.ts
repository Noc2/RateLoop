import { type Address, type Hex, getAddress, numberToHex } from "viem";

const BASE_SEPOLIA_CHAIN_ID = 84_532;

export type BaseAccountProvider = {
  request(input: { method: string; params?: readonly unknown[] }): Promise<unknown>;
};

type WalletConnectResponse = {
  accounts?: Array<{
    address?: string;
    capabilities?: {
      signInWithEthereum?: { message?: string; signature?: string };
    };
  }>;
};

async function readJson(response: Response) {
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Base Account request failed.");
  return body;
}

export async function signInWithBaseAccount(provider: BaseAccountProvider): Promise<Address> {
  const nonceResponse = await fetch("/api/auth/nonce", { credentials: "same-origin", cache: "no-store" });
  const nonceBody = await readJson(nonceResponse);
  if (typeof nonceBody.nonce !== "string") throw new Error("RateLoop returned an invalid sign-in challenge.");

  const connection = (await provider.request({
    method: "wallet_connect",
    params: [
      {
        version: "1",
        capabilities: {
          signInWithEthereum: {
            nonce: nonceBody.nonce,
            chainId: numberToHex(BASE_SEPOLIA_CHAIN_ID),
          },
        },
      },
    ],
  })) as WalletConnectResponse;

  const account = connection.accounts?.[0];
  const authentication = account?.capabilities?.signInWithEthereum;
  if (
    !account?.address ||
    !authentication?.message ||
    !authentication.signature ||
    !/^0x[0-9a-fA-F]+$/.test(authentication.signature)
  ) {
    throw new Error("Base Account did not return a complete SIWE response.");
  }

  const address = getAddress(account.address);
  const verification = await fetch("/api/auth/verify", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address,
      message: authentication.message,
      signature: authentication.signature as Hex,
    }),
  });
  const verified = await readJson(verification);
  if (typeof verified.address !== "string" || getAddress(verified.address) !== address) {
    throw new Error("RateLoop returned a mismatched authenticated account.");
  }
  return address;
}

export async function signOutBaseAccountSession() {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
  });
  await readJson(response);
}

export async function readBaseAccountSession(): Promise<{ address: Address; expiresAt: string } | null> {
  const response = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
  const body = await readJson(response);
  if (body.authenticated !== true || typeof body.address !== "string" || typeof body.expiresAt !== "string")
    return null;
  return { address: getAddress(body.address), expiresAt: body.expiresAt };
}
