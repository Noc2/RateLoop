import { AbsoluteFill, useCurrentFrame } from "remotion";
import { headingFont, bodyFont } from "../fonts";
import { LogoLoop } from "../LogoLoop";
import { GradientText, useFadeInUp } from "../primitives";
import { colors, orbitGradient, radiusCard } from "../theme";
import { OrbGlow } from "./Intro";

/** Mirror of the site's `.rateloop-gradient-action` orbit-border button. */
const OrbitButton = ({ label, startFrame }: { label: string; startFrame: number }) => {
  const frame = useCurrentFrame();
  const entrance = useFadeInUp(startFrame);
  return (
    <div
      style={{
        ...entrance,
        padding: 3,
        borderRadius: radiusCard + 2,
        backgroundImage: orbitGradient(frame * 2.4),
        boxShadow: "0 0 0 1px rgb(245 245 245 / 0.08), 0 18px 36px rgb(0 0 0 / 0.32)",
      }}
    >
      <div
        style={{
          borderRadius: radiusCard,
          padding: "30px 64px",
          background: `linear-gradient(180deg, rgb(18 18 18 / 0.98), rgb(32 32 32 / 0.96))`,
          fontFamily: bodyFont,
          fontWeight: 700,
          fontSize: 40,
          color: colors.warmWhite,
          boxShadow: "inset 0 1px 0 rgb(245 245 245 / 0.08)",
        }}
      >
        {label}
      </div>
    </div>
  );
};

const CHIPS = ["Remote MCP", "World Chain USDC", "World ID Verified"];

export const Outro = () => {
  const headline = useFadeInUp(22);
  const chips = useFadeInUp(70);

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <OrbGlow size={1000} opacity={0.18} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 44 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <LogoLoop size={120} startFrame={0} segmentStagger={2} segmentDraw={10} spinDegPerFrame={0.25} idPrefix="outro" />
          <span style={{ fontFamily: headingFont, fontWeight: 700, fontSize: 72, color: colors.warmWhite }}>
            RateLoop
          </span>
        </div>
        <h2
          style={{
            ...headline,
            margin: 0,
            fontFamily: headingFont,
            fontWeight: 700,
            fontSize: 100,
            lineHeight: 1.05,
            color: colors.warmWhite,
            textAlign: "center",
          }}
        >
          Ask <GradientText>Real Humans</GradientText>.
        </h2>
        <OrbitButton label="Level Up Your Agent" startFrame={46} />
        <div style={{ ...chips, display: "flex", gap: 18 }}>
          {CHIPS.map(chip => (
            <span
              key={chip}
              style={{
                borderRadius: radiusCard,
                border: `1px solid ${colors.shellBorder}`,
                background: "rgb(245 245 245 / 0.06)",
                padding: "14px 26px",
                fontFamily: bodyFont,
                fontWeight: 600,
                fontSize: 24,
                color: "rgb(245 245 245 / 0.72)",
              }}
            >
              {chip}
            </span>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
