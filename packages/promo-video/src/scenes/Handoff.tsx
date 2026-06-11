import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { bodyFont, headingFont, monoFont } from "../fonts";
import { useFadeInUp } from "../primitives";
import { colors, orbitGradient, radiusCard } from "../theme";
import { Card, Caption, CheckIcon, FieldRow } from "../ui";
import { OrbGlow } from "./Intro";

const APPROVE_AT = 92;
const LIVE_AT = 132;

/** Beat 3 — review the handoff link and fund in one click. */
export const Handoff = () => {
  const frame = useCurrentFrame();
  const approved = frame >= APPROVE_AT + 16;
  const live = useFadeInUp(LIVE_AT, 16);
  const buttonPress = interpolate(frame, [APPROVE_AT, APPROVE_AT + 6, APPROVE_AT + 14], [1, 0.96, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <OrbGlow size={760} opacity={0.15} />
      <Card startFrame={6} style={{ width: 880, overflow: "hidden" }}>
        {/* Browser chrome */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "18px 26px",
            borderBottom: `1px solid ${colors.shellBorder}`,
            background: "rgb(245 245 245 / 0.03)",
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            {[colors.pink, colors.yellow, colors.green].map(c => (
              <span key={c} style={{ width: 13, height: 13, borderRadius: "50%", background: c, opacity: 0.7 }} />
            ))}
          </div>
          <div
            style={{
              flex: 1,
              borderRadius: radiusCard,
              border: `1px solid ${colors.shellBorder}`,
              background: colors.surfaceNested,
              padding: "10px 18px",
              fontFamily: monoFont,
              fontSize: 20,
              color: colors.steel,
            }}
          >
            rateloop.ai/agent/handoff/7f3a…#token
          </div>
        </div>

        <div style={{ padding: "32px 40px" }}>
          <div style={{ fontFamily: headingFont, fontWeight: 700, fontSize: 38, color: colors.warmWhite }}>
            Review &amp; Fund
          </div>
          <div style={{ marginTop: 10 }}>
            <FieldRow label="question" value="Would this landing page convince you?" startFrame={28} />
            <FieldRow label="bounty" value="25 USDC" startFrame={40} valueColor={colors.green} />
            <FieldRow label="network" value="World Chain" startFrame={52} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 30 }}>
            <div
              style={{
                padding: 3,
                borderRadius: radiusCard + 2,
                backgroundImage: orbitGradient(frame * 2.4),
                transform: `scale(${buttonPress})`,
                opacity: approved ? 0.45 : 1,
              }}
            >
              <div
                style={{
                  borderRadius: radiusCard,
                  padding: "18px 40px",
                  background: "linear-gradient(180deg, rgb(18 18 18 / 0.98), rgb(32 32 32 / 0.96))",
                  fontFamily: bodyFont,
                  fontWeight: 700,
                  fontSize: 28,
                  color: colors.warmWhite,
                }}
              >
                Approve in Wallet
              </div>
            </div>

            <div
              style={{
                ...live,
                display: "flex",
                alignItems: "center",
                gap: 14,
                fontFamily: bodyFont,
                fontWeight: 700,
                fontSize: 28,
                color: colors.green,
              }}
            >
              <CheckIcon size={30} color={colors.green} />
              Question live — round open
            </div>
          </div>
        </div>
      </Card>
      <Caption text="You review and fund in one click" startFrame={20} />
    </AbsoluteFill>
  );
};
