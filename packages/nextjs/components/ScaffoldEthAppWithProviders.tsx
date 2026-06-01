"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { AppProgressBar as ProgressBar } from "next-nprogress-bar";
import { hardhat } from "viem/chains";
import { Footer } from "~~/components/Footer";
import { Header } from "~~/components/Header";
import { NavigationProgressDiagnostics } from "~~/components/NavigationProgressDiagnostics";
import { RateLoopWalletProviders } from "~~/components/RateLoopWalletProviders";
import { RouteScopedNotifiers } from "~~/components/RouteScopedNotifiers";
import { TestnetNoticeBanner } from "~~/components/TestnetNoticeBanner";
import { ReferralAttributionCapture } from "~~/components/referrals/ReferralAttributionCapture";
import { FaucetTrigger } from "~~/components/scaffold-eth/FaucetTrigger";
import { RATE_ROUTE } from "~~/constants/routes";
import { MobileHeaderVisibilityProvider } from "~~/contexts/MobileHeaderVisibilityContext";
import { OptimisticVoteProvider } from "~~/contexts/OptimisticVoteContext";
import { TermsAcceptanceProvider } from "~~/contexts/TermsAcceptanceContext";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";

const TermsAcceptanceModal = dynamic(
  () => import("~~/components/legal/TermsAcceptanceModal").then(m => m.TermsAcceptanceModal),
  { ssr: false },
);

const FaucetModal = dynamic(() => import("~~/components/scaffold-eth/Faucet").then(m => m.FaucetModal), {
  ssr: false,
});

const ScaffoldEthApp = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname() ?? "";
  const isVoteFeedRoute = pathname === RATE_ROUTE;
  const { targetNetwork } = useTargetNetwork();
  const showHardhatFaucet = targetNetwork.id === hardhat.id;
  const showVoteFeedMobileFaucet = isVoteFeedRoute && showHardhatFaucet;

  return (
    <MobileHeaderVisibilityProvider>
      <div className={`flex min-h-screen flex-col ${isVoteFeedRoute ? "lg:h-screen lg:overflow-hidden" : ""}`.trim()}>
        <div className="lg:pl-52">
          <TestnetNoticeBanner targetChainId={targetNetwork.id} />
        </div>
        <Header />
        {/* Main content: offset by left sidebar on desktop (208px at lg and up) */}
        <div className="flex flex-1 min-h-0 flex-col lg:pl-52">
          <div
            className={`relative flex flex-1 flex-col overflow-x-hidden ${
              isVoteFeedRoute ? "min-h-0 overflow-hidden lg:overflow-hidden" : ""
            }`}
          >
            {children}
          </div>
          {showVoteFeedMobileFaucet ? (
            <div className="lg:hidden">
              <div className="pointer-events-none fixed bottom-0 left-0 z-10 flex w-full items-center justify-between p-4">
                <div className="pointer-events-auto">
                  <FaucetTrigger />
                </div>
              </div>
            </div>
          ) : null}
          <div className={isVoteFeedRoute ? "hidden" : ""}>
            <Footer />
          </div>
        </div>
      </div>
      <RouteScopedNotifiers />
      {showHardhatFaucet ? <FaucetModal /> : null}
    </MobileHeaderVisibilityProvider>
  );
};

export const ScaffoldEthAppWithProviders = ({ children }: { children: React.ReactNode }) => {
  return (
    <RateLoopWalletProviders>
      <Suspense fallback={null}>
        <ReferralAttributionCapture />
      </Suspense>
      <ProgressBar height="3px" color="#f5f5f5" />
      <Suspense fallback={null}>
        <NavigationProgressDiagnostics />
      </Suspense>
      <TermsAcceptanceProvider>
        <OptimisticVoteProvider>
          <ScaffoldEthApp>{children}</ScaffoldEthApp>
        </OptimisticVoteProvider>
        <TermsAcceptanceModal />
      </TermsAcceptanceProvider>
    </RateLoopWalletProviders>
  );
};
