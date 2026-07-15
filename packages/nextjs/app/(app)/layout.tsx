import { TokenlessShell } from "~~/components/tokenless/TokenlessShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <TokenlessShell>{children}</TokenlessShell>;
}
