import type { Connector } from "wagmi";

const DIRECT_WALLET_CONNECTOR_PRIORITY = ["io.metamask", "com.coinbase.wallet", "me.rainbow", "injected"];

export function getDirectWagmiConnector(connectors: readonly Connector[]): Connector | undefined {
  for (const connectorId of DIRECT_WALLET_CONNECTOR_PRIORITY) {
    const connector = connectors.find(candidate => candidate.id === connectorId);
    if (connector) {
      return connector;
    }
  }

  return connectors.find(connector => connector.id !== "in-app-wallet");
}
