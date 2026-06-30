import assert from "node:assert/strict";
import test from "node:test";
import {
  createThirdwebInAppWallet,
  currentThirdwebWalletMatchesWagmiAddress,
  getThirdwebWalletIds,
  getThirdwebWalletSmartAccountOptions,
  getThirdwebWalletSponsorshipMode,
  getThirdwebWallets,
  isThirdwebInAppWalletCurrentForAddress,
  isThirdwebInAppWalletId,
  shouldIncludeThirdwebWalletAuthOption,
  supportsThirdwebExecutionCapabilities,
  supportsThirdwebInAppExecutionCapabilities,
  thirdwebWalletAddressMatchesWagmiAddress,
} from "~~/services/thirdweb/client";

function getInAppWalletAuthOptions(wallets: ReturnType<typeof getThirdwebWallets>) {
  const inAppWallet = wallets.find(wallet => wallet.id === "inApp");
  const config = inAppWallet?.getConfig() as { auth?: { options?: string[] } } | undefined;

  return config?.auth?.options;
}

test("getThirdwebWalletIds only exposes branded external wallets when matching injected providers exist", () => {
  assert.deepEqual(
    getThirdwebWalletIds({
      ethereum: {
        providers: [{ isMetaMask: true }, { isCoinbaseWallet: true }],
      },
    }),
    ["inApp", "io.metamask", "com.coinbase.wallet"],
  );
});

test("isThirdwebInAppWalletId accepts thirdweb and wagmi in-app ids", () => {
  assert.equal(isThirdwebInAppWalletId("inApp"), true);
  assert.equal(isThirdwebInAppWalletId("in-app-wallet"), true);
  assert.equal(isThirdwebInAppWalletId("io.metamask"), false);
  assert.equal(isThirdwebInAppWalletId(undefined), false);
});

test("local chain can connect through thirdweb without using hosted execution", () => {
  assert.equal(supportsThirdwebExecutionCapabilities(31337), false);
  assert.equal(supportsThirdwebInAppExecutionCapabilities(31337), false);
  assert.equal(supportsThirdwebExecutionCapabilities(8453), true);
  assert.equal(supportsThirdwebInAppExecutionCapabilities(8453), true);
});

test("thirdwebWalletAddressMatchesWagmiAddress compares addresses case-insensitively", () => {
  assert.equal(
    thirdwebWalletAddressMatchesWagmiAddress({
      thirdwebAddress: "0x6D12cC9Ee8392740306F87Fbd1ccB1cBC16FA593",
      wagmiAddress: "0x6d12cc9ee8392740306f87fbd1ccb1cbc16fa593",
    }),
    true,
  );
  assert.equal(
    thirdwebWalletAddressMatchesWagmiAddress({
      thirdwebAddress: "0x6D12cC9Ee8392740306F87Fbd1ccB1cBC16FA593",
      wagmiAddress: "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa",
    }),
    false,
  );
});

test("currentThirdwebWalletMatchesWagmiAddress prefers the active wallet account over stale active account", () => {
  assert.equal(
    currentThirdwebWalletMatchesWagmiAddress({
      activeThirdwebAccountAddress: "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa",
      activeWalletAccountAddress: "0x6D12cC9Ee8392740306F87Fbd1ccB1cBC16FA593",
      wagmiAddress: "0x6d12cc9ee8392740306f87fbd1ccb1cbc16fa593",
    }),
    true,
  );
  assert.equal(
    currentThirdwebWalletMatchesWagmiAddress({
      activeThirdwebAccountAddress: "0x6D12cC9Ee8392740306F87Fbd1ccB1cBC16FA593",
      activeWalletAccountAddress: "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa",
      wagmiAddress: "0x6d12cc9ee8392740306f87fbd1ccb1cbc16fa593",
    }),
    false,
  );
});

test("currentThirdwebWalletMatchesWagmiAddress accepts admin matches and active-account fallback", () => {
  assert.equal(
    currentThirdwebWalletMatchesWagmiAddress({
      activeThirdwebAccountAddress: "0x1111111111111111111111111111111111111111",
      activeWalletAccountAddress: "0x2222222222222222222222222222222222222222",
      thirdwebAdminAddress: "0x6D12cC9Ee8392740306F87Fbd1ccB1cBC16FA593",
      wagmiAddress: "0x6d12cc9ee8392740306f87fbd1ccb1cbc16fa593",
    }),
    true,
  );
  assert.equal(
    currentThirdwebWalletMatchesWagmiAddress({
      activeThirdwebAccountAddress: "0x6D12cC9Ee8392740306F87Fbd1ccB1cBC16FA593",
      wagmiAddress: "0x6d12cc9ee8392740306f87fbd1ccb1cbc16fa593",
    }),
    true,
  );
});

test("isThirdwebInAppWalletCurrentForAddress accepts current smart and admin accounts", () => {
  assert.equal(
    isThirdwebInAppWalletCurrentForAddress({
      activeWalletId: "inApp",
      connectedAddress: "0x1111111111111111111111111111111111111111",
      thirdwebAccountAddress: "0x1111111111111111111111111111111111111111",
      thirdwebAdminAddress: "0x2222222222222222222222222222222222222222",
    }),
    true,
  );
  assert.equal(
    isThirdwebInAppWalletCurrentForAddress({
      activeWalletId: "inApp",
      connectedAddress: "0x2222222222222222222222222222222222222222",
      thirdwebAccountAddress: "0x1111111111111111111111111111111111111111",
      thirdwebAdminAddress: "0x2222222222222222222222222222222222222222",
    }),
    true,
  );
});

