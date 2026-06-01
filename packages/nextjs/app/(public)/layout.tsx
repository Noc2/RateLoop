import { PublicShell } from "~~/components/PublicShell";
import { RateLoopWalletProviders } from "~~/components/RateLoopWalletProviders";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <RateLoopWalletProviders>
      <PublicShell>{children}</PublicShell>
    </RateLoopWalletProviders>
  );
}
