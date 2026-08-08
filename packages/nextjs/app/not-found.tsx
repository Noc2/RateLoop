import Link from "next/link";
import type { Metadata } from "next";
import { RootRecoveryShell } from "~~/components/tokenless/RootRecoveryShell";
import { RootRecoverySurface } from "~~/components/tokenless/RootRecoverySurface";
import { Button } from "~~/components/tokenless/ui/Button";

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
          <Button as={Link} variant="secondary" size="none" className="min-h-11" href="/">
            Home
          </Button>
        }
      />
    </RootRecoveryShell>
  );
}
