import { TokenlessShell } from "~~/components/tokenless/TokenlessShell";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <TokenlessShell>{children}</TokenlessShell>;
}
