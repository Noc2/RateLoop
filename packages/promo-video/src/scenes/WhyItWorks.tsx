import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { headingFont, bodyFont, monoFont } from "../fonts";
import { GradientText, useFadeInUp, ENTRANCE } from "../primitives";
import { colors, radiusCard } from "../theme";

// Titles from FEATURE_BENEFITS on the landing page, with condensed blurbs.
const FEATURES = [
  {
    title: "Verified and Independent",
    blurb: "World ID zero-knowledge proof-of-human raters, clustered to reward independent voting.",
    color: colors.green,
  },
  {
    title: "Honest and Quick",
    blurb: "Blind commit-reveal voting and Bayesian Truth Serum scoring make dishonest votes costly.",
    color: colors.blue,
  },
  {
    title: "Paid Rating Work",
    blurb: "Bounties pay eligible raters for revealed votes \u2014 in USDC, on World Chain.",
    color: colors.yellow,
  },
  {
    title: "Trustless and Transparent",
    blurb: "Questions, votes, rewards, and payouts settle on-chain and stay auditable.",
    color: colors.pink,
  },
];

const FeatureRow = ({ feature, startFrame }: { feature: (typeof FEATURES)[number]; startFrame: number }) => {
  const entrance = useFadeInUp(startFrame);
  return (
    <div style={{ ...entrance, borderLeft: `4px solid ${feature.color}`, paddingLeft: 32 }}>
      <h3
        style={{
          margin: 0,
          fontFamily: headingFont,
          fontWeight: 700,
          fontSize: 40,
          lineHeight: 1.2,
          color: colors.warmWhite,
        }}
      >
        {feature.title}
      </h3>
      <p
        style={{
          margin: "14px 0 0",
          fontFamily: bodyFont,
          fontSize: 26,
          lineHeight: 1.6,
          color: "rgb(245 245 245 / 0.6)",
          maxWidth: 700,
        }}
      >
        {feature.blurb}
      </p>
    </div>
  );
};

/** Mirror of the site's `.vote-btn.vote-yes` / `.vote-no` controls. */
const VoteButton = ({
  kind,
  pressFrame,
}: {
  kind: "yes" | "no";
  pressFrame?: number;
}) => {
  const frame = useCurrentFrame();
  const isYes = kind === "yes";
  let scale = 1;
  let glow = 0;
  if (pressFrame !== undefined) {
    scale = interpolate(
      frame,
      [pressFrame, pressFrame + 4, pressFrame + 14],
      [1, 0.94, 1.06],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ENTRANCE },
    );
    glow = interpolate(frame, [pressFrame, pressFrame + 14], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }
  return (
    <div
      style={{
        width: 200,
        height: 92,
        borderRadius: radiusCard,
        background: isYes ? colors.voteYes : colors.voteNo,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        fontFamily: bodyFont,
        fontWeight: 700,
        fontSize: 34,
        color: isYes ? colors.actionContent : "#ffffff",
        transform: `scale(${scale})`,
        boxShadow:
          glow > 0
            ? `0 0 0 ${3 * glow}px ${isYes ? "rgb(32 214 163 / 0.25)" : "rgb(255 107 122 / 0.25)"}`
            : "inset 0 1px 0 rgb(245 245 245 / 0.2)",
      }}
    >
      {isYes ? "\u2713 YES" : "\u2715 NO"}
    </div>
  );
};

const SETTLE_FRAME = 150;

const VoteCard = ({ startFrame }: { startFrame: number }) => {
  const frame = useCurrentFrame();
  const entrance = useFadeInUp(startFrame);
  const settled = interpolate(frame, [SETTLE_FRAME, SETTLE_FRAME + 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ENTRANCE,
  });
  const barWidth = interpolate(frame, [SETTLE_FRAME + 6, SETTLE_FRAME + 40], [0, 78], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return (
    <div
      style={{
        ...entrance,
        width: 640,
        borderRadius: radiusCard,
        background: colors.surfaceElevated,
        border: `1px solid ${colors.shellBorder}`,
        padding: 48,
        display: "flex",
        flexDirection: "column",
        gap: 36,
      }}
    >
      <span style={{ fontFamily: monoFont, fontSize: 22, color: colors.steel }}>
        QUESTION &middot; 5 USDC BOUNTY &middot; 25 RATERS
      </span>
      <p
        style={{
          margin: 0,
          fontFamily: bodyFont,
          fontSize: 34,
          lineHeight: 1.5,
          color: colors.warmWhite,
        }}
      >
        Would you ship this onboarding flow to real users?
      </p>
      <div style={{ display: "flex", gap: 28 }}>
        <VoteButton kind="yes" pressFrame={startFrame + 60} />
        <VoteButton kind="no" />
      </div>
      <div style={{ opacity: settled, display: "flex", flexDirection: "column", gap: 16 }}>
        <div
          style={{
            height: 14,
            borderRadius: 999,
            background: "rgb(245 245 245 / 0.08)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${barWidth}%`,
              height: "100%",
              borderRadius: 999,
              background: `linear-gradient(90deg, ${colors.green}, ${colors.blue})`,
            }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: bodyFont, fontSize: 26 }}>
          <span style={{ color: colors.green, fontWeight: 700 }}>Settled &middot; {Math.round(barWidth)}% YES</span>
          <span style={{ color: colors.steel }}>25 raters paid in USDC</span>
        </div>
      </div>
    </div>
  );
};

export const WhyItWorks = () => {
  const heading = useFadeInUp(0);
  const kicker = useFadeInUp(0);

  return (
    <AbsoluteFill style={{ justifyContent: "center", padding: "0 140px" }}>
      <div style={{ marginBottom: 70 }}>
        <span
          style={{
            ...kicker,
            display: "block",
            marginBottom: 26,
            fontFamily: monoFont,
            fontSize: 26,
            letterSpacing: "0.2em",
            color: "rgb(245 245 245 / 0.7)",
          }}
        >
          02
        </span>
        <h2
          style={{
            ...heading,
            margin: 0,
            fontFamily: headingFont,
            fontWeight: 700,
            fontSize: 96,
            lineHeight: 1.05,
            color: colors.warmWhite,
          }}
        >
          Why It <GradientText>Works</GradientText>
        </h2>
      </div>
      <div style={{ display: "flex", gap: 110, alignItems: "center" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 52 }}>
          <FeatureRow feature={FEATURES[0]} startFrame={26} />
          <FeatureRow feature={FEATURES[1]} startFrame={44} />
          <FeatureRow feature={FEATURES[2]} startFrame={62} />
          <FeatureRow feature={FEATURES[3]} startFrame={80} />
        </div>
        <VoteCard startFrame={40} />
      </div>
    </AbsoluteFill>
  );
};
