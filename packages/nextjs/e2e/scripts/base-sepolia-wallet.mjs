#!/usr/bin/env node
import deployedContracts from "@rateloop/contracts/deployedContracts";
import { USDC_BY_CHAIN_ID } from "@rateloop/contracts/protocol";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, formatEther, formatUnits, getAddress, http, isAddress, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const CHAIN_ID = baseSepolia.id;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../../..");
const DEFAULT_WALLET_FILE = resolve(REPO_ROOT, ".env.base-sepolia-e2e-wallet.local");
const ERC20_BALANCE_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

function usage() {
  return `Usage: yarn base-sepolia:e2e-wallet <command> [--file path] [--force]

Commands:
  generate   Create the ignored Base Sepolia E2E wallet file if it does not exist.
  show       Print the wallet address without revealing the private key.
  balances   Read Base Sepolia ETH, USDC, and LREP balances for the wallet.

The wallet file defaults to ${DEFAULT_WALLET_FILE}
and is ignored by .gitignore via .env.*.
`;
}

function parseArgs(argv) {
  const result = {
    command: "show",
    file: process.env.RATELOOP_BASE_SEPOLIA_E2E_WALLET_FILE?.trim() || DEFAULT_WALLET_FILE,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      result.command = "help";
      continue;
    }

    if (arg === "--force") {
      result.force = true;
      continue;
    }

    if (arg === "--file") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("--file requires a path.");
      }
      result.file = resolve(process.cwd(), nextArg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--file=")) {
      result.file = resolve(process.cwd(), arg.slice("--file=".length));
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    result.command = arg;
  }

  return result;
}

