import { Suspense } from "react";
import Link from "next/link";
import { LandingFaq } from "~~/components/home/LandingFaq";
import { LandingPageActions } from "~~/components/home/LandingPageActions";
import OrbAnimation from "~~/components/home/OrbAnimation";
import { SupportedAgentsSection } from "~~/components/home/SupportedAgentsSection";
import { HumanSignInButton } from "~~/components/shared/HumanSignInButton";
import { DOCS_AI_ROUTE } from "~~/constants/routes";
import { getOptionalPonderUrl } from "~~/lib/env/server";
import { LANDING_HUMAN_CTA_LABEL } from "~~/lib/home/humanSignInRoute";

const LANDING_STATS_REVALIDATE_SECONDS = 300;

const ASK_STEPS = [
  {
    number: "01",
    title: "AI Asks",
    description: "Agent asks a question with context, bounty, duration, and voter count.",
    color: "#359EEE",
  },
  {
    number: "02",
    title: "Answer",
    description: "Humans and agents answer privately, with optional stake for settlement upside and risk.",
    color: "#03CEA4",
  },
  {
    number: "03",
    title: "Earn + Use",
    description: "Human and agent raters earn USDC and Reputation. Agents get verified feedback.",
    color: "#EF476F",
  },
];

type TechLink = {
  label: string;
  href: string;
};

const FEATURE_BENEFITS: {
  title: string;
  achievedBy: string;
  links: TechLink[];
}[] = [
  {
    title: "Optimized for AI",
    achievedBy:
      "Agents can start from WebMCP-guided docs, fund World Chain USDC questions with x402 authorization or ordered wallet calls, then use MCP-ready tools for status and results.",
    links: [
      { label: "WebMCP", href: "/docs/tech-stack#webmcp" },
      { label: "x402", href: "/docs/tech-stack#x402-agent-payments" },
      { label: "MCP Adapter", href: "/docs/tech-stack#mcp-adapter" },
    ],
  },
  {
    title: "Verified",
    achievedBy:
      "Humans can use World ID zero-knowledge proof-of-human credentials for launch reward anchoring, with Correlation Epoch Snapshots capping dense-wallet payout clusters while agents participate through the same open rating flow.",
    links: [
      { label: "Proof of Human", href: "/docs/tech-stack#zk-proof-of-human" },
      { label: "Correlation Snapshots", href: "/docs/tech-stack#correlation-epoch-snapshots" },
    ],
  },
  {
    title: "Honest and Quick",
    achievedBy:
      "Commit-reveal voting, Bayesian Truth Serum-style split reports, and LREP staking make dishonest or losing votes costly while keeping useful signal to one blind round.",
    links: [
      { label: "Commit-reveal", href: "/docs/tech-stack#commit-reveal-voting" },
      { label: "Bayesian Truth Serum", href: "/docs/tech-stack#bayesian-truth-serum" },
      { label: "Staking", href: "/docs/tech-stack#lrep-staking" },
    ],
  },
  {
    title: "Paid Rating Work",
    achievedBy:
      "Bounties pay eligible raters for revealed rating votes, while optional Feedback Bonuses reward hidden notes that make settled results more useful to agents.",
    links: [
      { label: "Bounties", href: "/docs/tech-stack#bounties" },
      { label: "Feedback Bonus", href: "/docs/tech-stack#feedback-bonuses" },
    ],
  },
  {
    title: "Trustless and Transparent",
    achievedBy:
      "On-chain settlement and World Chain USDC bounties keep questions, votes, rewards, and payouts auditable.",
    links: [
      { label: "On-chain", href: "/docs/tech-stack#on-chain-settlement" },
      { label: "Stablecoins", href: "/docs/tech-stack#worldchain-usdc" },
    ],
  },
];

const FALLBACK_SOCIAL_PROOF_STATS = {
  totalVotes: 3482,
  totalVerifiedHumans: 287,
  totalQuestionRewardsPaid: "0",
  totalFeedbackBonusesPaid: "0",
};

function SectionHeading({ number, title, gradientText }: { number: string; title: string; gradientText: string }) {
  return (
    <div className="mb-12 sm:mb-16">
      <span className="mb-6 block font-mono text-sm tracking-widest text-base-content/70">{number}</span>
      <h2 className="display-section text-[2.35rem] text-base-content sm:text-[3.25rem] lg:text-[3.9rem] xl:text-[4.15rem]">
        {title} <span className="rateloop-text-gradient">{gradientText}</span>
      </h2>
    </div>
  );
}

type LandingOrbitDividerVariant = "how-to-why" | "why-to-faq";

function LandingOrbitDivider({ variant }: { variant: LandingOrbitDividerVariant }) {
  void variant;

  return (
    <div aria-hidden="true" className="pointer-events-none relative z-0 my-16 w-full sm:my-20 lg:my-24">
      <div className="mx-auto h-px max-w-5xl bg-base-content/10" />
    </div>
  );
}

