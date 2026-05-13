import { CURYO_E2E_WORLD_ID_MOCK_STORAGE_KEY, type LocalE2EWorldIdMock } from "../../lib/world-id/e2eMock";
import { E2E_RPC_URL } from "./service-urls";
import type { Page } from "@playwright/test";
import type { IDKitResult, RpContext } from "@worldcoin/idkit";
import { hashSignal } from "@worldcoin/idkit/hashing";
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, stringToHex } from "viem";

const WORLD_ID_E2E_ACTION = "rateloop-e2e-human-credential";
const WORLD_ID_E2E_APP_ID = "app_rateloop_e2e_mock";
const WORLD_ID_E2E_RP_CONTEXT = {
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  nonce: "rateloop-e2e-request",
  rp_id: WORLD_ID_E2E_APP_ID,
} as unknown as RpContext;

function makeE2EWorldIdResult(address: string): IDKitResult {
  const signal = address.toLowerCase();
  const nullifier = keccak256(stringToHex(`rateloop-world-id-e2e:${signal}`));

  return {
    action: WORLD_ID_E2E_ACTION,
    environment: "staging",
    nonce: "rateloop-e2e",
    protocol_version: "3.0",
    responses: [
      {
        identifier: "orb",
        merkle_root: "0x2a",
        nullifier,
        proof: encodeAbiParameters([{ type: "uint256[8]" }], [[1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n]]),
        signal_hash: hashSignal(signal),
      },
    ],
  };
}

export async function installLocalE2EWorldIdMock(page: Page, address: string): Promise<void> {
  const mock: LocalE2EWorldIdMock = {
    action: WORLD_ID_E2E_ACTION,
    appId: WORLD_ID_E2E_APP_ID,
    connectorURI: "worldcoin://rateloop-e2e/request",
    environment: "staging",
    result: makeE2EWorldIdResult(address),
    rpContext: WORLD_ID_E2E_RP_CONTEXT,
  };

  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    {
      key: CURYO_E2E_WORLD_ID_MOCK_STORAGE_KEY,
      value: JSON.stringify(mock),
    },
  );

  if (page.url() !== "about:blank") {
    await page.evaluate(
      ({ key, value }) => {
        window.localStorage.setItem(key, value);
      },
      {
        key: CURYO_E2E_WORLD_ID_MOCK_STORAGE_KEY,
        value: JSON.stringify(mock),
      },
    );
  }
}

export async function readActiveHumanCredential(address: string, contractAddress: string): Promise<boolean> {
  const abi = [
    {
      name: "hasActiveHumanCredential",
      type: "function",
      inputs: [{ name: "rater", type: "address" }],
      outputs: [{ name: "", type: "bool" }],
      stateMutability: "view",
    },
  ] as const;
  const data = encodeFunctionData({ abi, functionName: "hasActiveHumanCredential", args: [address as `0x${string}`] });
  const response = await fetch(E2E_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_call",
      params: [{ to: contractAddress, data }, "latest"],
      id: Date.now(),
    }),
  });
  const json = await response.json();
  if (json.error || !json.result) {
    return false;
  }

  return decodeFunctionResult({ abi, functionName: "hasActiveHumanCredential", data: json.result }) as boolean;
}
