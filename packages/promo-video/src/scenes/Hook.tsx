import { AbsoluteFill } from "remotion";
import { bodyFont, headingFont } from "../fonts";
import { GradientText, useFadeInUp } from "../primitives";
import { colors } from "../theme";
import { Caption, ChatBubble, ChatPanel, TypeOn } from "../ui";
import { OrbGlow } from "./Intro";

const PROMPT =
  "I have an idea for an AI meeting-notes app. Is the landing page convincing? Validate it before I build more.";

/** Beat 1 — a founder asks their agent for outside judgment. */
export const Hook = () => {
  const headline = useFadeInUp(8);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <OrbGlow size={820} opacity={0.16} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 44 }}>
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
          Your agent can build anything. <GradientText>Should it?</GradientText>
        </h1>
        <ChatPanel startFrame={26}>
          <ChatBubble from="user" startFrame={40}>
            <TypeOn text={PROMPT} startFrame={48} charsPerFrame={1.3} style={{ fontFamily: bodyFont }} />
          </ChatBubble>
        </ChatPanel>
      </div>
      <Caption text="One question. Real judgment. Before you build." startFrame={120} />
    </AbsoluteFill>
  );
};
