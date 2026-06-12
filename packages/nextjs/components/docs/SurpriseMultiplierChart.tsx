import { DocsDiagramFrame } from "~~/components/docs/DocsDiagramPrimitives";

// Plot area mapping for the clamp curve: x = agreement / base rate in [0, 4],
// y = surprise multiplier in [0.5, 3.5].
const X0 = 48;
const X1 = 448;
const Y0 = 166;
const Y1 = 18;
const xAt = (u: number) => X0 + (u / 4) * (X1 - X0);
const yAt = (v: number) => Y0 - ((v - 0.5) / 3) * (Y0 - Y1);

/** The surprise multiplier is a kinked clamp: flat 1.0x floor, linear, 3.0x cap. */
export function SurpriseMultiplierChart() {
  const line = [
    [xAt(0), yAt(1)],
    [xAt(1), yAt(1)],
    [xAt(3), yAt(3)],
    [xAt(4), yAt(3)],
  ]
    .map(([x, y]) => `${x},${y}`)
    .join(" ");

  return (
    <DocsDiagramFrame
      title="Surprise Multiplier Shape"
      description="Answers that merely match the prior pay the flat floor; answers that predict peers better than the trailing base rate earn up to the 3.0x cap."
    >
      <svg
        viewBox="0 0 460 200"
        role="img"
        aria-label="Surprise multiplier versus agreement over base rate: flat at 1x until agreement equals the base rate, rising linearly to a 3x cap"
        className="h-auto w-full"
      >
        {/* axes */}
        <line x1={X0} y1={Y0} x2={X1} y2={Y0} stroke="currentColor" strokeOpacity="0.25" />
        <line x1={X0} y1={Y0} x2={X0} y2={Y1} stroke="currentColor" strokeOpacity="0.25" />
        {/* floor / cap guides */}
        {[1, 3].map(v => (
          <line
            key={v}
            x1={X0}
            y1={yAt(v)}
            x2={X1}
            y2={yAt(v)}
            stroke="currentColor"
            strokeOpacity="0.12"
            strokeDasharray="4 4"
          />
        ))}
        {/* kink markers at x = 1 and x = 3 */}
        {[1, 3].map(u => (
          <line
            key={u}
            x1={xAt(u)}
            y1={Y0}
            x2={xAt(u)}
            y2={yAt(u === 1 ? 1 : 3)}
            stroke="currentColor"
            strokeOpacity="0.12"
            strokeDasharray="4 4"
          />
        ))}
        <polyline points={line} fill="none" stroke="var(--rateloop-green)" strokeWidth="3" strokeLinejoin="round" />
        {/* y labels */}
        <text x={X0 - 8} y={yAt(1) + 4} textAnchor="end" className="fill-current text-[11px] opacity-60">
          1.0x
        </text>
        <text x={X0 - 8} y={yAt(3) + 4} textAnchor="end" className="fill-current text-[11px] opacity-60">
          3.0x
        </text>
        {/* x labels */}
        <text x={xAt(1)} y={Y0 + 16} textAnchor="middle" className="fill-current text-[11px] opacity-60">
          1
        </text>
        <text x={xAt(3)} y={Y0 + 16} textAnchor="middle" className="fill-current text-[11px] opacity-60">
          3
        </text>
        <text x={(X0 + X1) / 2} y={Y0 + 32} textAnchor="middle" className="fill-current text-[11px] opacity-45">
          agreement / trailing base rate
        </text>
        <text
          x={14}
          y={(Y0 + Y1) / 2}
          textAnchor="middle"
          transform={`rotate(-90 14 ${(Y0 + Y1) / 2})`}
          className="fill-current text-[11px] opacity-45"
        >
          multiplier
        </text>
      </svg>
    </DocsDiagramFrame>
  );
}
