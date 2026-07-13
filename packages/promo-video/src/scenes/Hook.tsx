import { AbsoluteFill } from "remotion";
import { bodyFont, headingFont } from "../fonts";
import { GradientText, useFadeInUp } from "../primitives";
import { colors } from "../theme";
import { Caption, ChatBubble, ChatPanel, TypeOn } from "../ui";
import { OrbGlow } from "./Intro";

const PROMPT =
  "Our AI support assistant drafted this reply. Does it meet our quality bar before it reaches a customer?";

/** Beat 1 — a buyer names a real AI-workflow quality gate. */
export const Hook = () => {
  const headline = useFadeInUp(8);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <OrbGlow size={820} opacity={0.16} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 44,
        }}
      >
        <h1
          style={{
            ...headline,
            margin: 0,
            fontFamily: headingFont,
            fontWeight: 700,
            fontSize: 64,
            color: colors.warmWhite,
            textAlign: "center",
          }}
        >
          AI moves fast. <GradientText>Is the workflow ready?</GradientText>
        </h1>
        <ChatPanel startFrame={26}>
          <ChatBubble from="user" startFrame={40}>
            <TypeOn
              text={PROMPT}
              startFrame={48}
              charsPerFrame={1.3}
              style={{ fontFamily: bodyFont }}
            />
          </ChatBubble>
        </ChatPanel>
      </div>
      <Caption
        text="One quality gate. Real human judgment. Before rollout."
        startFrame={120}
      />
    </AbsoluteFill>
  );
};
