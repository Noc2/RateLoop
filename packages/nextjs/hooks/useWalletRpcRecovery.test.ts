import {
  addAndSwitchEthereumChain,
  buildAddEthereumChainParameter,
  canRepairWalletRpc,
  isUnknownWalletChainError,
} from "./useWalletRpcRecovery";
import assert from "node:assert/strict";
import test from "node:test";

test("canRepairWalletRpc only enables MetaMask wallets with a configured chain RPC", () => {
  assert.equal(
    canRepairWalletRpc({
      chain: {
        id: 8453,
        name: "Base mainnet",
        nativeCurrency: {
          decimals: 18,
          name: "Ether",
          symbol: "ETH",
        },
        rpcUrls: {
          default: {
            http: ["https://base-mainnet.g.alchemy.com/public"],
          },
        },
      } as any,
      walletId: "io.metamask",
    }),
    true,
  );

  assert.equal(
    canRepairWalletRpc({
      chain: {
        id: 8453,
        name: "Base mainnet",
        nativeCurrency: {
          decimals: 18,
          name: "Ether",
          symbol: "ETH",
        },
        rpcUrls: {
          default: {
            http: ["https://base-mainnet.g.alchemy.com/public"],
          },
        },
      } as any,
      walletId: "com.coinbase.wallet",
    }),
    false,
  );
});

test("buildAddEthereumChainParameter keeps preferred RPC and explorer URLs", () => {
  assert.deepEqual(
    buildAddEthereumChainParameter({
      blockExplorers: {
        default: {
          name: "Blockscout",
          url: "https://basescan.org",
        },
      },
      id: 8453,
      name: "Base mainnet",
      nativeCurrency: {
        decimals: 18,
        name: "Ether",
        symbol: "ETH",
      },
      rpcUrls: {
        default: {
          http: ["https://base-mainnet.g.alchemy.com/public"],
        },
      },
    } as any),
    {
      blockExplorerUrls: ["https://basescan.org"],
      chainId: "0x2105",
      chainName: "Base mainnet",
      nativeCurrency: {
        decimals: 18,
        name: "Ether",
        symbol: "ETH",
      },
      rpcUrls: ["https://base-mainnet.g.alchemy.com/public"],
    },
  );
});

test("isUnknownWalletChainError recognizes MetaMask unknown-chain shapes", () => {
  assert.equal(isUnknownWalletChainError({ code: 4902 }), true);
  assert.equal(isUnknownWalletChainError({ code: "4902" }), true);
  assert.equal(
    isUnknownWalletChainError({
      code: -32603,
      message:
        'MetaMask - RPC Error: Unrecognized chain ID "0xa4ec". Try adding the chain using wallet_addEthereumChain first.',
    }),
    true,
  );
  assert.equal(
    isUnknownWalletChainError({
      data: {
        originalError: {
          code: 4902,
        },
      },
    }),
    true,
  );
  assert.equal(
    isUnknownWalletChainError({
      cause: {
        details: 'Unrecognized chain ID "0xa4ec".',
      },
    }),
    true,
  );
  assert.equal(
    isUnknownWalletChainError({
      shortMessage: "Try adding the chain using wallet_addEthereumChain first.",
    }),
    true,
  );
  assert.equal(isUnknownWalletChainError({ code: 4001, message: "User rejected the request." }), false);
});

test("addAndSwitchEthereumChain adds the configured chain before switching", async () => {
  const requests: Array<{ method: string; params?: unknown[] }> = [];
  const provider = {
    request: async (request: { method: string; params?: unknown[] }) => {
      requests.push(request);
      return null;
    },
  };

  await addAndSwitchEthereumChain(provider, {
    blockExplorers: {
      default: {
        name: "Blockscout",
        url: "https://basescan.org",
      },
    },
    id: 8453,
    name: "Base mainnet",
    nativeCurrency: {
      decimals: 18,
      name: "Ether",
      symbol: "ETH",
    },
    rpcUrls: {
      default: {
        http: ["https://base-mainnet.g.alchemy.com/public"],
      },
    },
  } as any);

  assert.deepEqual(requests, [
    {
      method: "wallet_addEthereumChain",
      params: [
        {
          blockExplorerUrls: ["https://basescan.org"],
          chainId: "0x2105",
          chainName: "Base mainnet",
          nativeCurrency: {
            decimals: 18,
            name: "Ether",
            symbol: "ETH",
          },
          rpcUrls: ["https://base-mainnet.g.alchemy.com/public"],
        },
      ],
    },
    {
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x2105" }],
    },
  ]);
});
