import { AbsoluteFill } from "remotion";
import { headingFont, bodyFont } from "../fonts";
import { LogoLoop } from "../LogoLoop";
import { GradientText, useFadeInUp } from "../primitives";
import { colors, radiusCard } from "../theme";
import { OrbGlow } from "./Intro";

const CHIPS = [
  "Blinded Human Panels",
  "Focused Quality Gates",
  "Written Rationale",
  "Sealed Responses",
  "Settlement Evidence",
];

export const Outro = () => {
  const headline = useFadeInUp(22);
  const chips = useFadeInUp(70);

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <OrbGlow size={1000} opacity={0.18} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 44,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <LogoLoop
            size={120}
            startFrame={0}
            segmentStagger={2}
            segmentDraw={10}
            spinDegPerFrame={0.25}
            idPrefix="outro"
          />
          <span
            style={{
              fontFamily: headingFont,
              fontWeight: 700,
              fontSize: 72,
              color: colors.warmWhite,
            }}
          >
            RateLoop<GradientText>.ai</GradientText>
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
          Human Assurance for <GradientText>AI Workflows</GradientText>
        </h2>
        <div
          style={{
            ...chips,
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 18,
            maxWidth: 1180,
          }}
        >
          {CHIPS.map((chip) => (
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
