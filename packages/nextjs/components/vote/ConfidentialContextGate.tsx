"use client";

import React, { type ReactNode, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { LockClosedIcon } from "@heroicons/react/24/outline";
import { useConfidentialityBond } from "~~/hooks/useConfidentialityBond";
import type { ContentItem } from "~~/hooks/useContentFeed";
import { useWalletMessageSigner } from "~~/hooks/useWalletMessageSigner";
import { CONFIDENTIALITY_TERMS_URI } from "~~/lib/confidentiality/terms";
import {
  getConfidentialContextVoteBlocker,
  getConfidentialityBondRequirement,
  isPrivateContextMetadata,
} from "~~/lib/vote/confidentialContext";
import { notification } from "~~/utils/scaffold-eth";

export type ConfidentialContextGateChildren = ReactNode | ((params: { walletAddress?: string }) => ReactNode);

export function renderConfidentialGateChildren(children: ConfidentialContextGateChildren, walletAddress?: string) {
  return typeof children === "function" ? children({ walletAddress }) : children;
}

export function ConfidentialContextTermsLink({ className = "link link-primary" }: { className?: string }) {
  return (
    <Link href={CONFIDENTIALITY_TERMS_URI} target="_blank" rel="noopener noreferrer" className={className}>
      question confidentiality terms
    </Link>
  );
}

export function PrivateContextBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md bg-warning/15 font-semibold text-warning ${
        compact ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm"
      }`}
    >
      <LockClosedIcon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      Private context
    </span>
  );
}

function ConfidentialBondRequirementChip({ compact = false, label }: { compact?: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md bg-base-content/[0.07] font-semibold text-base-content/75 ${
        compact ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm"
      }`}
    >
      {label} bond
    </span>
  );
}

export function ConfidentialContextBadges({
  compact = false,
  item,
  showBondRequirement = true,
}: {
  compact?: boolean;
  item: ContentItem;
  showBondRequirement?: boolean;
}) {
  const privateContext = isPrivateContextMetadata(item);
  if (!privateContext) return null;

  const bondRequirement = getConfidentialityBondRequirement(item.confidentiality);

  return (
    <>
      <PrivateContextBadge compact={compact} />
      {showBondRequirement && bondRequirement.isRequired ? (
        <ConfidentialBondRequirementChip compact={compact} label={bondRequirement.label} />
      ) : null}
    </>
  );
}

function GateShell({ children, variant }: { children: ReactNode; variant: "media" | "inline" }) {
  const lockedClassName =
    variant === "inline"
      ? "flex w-full flex-col items-start gap-3 rounded-md border border-warning/20 bg-warning/10 p-3 text-left"
      : "flex h-full min-h-[16rem] w-full flex-col items-center justify-center gap-4 bg-base-300 p-6 text-center";

  return <div className={lockedClassName}>{children}</div>;
}

function GateCopy({ children, title, variant }: { children: ReactNode; title: string; variant: "media" | "inline" }) {
  return (
    <div className={variant === "inline" ? "max-w-2xl space-y-1" : "max-w-md space-y-2"}>
      <p className="text-base font-semibold text-base-content">{title}</p>
      <div className="space-y-1 text-sm leading-relaxed text-base-content/65">{children}</div>
    </div>
  );
}

