import { createConfig } from "ponder";
import {
  credentialIssuerAbi,
  tokenlessFeedbackBonusAbi,
  tokenlessPanelAbi,
} from "./src/tokenlessAbi";
import { resolveTokenlessDeployment } from "./src/protocol-deployment";
import { createPonderRpcTransport, resolvePonderRpcUrls } from "./src/rpc";

const deployment = resolveTokenlessDeployment();
const rpcUrls = resolvePonderRpcUrls(deployment);

export default createConfig({
  networks: {
    [deployment.network]: {
      chainId: deployment.chainId,
      transport: createPonderRpcTransport(rpcUrls),
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
    TokenlessFeedbackBonus: {
      abi: tokenlessFeedbackBonusAbi,
      network: {
        [deployment.network]: {
          address: deployment.feedbackBonusAddress,
          startBlock: deployment.startBlock,
        },
      },
    },
  },
});
