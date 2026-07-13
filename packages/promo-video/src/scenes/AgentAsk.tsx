import { AbsoluteFill } from "remotion";
import { bodyFont, headingFont, monoFont } from "../fonts";
import { useFadeInUp } from "../primitives";
import { colors, radiusCard, spectrumGradient } from "../theme";
import {
  Card,
  ChatBubble,
  ChatPanel,
  CheckIcon,
  FieldRow,
  TypeOn,
} from "../ui";
import { RewardChip, surfaceCardStyle } from "../siteUi";
import { OrbGlow } from "./Intro";

const ToolCall = ({
  name,
  startFrame,
  doneFrame,
}: {
  name: string;
  startFrame: number;
  doneFrame: number;
}) => {
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

/** Beat 2 — the workspace turns the rollout decision into a focused panel. */
export const AgentAsk = () => {
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <OrbGlow size={780} opacity={0.14} />
      <div style={{ display: "flex", gap: 56, alignItems: "stretch" }}>
        <div
          style={{
            width: 760,
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          <ChatPanel startFrame={4} width={760}>
            <ChatBubble from="agent" startFrame={14} width="92%">
              <TypeOn
                text="Turning that decision into one focused human panel."
                startFrame={20}
                charsPerFrame={1.6}
                style={{ fontFamily: bodyFont }}
              />
            </ChatBubble>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
                padding: "4px 8px",
              }}
            >
              <ToolCall name="rateloop_quote" startFrame={70} doneFrame={96} />
              <ToolCall
                name="rateloop_prepare_ask"
                startFrame={106}
                doneFrame={140}
              />
            </div>
          </ChatPanel>
        </div>

        {/* Question preview styled like a discover feed card: centered title header,
            brand reward chips with near-black text, borderless surface card. */}
        <Card
          startFrame={60}
          style={{ ...surfaceCardStyle, width: 700, padding: "26px 30px" }}
        >
          <div
            style={{
              fontFamily: monoFont,
              fontSize: 19,
              letterSpacing: 2,
              color: colors.steel,
              marginBottom: 16,
            }}
          >
            HUMAN ASSURANCE PANEL
          </div>
          <div
            style={{
              borderRadius: radiusCard + 4,
              background: "rgb(245 245 245 / 0.05)",
              padding: "22px 28px",
              textAlign: "center",
              fontFamily: headingFont,
              fontWeight: 600,
              fontSize: 31,
              lineHeight: 1.3,
              color: colors.warmWhite,
            }}
          >
            <TypeOn
              text="Would you approve this AI-drafted reply for a customer?"
              startFrame={74}
              charsPerFrame={1.5}
            />
          </div>
          <div
            style={{
              height: 100,
              borderRadius: radiusCard,
              backgroundImage: spectrumGradient,
              opacity: 0.22,
              margin: "16px 0 18px",
              border: `1px solid ${colors.shellBorder}`,
            }}
          />
          <div style={{ display: "flex", gap: 14, marginBottom: 8 }}>
            <RewardChip brand="blue" startFrame={120}>
              25 USDC Bounty
            </RewardChip>
            <RewardChip brand="green" startFrame={132}>
              5 USDC Attempt Reserve
            </RewardChip>
          </div>
          <FieldRow label="raters" value="25 votes required" startFrame={146} />
          <FieldRow
            label="audience"
            value="support leads · customers"
            startFrame={160}
          />
        </Card>
      </div>
    </AbsoluteFill>
  );
};