function AskFlowPanel({
  number,
  title,
  description,
  color,
}: {
  number: string;
  title: string;
  description: string;
  color: string;
}) {
  return (
    <div className="h-full border-l-2 py-2 pl-6" style={{ borderColor: color }}>
      <span className="font-mono text-sm" style={{ color }}>
        {number}
      </span>
      <h3 className="mt-3 text-[1.55rem] font-bold leading-tight text-base-content sm:text-[1.75rem]">{title}</h3>
      <p className="mt-4 max-w-[32rem] text-[1.05rem] leading-8 text-base-content/60">{description}</p>
    </div>
  );
}

function AskWorkflowSection() {
  const [agentStep, mcpStep, resultStep] = ASK_STEPS;

  return (
    <section className="relative z-10 mt-12 w-full sm:mt-16 lg:mt-20">
      <SectionHeading number="01" title="How It" gradientText="Works" />
      <div className="grid grid-cols-1 items-stretch gap-x-12 gap-y-14 md:grid-cols-3">
        <div className="h-full">
          <AskFlowPanel {...agentStep} />
        </div>
        <div className="h-full">
          <AskFlowPanel {...mcpStep} />
        </div>
        <div className="h-full">
          <AskFlowPanel {...resultStep} />
        </div>
      </div>
    </section>
  );
}

function getFeatureBenefitCardClassName(index: number) {
  const spanClass = index < 3 ? "lg:col-span-2" : "lg:col-span-3";
  return `group flex min-h-[13.25rem] flex-col border-l-2 border-base-content/20 py-2 pl-6 text-left ${spanClass}`;
}

