"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useAccount } from "wagmi";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { ConnectWalletCard } from "~~/components/shared/ConnectWalletCard";
import { WalletRestoreLoading } from "~~/components/shared/WalletRestoreLoading";
import { useWalletRestore } from "~~/contexts/WalletRestoreContext";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { REPUTATION_CONTRACT_NAME } from "~~/lib/contracts/reputation";
import { getGovernanceReputationGateState } from "~~/lib/governance/reputationGate";
import { replaceUrlPreservingHistoryState } from "~~/lib/ui/browserHistory";

type GovernanceTab = "profile" | "leaderboard" | "governance";

const governanceTabs: GovernanceTab[] = ["profile", "leaderboard", "governance"];

function GovernanceSectionLoading() {
  return (
    <div className="surface-card rounded-2xl p-6">
      <div className="flex items-center gap-3 text-base-content/50">
        <span className="loading loading-spinner loading-sm text-primary" />
        <span>Loading...</span>
      </div>
    </div>
  );
}

function GovernancePageLoading({ message }: { message: string }) {
  return (
    <AppPageShell contentClassName="space-y-6">
      <div className="flex min-h-[40vh] flex-col items-center justify-center px-4 text-center">
        <span className="loading loading-spinner loading-lg text-primary" />
        <p className="mt-4 text-sm text-base-content/60">{message}</p>
      </div>
    </AppPageShell>
  );
}

const PublicProfileView = dynamic(
  () => import("~~/components/profile/PublicProfileView").then(mod => mod.PublicProfileView),
  { loading: GovernanceSectionLoading },
);
const VoterAccuracyStats = dynamic(
  () => import("~~/components/leaderboard/VoterAccuracyStats").then(mod => mod.VoterAccuracyStats),
  { loading: GovernanceSectionLoading },
);
const AccuracyLeaderboard = dynamic(
  () => import("~~/components/leaderboard/AccuracyLeaderboard").then(mod => mod.AccuracyLeaderboard),
  { loading: GovernanceSectionLoading },
);
const TreasuryBalance = dynamic(
  () => import("~~/components/governance/TreasuryBalance").then(mod => mod.TreasuryBalance),
  { loading: GovernanceSectionLoading },
);
const GovernanceStats = dynamic(
  () => import("~~/components/governance/GovernanceStats").then(mod => mod.GovernanceStats),
  { loading: GovernanceSectionLoading },
);
const GetLrepOnboarding = dynamic(
  () => import("~~/components/governance/GetLrepOnboarding").then(mod => mod.GetLrepOnboarding),
  { loading: GovernanceSectionLoading },
);
const GovernanceActionComposer = dynamic(
  () => import("~~/components/governance/GovernanceActionComposer").then(mod => mod.GovernanceActionComposer),
  { loading: GovernanceSectionLoading },
);
const ProposalList = dynamic(() => import("~~/components/governance/ProposalList").then(mod => mod.ProposalList), {
  loading: GovernanceSectionLoading,
});

function getGovernanceHash(tab: GovernanceTab) {
  return tab === "profile" ? "" : `#${tab}`;
}

function normalizeGovernanceHash(hash: string): GovernanceTab | null {
  if (!hash) return "profile";
  if (hash === "accuracy") return "leaderboard";
  return governanceTabs.includes(hash as GovernanceTab) ? (hash as GovernanceTab) : null;
}

