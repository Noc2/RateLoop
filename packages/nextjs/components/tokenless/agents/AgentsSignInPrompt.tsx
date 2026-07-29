"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SignedOutGate } from "~~/components/auth/SignedOutGate";
import { agentSignInReturnToWithHash } from "~~/components/tokenless/agents/agentWorkspaceState";
import { Button } from "~~/components/tokenless/ui/Button";

export function AgentsSignInPrompt({ returnTo }: { returnTo: string }) {
  const [browserReturnTo, setBrowserReturnTo] = useState(returnTo);

  useEffect(() => {
    setBrowserReturnTo(agentSignInReturnToWithHash(returnTo, window.location.hash));
  }, [returnTo]);

  return (
    <SignedOutGate
      description="Sign in to connect an agent, configure human review, manage reviewers, and evaluate performance."
      returnTo={browserReturnTo}
      secondaryAction={
        <Button
          as={Link}
          href="/docs/ai"
          size="sm"
          variant="secondary"
          className="h-10 min-h-10 px-[0.9rem] text-base font-bold leading-none"
        >
          Agent docs
        </Button>
      }
      title="Agents"
      titleId="agents-sign-in-title"
    />
  );
}
