"use client";

import React, { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "wagmi";
import { LockClosedIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { ConfidentialityTermsBody } from "~~/components/legal/ConfidentialityTermsBody";
import { useConfidentialityBond } from "~~/hooks/useConfidentialityBond";
import type { ContentItem } from "~~/hooks/useContentFeed";
import { ensurePrivateAccountReadSession } from "~~/hooks/usePrivateAccountSession";
import { useWalletMessageSigner } from "~~/hooks/useWalletMessageSigner";
import { fetchConfidentialityTermsStatus } from "~~/lib/confidentiality/clientTermsStatus";
import { CONFIDENTIALITY_TERMS_TITLE, CONFIDENTIALITY_TERMS_VERSION } from "~~/lib/confidentiality/terms";
import {
  CONFIDENTIALITY_ACCEPTED_EVENT,
  getConfidentialContextVoteBlocker,
  getConfidentialityBondRequirement,
  isPrivateContextMetadata,
} from "~~/lib/vote/confidentialContext";
import { notification } from "~~/utils/scaffold-eth";

export type ConfidentialContextGateChildren = ReactNode | ((params: { walletAddress?: string }) => ReactNode);

export function renderConfidentialGateChildren(children: ConfidentialContextGateChildren, walletAddress?: string) {
  return typeof children === "function" ? children({ walletAddress }) : children;
}

export function ConfidentialContextTermsDialogPanel({
  isBusy,
  onAccept,
  onClose,
}: {
  isBusy: boolean;
  onAccept: () => void;
  onClose: () => void;
}) {
  const titleId = useId();

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/45 backdrop-blur-sm"
        aria-label="Close confidentiality terms dialog"
        onClick={onClose}
        disabled={isBusy}
      />
      <div className="relative z-10 max-h-[calc(100svh-1rem)] w-full max-w-2xl overflow-hidden rounded-t-2xl bg-base-200 p-6 shadow-2xl sm:rounded-2xl">
        <button
          type="button"
          onClick={onClose}
          className="btn btn-sm btn-circle btn-ghost absolute right-3 top-3 text-base-content/70 hover:text-base-content"
          aria-label="Close"
          disabled={isBusy}
        >
          <XMarkIcon className="h-5 w-5" />
        </button>

        <h3 id={titleId} className="px-9 text-center text-lg font-semibold leading-tight text-base-content">
          {CONFIDENTIALITY_TERMS_TITLE}
        </h3>
        <p className="mt-2 text-center text-sm leading-relaxed text-base-content/65">
          Review these terms before unlocking hosted private context.
        </p>

        <div className="mt-5 max-h-[58svh] overflow-y-auto rounded-lg border border-base-content/10 bg-base-100 p-4 text-sm leading-relaxed text-base-content/78 [scrollbar-gutter:stable]">
          <div className="space-y-5">
            <ConfidentialityTermsBody compact />
          </div>
        </div>
        <p className="mt-3 text-xs text-base-content/48">Version: {CONFIDENTIALITY_TERMS_VERSION}</p>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={isBusy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onAccept} disabled={isBusy}>
            {isBusy ? <span className="loading loading-spinner loading-xs" /> : null}
            Accept with wallet
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfidentialContextTermsDialog({
  isBusy,
  isOpen,
  onAccept,
  onClose,
}: {
  isBusy: boolean;
  isOpen: boolean;
  onAccept: () => void;
  onClose: () => void;
}) {
  if (!isOpen || typeof document === "undefined") return null;
  return createPortal(
    <ConfidentialContextTermsDialogPanel isBusy={isBusy} onAccept={onAccept} onClose={onClose} />,
    document.body,
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
  const [ownerSessionReady, setOwnerSessionReady] = useState(false);
  const [isCheckingTerms, setIsCheckingTerms] = useState(false);
  const [isCheckingOwnerSession, setIsCheckingOwnerSession] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isConfirmingOwnerSession, setIsConfirmingOwnerSession] = useState(false);
  const [isTermsDialogOpen, setIsTermsDialogOpen] = useState(false);
  const isOwnContent = Boolean(item.isOwnContent);
  const bondRequirement = useMemo(
    () => getConfidentialityBondRequirement(item.confidentiality),
    [item.confidentiality],
  );
  const bond = useConfidentialityBond({
    bondRequirement,
    contentId: item.id,
    enabled: gated && accepted && !isOwnContent,
  });

  useEffect(() => {
    setAccepted(false);
    setOwnerSessionReady(false);
  }, [address, item.id]);

  useEffect(() => {
    if (!gated || typeof window === "undefined") return;
    const handleAccepted = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      if (detail?.contentId === item.id.toString()) setAccepted(true);
    };
    window.addEventListener(CONFIDENTIALITY_ACCEPTED_EVENT, handleAccepted);
    return () => {
      window.removeEventListener(CONFIDENTIALITY_ACCEPTED_EVENT, handleAccepted);
    };
  }, [gated, item.id]);

  useEffect(() => {
    if (!gated || !address || isOwnContent) return;
    let cancelled = false;
    setIsCheckingTerms(true);
    fetchConfidentialityTermsStatus(address, item.id)
      .then(status => {
        if (!cancelled && status.accepted) setAccepted(true);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setIsCheckingTerms(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address, gated, isOwnContent, item.id]);

  useEffect(() => {
    if (!gated || !isOwnContent || !address) return;
    let cancelled = false;
    setIsCheckingOwnerSession(true);
    const params = new URLSearchParams({ address });
    fetch(`/api/account/private-session?${params.toString()}`, {
      credentials: "include",
    })
      .then(response => (response.ok ? response.json() : null))
      .then(body => {
        if (!cancelled && body?.hasSession === true) setOwnerSessionReady(true);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setIsCheckingOwnerSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address, gated, isOwnContent, item.id]);

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
      setIsTermsDialogOpen(false);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(CONFIDENTIALITY_ACCEPTED_EVENT, {
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

  const confirmOwnerSession = async () => {
    if (!address) {
      notification.warning("Connect a wallet to view your private context.");
      return;
    }
    setIsConfirmingOwnerSession(true);
    try {
      await ensurePrivateAccountReadSession(address, signMessageAsync);
      setOwnerSessionReady(true);
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "Could not confirm wallet access.");
    } finally {
      setIsConfirmingOwnerSession(false);
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

  if (isOwnContent) {
    if (ownerSessionReady) return <>{renderConfidentialGateChildren(children, address)}</>;

    return (
      <GateShell variant={variant}>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <ConfidentialContextBadges item={item} showBondRequirement={false} />
        </div>
        <GateCopy
          title={
            address ? "Confirm wallet to view your private context" : "Connect wallet to view your private context"
          }
          variant={variant}
        >
          <p>Your question&apos;s private context is visible after confirming the submitting wallet.</p>
          <p>You still cannot vote on your own question.</p>
        </GateCopy>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={confirmOwnerSession}
          disabled={!address || isCheckingOwnerSession || isConfirmingOwnerSession || isSigning}
        >
          {isCheckingOwnerSession || isConfirmingOwnerSession || isSigning ? (
            <span className="loading loading-spinner loading-xs" />
          ) : null}
          {address ? "Confirm wallet" : "Connect wallet"}
        </button>
      </GateShell>
    );
  }

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
    const acceptTermsButton = (
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={() => setIsTermsDialogOpen(true)}
        disabled={isCheckingTerms || isAccepting || isSigning}
      >
        {isCheckingTerms || isAccepting || isSigning ? <span className="loading loading-spinner loading-xs" /> : null}
        Accept terms
      </button>
    );

    return (
      <>
        {variant === "inline" ? null : <GateShell variant={variant}>{acceptTermsButton}</GateShell>}
        <ConfidentialContextTermsDialog
          isBusy={isAccepting || isSigning}
          isOpen={isTermsDialogOpen}
          onAccept={acceptTerms}
          onClose={() => setIsTermsDialogOpen(false)}
        />
      </>
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
