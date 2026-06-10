"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { TERMS_ACCEPTED_KEY, TERMS_VERSION } from "~~/constants/termsAcceptance";

export type ActionType = "faucet" | "vote" | "submit" | "claim" | "buy" | null;

interface TermsAcceptance {
  version: string;
  timestamp: number;
  termsAccepted: boolean;
  privacyAcknowledged: boolean;
}

interface TermsAcceptanceContextType {
  isAccepted: boolean | null;
  showModal: boolean;
  pendingAction: ActionType;
  requireAcceptance: (actionName: ActionType) => Promise<boolean>;
  acceptTerms: () => void;
  closeModal: () => void;
}

const TermsAcceptanceContext = createContext<TermsAcceptanceContextType | null>(null);

export type TermsAcceptanceResolver = (value: boolean) => void;

/**
 * Settles every queued requireAcceptance promise with the modal outcome.
 * Multiple actions can await acceptance concurrently; settling all of them
 * keeps no caller hanging when the modal resolves once.
 */
export function settlePendingTermsResolvers(queue: TermsAcceptanceResolver[], value: boolean) {
  const resolvers = queue.splice(0, queue.length);
  for (const resolve of resolvers) {
    resolve(value);
  }
}

function readStoredTermsAcceptance(): boolean {
  try {
    const stored = localStorage.getItem(TERMS_ACCEPTED_KEY);
    if (!stored) {
      return false;
    }

    const acceptance: TermsAcceptance = JSON.parse(stored);
    return acceptance.version === TERMS_VERSION && acceptance.termsAccepted;
  } catch {
    return false;
  }
}

export function TermsAcceptanceProvider({ children }: { children: React.ReactNode }) {
  const [isAccepted, setIsAccepted] = useState<boolean | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<ActionType>(null);

  // Store resolve functions for every pending promise; concurrent callers
  // (e.g. commitVote and claimAll) must all settle when the modal resolves.
  const pendingResolversRef = useRef<TermsAcceptanceResolver[]>([]);

  // Check localStorage on mount
  useEffect(() => {
    if (readStoredTermsAcceptance()) {
      setIsAccepted(true);
      return;
    }

    setIsAccepted(false);
  }, []);

  const requireAcceptance = useCallback(
    async (actionName: ActionType): Promise<boolean> => {
      const hasAcceptedTerms = isAccepted ?? readStoredTermsAcceptance();

      // Already accepted
      if (hasAcceptedTerms) {
        if (isAccepted !== true) {
          setIsAccepted(true);
        }
        return true;
      }

      if (isAccepted === null) {
        setIsAccepted(false);
      }

      // Show modal and wait for acceptance
      setPendingAction(actionName);
      setShowModal(true);

      // Return promise that resolves when user accepts or closes
      return new Promise<boolean>(resolve => {
        pendingResolversRef.current.push(resolve);
      });
    },
    [isAccepted],
  );

  const acceptTerms = useCallback(() => {
    const acceptance: TermsAcceptance = {
      version: TERMS_VERSION,
      timestamp: Date.now(),
      termsAccepted: true,
      privacyAcknowledged: true,
    };
    try {
      localStorage.setItem(TERMS_ACCEPTED_KEY, JSON.stringify(acceptance));
    } catch {
      // Accept for this page view even when browser storage is unavailable.
    }
    setIsAccepted(true);
    setShowModal(false);
    setPendingAction(null);

    // Resolve every pending promise with true
    settlePendingTermsResolvers(pendingResolversRef.current, true);
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setPendingAction(null);

    // Resolve every pending promise with false
    settlePendingTermsResolvers(pendingResolversRef.current, false);
  }, []);

  return (
    <TermsAcceptanceContext.Provider
      value={{
        isAccepted,
        showModal,
        pendingAction,
        requireAcceptance,
        acceptTerms,
        closeModal,
      }}
    >
      {children}
    </TermsAcceptanceContext.Provider>
  );
}

export function useTermsAcceptance() {
  const context = useContext(TermsAcceptanceContext);
  if (!context) {
    throw new Error("useTermsAcceptance must be used within TermsAcceptanceProvider");
  }
  return context;
}
