import { DocsDiagramFrame, MiniPill } from "~~/components/docs/DocsDiagramPrimitives";

const X0 = 52;
const X1 = 456;
const Y0 = 176;
const Y1 = 22;
const MAX_MARGIN_BPS = 3_000;
const MAX_BONUS_OF_BASE_PERCENT = 12.5;
const xAt = (marginBps: number) => X0 + (marginBps / MAX_MARGIN_BPS) * (X1 - X0);
const yAt = (percentOfBase: number) => Y0 - (percentOfBase / MAX_BONUS_OF_BASE_PERCENT) * (Y0 - Y1);

export function SurprisinglyPopularBonusChart() {
  const thresholdX = xAt(500);
  const thresholdBonusY = yAt(2.5);
  const saturationX = xAt(2_500);
  const saturationY = yAt(12.5);
  const curve = [
    `${X0},${Y0}`,
    `${thresholdX},${Y0}`,
    `${thresholdX},${thresholdBonusY}`,
    `${saturationX},${saturationY}`,
    `${X1},${saturationY}`,
  ].join(" ");

  return (
    <DocsDiagramFrame
      eyebrow="tokenless-sp-bounty-v1"
      title="Surprisingly Popular top-up"
      description="For a report on the selected surprising outcome, the platform-funded top-up grows with its leave-one-out surprise margin. It does not change the verdict."
    >
      <svg
        viewBox="0 0 480 226"
        role="img"
        aria-label="Surprisingly Popular top-up is zero below a 500 basis point surprise margin, starts at 2.5 percent of guaranteed base at the threshold, rises to 12.5 percent at 2,500 basis points, and remains capped"
        className="h-auto w-full"
      >
        <line x1={X0} y1={Y0} x2={X1} y2={Y0} stroke="currentColor" strokeOpacity="0.25" />
        <line x1={X0} y1={Y0} x2={X0} y2={Y1} stroke="currentColor" strokeOpacity="0.25" />

        {[2.5, 12.5].map(percent => (
          <line
            key={percent}
            x1={X0}
            y1={yAt(percent)}
            x2={X1}
            y2={yAt(percent)}
            stroke="currentColor"
            strokeOpacity="0.12"
            strokeDasharray="4 4"
          />
        ))}
        {[500, 2_500].map(margin => (
          <line
            key={margin}
            x1={xAt(margin)}
            y1={Y0}
            x2={xAt(margin)}
            y2={margin === 500 ? thresholdBonusY : saturationY}
            stroke="currentColor"
            strokeOpacity="0.14"
            strokeDasharray="4 4"
          />
        ))}

        <polyline points={curve} fill="none" stroke="var(--rateloop-pink)" strokeWidth="3" strokeLinejoin="round" />
        <circle cx={thresholdX} cy={thresholdBonusY} r="4" fill="var(--rateloop-pink)" />
        <circle cx={saturationX} cy={saturationY} r="4" fill="var(--rateloop-pink)" />

        <text x={X0 - 8} y={Y0 + 4} textAnchor="end" className="fill-current text-[10px] opacity-60">
          0%
        </text>
        <text x={X0 - 8} y={yAt(2.5) + 4} textAnchor="end" className="fill-current text-[10px] opacity-60">
          2.5%
        </text>
        <text x={X0 - 8} y={yAt(12.5) + 4} textAnchor="end" className="fill-current text-[10px] opacity-60">
          12.5%
        </text>

        <text x={thresholdX} y={Y0 + 17} textAnchor="middle" className="fill-current text-[10px] opacity-60">
          500
        </text>
        <text x={saturationX} y={Y0 + 17} textAnchor="middle" className="fill-current text-[10px] opacity-60">
          2,500
        </text>
        <text x={(X0 + X1) / 2} y={Y0 + 37} textAnchor="middle" className="fill-current text-[10px] opacity-45">
          leave-one-out surprise margin (basis points)
        </text>
        <text
          x="14"
          y={(Y0 + Y1) / 2}
          textAnchor="middle"
          transform={`rotate(-90 14 ${(Y0 + Y1) / 2})`}
          className="fill-current text-[10px] opacity-45"
        >
          top-up (% of guaranteed base)
        </text>
      </svg>

      <div className="mt-3 flex flex-wrap gap-2">
        <MiniPill accent="pink">500 bps qualification</MiniPill>
        <MiniPill accent="yellow">2,500 bps saturation</MiniPill>
        <MiniPill accent="green">12.5% maximum of base</MiniPill>
        <MiniPill accent="blue">10-report minimum</MiniPill>
      </div>
    </DocsDiagramFrame>
  );
}
