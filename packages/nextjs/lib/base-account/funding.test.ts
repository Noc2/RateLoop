import { type TokenlessRoundTerms, prepareTokenlessRoundCalls, sendTokenlessRoundCalls } from "./funding";
import { TokenlessPanelAbi } from "@rateloop/contracts/tokenless";
import assert from "node:assert/strict";
import test from "node:test";
import { type EIP1193Provider, type Hex, decodeFunctionData, getAddress } from "viem";

const panelAddress = getAddress("0x2222222222222222222222222222222222222222");
const usdcAddress = getAddress("0x3333333333333333333333333333333333333333");
const funder = getAddress("0x4444444444444444444444444444444444444444");

const terms: TokenlessRoundTerms = {
  contentId: `0x${"11".repeat(32)}` as Hex,
  termsHash: `0x${"22".repeat(32)}` as Hex,
  beaconNetworkHash: `0x${"33".repeat(32)}` as Hex,
  bountyAmount: 10_000_000n,
  feeAmount: 750_000n,
  attemptReserve: 2_000_000n,
  attemptCompensation: 200_000n,
  minimumReveals: 10,
  maximumCommits: 12,
  requiredTier: 2,
  commitDeadline: 2_000_000_000n,
  revealDeadline: 2_000_003_600n,
  beaconFailureDeadline: 2_000_007_200n,
  beaconRound: 42n,
  claimGracePeriod: 604_800n,
  feeRecipient: getAddress("0x5555555555555555555555555555555555555555"),
};

test("funding calls approve only the exact escrow total before createRound", () => {
  const prepared = prepareTokenlessRoundCalls({ panelAddress, usdcAddress, terms });
  assert.equal(prepared.total, 12_750_000n);
  assert.equal(prepared.calls[0].to, usdcAddress);
  assert.equal(prepared.calls[1].to, panelAddress);

  const approval = decodeFunctionData({
    abi: [
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
    ] as const,
    data: prepared.calls[0].data,
  });
  assert.deepEqual(approval.args, [panelAddress, prepared.total]);

  const creation = decodeFunctionData({ abi: TokenlessPanelAbi, data: prepared.calls[1].data });
  assert.equal(creation.functionName, "createRound");
  assert.deepEqual(creation.args?.[0], terms);
});

test("Base Account submission requires an atomic Base Sepolia batch", async () => {
  let request: unknown;
  const provider = {
    async request(value: unknown) {
      request = value;
      return { batchId: "0x1234", status: "pending" };
    },
  } as EIP1193Provider;

  const sent = await sendTokenlessRoundCalls({ provider, funder, panelAddress, usdcAddress, terms });
  assert.equal(sent.total, 12_750_000n);
  assert.deepEqual(request, {
    method: "wallet_sendCalls",
    params: [
      {
        version: "2.0.0",
        from: funder,
        chainId: "0x14a34",
        atomicRequired: true,
        calls: prepareTokenlessRoundCalls({ panelAddress, usdcAddress, terms }).calls,
      },
    ],
  });
});

test("round funding rejects zero totals before opening the wallet", () => {
  assert.throws(
    () =>
      prepareTokenlessRoundCalls({
        panelAddress,
        usdcAddress,
        terms: { ...terms, bountyAmount: 0n, feeAmount: 0n, attemptReserve: 0n },
      }),
    /outside uint256 bounds/,
  );
});
