import { TokenlessShell } from "~~/components/tokenless/TokenlessShell";

// Per-request CSP nonces can protect only dynamically rendered Next.js scripts.
export const dynamic = "force-dynamic";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <TokenlessShell>{children}</TokenlessShell>;
}
