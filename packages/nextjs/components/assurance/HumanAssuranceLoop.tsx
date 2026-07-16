const stages = [
  {
    number: "01",
    title: "Owner sets policy",
    body: "Sets review rules, risk thresholds, audience, data boundaries, and spending limits.",
    conciseBody: "Sets review rules, risk thresholds, audience, data boundaries, and spending limits.",
    color: "#359EEE",
  },
  {
    number: "02",
    title: "Agent submits work",
    body: "Submits the work, context, declared risk, and supporting evidence within the owner-approved policy.",
    conciseBody: "Submits work, context, and evidence within the owner-approved policy.",
    color: "#03CEA4",
  },
  {
    number: "03",
    title: "Humans judge",
    body: "Eligible people answer independently. The verdict, reasons, and agreement evidence return to the agent.",
    conciseBody: "Independent humans return verdicts, reasons, and evidence.",
    color: "#FFC43D",
  },
  {
    number: "04",
    title: "Evaluation",
    body: "Returns evidence-backed feedback and actionable insights for this workflow.",
    conciseBody: "Returns evidence-backed feedback and actionable insights for this workflow.",
    color: "#EF476F",
  },
] as const;

export function HumanAssuranceLoop({ className = "", concise = false }: { className?: string; concise?: boolean }) {
  return (
    <section
      className={`rateloop-assurance-loop rounded-2xl border border-base-content/10 bg-base-content/[0.025] p-5 sm:p-8 ${className}`}
      aria-labelledby="human-assurance-loop-title"
    >
      <div className="grid items-center gap-8 lg:grid-cols-[minmax(19rem,0.9fr)_minmax(0,1.1fr)] lg:gap-12">
        <figure className="mx-auto w-full max-w-[31rem]">
          <div className="relative aspect-square">
            <svg viewBox="0 0 440 440" className="h-full w-full" aria-hidden="true">
              <defs>
                <radialGradient id="assurance-loop-glow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#03CEA4" stopOpacity="0.13" />
                  <stop offset="58%" stopColor="#359EEE" stopOpacity="0.05" />
                  <stop offset="100%" stopColor="#000000" stopOpacity="0" />
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
              <circle cx="220" cy="220" r="156" fill="none" stroke="white" strokeOpacity="0.08" strokeWidth="18" />
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
                <circle cx="220" cy="64" r="7" fill="#f5f5f5" />
                <circle cx="220" cy="64" r="15" fill="none" stroke="#f5f5f5" strokeOpacity="0.18" />
              </g>
              {[
                [220, 64],
                [376, 220],
                [220, 376],
                [64, 220],
              ].map(([cx, cy], index) => (
                <g key={`${cx}-${cy}`} className="rateloop-assurance-node">
                  <circle cx={cx} cy={cy} r="20" fill="#090909" stroke={stages[index]?.color} strokeWidth="2" />
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
            <figcaption className="pointer-events-none absolute inset-[29%] flex flex-col items-center justify-center rounded-full border border-white/10 bg-black/70 text-center shadow-[0_0_80px_rgb(3_206_164/0.08)] backdrop-blur-sm">
              <h3
                id="human-assurance-loop-title"
                className="flex flex-col items-center text-[clamp(0.72rem,3.2vw,1.25rem)] font-bold leading-[1.08]"
              >
                <span>Human</span>
                <span>Assurance</span>
                <span className="rateloop-text-gradient inline-block">Loop</span>
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
          {!concise ? (
            <p className="mt-6 text-xs leading-5 text-base-content/45">
              Coverage never becomes a global score. Evidence remains scoped to the exact agent version, policy,
              workflow, risk tier, and reviewer audience.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
