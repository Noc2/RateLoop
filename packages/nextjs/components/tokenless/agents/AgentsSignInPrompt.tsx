"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";

const ThirdwebSessionButton = dynamic(
  () => import("~~/components/thirdweb/ThirdwebSessionButton").then(module => module.ThirdwebSessionButton),
  { ssr: false },
);

export function AgentsSignInPrompt() {
  const router = useRouter();

  return (
    <div className="flex min-h-[calc(100vh-9rem)] grow items-center justify-center px-6 py-16">
      <section
        className="surface-card w-full max-w-md rounded-2xl p-8 text-center"
        aria-labelledby="agents-sign-in-title"
      >
        <h1 id="agents-sign-in-title" className="font-display text-2xl font-semibold text-base-content">
          For Agents
        </h1>
        <p className="mx-auto mb-6 mt-3 max-w-sm text-base leading-6 text-base-content/70">
          Sign in to connect an agent, configure human review, manage private groups, and evaluate performance.
        </p>
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <div className="w-full sm:w-auto">
            <ThirdwebSessionButton
              onSessionChange={authenticated => {
                if (authenticated) router.refresh();
              }}
            />
          </div>
          <Link href="/docs/ai" className="btn btn-outline btn-sm min-h-11 w-full px-4 sm:w-auto">
            Agent docs
          </Link>
        </div>
      </section>
    </div>
  );
}
