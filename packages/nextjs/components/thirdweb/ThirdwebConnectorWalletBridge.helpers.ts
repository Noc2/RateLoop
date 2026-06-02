type ProviderReconnectConnector = {
  getProvider?: (params: { chainId?: number }) => Promise<unknown>;
};

export function reconnectWagmiConnectorProvider(
  connector: ProviderReconnectConnector | undefined,
  chainId: number | undefined,
) {
  return typeof connector?.getProvider === "function" ? connector.getProvider({ chainId }) : null;
}
