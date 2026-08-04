"use client";

import { RootRecoveryShell } from "~~/components/tokenless/RootRecoveryShell";
import { RootRecoverySurface } from "~~/components/tokenless/RootRecoverySurface";
import { RuntimeErrorActions } from "~~/components/tokenless/RuntimeErrorActions";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RootRecoveryShell>
      <RootRecoverySurface
        eyebrow="Error"
        title="Something went wrong"
        description="Try loading this page again. If the problem continues, return to the previous page or choose another task."
        actions={<RuntimeErrorActions reset={reset} />}
      />
    </RootRecoveryShell>
  );
}
