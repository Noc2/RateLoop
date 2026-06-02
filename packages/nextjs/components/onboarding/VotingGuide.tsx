"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAccount } from "wagmi";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { GradientActionButton } from "~~/components/shared/GradientAction";
import { HumanSignInButton } from "~~/components/shared/HumanSignInButton";
import { useOnboarding } from "~~/hooks/useOnboarding";
import { HUMAN_SIGN_IN_LABEL } from "~~/lib/home/humanSignInRoute";

const STEPS = [
  {
    label: HUMAN_SIGN_IN_LABEL,
    desc: "connect a wallet and start building calibration history",
  },
  { label: "Rate", desc: "submit a private thumbs-up/down signal and crowd forecast" },
  { label: "Lock", desc: "optionally back your signal with reputation once you are eligible" },
  {
    label: "Reveal & Resolve",
    desc: "after the private phase, signals are revealed and the round settles",
  },
  { label: "Claim", desc: "collect eligible rewards after settlement" },
];

/**
 * Right-side popup explaining the 5-step voting flow.
 * Shows once before the first vote until dismissed.
 */
export function VotingGuide() {
  const { shouldShowGuide, dismissGuide } = useOnboarding();
  const { address } = useAccount();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted || !shouldShowGuide) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 80 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 80 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="fixed left-4 right-4 top-24 z-50 overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(145deg,rgb(24_24_24/0.98),rgb(9_9_9/0.99)_58%,rgb(27_27_27/0.96))] shadow-[0_28px_72px_rgba(0,0,0,0.62),0_0_0_1px_rgba(245,245,245,0.04)] backdrop-blur-xl sm:left-auto sm:w-80"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgb(53_158_238/0.1),transparent_32%,rgb(3_206_164/0.07)_58%,rgb(239_71_111/0.08))]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[image:var(--rateloop-spectrum-gradient)] opacity-80"
        />

        {/* Header */}
        <div className="relative border-b border-white/10 px-5 pt-5 pb-4">
          <button
            onClick={dismissGuide}
            className="btn btn-ghost btn-xs btn-circle absolute right-3 top-3"
            aria-label="Dismiss guide"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
          <h3 className="pr-6 text-lg font-bold leading-snug">
            How It <span className="rateloop-text-gradient">Works</span>
          </h3>
        </div>

        {/* Steps */}
        <div className="relative space-y-3.5 px-5 py-4">
          {STEPS.map((step, i) => (
            <div key={step.label} className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] text-xs font-bold text-base-content/80 shadow-[inset_0_1px_0_rgba(245,245,245,0.06)]">
                {i + 1}
              </span>
              <p className="text-sm leading-snug text-base-content/70">
                <span className="font-semibold text-base-content">{step.label}</span>
                <span> — {step.desc}</span>
              </p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="relative px-5 pb-4">
          {!address ? (
            <HumanSignInButton className="w-full" gradientMotion="intro" gradientSize="sm" style={{ width: "100%" }}>
              {HUMAN_SIGN_IN_LABEL}
            </HumanSignInButton>
          ) : (
            <GradientActionButton
              className="w-full"
              motion="intro"
              size="sm"
              style={{ width: "100%" }}
              onClick={dismissGuide}
            >
              Start rating
            </GradientActionButton>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
