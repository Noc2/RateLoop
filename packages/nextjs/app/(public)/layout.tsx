import { PublicShell } from "~~/components/PublicShell";
import { RateLoopWalletProviders } from "~~/components/RateLoopWalletProviders";
import { TermsAcceptanceModal } from "~~/components/legal/TermsAcceptanceModal";
import { WalletFundingProvider } from "~~/components/shared/WalletFundingProvider";
import { TermsAcceptanceProvider } from "~~/contexts/TermsAcceptanceContext";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <RateLoopWalletProviders>
      <TermsAcceptanceProvider>
        <WalletFundingProvider>
          <PublicShell>{children}</PublicShell>
        </WalletFundingProvider>
        <TermsAcceptanceModal />
      </TermsAcceptanceProvider>
    </RateLoopWalletProviders>
  );
}
