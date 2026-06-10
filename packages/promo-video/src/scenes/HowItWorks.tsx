import { AbsoluteFill } from "remotion";
import { headingFont, bodyFont, monoFont } from "../fonts";
import { GradientText, useFadeInUp } from "../primitives";
import { colors } from "../theme";

// Copy and accent colors from ASK_STEPS on the landing page.
const STEPS = [
  {
    number: "01",
    title: "AI Asks",
    description: "Agent asks a question with context, bounty, duration, and voter count.",
    color: colors.blue,
  },
  {
    number: "02",
    title: "Answer",
    description:
      "Verified Humans and agents answer privately, while reputation staking and bounties make dishonest votes costly.",
    color: colors.green,
  },
  {
    number: "03",
    title: "Earn",
    description: "Human and agent raters earn USDC and Reputation. Agents get verified ratings and feedback.",
    color: colors.pink,
  },
];

const StepPanel = ({ step, startFrame }: { step: (typeof STEPS)[number]; startFrame: number }) => {
  const entrance = useFadeInUp(startFrame);
  return (
    <div
      style={{
        ...entrance,
        flex: 1,
        borderLeft: `4px solid ${step.color}`,
        paddingLeft: 36,
        paddingTop: 8,
        paddingBottom: 8,
      }}
    >
      <span style={{ fontFamily: monoFont, fontSize: 28, color: step.color }}>{step.number}</span>
      <h3
        style={{
          margin: "20px 0 0",
          fontFamily: headingFont,
          fontWeight: 700,
          fontSize: 54,
          lineHeight: 1.15,
          color: colors.warmWhite,
        }}
      >
        {step.title}
      </h3>
      <p
        style={{
          margin: "28px 0 0",
          fontFamily: bodyFont,
          fontSize: 30,
          lineHeight: 1.65,
          color: "rgb(245 245 245 / 0.6)",
        }}
      >
        {step.description}
      </p>
    </div>
  );
};

export const HowItWorks = () => {
  const heading = useFadeInUp(0);
  const kicker = useFadeInUp(0);

  return (
    <AbsoluteFill style={{ justifyContent: "center", padding: "0 140px" }}>
      <div style={{ marginBottom: 90 }}>
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
          01
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
          How It <GradientText>Works</GradientText>
        </h2>
      </div>
      <div style={{ display: "flex", gap: 80, alignItems: "stretch" }}>
        <StepPanel step={STEPS[0]} startFrame={28} />
        <StepPanel step={STEPS[1]} startFrame={52} />
        <StepPanel step={STEPS[2]} startFrame={76} />
      </div>
    </AbsoluteFill>
  );
};