function parseEnvFile(content) {
  const env = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    env[key] = rawValue.replace(/^(['"])(.*)\1$/, "$2");
  }

  return env;
}

async function readWalletEnv(file) {
  if (!existsSync(file)) {
    throw new Error(`Wallet file does not exist: ${file}. Run generate first.`);
  }

  return parseEnvFile(await readFile(file, "utf8"));
}

function resolveWallet(env) {
  const privateKey = env.BASE_SEPOLIA_E2E_PRIVATE_KEY?.trim();
  const address = env.BASE_SEPOLIA_E2E_ADDRESS?.trim();

  if (!privateKey && !address) {
    throw new Error("Wallet file is missing BASE_SEPOLIA_E2E_ADDRESS and BASE_SEPOLIA_E2E_PRIVATE_KEY.");
  }

  if (privateKey) {
    const account = privateKeyToAccount(privateKey);
    if (address && getAddress(address) !== account.address) {
      throw new Error("BASE_SEPOLIA_E2E_ADDRESS does not match BASE_SEPOLIA_E2E_PRIVATE_KEY.");
    }

    return { address: account.address, privateKey };
  }

  if (!isAddress(address)) {
    throw new Error("BASE_SEPOLIA_E2E_ADDRESS is not a valid address.");
  }

  return { address: getAddress(address), privateKey: null };
}

function resolveRpcUrl(env) {
  return (
    env.BASE_SEPOLIA_E2E_RPC_URL?.trim() ||
    process.env.BASE_SEPOLIA_E2E_RPC_URL?.trim() ||
    process.env.BASE_SEPOLIA_RPC_URL?.trim() ||
    process.env.PONDER_RPC_URL_84532?.trim() ||
    process.env.NEXT_PUBLIC_RPC_URL_84532?.trim() ||
    baseSepolia.rpcUrls.default.http[0]
  );
}

function buildWalletEnv({ address, privateKey, rpcUrl }) {
  return `# Disposable RateLoop E2E wallet for Base Sepolia only.
# Created by: yarn base-sepolia:e2e-wallet generate
# Do not commit this file. Do not fund this wallet on mainnet.
BASE_SEPOLIA_E2E_CHAIN_ID=${CHAIN_ID}
BASE_SEPOLIA_E2E_ADDRESS=${address}
BASE_SEPOLIA_E2E_PRIVATE_KEY=${privateKey}
BASE_SEPOLIA_E2E_RPC_URL=${rpcUrl}
`;
}

async function generateWallet(file, { force }) {
  if (existsSync(file) && !force) {
    const wallet = resolveWallet(await readWalletEnv(file));
    console.log("Base Sepolia E2E wallet already exists.");
    console.log(`Address: ${wallet.address}`);
    console.log(`File: ${file}`);
    console.log("Use --force only if you intentionally want a new empty test wallet.");
    return;
  }

  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const rpcUrl = resolveRpcUrl({});

  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, buildWalletEnv({ address: account.address, privateKey, rpcUrl }), { mode: 0o600 });
  await chmod(file, 0o600);

  console.log("Base Sepolia E2E wallet created.");
  console.log(`Address: ${account.address}`);
  console.log(`File: ${file}`);
  console.log("Fund this address on Base Sepolia only.");
}

async function showWallet(file) {
  const wallet = resolveWallet(await readWalletEnv(file));

  console.log(`Address: ${wallet.address}`);
  console.log(`Chain ID: ${CHAIN_ID}`);
  console.log(`File: ${file}`);
}

function getTokenAddress(name, env, fallback) {
  const value = env[name]?.trim() || process.env[name]?.trim() || fallback;
  return value && isAddress(value) ? getAddress(value) : null;
}

async function readTokenBalance(client, tokenAddress, walletAddress) {
  if (!tokenAddress) {
    return null;
  }

  const [rawBalance, decimals, symbol] = await Promise.all([
    client.readContract({
      address: tokenAddress,
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf",
      args: [walletAddress],
    }),
    client.readContract({
      address: tokenAddress,
      abi: ERC20_BALANCE_ABI,
      functionName: "decimals",
    }),
    client.readContract({
      address: tokenAddress,
      abi: ERC20_BALANCE_ABI,
      functionName: "symbol",
    }),
  ]);

  return {
    address: tokenAddress,
    formatted: formatUnits(rawBalance, decimals),
    raw: rawBalance.toString(),
    symbol,
  };
}

async function showBalances(file) {
  const env = await readWalletEnv(file);
  const wallet = resolveWallet(env);
  const rpcUrl = resolveRpcUrl(env);
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });
  const deployment = deployedContracts[CHAIN_ID];
  const lrepAddress = getTokenAddress("BASE_SEPOLIA_E2E_LREP_ADDRESS", env, deployment?.LoopReputation?.address);
  const usdcAddress = getTokenAddress("BASE_SEPOLIA_E2E_USDC_ADDRESS", env, USDC_BY_CHAIN_ID[CHAIN_ID]);
  const [nativeBalance, usdcBalance, lrepBalance] = await Promise.all([
    client.getBalance({ address: wallet.address }),
    readTokenBalance(client, usdcAddress, wallet.address),
    readTokenBalance(client, lrepAddress, wallet.address),
  ]);

  console.log(`Address: ${wallet.address}`);
  console.log(`RPC: ${rpcUrl}`);
  console.log(`ETH: ${formatEther(nativeBalance)} (${nativeBalance.toString()} wei)`);

  if (usdcBalance) {
    console.log(`${usdcBalance.symbol}: ${usdcBalance.formatted} (${usdcBalance.raw} atomic) @ ${usdcBalance.address}`);
  }

  if (lrepBalance) {
    console.log(`${lrepBalance.symbol}: ${lrepBalance.formatted} (${lrepBalance.raw} atomic) @ ${lrepBalance.address}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help") {
    console.log(usage());
    return;
  }

  if (args.command === "generate") {
    await generateWallet(args.file, { force: args.force });
    return;
  }

  if (args.command === "show") {
    await showWallet(args.file);
    return;
  }

  if (args.command === "balances") {
    await showBalances(args.file);
    return;
  }

  throw new Error(`Unknown command: ${args.command}\n\n${usage()}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