export function ConfidentialContextGate({
  children,
  item,
  variant = "media",
}: {
  children: ConfidentialContextGateChildren;
  item: ContentItem;
  variant?: "media" | "inline";
}) {
  const gated = isPrivateContextMetadata(item);
  const { address } = useAccount();
  const { isPending: isSigning, signMessageAsync } = useWalletMessageSigner({ address });
  const [accepted, setAccepted] = useState(false);
  const [isCheckingTerms, setIsCheckingTerms] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const bondRequirement = useMemo(
    () => getConfidentialityBondRequirement(item.confidentiality),
    [item.confidentiality],
  );
  const bond = useConfidentialityBond({
    bondRequirement,
    contentId: item.id,
    enabled: gated && accepted,
  });

  useEffect(() => {
    setAccepted(false);
  }, [address, item.id]);

  useEffect(() => {
    if (!gated || typeof window === "undefined") return;
    const handleAccepted = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      if (detail?.contentId === item.id.toString()) setAccepted(true);
    };
    window.addEventListener("rateloop:confidentiality-accepted", handleAccepted);
    return () => {
      window.removeEventListener("rateloop:confidentiality-accepted", handleAccepted);
    };
  }, [gated, item.id]);

  useEffect(() => {
    if (!gated || !address) return;
    let cancelled = false;
    setIsCheckingTerms(true);
    const params = new URLSearchParams({
      address,
      contentId: item.id.toString(),
    });
    fetch(`/api/confidentiality/terms?${params.toString()}`, {
      credentials: "include",
    })
      .then(response => (response.ok ? response.json() : null))
      .then(body => {
        if (!cancelled && body?.accepted === true) setAccepted(true);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setIsCheckingTerms(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address, gated, item.id]);

  const acceptTerms = async () => {
    if (!address) {
      notification.warning("Connect a wallet to view private context.");
      return;
    }
    setIsAccepting(true);
    try {
      const payload = {
        address,
        contentHash: item.contentHash,
        contentId: item.id.toString(),
        detailsHash: item.detailsHash ?? undefined,
        questionMetadataHash: item.questionMetadataHash ?? undefined,
      };
      const challengeResponse = await fetch("/api/confidentiality/terms/challenge", {
        body: JSON.stringify(payload),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const challenge = await challengeResponse.json();
      if (!challengeResponse.ok || typeof challenge.message !== "string" || typeof challenge.challengeId !== "string") {
        throw new Error(challenge.error || "Could not create confidentiality challenge.");
      }
      const signature = await signMessageAsync({ message: challenge.message });
      const acceptResponse = await fetch("/api/confidentiality/terms", {
        body: JSON.stringify({
          ...payload,
          challengeId: challenge.challengeId,
          signature,
          termsVersion: challenge.termsVersion,
        }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const acceptedBody = await acceptResponse.json();
      if (!acceptResponse.ok || acceptedBody.accepted !== true) {
        throw new Error(acceptedBody.error || "Could not record confidentiality acceptance.");
      }
      setAccepted(true);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("rateloop:confidentiality-accepted", {
            detail: { contentId: item.id.toString() },
          }),
        );
      }
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "Could not unlock private context.");
    } finally {
      setIsAccepting(false);
    }
  };

  const postBond = async () => {
    const posted = await bond.postBond();
    if (posted) {
      notification.success("Confidentiality bond posted.");
      return;
    }
    if (bond.error) notification.error(bond.error);
  };

  if (!gated) return <>{renderConfidentialGateChildren(children, address)}</>;

  const blocker = getConfidentialContextVoteBlocker({
    bondRequirement,
    escrowConfigured: Boolean(bond.escrowAddress),
    hasAcceptedTerms: accepted,
    hasActiveBond: bond.hasActiveBond,
    hasActiveHumanCredential: bond.hasActiveHumanCredential && Boolean(bond.identityKey),
    identityResolved: bond.isIdentityResolved,
    isBondChecking: bond.isCheckingBond,
    isGated: gated,
    isTermsChecking: isCheckingTerms,
  });

  if (!blocker) return <>{renderConfidentialGateChildren(children, address)}</>;

  if (!accepted) {
    return (
      <GateShell variant={variant}>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <ConfidentialContextBadges item={item} />
        </div>
        <GateCopy title="Confidential context is locked" variant={variant}>
          <p>
            Review and accept the <ConfidentialContextTermsLink /> with your wallet to view hosted context for this
            rating.
          </p>
          {bondRequirement.isRequired ? <p>Viewing and voting also require a {bondRequirement.label} bond.</p> : null}
        </GateCopy>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={acceptTerms}
          disabled={isCheckingTerms || isAccepting || isSigning}
        >
          {isCheckingTerms || isAccepting || isSigning ? <span className="loading loading-spinner loading-xs" /> : null}
          Accept terms
        </button>
      </GateShell>
    );
  }

  if (bond.isIdentityLoading || bond.isCheckingBond) {
    return (
      <GateShell variant={variant}>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <ConfidentialContextBadges item={item} />
        </div>
        <GateCopy title="Checking private-context access" variant={variant}>
          <p>{blocker}</p>
        </GateCopy>
        <span className="loading loading-spinner loading-sm text-primary" />
      </GateShell>
    );
  }

  if (!bond.hasActiveHumanCredential) {
    return (
      <GateShell variant={variant}>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <ConfidentialContextBadges item={item} />
        </div>
        <GateCopy title="Human credential required" variant={variant}>
          <p>Private-context ratings require an active human credential before hosted context is shown.</p>
        </GateCopy>
        <a className="btn btn-outline btn-sm" href="/settings">
          Verify in Settings
        </a>
      </GateShell>
    );
  }

  return (
    <GateShell variant={variant}>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <ConfidentialContextBadges item={item} />
      </div>
      <GateCopy title="Confidentiality bond required" variant={variant}>
        <p>Post the {bondRequirement.label} bond before viewing or voting on this private context.</p>
        {bond.error ? <p className="font-medium text-error">{bond.error}</p> : null}
      </GateCopy>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={postBond}
        disabled={bond.isPostingBond || !bond.escrowAddress || !bond.tokenAddress}
      >
        {bond.isPostingBond ? <span className="loading loading-spinner loading-xs" /> : null}
        Post {bondRequirement.asset} bond
      </button>
    </GateShell>
  );
}
