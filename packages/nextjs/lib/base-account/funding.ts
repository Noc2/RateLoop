import { TokenlessPanelAbi } from "@rateloop/contracts/tokenless";
import { type Address, type EIP1193Provider, type Hex, encodeFunctionData, getAddress, numberToHex } from "viem";

const BASE_SEPOLIA_CHAIN_ID = 84_532;
const UINT256_MAX = 2n ** 256n - 1n;

const approveAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export type TokenlessRoundTerms = {
  contentId: Hex;
  termsHash: Hex;
  beaconNetworkHash: Hex;
  bountyAmount: bigint;
  feeAmount: bigint;
  attemptReserve: bigint;
  attemptCompensation: bigint;
  minimumReveals: number;
  maximumCommits: number;
  admissionPolicyHash: Hex;
  commitDeadline: bigint;
  revealDeadline: bigint;
  beaconFailureDeadline: bigint;
  beaconRound: bigint;
  scoringBeaconRound: bigint;
  claimGracePeriod: bigint;
  feeRecipient: Address;
};

export type WalletCall = { to: Address; value: Hex; data: Hex };

function checkedRoundTotal(terms: TokenlessRoundTerms) {
  for (const amount of [terms.bountyAmount, terms.feeAmount, terms.attemptReserve]) {
    if (amount < 0n) throw new Error("Round amounts cannot be negative.");
  }
  const total = terms.bountyAmount + terms.feeAmount + terms.attemptReserve;
  if (total <= 0n || total > UINT256_MAX) throw new Error("Round total is outside uint256 bounds.");
  return total;
}

export function prepareTokenlessRoundCalls(input: {
  panelAddress: Address;
  usdcAddress: Address;
  terms: TokenlessRoundTerms;
}): { calls: [WalletCall, WalletCall]; total: bigint } {
  const panelAddress = getAddress(input.panelAddress);
  const usdcAddress = getAddress(input.usdcAddress);
  const feeRecipient = getAddress(input.terms.feeRecipient);
  const total = checkedRoundTotal(input.terms);
  const terms = { ...input.terms, feeRecipient };

  return {
    total,
    calls: [
      {
        to: usdcAddress,
        value: "0x0",
        data: encodeFunctionData({ abi: approveAbi, functionName: "approve", args: [panelAddress, total] }),
      },
      {
        to: panelAddress,
        value: "0x0",
        data: encodeFunctionData({ abi: TokenlessPanelAbi, functionName: "createRound", args: [terms] }),
      },
    ],
  };
}

export async function sendTokenlessRoundCalls(input: {
  provider: EIP1193Provider;
  funder: Address;
  panelAddress: Address;
  usdcAddress: Address;
  terms: TokenlessRoundTerms;
  paymasterUrl?: string;
}) {
  const funder = getAddress(input.funder);
  const { calls, total } = prepareTokenlessRoundCalls(input);
  const capabilities = input.paymasterUrl
    ? { paymasterService: { url: new URL(input.paymasterUrl).toString() } }
    : undefined;

  const result = await input.provider.request({
    method: "wallet_sendCalls",
    params: [
      {
        version: "2.0.0",
        from: funder,
        chainId: numberToHex(BASE_SEPOLIA_CHAIN_ID),
        atomicRequired: true,
        calls,
        ...(capabilities ? { capabilities } : {}),
      },
    ],
  });

  return { result, total };
}

type CallsStatus = {
  status?: number | string;
  receipts?: Array<{ transactionHash?: string }>;
};

export async function waitForTokenlessRoundTransaction(input: {
  provider: EIP1193Provider;
  callsId: unknown;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<Hex> {
  if (typeof input.callsId === "string" && /^0x[0-9a-fA-F]{64}$/.test(input.callsId)) return input.callsId as Hex;
  if (typeof input.callsId !== "string" || !input.callsId.trim()) {
    throw new Error("Base Account returned an invalid call bundle id.");
  }
  const timeoutMs = input.timeoutMs ?? 120_000;
  const pollMs = input.pollMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = (await input.provider.request({
      method: "wallet_getCallsStatus",
      params: [input.callsId],
    })) as CallsStatus;
    const transactionHash = status.receipts?.at(-1)?.transactionHash;
    if (transactionHash && /^0x[0-9a-fA-F]{64}$/.test(transactionHash)) return transactionHash as Hex;
    const normalized = String(status.status ?? "").toLowerCase();
    if (["failed", "reverted", "400", "500"].includes(normalized)) {
      throw new Error("Base Account round funding failed.");
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  throw new Error("Base Account funding is still pending. You can safely retry confirmation.");
}
