import { AbsoluteFill } from "remotion";
import { bodyFont, headingFont, monoFont } from "../fonts";
import { useFadeInUp } from "../primitives";
import { colors, radiusCard } from "../theme";
import { ChatBubble, ChatPanel, FieldRow, TypeOn } from "../ui";
import { OrbGlow } from "./Intro";

/** Beat 6 — the agent returns a report the founder can act on. */
export const Report = () => {
  const reportCard = useFadeInUp(56, 16);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <OrbGlow size={820} opacity={0.15} />
      <ChatPanel startFrame={4} width={1160}>
        <ChatBubble from="agent" startFrame={16} width="94%">
          <TypeOn
            text="Round settled — 25 verified raters. Here is your validation report:"
            startFrame={22}
            charsPerFrame={1.7}
            style={{ fontFamily: bodyFont }}
          />
        </ChatBubble>

        <div
          style={{
            ...reportCard,
            alignSelf: "flex-start",
            width: "94%",
            borderRadius: radiusCard + 4,
            border: `1px solid ${colors.shellBorder}`,
            background: colors.surfaceNested,
            padding: "26px 32px",
          }}
        >
          <div
            style={{
              fontFamily: headingFont,
              fontWeight: 700,
              fontSize: 30,
              color: colors.warmWhite,
              marginBottom: 6,
            }}
          >
            Validation report — AI meeting-notes app
          </div>
          <FieldRow label="rating" value="78% would try it" startFrame={86} valueColor={colors.voteYes} />
          <FieldRow label="confidence" value="high · 25 of 25 revealed" startFrame={100} />
          <FieldRow
            label="top objection"
            value={'"Pricing section is unclear"'}
            startFrame={114}
            valueColor={colors.yellow}
          />
          <FieldRow label="recommendation" value="Ship it — fix the pricing section first" startFrame={128} />
          <div
            style={{
              marginTop: 18,
              fontFamily: monoFont,
              fontSize: 20,
              color: colors.blue,
            }}
          >
            rateloop.ai/rate/1284 — public, citable result
          </div>
        </div>

        <ChatBubble from="user" startFrame={210}>
          <TypeOn text="Shipping it." startFrame={218} charsPerFrame={0.8} style={{ fontFamily: bodyFont }} />
        </ChatBubble>
      </ChatPanel>
    </AbsoluteFill>
  );
};