test("isThirdwebInAppWalletCurrentForAddress rejects stale in-app wallets after MetaMask connects", () => {
  assert.equal(
    isThirdwebInAppWalletCurrentForAddress({
      activeWalletId: "inApp",
      connectedAddress: "0x3333333333333333333333333333333333333333",
      thirdwebAccountAddress: "0x1111111111111111111111111111111111111111",
      thirdwebAdminAddress: "0x2222222222222222222222222222222222222222",
    }),
    false,
  );
  assert.equal(
    isThirdwebInAppWalletCurrentForAddress({
      activeWalletId: "io.metamask",
      connectedAddress: "0x3333333333333333333333333333333333333333",
      thirdwebAccountAddress: "0x3333333333333333333333333333333333333333",
    }),
    false,
  );
});

test("isThirdwebInAppWalletCurrentForAddress allows the pre-wagmi reconnect window", () => {
  assert.equal(
    isThirdwebInAppWalletCurrentForAddress({
      activeWalletId: "inApp",
      thirdwebAccountAddress: "0x1111111111111111111111111111111111111111",
    }),
    true,
  );
});

test("getThirdwebWalletIds keeps the modal on the in-app wallet when no branded injected providers are present", () => {
  assert.deepEqual(getThirdwebWalletIds({ ethereum: undefined }), ["inApp"]);
});

test("shouldIncludeThirdwebWalletAuthOption uses wallet auth when no branded injected wallet is available", () => {
  assert.equal(shouldIncludeThirdwebWalletAuthOption({ ethereum: undefined }), true);
  assert.equal(shouldIncludeThirdwebWalletAuthOption({ ethereum: { providers: [{ isFrame: true }] } }), true);
  assert.equal(
    shouldIncludeThirdwebWalletAuthOption({
      ethereum: {
        providers: [{ isMetaMask: true }],
      },
    }),
    false,
  );
});

test("createThirdwebInAppWallet can hide wallet auth to avoid duplicate compact mobile wallet rows", () => {
  const wallet = createThirdwebInAppWallet(480, { includeWalletAuthOption: false });
  const config = wallet.getConfig() as { auth?: { options?: string[] } };

  assert.deepEqual(config.auth?.options, ["google", "apple", "email", "passkey"]);
});

test("createThirdwebInAppWallet uses the RateLoop login hero for wallet branding", () => {
  const wallet = createThirdwebInAppWallet(480);
  const config = wallet.getConfig() as {
    metadata?: { image?: { alt?: string; height?: number; src?: string; width?: number } };
  };

  assert.deepEqual(config.metadata?.image, {
    alt: "Level Up Your Agent",
    height: 160,
    src: "/thirdweb-login-hero.svg",
    width: 288,
  });
});

test("createThirdwebInAppWallet enables sponsored smart accounts on World Chain Sepolia", () => {
  const wallet = createThirdwebInAppWallet(4801);
  const config = wallet.getConfig() as {
    executionMode?: { mode?: string; smartAccount?: { chain?: { id?: number }; sponsorGas?: boolean } };
    smartAccount?: { chain?: { id?: number }; sponsorGas?: boolean };
  };

  assert.equal(config.executionMode?.mode, "EIP4337");
  assert.equal(config.executionMode?.smartAccount?.chain?.id, 4801);
  assert.equal(config.executionMode?.smartAccount?.sponsorGas, true);
  assert.equal(config.smartAccount?.chain?.id, 4801);
  assert.equal(config.smartAccount?.sponsorGas, true);
  assert.equal(getThirdwebWalletSponsorshipMode(wallet), "sponsored");
});

test("getThirdwebWalletSmartAccountOptions exposes Sepolia smart account options for the wagmi bridge", () => {
  const smartAccount = getThirdwebWalletSmartAccountOptions(4801, { sponsorshipMode: "self-funded" });

  assert.equal(smartAccount?.chain.id, 4801);
  assert.equal(smartAccount && "sponsorGas" in smartAccount ? smartAccount.sponsorGas : undefined, false);
  assert.equal(getThirdwebWalletSmartAccountOptions(480), undefined);
});

test("getThirdwebWalletSmartAccountOptions omits Base Sepolia because it uses EIP-7702", () => {
  const smartAccount = getThirdwebWalletSmartAccountOptions(84532, { sponsorshipMode: "self-funded" });

  assert.equal(smartAccount, undefined);
  assert.equal(getThirdwebWalletSmartAccountOptions(8453), undefined);
});

test("getThirdwebWallets keeps wallet auth inside in-app wallet when no branded injected wallet exists", () => {
  const wallets = getThirdwebWallets(480, {
    ethereum: {
      providers: [{ isFrame: true }],
    },
  });

  assert.deepEqual(
    wallets.map(wallet => wallet.id),
    ["inApp"],
  );
  assert.deepEqual(getInAppWalletAuthOptions(wallets), ["google", "apple", "email", "passkey", "wallet"]);
});

test("getThirdwebWallets omits in-app wallet auth when a branded injected wallet is listed separately", () => {
  const wallets = getThirdwebWallets(480, {
    ethereum: {
      providers: [{ isMetaMask: true }],
    },
  });

  assert.deepEqual(
    wallets.map(wallet => wallet.id),
    ["inApp", "io.metamask"],
  );
  assert.deepEqual(getInAppWalletAuthOptions(wallets), ["google", "apple", "email", "passkey"]);
});
