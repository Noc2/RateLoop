type ThirdwebWalletFundingAsset = "ETH" | "USDC";

const THIRDWEB_PAY_WALLET_FUNDING_CHAIN_IDS = new Set([8453]);

const TESTNET_CHAIN_NAMES: Record<number, string> = {
  4801: "World Chain Sepolia",
  84532: "Base Sepolia",
};

export function supportsThirdwebWalletFunding(chainId: number | null | undefined): boolean {
  return typeof chainId === "number" && THIRDWEB_PAY_WALLET_FUNDING_CHAIN_IDS.has(chainId);
}

export function getThirdwebWalletFundingUnavailableMessage({
  asset,
  chainId,
  chainName,
  fallbackMessage,
}: {
  asset: ThirdwebWalletFundingAsset;
  chainId: number | null | undefined;
  chainName?: string;
  fallbackMessage?: string;
}): string {
  if (supportsThirdwebWalletFunding(chainId)) {
    return fallbackMessage ?? "Direct wallet funding is unavailable right now.";
  }

  if (chainId === 31337) {
    return fallbackMessage ?? "Use the local faucet from your wallet menu to fund local test wallets.";
  }

  const assetLabel = asset === "ETH" ? "ETH" : "USDC";
  const networkName = (typeof chainId === "number" && TESTNET_CHAIN_NAMES[chainId]) || chainName || "this network";

  if (typeof chainId === "number" && TESTNET_CHAIN_NAMES[chainId]) {
    return `thirdweb Pay direct ${assetLabel} top-ups are not available on ${networkName}. Use a ${networkName} faucet or send testnet ${assetLabel} to this wallet, then retry in RateLoop.`;
  }

  return (
    fallbackMessage ??
    `thirdweb Pay direct ${assetLabel} top-ups are not available on ${networkName}. Send ${assetLabel} to this wallet outside RateLoop, then retry.`
  );
}
