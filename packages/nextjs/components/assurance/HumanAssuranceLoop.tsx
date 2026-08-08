import type { Locale } from "~~/i18n/config";
import { getMessagesForLocale } from "~~/i18n/messages";

const stageDefinitions = [
  {
    number: "01",
    key: "policy",
    color: "var(--rateloop-blue)",
  },
  {
    number: "02",
    key: "submit",
    color: "var(--rateloop-green)",
  },
  {
    number: "03",
    key: "judge",
    color: "var(--rateloop-yellow)",
  },
  {
    number: "04",
    key: "evaluate",
    color: "var(--rateloop-pink)",
  },
] as const;

export function HumanAssuranceLoop({
  className = "",
  concise = false,
  locale = "en",
}: {
  className?: string;
  concise?: boolean;
  locale?: Locale;
}) {
  const copy = getMessagesForLocale(locale).home.loop;
  const stages = stageDefinitions.map(stage => {
    const stageCopy = copy.stages[stage.key];
    return {
      ...stage,
      title: stageCopy.title,
      body: stageCopy.body,
      conciseBody: "concise" in stageCopy ? stageCopy.concise : stageCopy.body,
    };
  });

  return (
    <section
      className={`rounded-2xl border border-base-content/10 bg-base-content/[0.025] p-5 sm:p-8 ${className}`}
      aria-labelledby="human-assurance-loop-title"
    >
      <div className="grid items-center gap-8 lg:grid-cols-[minmax(19rem,0.9fr)_minmax(0,1.1fr)] lg:gap-12">
        <figure className="mx-auto w-full max-w-[31rem]">
          <div className="relative aspect-square">
            <svg viewBox="0 0 440 440" className="h-full w-full" aria-hidden="true">
              <defs>
                <radialGradient id="assurance-loop-glow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="var(--rateloop-green)" stopOpacity="0.13" />
                  <stop offset="58%" stopColor="var(--rateloop-blue)" stopOpacity="0.05" />
                  <stop offset="100%" stopColor="var(--rateloop-surface)" stopOpacity="0" />
                </radialGradient>
                <filter id="assurance-loop-tracer-glow" x="-200%" y="-200%" width="400%" height="400%">
                  <feGaussianBlur stdDeviation="8" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <circle cx="220" cy="220" r="196" fill="url(#assurance-loop-glow)" />
              <circle
                cx="220"
                cy="220"
                r="156"
                fill="none"
                stroke="var(--color-base-content)"
                strokeOpacity="0.08"
                strokeWidth="18"
              />
              {stages.map((stage, index) => (
                <circle
                  key={stage.number}
                  cx="220"
                  cy="220"
                  r="156"
                  fill="none"
                  pathLength="100"
                  stroke={stage.color}
                  strokeWidth="9"
                  strokeLinecap="round"
                  strokeDasharray="25 75"
                  strokeDashoffset={String(index * -25)}
                  transform="rotate(-90 220 220)"
                />
              ))}
              <g className="rateloop-assurance-tracer" filter="url(#assurance-loop-tracer-glow)">
                <circle cx="220" cy="64" r="7" fill="var(--color-base-content)" />
                <circle cx="220" cy="64" r="15" fill="none" stroke="var(--color-base-content)" strokeOpacity="0.18" />
              </g>
              {[
                [220, 64],
                [376, 220],
                [220, 376],
                [64, 220],
              ].map(([cx, cy], index) => (
                <g key={`${cx}-${cy}`} className="rateloop-assurance-node">
                  <circle
                    cx={cx}
                    cy={cy}
                    r="20"
                    fill="var(--rateloop-surface-elevated)"
                    stroke={stages[index]?.color}
                    strokeWidth="2"
                  />
                  <text
                    x={cx}
                    y={cy + 4}
                    fill={stages[index]?.color}
                    fontSize="12"
                    fontFamily="monospace"
                    textAnchor="middle"
                  >
                    {index + 1}
                  </text>
                </g>
              ))}
            </svg>
            <figcaption className="pointer-events-none absolute inset-[29%] flex flex-col items-center justify-center rounded-full border border-base-content/10 bg-[rgb(var(--rateloop-surface-elevated-rgb)/0.84)] text-center shadow-[0_0_80px_rgb(3_206_164/0.08)] backdrop-blur-sm">
              <h3
                id="human-assurance-loop-title"
                className="flex flex-col items-center text-[clamp(0.72rem,3.2vw,1.25rem)] font-bold leading-[1.08]"
              >
                <span>{copy.titleLine1}</span>
                <span>{copy.titleLine2}</span>
                <span className="inline-block text-base-content">{copy.titleLine3}</span>
              </h3>
            </figcaption>
          </div>
        </figure>

        <div className="w-full">
          <ol className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
            {stages.map(stage => (
              <li key={stage.number} className="border-l-2 pl-4" style={{ borderColor: stage.color }}>
                <span className="font-mono text-sm" style={{ color: stage.color }}>
                  {stage.number}
                </span>
                <h4 className="mt-1 text-xl font-semibold">{stage.title}</h4>
                <p className="mt-2 text-[0.95rem] leading-7 text-base-content/55 sm:text-base">
                  {concise ? stage.conciseBody : stage.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
