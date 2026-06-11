import { AbsoluteFill } from "remotion";
import { bodyFont, headingFont, monoFont } from "../fonts";
import { useFadeInUp } from "../primitives";
import { colors, radiusCard, spectrumGradient } from "../theme";
import { Card, ChatBubble, ChatPanel, CheckIcon, Chip, Caption, FieldRow, TypeOn } from "../ui";
import { OrbGlow } from "./Intro";

const ToolCall = ({ name, startFrame, doneFrame }: { name: string; startFrame: number; doneFrame: number }) => {
  const entrance = useFadeInUp(startFrame, 12);
  return (
    <div
      style={{
        ...entrance,
        display: "flex",
        alignItems: "center",
        gap: 14,
        fontFamily: monoFont,
        fontSize: 21,
        color: colors.steel,
      }}
    >
      <span style={{ color: colors.blue }}>→</span>
      {name}
      <span style={{ marginLeft: "auto" }}>
        <FadeCheck startFrame={doneFrame} />
      </span>
    </div>
  );
};

const FadeCheck = ({ startFrame }: { startFrame: number }) => {
  const entrance = useFadeInUp(startFrame, 8);
  return (
    <span style={{ ...entrance, display: "inline-flex" }}>
      <CheckIcon size={22} color={colors.green} />
    </span>
  );
};

/** Beat 2 — the agent drafts the RateLoop question. */
export const AgentAsk = () => {
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <OrbGlow size={780} opacity={0.14} />
      <div style={{ display: "flex", gap: 56, alignItems: "stretch" }}>
        <div style={{ width: 760, display: "flex", flexDirection: "column", gap: 24 }}>
          <ChatPanel startFrame={4} width={760}>
            <ChatBubble from="agent" startFrame={14} width="92%">
              <TypeOn
                text="On it. Drafting one focused RateLoop question with a USDC bounty."
                startFrame={20}
                charsPerFrame={1.6}
                style={{ fontFamily: bodyFont }}
              />
            </ChatBubble>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "4px 8px" }}>
              <ToolCall name="rateloop_quote_question" startFrame={70} doneFrame={96} />
              <ToolCall name="rateloop_create_ask_handoff_link" startFrame={106} doneFrame={140} />
            </div>
          </ChatPanel>
        </div>

        <Card startFrame={60} style={{ width: 700, padding: "30px 36px" }}>
          <div
            style={{
              fontFamily: monoFont,
              fontSize: 19,
              letterSpacing: 2,
              color: colors.steel,
              marginBottom: 14,
            }}
          >
            RATELOOP QUESTION
          </div>
          <div
            style={{
              fontFamily: headingFont,
              fontWeight: 700,
              fontSize: 33,
              lineHeight: 1.3,
              color: colors.warmWhite,
              marginBottom: 10,
            }}
          >
            <TypeOn text="Would this landing page convince you to try the app?" startFrame={74} charsPerFrame={1.5} />
          </div>
          <div
            style={{
              height: 110,
              borderRadius: radiusCard,
              backgroundImage: spectrumGradient,
              opacity: 0.22,
              margin: "14px 0 8px",
              border: `1px solid ${colors.shellBorder}`,
            }}
          />
          <FieldRow label="bounty" value="25 USDC" startFrame={120} valueColor={colors.green} />
          <FieldRow label="raters" value="25 votes required" startFrame={134} />
          <FieldRow label="audience" value="founders · freelancers" startFrame={148} />
          <FieldRow label="feedback bonus" value="5 USDC for written reasons" startFrame={162} />
          <div style={{ display: "flex", gap: 12, marginTop: 22 }}>
            <Chip startFrame={182}>blind round</Chip>
            <Chip startFrame={192}>crowd prediction</Chip>
            <Chip startFrame={202}>on-chain settle</Chip>
          </div>
        </Card>
      </div>
      <Caption text="Your agent turns it into one focused question" startFrame={26} />
    </AbsoluteFill>
  );
};
