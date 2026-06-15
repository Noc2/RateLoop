"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useConfidentialityBond } from "~~/hooks/useConfidentialityBond";
import type { ContentItem } from "~~/hooks/useContentFeed";
import { fetchConfidentialityTermsStatus } from "~~/lib/confidentiality/clientTermsStatus";
import {
  CONFIDENTIALITY_ACCEPTED_EVENT,
  getConfidentialContextVoteBlocker,
  getConfidentialityBondRequirement,
  isPrivateContextMetadata,
} from "~~/lib/vote/confidentialContext";

export function useConfidentialContextAccessBlocker(item: ContentItem | null | undefined) {
  const { address } = useAccount();
  const gated = isPrivateContextMetadata(item ?? null);
  const isOwnContent = Boolean(item?.isOwnContent);
  const contentId = item?.id ?? 0n;
  const bondRequirement = useMemo(
    () => getConfidentialityBondRequirement(item?.confidentiality),
    [item?.confidentiality],
  );
  const [accepted, setAccepted] = useState(false);
  const [isCheckingTerms, setIsCheckingTerms] = useState(false);
  const [hasCheckedTerms, setHasCheckedTerms] = useState(false);

  useEffect(() => {
    setAccepted(false);
    setIsCheckingTerms(false);
    setHasCheckedTerms(false);
  }, [address, contentId, gated, isOwnContent]);

  useEffect(() => {
    if (!gated || !address || isOwnContent || contentId <= 0n) return;

    let cancelled = false;
    setIsCheckingTerms(true);
    fetchConfidentialityTermsStatus(address, contentId)
      .then(status => {
        if (!cancelled) {
          setAccepted(status.accepted);
          setHasCheckedTerms(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAccepted(false);
          setHasCheckedTerms(true);
        }
      })
      .finally(() => {
        if (!cancelled) setIsCheckingTerms(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, contentId, gated, isOwnContent]);

  useEffect(() => {
    if (!gated || isOwnContent || typeof window === "undefined") return;

    const handleAccepted = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      if (detail?.contentId === contentId.toString()) {
        setAccepted(true);
        setHasCheckedTerms(true);
      }
    };

    window.addEventListener(CONFIDENTIALITY_ACCEPTED_EVENT, handleAccepted);
    return () => {
      window.removeEventListener(CONFIDENTIALITY_ACCEPTED_EVENT, handleAccepted);
    };
  }, [contentId, gated, isOwnContent]);

  const bond = useConfidentialityBond({
    bondRequirement,
    contentId,
    enabled: gated && accepted && !isOwnContent && contentId > 0n,
  });

  if (!gated || isOwnContent) return null;

  const isTermsStatusPending = Boolean(address && !hasCheckedTerms && !accepted);
  const isBondStatusPending = Boolean(
    accepted &&
      bondRequirement.isRequired &&
      bond.hasActiveHumanCredential &&
      bond.identityKey &&
      !bond.hasCheckedBond &&
      !bond.error,
  );

  return getConfidentialContextVoteBlocker({
    bondRequirement,
    escrowConfigured: Boolean(bond.escrowAddress),
    hasAcceptedTerms: accepted,
    hasActiveBond: bond.hasActiveBond,
    hasActiveHumanCredential: bond.hasActiveHumanCredential && Boolean(bond.identityKey),
    identityResolved: bond.isIdentityResolved && !bond.isIdentityLoading,
    isBondChecking: bond.isCheckingBond || isBondStatusPending,
    isGated: gated,
    isTermsChecking: isCheckingTerms || isTermsStatusPending,
  });
}
