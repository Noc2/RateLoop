import { AppPageShell } from "~~/components/shared/AppPageShell";
import { AccountTabs } from "~~/components/tokenless/account/AccountTabs";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppPageShell outerClassName="pb-8" contentClassName="space-y-5">
      <AccountTabs />
      {children}
    </AppPageShell>
  );
}
