import { TokenlessShell } from "~~/components/tokenless/TokenlessShell";
import { isTokenlessSandboxMode } from "~~/lib/tokenless/server";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <TokenlessShell sandboxMode={isTokenlessSandboxMode()}>{children}</TokenlessShell>;
}
