import type { Metadata } from "next";
import { ArrowPathIcon, CheckIcon, HandThumbDownIcon, HandThumbUpIcon, WalletIcon } from "@heroicons/react/24/outline";
import { RateLoopLogo } from "~~/components/RateLoopLogo";

export const metadata: Metadata = {
  title: "Gradient Button Study | RateLoop",
  description: "A RateLoop gradient-border button motion study.",
};

type MotionState = "active" | "idle";
type ButtonTone = "dark" | "solid";
type ButtonSize = "default" | "lg";

function GradientActionButton({
  children,
  icon,
  motion = "idle",
  tone = "dark",
  size = "default",
  disabled = false,
  className = "",
  voteDirection,
  spinIcon = false,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  motion?: MotionState;
  tone?: ButtonTone;
  size?: ButtonSize;
  disabled?: boolean;
  className?: string;
  voteDirection?: "up" | "down";
  spinIcon?: boolean;
}) {
  return (
    <button
      type="button"
      className={`rateloop-gradient-action ${voteDirection ? "rateloop-gradient-vote" : ""} ${className}`}
      data-motion={motion}
      data-tone={tone}
      data-size={size}
      data-direction={voteDirection}
      disabled={disabled}
      aria-busy={motion === "active" || undefined}
    >
      <span className="rateloop-gradient-action-inner">
        {icon ? (
          <span className="rateloop-gradient-action-icon" data-spin={spinIcon || undefined}>
            {icon}
          </span>
        ) : null}
        <span>{children}</span>
      </span>
    </button>
  );
}

function StudyCard({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <article className="surface-card flex min-h-[12rem] flex-col p-6">
      <span className="font-mono text-sm text-base-content/55">{number}</span>
      <h2 className="mt-3 text-xl font-semibold text-base-content">{title}</h2>
      <div className="mt-auto flex min-h-24 items-end">{children}</div>
    </article>
  );
}

export default function ButtonMotionStudyPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-12 sm:px-6 lg:px-8">
      <section className="grid gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
        <div className="max-w-2xl">
          <div className="flex items-center gap-3">
            <RateLoopLogo className="h-10 w-10" idPrefix="button-motion-study-logo" />
            <span className="font-mono text-sm tracking-widest text-base-content/60">MOTION STUDY</span>
          </div>
          <h1 className="display-section mt-6 text-[2.7rem] text-base-content sm:text-[4rem]">
            Gradient <span className="rateloop-text-gradient">Action</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-base-content/70">
            The motion feels strongest as feedback for wallet and transaction waits. Idle CTAs can keep a quiet static
            edge; vote buttons work best when the animation appears only after a click while the vote submits.
          </p>
        </div>

        <div className="relative flex min-h-[20rem] items-center justify-center overflow-hidden rounded-lg bg-base-200 p-8 shadow-[0_36px_80px_rgb(0_0_0/0.45)] ring-1 ring-white/10">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgb(53_158_238/0.13),transparent_34%,rgb(3_206_164/0.1)_56%,rgb(239_71_111/0.11))]" />
          <div className="relative flex flex-col items-center gap-5 text-center">
            <GradientActionButton
              motion="active"
              tone="solid"
              size="lg"
              disabled
              spinIcon
              icon={<ArrowPathIcon aria-hidden className="h-full w-full" />}
            >
              Submit transaction
            </GradientActionButton>
            <p className="max-w-sm text-sm leading-6 text-base-content/58">
              One animated action per surface keeps the brand color useful instead of noisy.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StudyCard number="01" title="Transaction pending">
          <GradientActionButton
            motion="active"
            tone="solid"
            disabled
            spinIcon
            icon={<ArrowPathIcon aria-hidden className="h-full w-full" />}
          >
            Submitting
          </GradientActionButton>
        </StudyCard>

        <StudyCard number="02" title="Sign-in ready">
          <GradientActionButton icon={<WalletIcon aria-hidden className="h-full w-full" />}>
            Sign in
          </GradientActionButton>
        </StudyCard>

        <StudyCard number="03" title="Vote submitting">
          <div className="flex flex-wrap gap-3">
            <GradientActionButton
              motion="active"
              disabled
              voteDirection="up"
              icon={<HandThumbUpIcon aria-hidden className="h-full w-full" />}
            >
              Up
            </GradientActionButton>
            <GradientActionButton
              disabled
              voteDirection="down"
              icon={<HandThumbDownIcon aria-hidden className="h-full w-full" />}
            >
              Down
            </GradientActionButton>
          </div>
        </StudyCard>

        <StudyCard number="04" title="Success settled">
          <GradientActionButton tone="dark" icon={<CheckIcon aria-hidden className="h-full w-full" />}>
            Confirmed
          </GradientActionButton>
        </StudyCard>
      </section>
    </div>
  );
}
