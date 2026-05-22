import { NextRequest, NextResponse } from "next/server";

// Only available in development on localhost chain
const DEV_FAUCET_ENABLED = process.env.DEV_FAUCET_ENABLED === "true" && process.env.NODE_ENV === "development";
const RATE_LIMIT = { limit: 10, windowMs: 60_000 }; // 10 req/min per IP

const LREP_DECIMALS = 6;
const USDC_DECIMALS = 6;
const MAX_MINT_AMOUNT = 10_000; // Cap per request

const erc20FaucetAbi = [
  {
    type: "function",
    name: "mint",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

const questionRewardPoolEscrowAbi = [
  {
    type: "function",
    name: "usdcToken",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
] as const;

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!DEV_FAUCET_ENABLED) {
    return NextResponse.json({ error: "Dev faucet is disabled" }, { status: 403 });
  }

  const [{ checkRateLimit }] = await Promise.all([import("~~/utils/rateLimit")]);
  const limited = await checkRateLimit(request, RATE_LIMIT);
  if (limited) return limited;

  try {
    const { address, action, amount } = await request.json();

    if (!address || !action) {
      return NextResponse.json({ error: "Missing address or action" }, { status: 400 });
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
    }

    if (!["mint-lrep", "mint-usdc"].includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const [
      { default: deployedContracts },
      { createPublicClient, createWalletClient, http, parseUnits },
      { privateKeyToAccount },
      { hardhat },
      { getKeystoreAccount },
    ] = await Promise.all([
      import("@rateloop/contracts/deployedContracts"),
      import("viem"),
      import("viem/accounts"),
      import("viem/chains"),
      import("~~/utils/keystore"),
    ]);

    // Resolve deployer account: keystore first, then raw private key fallback
    const faucetPrivateKey = process.env.FAUCET_PRIVATE_KEY;
    const account =
      getKeystoreAccount() ?? (faucetPrivateKey ? privateKeyToAccount(faucetPrivateKey as `0x${string}`) : null);

    if (!account) {
      console.error("[DevFaucet] No keystore or FAUCET_PRIVATE_KEY configured");
      return NextResponse.json({ error: "Dev faucet not configured" }, { status: 500 });
    }

    const HARDHAT_CHAIN_ID = hardhat.id; // 31337
    const contracts = (deployedContracts as any)[HARDHAT_CHAIN_ID];
    if (!contracts) {
      return NextResponse.json({ error: "No contracts deployed on localhost" }, { status: 500 });
    }

    const rpcUrl = "http://127.0.0.1:8545";

    const walletClient = createWalletClient({
      account,
      chain: hardhat,
      transport: http(rpcUrl),
    });

    const publicClient = createPublicClient({
      chain: hardhat,
      transport: http(rpcUrl),
    });

    if (action === "mint-lrep") {
      const lrepAddress = contracts.LoopReputation?.address;
      if (!lrepAddress) {
        return NextResponse.json({ error: "LoopReputation not deployed on localhost" }, { status: 500 });
      }

      const requestedAmount = Number(amount) || 1000;
      if (requestedAmount <= 0 || requestedAmount > MAX_MINT_AMOUNT) {
        return NextResponse.json({ error: `Amount must be between 1 and ${MAX_MINT_AMOUNT}` }, { status: 400 });
      }
      const mintAmount = parseUnits(requestedAmount.toString(), LREP_DECIMALS);

      // M-3 (2026-05-22 audit): LoopReputation exposes mint(address,uint256) gated on
      // MINTER_ROLE, which the local deployer signer holds. Use mint here so the faucet
      // works on a fresh anvil instance without pre-funding the signer; matches the
      // mint-usdc path below.
      const txHash = await walletClient.writeContract({
        address: lrepAddress,
        abi: erc20FaucetAbi,
        functionName: "mint",
        args: [address as `0x${string}`, mintAmount],
      });

      await publicClient.waitForTransactionReceipt({ hash: txHash });

      return NextResponse.json({
        success: true,
        txHash,
        action: "mint-lrep",
        amount: requestedAmount.toString(),
      });
    }

    if (action === "mint-usdc") {
      let usdcAddress = contracts.MockERC20?.address as `0x${string}` | undefined;

      if (!usdcAddress) {
        const escrowAddress = contracts.QuestionRewardPoolEscrow?.address as `0x${string}` | undefined;
        if (!escrowAddress) {
          return NextResponse.json({ error: "QuestionRewardPoolEscrow not deployed on localhost" }, { status: 500 });
        }

        usdcAddress = (await publicClient.readContract({
          address: escrowAddress,
          abi: questionRewardPoolEscrowAbi,
          functionName: "usdcToken",
        })) as `0x${string}`;
      }

      const requestedAmount = Number(amount) || 1000;
      if (requestedAmount <= 0 || requestedAmount > MAX_MINT_AMOUNT) {
        return NextResponse.json({ error: `Amount must be between 1 and ${MAX_MINT_AMOUNT}` }, { status: 400 });
      }
      const mintAmount = parseUnits(requestedAmount.toString(), USDC_DECIMALS);

      const txHash = await walletClient.writeContract({
        address: usdcAddress,
        abi: erc20FaucetAbi,
        functionName: "mint",
        args: [address as `0x${string}`, mintAmount],
      });

      await publicClient.waitForTransactionReceipt({ hash: txHash });

      return NextResponse.json({
        success: true,
        txHash,
        action: "mint-usdc",
        amount: requestedAmount.toString(),
      });
    }
  } catch (error: any) {
    console.error("[DevFaucet] Error:", error);
    return NextResponse.json({ error: "Failed to execute dev faucet action" }, { status: 500 });
  }
}
