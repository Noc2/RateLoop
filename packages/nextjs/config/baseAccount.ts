import { cookieStorage, createConfig, createStorage, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { baseAccount, injected } from "wagmi/connectors";

export const tokenlessChain = baseSepolia;

export function getBaseAccountConfig() {
  const rpcUrl = process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL?.trim();

  return createConfig({
    chains: [tokenlessChain],
    connectors: [
      baseAccount({
        appName: "RateLoop",
      }),
      injected({ shimDisconnect: true }),
    ],
    multiInjectedProviderDiscovery: false,
    ssr: true,
    storage: createStorage({ storage: cookieStorage }),
    transports: {
      [tokenlessChain.id]: http(rpcUrl || undefined),
    },
  });
}

declare module "wagmi" {
  interface Register {
    config: ReturnType<typeof getBaseAccountConfig>;
  }
}
