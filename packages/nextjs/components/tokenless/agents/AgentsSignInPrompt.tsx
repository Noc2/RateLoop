import Link from "next/link";
import { SignedOutGate } from "~~/components/auth/SignedOutGate";
import { AgentWorkspaceExample } from "~~/components/tokenless/SignedOutExamples";
import { Button } from "~~/components/tokenless/ui/Button";

export function AgentsSignInPrompt() {
  return (
    <SignedOutGate
      description="Sign in to connect an agent, configure human review, manage reviewers, and evaluate performance."
      preview={<AgentWorkspaceExample />}
      returnTo="/agents"
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