function GovernancePageInner() {
  const { isConnected, address } = useAccount();
  const { isRestoringWallet } = useWalletRestore();
  const [activeTab, setActiveTab] = useState<GovernanceTab>("profile");
  const [hashInitialized, setHashInitialized] = useState(false);
  const autoSelectedEntryAddressRef = useRef<string | null>(null);

  // Sync tab with URL hash (e.g. /governance#governance)
  const selectTab = useCallback((tab: GovernanceTab) => {
    setActiveTab(tab);
    const hash = getGovernanceHash(tab);
    replaceUrlPreservingHistoryState(hash || window.location.pathname + window.location.search);
  }, []);

  useEffect(() => {
    const applyHash = () => {
      const rawHash = window.location.hash.replace(/^#/, "");
      const nextTab = normalizeGovernanceHash(rawHash);
      setHashInitialized(true);

      if (nextTab) {
        setActiveTab(nextTab);
        const nextHash = getGovernanceHash(nextTab);
        const currentHash = rawHash ? `#${rawHash}` : "";
        if (currentHash !== nextHash) {
          replaceUrlPreservingHistoryState(`${window.location.pathname}${window.location.search}${nextHash}`);
        }
      }
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  // Check LREP balance
  const {
    data: lrepBalance,
    isError: lrepBalanceError,
    refetch: refetchLrepBalance,
  } = useScaffoldReadContract({
    contractName: REPUTATION_CONTRACT_NAME,
    functionName: "balanceOf",
    args: [address],
    query: { enabled: !!address },
  });

  const hasResolvedBalance = !!address && lrepBalance !== undefined;
  const lrepGateState = getGovernanceReputationGateState({
    hasAddress: Boolean(address),
    lrepBalance,
    lrepBalanceError,
  });
  const addressKey = address?.toLowerCase() ?? null;
  const shouldWaitForEntryRouting = Boolean(address) && !hashInitialized;

  useEffect(() => {
    autoSelectedEntryAddressRef.current = null;
  }, [addressKey]);

  useEffect(() => {
    if (!addressKey || !hashInitialized || !hasResolvedBalance) {
      return;
    }

    if (window.location.hash) {
      autoSelectedEntryAddressRef.current = addressKey;
      return;
    }

    if (autoSelectedEntryAddressRef.current === addressKey) {
      return;
    }

    selectTab("profile");

    autoSelectedEntryAddressRef.current = addressKey;
  }, [addressKey, hasResolvedBalance, hashInitialized, selectTab]);

  // Keep an invalid hash from pinning users to a removed legacy tab.
  useEffect(() => {
    if (!hashInitialized) {
      return;
    }

    const hashTab = normalizeGovernanceHash(window.location.hash.replace(/^#/, ""));
    if (!hashTab) {
      selectTab("profile");
    }
  }, [hashInitialized, selectTab]);

  // Show connect wallet prompt if not connected
  if (!isConnected) {
    if (isRestoringWallet) {
      return <WalletRestoreLoading />;
    }

    return (
      <ConnectWalletCard
        title="LREP"
        message="Connect a wallet to build reputation, review predictions, and participate in governance."
      />
    );
  }

  if (shouldWaitForEntryRouting) {
    return <GovernancePageLoading message="Loading governance..." />;
  }

  if (lrepGateState === "loading") {
    return <GovernancePageLoading message="Loading LREP status..." />;
  }

  if (lrepGateState === "error") {
    return (
      <AppPageShell contentClassName="space-y-6">
        <div className="surface-card mx-auto flex min-h-[40vh] max-w-xl flex-col items-center justify-center rounded-3xl px-6 py-10 text-center">
          <h1 className="text-2xl font-semibold text-base-content">LREP status unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-base-content/60">
            We could not confirm this wallet&apos;s LREP balance. Retry before opening the reputation profile.
          </p>
          <button type="button" className="btn btn-primary mt-6" onClick={() => void refetchLrepBalance()}>
            Retry
          </button>
        </div>
      </AppPageShell>
    );
  }

  if (lrepGateState === "zero-lrep" && address) {
    return (
      <AppPageShell contentClassName="space-y-6">
        <GetLrepOnboarding address={address as `0x${string}`} />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell contentClassName="space-y-6">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => selectTab("profile")}
          className={`tab-control px-4 py-1.5 text-base font-medium transition-colors ${
            activeTab === "profile" ? "pill-active" : "pill-inactive"
          }`}
        >
          Profile
        </button>
        <button
          onClick={() => selectTab("leaderboard")}
          className={`tab-control px-4 py-1.5 text-base font-medium transition-colors ${
            activeTab === "leaderboard" ? "pill-active" : "pill-inactive"
          }`}
        >
          Leaderboard
        </button>
        <button
          onClick={() => selectTab("governance")}
          className={`tab-control px-4 py-1.5 text-base font-medium transition-colors ${
            activeTab === "governance" ? "pill-active" : "pill-inactive"
          }`}
        >
          Governance
        </button>
      </div>

      {activeTab === "profile" && address && <PublicProfileView address={address as `0x${string}`} embedded />}

      {activeTab === "leaderboard" && (
        <>
          <VoterAccuracyStats />
          <AccuracyLeaderboard />
        </>
      )}

      {activeTab === "governance" && (
        <div className="space-y-6">
          <div className="space-y-6">
            <TreasuryBalance />
            <GovernanceStats />
          </div>
          <GovernanceActionComposer />
          <ProposalList />
        </div>
      )}
    </AppPageShell>
  );
}

export default function GovernancePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[60vh]">Loading...</div>}>
      <GovernancePageInner />
    </Suspense>
  );
}
