import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { bodyFont, headingFont, monoFont } from "../fonts";
import { useFadeInUp } from "../primitives";
import { colors } from "../theme";
import { Caption, CheckIcon, Chip } from "../ui";
import { OrbGlow } from "./Intro";

const SWEEP_START = 30;
const SWEEP_END = 110;
const TARGET = 78;

/** Beat 5 — reveal and on-chain settlement: the result dial sweeps to 78%. */
export const Settle = () => {
  const frame = useCurrentFrame();
  const pct = interpolate(frame, [SWEEP_START, SWEEP_END], [0, TARGET], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const subline = useFadeInUp(120);
  const settled = useFadeInUp(150);

  const r = 190;
  const c = 2 * Math.PI * r;
  const arcSpan = 0.75; // 270° dial
  const dash = (pct / 100) * arcSpan * c;

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <OrbGlow size={900} opacity={0.18} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 30 }}>
        <div style={{ position: "relative", width: 480, height: 480 }}>
          <svg viewBox="0 0 480 480" width={480} height={480} style={{ transform: "rotate(135deg)" }}>
            <defs>
              <linearGradient id="dial-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={colors.blue} />
                <stop offset="0.45" stopColor={colors.green} />
                <stop offset="0.8" stopColor={colors.yellow} />
                <stop offset="1" stopColor={colors.pink} />
              </linearGradient>
            </defs>
            <circle
              cx="240"
              cy="240"
              r={r}
              fill="none"
              stroke="rgb(245 245 245 / 0.08)"
              strokeWidth="26"
              strokeDasharray={`${arcSpan * c} ${c}`}
              strokeLinecap="round"
            />
            <circle
              cx="240"
              cy="240"
              r={r}
              fill="none"
              stroke="url(#dial-grad)"
              strokeWidth="26"
              strokeDasharray={`${dash} ${c}`}
              strokeLinecap="round"
            />
          </svg>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <div style={{ fontFamily: headingFont, fontWeight: 700, fontSize: 110, color: colors.warmWhite }}>
              {Math.round(pct)}%
            </div>
            <div style={{ fontFamily: bodyFont, fontSize: 30, color: "rgb(245 245 245 / 0.75)" }}>would try it</div>
          </div>
        </div>

        <div style={{ ...subline, fontFamily: monoFont, fontSize: 23, color: colors.steel }}>
          crowd prediction 74% · calibrated reports rewarded
        </div>

        <div style={{ ...settled, display: "flex", alignItems: "center", gap: 16 }}>
          <Chip color={colors.green}>
            <CheckIcon size={22} color={colors.green} />
            Settled on-chain
          </Chip>
          <Chip>
            <span style={{ fontFamily: monoFont }}>World Chain · block 0x8f2…c41</span>
          </Chip>
        </div>
      </div>
      <Caption text="Settles on-chain. Auditable forever." startFrame={22} />
    </AbsoluteFill>
  );
};
