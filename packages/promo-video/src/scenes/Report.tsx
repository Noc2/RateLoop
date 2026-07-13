import { AbsoluteFill } from "remotion";
import { bodyFont, headingFont } from "../fonts";
import { useFadeInUp } from "../primitives";
import { colors, radiusCard } from "../theme";
import { ChatBubble, ChatPanel, FieldRow, TypeOn } from "../ui";
import { OutlineButton } from "../siteUi";
import { OrbGlow } from "./Intro";

/** Beat 6 — the buyer receives decision evidence, not an automatic approval. */
export const Report = () => {
  const reportCard = useFadeInUp(56, 16);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <OrbGlow size={820} opacity={0.15} />
      <ChatPanel startFrame={4} width={1160}>
        <ChatBubble from="agent" startFrame={16} width="94%">
          <TypeOn
            text="Round settled — 25 eligible human raters. Here is your assurance report:"
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
            Human assurance result — AI support workflow
          </div>
          <FieldRow
            label="panel signal"
            value="78% met the quality bar"
            startFrame={86}
            valueColor={colors.voteYes}
          />
          <FieldRow
            label="coverage"
            value="25 of 25 revealed"
            startFrame={100}
          />
          <FieldRow
            label="top concern"
            value={'"Escalation wording is unclear"'}
            startFrame={114}
            valueColor={colors.yellow}
          />
          <FieldRow
            label="decision input"
            value="Revise the wording, then retest"
            startFrame={128}
          />
          <FieldRow
            label="decision owner"
            value="Customer support lead"
            startFrame={150}
          />
          <div style={{ marginTop: 22 }}>
            <OutlineButton
              label="Inspect settlement evidence"
              startFrame={168}
            />
          </div>
        </div>

        <ChatBubble from="user" startFrame={210}>
          <TypeOn
            text="We'll revise, retest, and decide."
            startFrame={218}
            charsPerFrame={0.8}
            style={{ fontFamily: bodyFont }}
          />
        </ChatBubble>
      </ChatPanel>
    </AbsoluteFill>
  );
};
