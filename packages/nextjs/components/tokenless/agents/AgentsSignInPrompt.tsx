"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SignInSurface } from "~~/components/auth/SignInSurface";
import { AgentWorkspaceExample } from "~~/components/tokenless/SignedOutExamples";

const ThirdwebSessionButton = dynamic(
  () => import("~~/components/thirdweb/ThirdwebSessionButton").then(module => module.ThirdwebSessionButton),
  { ssr: false },
);

export function AgentsSignInPrompt() {
  const router = useRouter();

  return (
    <SignInSurface
      description="Sign in to connect an agent, configure human review, manage private groups, and evaluate performance."
      title="Agents"
      titleId="agents-sign-in-title"
    >
      <AgentWorkspaceExample />
      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
        <div className="w-full sm:w-auto">
          <ThirdwebSessionButton
            compact
            onSessionChange={authenticated => {
              if (authenticated) router.refresh();
            }}
          />
        </div>
        <Link
          href="/docs/ai"
          className="btn btn-outline h-10 min-h-10 w-auto min-w-0 px-[0.9rem] text-base font-bold leading-none"
        >
          Agent docs
        </Link>
      </div>
    </SignInSurface>
  );
}
