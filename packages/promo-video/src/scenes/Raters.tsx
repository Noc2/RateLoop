import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { bodyFont, headingFont, monoFont } from "../fonts";
import { GradientText, useFadeInUp } from "../primitives";
import { colors, radiusCard, spectrumGradient } from "../theme";
import { Card, Caption, ChatBubble, Chip, LockIcon, ThumbIcon, TypeOn } from "../ui";
import { OrbGlow } from "./Intro";

type Rater = { initials: string; ai?: boolean; commitAt: number };

const RATERS: Rater[] = [
  { initials: "MK", commitAt: 60 },
  { initials: "JR", commitAt: 84 },
  { initials: "AL", commitAt: 112 },
  { initials: "AI", ai: true, commitAt: 136 },
  { initials: "TS", commitAt: 168 },
  { initials: "NV", commitAt: 196 },
  { initials: "PD", commitAt: 228 },
  { initials: "EH", commitAt: 256 },
];

const RaterChip = ({ rater }: { rater: Rater }) => {
  const frame = useCurrentFrame();
  const entrance = useFadeInUp(rater.commitAt - 16, 14);
  const locked = frame >= rater.commitAt;
  const lockPop = interpolate(frame, [rater.commitAt, rater.commitAt + 8], [0.6, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const earnT = interpolate(frame, [rater.commitAt + 10, rater.commitAt + 52], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ ...entrance, position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      {/* USDC earn chip floating up */}
      {earnT > 0 && earnT < 1 && (
        <div
          style={{
            position: "absolute",
            top: -34 - earnT * 36,
            opacity: earnT < 0.75 ? 1 : (1 - earnT) * 4,
            fontFamily: monoFont,
            fontWeight: 700,
            fontSize: 19,
            color: colors.green,
            whiteSpace: "nowrap",
          }}
        >
          +0.75 USDC
        </div>
      )}
      <div
        style={{
          width: 86,
          height: 86,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: headingFont,
          fontWeight: 700,
          fontSize: 28,
          color: colors.warmWhite,
          background: rater.ai ? "transparent" : colors.surfaceNested,
          backgroundImage: rater.ai ? spectrumGradient : undefined,
          border: `1px solid ${colors.shellBorder}`,
        }}
      >
        <span
          style={
            rater.ai
              ? {
                  width: 80,
                  height: 80,
                  borderRadius: "50%",
                  background: colors.surfaceElevated,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }
              : undefined
          }
        >
          {rater.initials}
        </span>
      </div>
      <div style={{ height: 26, display: "flex", alignItems: "center", transform: `scale(${locked ? lockPop : 0})` }}>
        <LockIcon size={22} color={locked ? colors.yellow : "transparent"} />
      </div>
    </div>
  );
};

/** Beat 4 — verified humans (and an AI rater) vote blind and earn USDC. */
export const Raters = () => {
  const frame = useCurrentFrame();
  const upPick = frame >= 150;
  const slider = interpolate(frame, [180, 250], [0, 72], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pickPop = interpolate(frame, [150, 158], [1, 1.06], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pickSettle = interpolate(frame, [158, 168], [pickPop, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <OrbGlow size={840} opacity={0.13} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 40 }}>
        {/* Committing raters */}
        <div style={{ display: "flex", gap: 34 }}>
          {RATERS.map(r => (
            <RaterChip key={r.initials} rater={r} />
          ))}
        </div>

        <div style={{ display: "flex", gap: 48, alignItems: "stretch" }}>
          {/* Blind vote card */}
          <Card startFrame={84} style={{ width: 640, padding: "30px 38px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
              <Chip startFrame={96} color={colors.green}>
                <CheckDot /> Verified Human · World ID
              </Chip>
              <Chip startFrame={108}>blind vote</Chip>
            </div>
            <div style={{ display: "flex", gap: 22 }}>
              <VoteButton up active={upPick} scale={upPick ? pickSettle : 1} />
              <VoteButton up={false} active={false} scale={1} />
            </div>
            <div style={{ marginTop: 30 }}>
              <div style={{ fontFamily: monoFont, fontSize: 19, color: colors.steel, marginBottom: 12 }}>
                PREDICT THE CROWD — {Math.round(slider)}% will vote up
              </div>
              <div style={{ position: "relative", height: 12, borderRadius: 6, background: colors.surfaceNested }}>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: `${slider}%`,
                    borderRadius: 6,
                    backgroundImage: spectrumGradient,
                  }}
                />
              </div>
            </div>
          </Card>

          {/* Feedback note */}
          <Card startFrame={250} style={{ width: 560, padding: "28px 34px", alignSelf: "center" }}>
            <div style={{ fontFamily: monoFont, fontSize: 19, color: colors.steel, marginBottom: 14 }}>
              FEEDBACK · earns the bonus
            </div>
            <ChatBubble from="agent" startFrame={258} width="100%">
              <TypeOn
                text={'"Pricing section is unclear. Why two tiers at the same price?"'}
                startFrame={266}
                charsPerFrame={1.1}
                style={{ fontFamily: bodyFont, fontStyle: "italic" }}
              />
            </ChatBubble>
          </Card>
        </div>
      </div>
      {frame < 240 ? (
        <Caption text="Verified humans rate it blind — and earn USDC" startFrame={20} />
      ) : (
        <Caption text="Honest votes pay. Copying doesn't." startFrame={252} />
      )}
    </AbsoluteFill>
  );
};

const CheckDot = () => (
  <span
    style={{
      width: 12,
      height: 12,
      borderRadius: "50%",
      background: colors.green,
      display: "inline-block",
    }}
  />
);

const VoteButton = ({ up, active, scale }: { up: boolean; active: boolean; scale: number }) => (
  <div
    style={{
      flex: 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 14,
      padding: "24px 0",
      borderRadius: radiusCard + 2,
      border: `2px solid ${active ? colors.voteYes : colors.shellBorder}`,
      background: active ? "rgb(32 214 163 / 0.12)" : colors.surfaceNested,
      transform: `scale(${scale})`,
      fontFamily: bodyFont,
      fontWeight: 700,
      fontSize: 28,
      color: active ? colors.voteYes : colors.steel,
    }}
  >
    <ThumbIcon up={up} size={32} color={active ? colors.voteYes : colors.steel} />
    {up ? "Convincing" : "Not yet"}
  </div>
);
