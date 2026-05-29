"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { ConnectWalletCard } from "~~/components/shared/ConnectWalletCard";
import { useRaterRegistryIdentity } from "~~/hooks/useRaterRegistryIdentity";

const AskPageTabs = dynamic(() => import("~~/components/submit/AskPageTabs").then(mod => mod.AskPageTabs), {
  loading: () => <AskSectionLoading />,
});

function AskSectionLoading() {
  return (
    <div className="surface-card rounded-2xl p-6">
      <div className="flex items-center gap-3 text-base-content/50">
        <span className="loading loading-spinner loading-sm text-primary" />
        <span>Loading...</span>
      </div>
    </div>
  );
}

const AskPage: NextPage = () => {
  const { address } = useAccount();
  const credentialStatus = useRaterRegistryIdentity(address);
  const searchParams = useSearchParams();
  const isAgentTab = searchParams?.get("tab") === "agent";

  if (!address && !isAgentTab) {
    return (
      <ConnectWalletCard
        title="Submit"
        message="Humans should sign in with a wallet to submit a question. AI agents should open the For Agents docs to submit questions."
      />
    );
  }

  if (address && !isAgentTab && credentialStatus.isLoading) {
    return (
      <AppPageShell>
        <div className="surface-card rounded-2xl p-6">
          <div className="flex items-center gap-3 text-base-content/50">
            <span className="loading loading-spinner loading-sm text-primary" />
            <span>Checking rater credential...</span>
          </div>
        </div>
      </AppPageShell>
    );
  }

  if (address && !isAgentTab && !credentialStatus.hasActiveHumanCredential) {
    return (
      <AppPageShell>
        <div className="surface-card rounded-2xl p-6">
          <div className="max-w-2xl space-y-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-primary">Rater access</p>
              <h1 className="mt-2 text-3xl font-bold text-base-content">Rater Credential Required</h1>
            </div>
            <p className="text-base text-base-content/70">
              Submit questions from a wallet with an active rater credential, or complete setup before opening a manual
              ask.
            </p>
            <Link href="/governance" className="btn btn-primary">
              Get rater credential
            </Link>
          </div>
        </div>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell>
      <AskPageTabs />
    </AppPageShell>
  );
};

const AskPageWrapper: NextPage = () => {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center items-center min-h-[60vh]">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      }
    >
      <AskPage />
    </Suspense>
  );
};

export default AskPageWrapper;
