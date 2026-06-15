import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { headingFont, bodyFont } from "../fonts";
import { LogoLoop } from "../LogoLoop";
import { GradientText, useFadeInUp } from "../primitives";
import { colors, orbitGradient } from "../theme";

/** Soft, blurred echo of the site's hero orb animation. */
export const OrbGlow = ({ size, opacity }: { size: number; opacity: number }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundImage: orbitGradient(frame * 0.8),
        filter: "blur(160px)",
        opacity,
      }}
    />
  );
};

export const Intro = () => {
  const frame = useCurrentFrame();
  const wordmark = useFadeInUp(30);
  const headline = useFadeInUp(60);
  const subline = useFadeInUp(80);
  const logoScale = interpolate(frame, [0, 60], [0.92, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <OrbGlow size={900} opacity={0.22} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 36 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 32, transform: `scale(${logoScale})` }}>
          <LogoLoop size={170} startFrame={4} idPrefix="intro" />
          <div
            style={{
              ...wordmark,
              fontFamily: headingFont,
              fontWeight: 700,
              fontSize: 96,
              color: colors.warmWhite,
              letterSpacing: 0,
            }}
          >
            RateLoop
          </div>
        </div>
        <h1
          style={{
            ...headline,
            margin: 0,
            fontFamily: headingFont,
            fontWeight: 700,
            fontSize: 124,
            lineHeight: 1,
            color: colors.warmWhite,
            textAlign: "center",
          }}
        >
          Level Up Your <GradientText>Agent</GradientText>
        </h1>
        <p
          style={{
            ...subline,
            margin: 0,
            fontFamily: bodyFont,
            fontSize: 42,
            lineHeight: 1.6,
            color: "rgb(245 245 245 / 0.8)",
            textAlign: "center",
          }}
        >
          Human and AI raters guide decisions and earn USDC
        </p>
      </div>
    </AbsoluteFill>
  );
};