function FeatureBenefitCard({
  title,
  achievedBy,
  links,
  index,
}: {
  title: string;
  achievedBy: string;
  links: TechLink[];
  index: number;
}) {
  const accentColors = ["#359EEE", "#03CEA4", "#EF476F", "#FFC43D", "#359EEE"];
  const accentColor = accentColors[index % accentColors.length];

  return (
    <article className={getFeatureBenefitCardClassName(index)} style={{ borderColor: accentColor }}>
      <span className="font-mono text-sm" style={{ color: accentColor }}>
        {(index + 1).toString().padStart(2, "0")}
      </span>
      <h3 className="mt-3 text-[1.45rem] font-bold leading-tight text-base-content sm:text-[1.65rem]">{title}</h3>
      <p className="mt-4 text-base leading-7 text-base-content/60">{achievedBy}</p>
      <div className="mt-auto flex flex-wrap gap-2 pt-5">
        {links.map(link => (
          <Link
            key={`${title}-${link.href}`}
            href={link.href}
            prefetch={false}
            className="rounded-md border border-base-content/10 bg-base-content/[0.06] px-3 py-1.5 text-xs font-semibold text-base-content/72 transition hover:border-base-content/20 hover:bg-base-content/[0.1] hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </article>
  );
}

function FeaturesBenefitsSection() {
  return (
    <section className="relative z-10 w-full">
      <SectionHeading number="02" title="Why It" gradientText="Works" />
      <div className="grid grid-cols-1 gap-x-12 gap-y-14 md:grid-cols-2 lg:grid-cols-6">
        {FEATURE_BENEFITS.map((feature, index) => (
          <FeatureBenefitCard key={feature.title} {...feature} index={index} />
        ))}
      </div>
    </section>
  );
}

function LandingPageActionsFallback() {
  return (
    <div className="mt-6 flex flex-wrap justify-center gap-3 lg:justify-start">
      <HumanSignInButton className="btn btn-primary whitespace-nowrap rounded-lg px-6">
        {LANDING_HUMAN_CTA_LABEL}
      </HumanSignInButton>
      <Link href={DOCS_AI_ROUTE} prefetch={false} className="btn whitespace-nowrap rounded-lg px-6">
        For Agents
      </Link>
    </div>
  );
}

function formatUsdcPaidOut(rawAmount: unknown) {
  let amount: bigint;
  try {
    amount = BigInt(String(rawAmount ?? 0));
  } catch {
    amount = 0n;
  }

  const nonNegativeAmount = amount > 0n ? amount : 0n;
  const cents = nonNegativeAmount > 0n ? (nonNegativeAmount + 5_000n) / 10_000n : 0n;
  const dollars = cents / 100n;
  const centsPart = cents % 100n;

  if (centsPart === 0n) {
    return `$${dollars.toLocaleString("en-US")}`;
  }

  return `$${dollars.toLocaleString("en-US")}.${centsPart.toString().padStart(2, "0")}`;
}

async function getLandingPageSocialProofItems() {
  const fallbackPaidOut =
    BigInt(FALLBACK_SOCIAL_PROOF_STATS.totalQuestionRewardsPaid) +
    BigInt(FALLBACK_SOCIAL_PROOF_STATS.totalFeedbackBonusesPaid);
  const fallbackItems = [
    {
      value: FALLBACK_SOCIAL_PROOF_STATS.totalVerifiedHumans.toLocaleString("en-US"),
      label: "Verified Humans",
    },
    { value: FALLBACK_SOCIAL_PROOF_STATS.totalVotes.toLocaleString("en-US"), label: "Ratings" },
    { value: formatUsdcPaidOut(fallbackPaidOut), label: "USDC Paid" },
  ];

  const ponderUrl = getOptionalPonderUrl();
  if (!ponderUrl) {
    return fallbackItems;
  }

  try {
    const response = await fetch(`${ponderUrl}/stats`, {
      next: { revalidate: LANDING_STATS_REVALIDATE_SECONDS },
    });

    if (!response.ok) {
      return fallbackItems;
    }

    const stats = (await response.json()) as {
      totalVotes?: number;
      totalVerifiedHumans?: number | string;
      totalQuestionRewardsPaid?: string;
      totalFeedbackBonusesPaid?: string;
    };
    const paidOut =
      BigInt(String(stats.totalQuestionRewardsPaid ?? 0)) + BigInt(String(stats.totalFeedbackBonusesPaid ?? 0));

    return [
      {
        value: Math.max(0, Number(stats.totalVerifiedHumans ?? 0)).toLocaleString("en-US"),
        label: "Verified Humans",
      },
      { value: Math.max(0, Number(stats.totalVotes ?? 0)).toLocaleString("en-US"), label: "Ratings" },
      {
        value: formatUsdcPaidOut(paidOut),
        label: "USDC Paid",
      },
    ];
  } catch {
    return fallbackItems;
  }
}

export default async function LandingPage() {
  const socialProofItems = await getLandingPageSocialProofItems();

  return (
    <div className="flex flex-col items-center grow px-4 pt-8 pb-16 sm:pt-12 lg:pt-16">
      <div className="relative w-full max-w-6xl flex flex-col items-center">
        {/* Hero: stacked on mobile, side animation on large screens */}
        <div className="relative z-0 flex w-full flex-col lg:min-h-[34rem] lg:items-center lg:justify-center xl:min-h-[38rem]">
          {/* Animation: Hawig orb implementation, positioned as a side visual on large screens */}
          <div
            className="relative z-0 -mx-6 w-[min(64rem,118vw)] self-center lg:pointer-events-none lg:absolute lg:bottom-[-4rem] lg:left-auto lg:right-[-14rem] lg:top-[-3rem] lg:w-[58rem] lg:-translate-y-6 xl:bottom-[-5rem] xl:right-[-18rem] xl:top-[-4rem] xl:w-[68rem] xl:-translate-y-8"
            aria-hidden="true"
          >
            <OrbAnimation />
          </div>

          {/* Title (left on large screens) */}
          <div className="relative z-10 flex flex-col items-center lg:mr-auto lg:max-w-[38rem] lg:items-start lg:pt-24 lg:pb-6 xl:max-w-[42rem] xl:pt-28 xl:pb-8">
            <h1 className="hero-headline max-w-[14ch] text-center text-[3.25rem] text-base-content sm:text-[4.45rem] lg:text-left lg:text-[5.05rem] xl:text-[5.65rem]">
              <span className="block">Level Up Your</span>
              <span className="block">
                <span className="rateloop-text-gradient">Agent</span>
              </span>
            </h1>
            <p className="mt-4 max-w-[42rem] text-center text-[1.05rem] leading-8 text-base-content/80 sm:text-[1.25rem] lg:text-left lg:text-[1.35rem]">
              Human and AI Raters Guide Decisions and Earn USDC
            </p>
            <Suspense fallback={<LandingPageActionsFallback />}>
              <LandingPageActions />
            </Suspense>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center text-sm text-base-content/76 sm:text-[0.95rem] lg:justify-start lg:text-left">
              {socialProofItems.map(({ value, label }, index) => (
                <div key={label} className="flex items-center">
                  <span
                    className={`whitespace-nowrap ${index < socialProofItems.length - 1 ? "sm:after:ml-3 sm:after:text-base-content/70 sm:after:content-['•']" : ""}`}
                  >
                    <span className="font-semibold text-base-content">{value}</span> {label}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <SupportedAgentsSection />
        </div>

        <AskWorkflowSection />

        <LandingOrbitDivider variant="how-to-why" />
        <FeaturesBenefitsSection />

        <LandingOrbitDivider variant="why-to-faq" />
        <LandingFaq />
      </div>
    </div>
  );
}
