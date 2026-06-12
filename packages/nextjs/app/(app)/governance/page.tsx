"use client";

import { type FormEvent, Suspense, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { ConnectWalletCard } from "~~/components/shared/ConnectWalletCard";
import { WalletRestoreLoading } from "~~/components/shared/WalletRestoreLoading";
import { useWalletRestore } from "~~/contexts/WalletRestoreContext";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { REPUTATION_CONTRACT_NAME } from "~~/lib/contracts/reputation";
import { getGovernanceReputationGateState } from "~~/lib/governance/reputationGate";
import { replaceUrlPreservingHistoryState } from "~~/lib/ui/browserHistory";
import { notification } from "~~/utils/scaffold-eth";

type GovernanceTab = "profile" | "leaderboard" | "governance" | "breaches";

const governanceTabs: GovernanceTab[] = ["profile", "leaderboard", "governance", "breaches"];
const GOVERNANCE_ACTION_QUERY_PARAM = "governanceAction";
const CONFIDENTIALITY_SLASH_BOND_ACTION_ID = "confidentiality-slash-bond";
const RATER_REGISTRY_BAN_IDENTITY_ACTION_ID = "rater-registry-ban-identity";
const RATER_REGISTRY_UNBAN_IDENTITY_ACTION_ID = "rater-registry-unban-identity";

type BreachReport = {
  accusedIdentityKey: string;
  contentId: string;
  createdAt: string;
  evidenceHash: string;
  evidenceUrl: string | null;
  id: number;
  reporter: string;
  status: string;
};

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

function buildGovernanceActionHref(actionId: string, values: Record<string, string | null | undefined>) {
  const params = new URLSearchParams({ [GOVERNANCE_ACTION_QUERY_PARAM]: actionId });
  for (const [key, value] of Object.entries(values)) {
    const trimmed = value?.trim();
    if (trimmed) params.set(key, trimmed);
  }
  return `/governance?${params.toString()}#governance`;
}

function buildBreachActionReason(reportId: number | null, contentId: string) {
  const trimmedContentId = contentId.trim();
  if (reportId !== null && trimmedContentId) {
    return `Confidentiality breach report #${reportId} for content ${trimmedContentId}`;
  }
  if (trimmedContentId) {
    return `Confidentiality breach report for content ${trimmedContentId}`;
  }
  return "Confidentiality breach report";
}

type ConfidentialityBreachesPanelProps = {
  onOpenGovernanceAction: (href: string) => void;
  reporter: `0x${string}`;
};

function ConfidentialityBreachesPanel({ onOpenGovernanceAction, reporter }: ConfidentialityBreachesPanelProps) {
  const [contentId, setContentId] = useState("");
  const [accusedIdentityKey, setAccusedIdentityKey] = useState("");
  const [evidenceHash, setEvidenceHash] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [reports, setReports] = useState<BreachReport[]>([]);
  const [isLoadingReports, setIsLoadingReports] = useState(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);

  const loadReports = useCallback(async () => {
    if (!contentId.trim()) {
      notification.warning("Enter a content id first.");
      return;
    }
    setIsLoadingReports(true);
    try {
      const params = new URLSearchParams({ contentId: contentId.trim() });
      const response = await fetch(`/api/confidentiality/breaches?${params.toString()}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load breach reports.");
      setReports(Array.isArray(body.reports) ? body.reports : []);
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "Could not load breach reports.");
    } finally {
      setIsLoadingReports(false);
    }
  }, [contentId]);

  const submitReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmittingReport(true);
    try {
      const response = await fetch("/api/confidentiality/breaches", {
        body: JSON.stringify({
          accusedIdentityKey,
          contentId,
          evidenceHash,
          evidenceUrl: evidenceUrl.trim() || undefined,
          reporter,
        }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok || body.ok !== true) {
        throw new Error(body.error || "Could not submit breach report.");
      }
      notification.success("Breach report submitted.");
      await loadReports();
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "Could not submit breach report.");
    } finally {
      setIsSubmittingReport(false);
    }
  };

  const draftReason = buildBreachActionReason(null, contentId);
  const draftSlashBondHref = buildGovernanceActionHref(CONFIDENTIALITY_SLASH_BOND_ACTION_ID, {
    contentId,
    evidenceHash,
    identityKey: accusedIdentityKey,
    reason: draftReason,
    reporterRecipient: reporter,
  });
  const draftBanIdentityHref = buildGovernanceActionHref(RATER_REGISTRY_BAN_IDENTITY_ACTION_ID, {
    evidenceHash,
    expiresAt: "0",
    reason: draftReason,
  });
  const draftUnbanIdentityHref = buildGovernanceActionHref(RATER_REGISTRY_UNBAN_IDENTITY_ACTION_ID, {});
  const missingSlashBondPrefillFields = [
    contentId.trim() ? null : "content id",
    accusedIdentityKey.trim() ? null : "identity key",
    evidenceHash.trim() ? null : "evidence hash",
  ].filter((field): field is string => field !== null);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
      <form onSubmit={submitReport} className="surface-card rounded-2xl p-6">
        <div className="mb-5">
          <h2 className="text-xl font-semibold text-base-content">Confidentiality breach report</h2>
          <p className="mt-2 text-sm leading-relaxed text-base-content/60">
            Reports require a gated-context signed session for this wallet. Governance can use the evidence hash and
            access-log proof to arbitrate slash or sanction proposals.
          </p>
        </div>
        <div className="grid gap-4">
          <label className="form-control gap-2 sm:grid sm:grid-cols-[max-content_minmax(0,1fr)] sm:items-center sm:gap-x-6">
            <span className="label-text whitespace-nowrap text-base-content/65">Content id</span>
            <input
              className="input input-bordered mt-2 w-full bg-base-100 sm:mt-0 sm:max-w-xl sm:justify-self-end"
              inputMode="numeric"
              value={contentId}
              onChange={event => setContentId(event.target.value)}
              placeholder="123"
            />
          </label>
          <label className="form-control gap-2 sm:grid sm:grid-cols-[max-content_minmax(0,1fr)] sm:items-center sm:gap-x-6">
            <span className="label-text whitespace-nowrap text-base-content/65">Accused identity key</span>
            <input
              className="input input-bordered mt-2 w-full bg-base-100 font-mono text-sm sm:mt-0 sm:max-w-xl sm:justify-self-end"
              value={accusedIdentityKey}
              onChange={event => setAccusedIdentityKey(event.target.value)}
              placeholder="0x..."
            />
          </label>
          <label className="form-control gap-2 sm:grid sm:grid-cols-[max-content_minmax(0,1fr)] sm:items-center sm:gap-x-6">
            <span className="label-text whitespace-nowrap text-base-content/65">Evidence hash</span>
            <input
              className="input input-bordered mt-2 w-full bg-base-100 font-mono text-sm sm:mt-0 sm:max-w-xl sm:justify-self-end"
              value={evidenceHash}
              onChange={event => setEvidenceHash(event.target.value)}
              placeholder="0x..."
            />
          </label>
          <label className="form-control gap-2 sm:grid sm:grid-cols-[max-content_minmax(0,1fr)] sm:items-center sm:gap-x-6">
            <span className="label-text whitespace-nowrap text-base-content/65">Evidence URL</span>
            <input
              className="input input-bordered mt-2 w-full bg-base-100 sm:mt-0 sm:max-w-xl sm:justify-self-end"
              type="url"
              value={evidenceUrl}
              onChange={event => setEvidenceUrl(event.target.value)}
              placeholder="https://..."
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary" disabled={isSubmittingReport}>
              {isSubmittingReport ? <span className="loading loading-spinner loading-xs" /> : null}
              Submit report
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => void loadReports()}
              disabled={isLoadingReports}
            >
              {isLoadingReports ? <span className="loading loading-spinner loading-xs" /> : null}
              Load reports
            </button>
          </div>
        </div>
      </form>

      <div className="space-y-6">
        <div className="surface-card rounded-2xl p-6">
          <h2 className="text-xl font-semibold text-base-content">Governance actions</h2>
          <p className="mt-2 text-sm leading-relaxed text-base-content/60">
            Open a proposal with the current breach fields prefilled. Identity bans require the credential provider and
            raw nullifier hash.
          </p>
          <div className="mt-4 grid gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm justify-start"
              onClick={() => onOpenGovernanceAction(draftSlashBondHref)}
            >
              Slash bond proposal
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm justify-start"
              onClick={() => onOpenGovernanceAction(draftBanIdentityHref)}
            >
              Ban identity proposal
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm justify-start"
              onClick={() => onOpenGovernanceAction(draftUnbanIdentityHref)}
            >
              Unban identity proposal
            </button>
          </div>
          <div className="mt-3 space-y-1 text-xs leading-relaxed text-base-content/50">
            {missingSlashBondPrefillFields.length > 0 ? (
              <p>Slash prefill missing: {missingSlashBondPrefillFields.join(", ")}.</p>
            ) : null}
            <p>Identity ban actions still need provider and raw nullifier hash in the composer.</p>
          </div>
        </div>

        <div className="surface-card rounded-2xl p-6">
          <h2 className="text-xl font-semibold text-base-content">Reports</h2>
          <div className="mt-4 space-y-3">
            {reports.length > 0 ? (
              reports.map(report => (
                <div
                  key={report.id}
                  className="rounded-xl border border-base-300 bg-base-100 p-3 text-sm"
                  data-testid="confidentiality-breach-report"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-base-content">#{report.id}</span>
                    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">
                      {report.status}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 font-mono text-xs text-base-content/60">
                    <p className="break-all">identity {report.accusedIdentityKey}</p>
                    <p className="break-all">evidence {report.evidenceHash}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onOpenGovernanceAction(
                          buildGovernanceActionHref(CONFIDENTIALITY_SLASH_BOND_ACTION_ID, {
                            contentId: report.contentId,
                            evidenceHash: report.evidenceHash,
                            identityKey: report.accusedIdentityKey,
                            reason: buildBreachActionReason(report.id, report.contentId),
                            reporterRecipient: report.reporter,
                          }),
                        )
                      }
                      className="btn btn-primary btn-xs"
                    >
                      Slash bond
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenGovernanceAction(
                          buildGovernanceActionHref(RATER_REGISTRY_BAN_IDENTITY_ACTION_ID, {
                            evidenceHash: report.evidenceHash,
                            expiresAt: "0",
                            reason: buildBreachActionReason(report.id, report.contentId),
                          }),
                        )
                      }
                      className="btn btn-outline btn-xs"
                    >
                      Ban identity
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenGovernanceAction(buildGovernanceActionHref(RATER_REGISTRY_UNBAN_IDENTITY_ACTION_ID, {}))
                      }
                      className="btn btn-outline btn-xs"
                    >
                      Unban identity
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-base-content/60">Load a content id to review submitted reports.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function GovernancePageInner() {
  const router = useRouter();
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

  const openGovernanceAction = useCallback(
    (href: string) => {
      setActiveTab("governance");
      router.push(href, { scroll: false });
    },
    [router],
  );

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
        <button
          onClick={() => selectTab("breaches")}
          className={`tab-control px-4 py-1.5 text-base font-medium transition-colors ${
            activeTab === "breaches" ? "pill-active" : "pill-inactive"
          }`}
        >
          Breaches
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

      {activeTab === "breaches" && address && (
        <ConfidentialityBreachesPanel
          reporter={address as `0x${string}`}
          onOpenGovernanceAction={openGovernanceAction}
        />
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
