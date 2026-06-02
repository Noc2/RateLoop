import { headers } from "next/headers";
import { ScaffoldEthAppWithProviders } from "~~/components/ScaffoldEthAppWithProviders";
import { getWagmiInitialStateFromCookie } from "~~/services/web3/wagmiInitialState";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const wagmiInitialState = getWagmiInitialStateFromCookie((await headers()).get("cookie"));

  return (
    <ScaffoldEthAppWithProviders wagmiInitialState={wagmiInitialState}>
      <main id="main-content" className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden">
        {children}
      </main>
    </ScaffoldEthAppWithProviders>
  );
}
