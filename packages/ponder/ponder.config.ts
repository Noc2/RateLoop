import { createConfig } from "ponder";
import { http } from "viem";
import { credentialIssuerAbi, tokenlessPanelAbi } from "./src/tokenlessAbi";
import { resolveTokenlessDeployment } from "./src/protocol-deployment";

const deployment = resolveTokenlessDeployment();
const rpcKey = `PONDER_RPC_URL_${deployment.chainId}`;
const rpcUrl = process.env[rpcKey]?.trim() ?? (deployment.network === "hardhat" ? "http://127.0.0.1:8545" : undefined);
if (!rpcUrl) throw new Error(`${rpcKey} is required.`);
const parsedRpc = new URL(rpcUrl);
if (deployment.network !== "hardhat" && parsedRpc.protocol !== "https:") {
  throw new Error(`${rpcKey} must use HTTPS.`);
}

export default createConfig({
  networks: {
    [deployment.network]: {
      chainId: deployment.chainId,
      transport: http(rpcUrl),
      pollingInterval: deployment.network === "hardhat" ? 1_000 : 4_000,
    },
  },
  contracts: {
    TokenlessPanel: {
      abi: tokenlessPanelAbi,
      network: {
        [deployment.network]: {
          address: deployment.panelAddress,
          startBlock: deployment.startBlock,
        },
      },
    },
    CredentialIssuer: {
      abi: credentialIssuerAbi,
      network: {
        [deployment.network]: {
          address: deployment.issuerAddress,
          startBlock: deployment.startBlock,
        },
      },
    },
  },
});
