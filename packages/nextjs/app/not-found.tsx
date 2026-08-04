import Link from "next/link";
import type { Metadata } from "next";
import { RootRecoveryShell } from "~~/components/tokenless/RootRecoveryShell";
import { RootRecoverySurface } from "~~/components/tokenless/RootRecoverySurface";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <RootRecoveryShell>
      <RootRecoverySurface
        eyebrow="404"
        title="Page not found"
        description="This address may be wrong, or the page may have moved."
        actions={
          <Link href="/" className="btn rateloop-secondary-action min-h-11 px-4">
            Home
          </Link>
        }
      />
    </RootRecoveryShell>
  );
}
