"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useConfidentialityBond } from "~~/hooks/useConfidentialityBond";
import type { ContentItem } from "~~/hooks/useContentFeed";
import { fetchConfidentialityTermsStatus } from "~~/lib/confidentiality/clientTermsStatus";
import {
  CONFIDENTIALITY_ACCEPTED_EVENT,
  CONFIDENTIALITY_READ_SESSION_CONFIRMED_EVENT,
  getConfidentialContextVoteBlocker,
  getConfidentialityBondRequirement,
  isPrivateContextMetadata,
} from "~~/lib/vote/confidentialContext";

export function useConfidentialContextAccessBlocker(item: ContentItem | null | undefined) {
  const { address } = useAccount();
  const gated = isPrivateContextMetadata(item ?? null);
  const isOwnContent = Boolean(item?.isOwnContent);
  const contentId = item?.id ?? 0n;
  const confidentialityScope = useMemo(
    () => ({
      chainId: item?.chainId ?? undefined,
      contentRegistryAddress: item?.contentRegistryAddress ?? undefined,
      deploymentKey: item?.deploymentKey ?? undefined,
    }),
    [item?.chainId, item?.contentRegistryAddress, item?.deploymentKey],
  );
  const bondRequirement = useMemo(
    () => getConfidentialityBondRequirement(item?.confidentiality),
    [item?.confidentiality],
  );
  const [accepted, setAccepted] = useState(false);
  const [hasReadSession, setHasReadSession] = useState(false);
  const [isCheckingTerms, setIsCheckingTerms] = useState(false);
  const [hasCheckedTerms, setHasCheckedTerms] = useState(false);

  useEffect(() => {
    setAccepted(false);
    setHasReadSession(false);
    setIsCheckingTerms(false);
    setHasCheckedTerms(false);
  }, [address, contentId, gated, isOwnContent]);

  useEffect(() => {
    if (!gated || !address || isOwnContent || contentId <= 0n) return;

    let cancelled = false;
    setIsCheckingTerms(true);
    fetchConfidentialityTermsStatus(address, contentId, confidentialityScope)
      .then(status => {
        if (!cancelled) {
          setAccepted(status.accepted);
          setHasReadSession(status.hasSession);
          setHasCheckedTerms(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAccepted(false);
          setHasReadSession(false);
          setHasCheckedTerms(true);
        }
      })
      .finally(() => {
        if (!cancelled) setIsCheckingTerms(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, confidentialityScope, contentId, gated, isOwnContent]);

  useEffect(() => {
    if (!gated || isOwnContent || typeof window === "undefined") return;

    const handleAccepted = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      const detailRecord = detail && typeof detail === "object" ? (detail as Record<string, unknown>) : null;
      const matchingContent = detailRecord?.contentId === contentId.toString();
      const matchingDeployment =
        !item?.deploymentKey ||
        (typeof detailRecord?.deploymentKey === "string" &&
          detailRecord.deploymentKey.toLowerCase() === item.deploymentKey.toLowerCase());
      const matchingChain = typeof item?.chainId !== "number" || detailRecord?.chainId === item.chainId;
      if (matchingContent && matchingDeployment && matchingChain) {
        setAccepted(true);
        setHasReadSession(true);
        setHasCheckedTerms(true);
      }
    };

    const handleReadSessionConfirmed = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      const detailRecord = detail && typeof detail === "object" ? (detail as Record<string, unknown>) : null;
      const matchingContent = detailRecord?.contentId === contentId.toString();
      const matchingDeployment =
        !item?.deploymentKey ||
        (typeof detailRecord?.deploymentKey === "string" &&
          detailRecord.deploymentKey.toLowerCase() === item.deploymentKey.toLowerCase());
      const matchingChain = typeof item?.chainId !== "number" || detailRecord?.chainId === item.chainId;
      if (matchingContent && matchingDeployment && matchingChain) {
        setHasReadSession(true);
        setHasCheckedTerms(true);
      }
    };

    window.addEventListener(CONFIDENTIALITY_ACCEPTED_EVENT, handleAccepted);
    window.addEventListener(CONFIDENTIALITY_READ_SESSION_CONFIRMED_EVENT, handleReadSessionConfirmed);
    return () => {
      window.removeEventListener(CONFIDENTIALITY_ACCEPTED_EVENT, handleAccepted);
      window.removeEventListener(CONFIDENTIALITY_READ_SESSION_CONFIRMED_EVENT, handleReadSessionConfirmed);
    };
  }, [contentId, gated, isOwnContent, item?.chainId, item?.deploymentKey]);

  const bond = useConfidentialityBond({
    bondRequirement,
    contentId,
    enabled: gated && accepted && hasReadSession && !isOwnContent && contentId > 0n,
  });

  if (!gated || isOwnContent) return null;

  const isTermsStatusPending = Boolean(address && !hasCheckedTerms && !accepted);
  const isSessionStatusPending = Boolean(address && !hasCheckedTerms);
  const isBondStatusPending = Boolean(
    accepted &&
      hasReadSession &&
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
    hasReadSession: !address || !hasCheckedTerms || hasReadSession,
    hasActiveBond: bond.hasActiveBond,
    hasActiveHumanCredential: bond.hasActiveHumanCredential && Boolean(bond.identityKey),
    identityResolved: bond.isIdentityResolved && !bond.isIdentityLoading,
    isBondChecking: bond.isCheckingBond || isBondStatusPending,
    isGated: gated,
    isSessionChecking: isCheckingTerms || isSessionStatusPending,
    isTermsChecking: isCheckingTerms || isTermsStatusPending,
  });
}
