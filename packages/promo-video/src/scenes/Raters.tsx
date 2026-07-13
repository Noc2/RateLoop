import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { bodyFont, headingFont, monoFont } from "../fonts";
import { useFadeInUp } from "../primitives";
import { RatingOrb } from "../RatingOrb";
import { colors, spectrumGradient } from "../theme";
import { Caption, Card, ChatBubble, Chip, LockIcon, TypeOn } from "../ui";
import {
  GradientActionButton,
  MicroLabel,
  VoteButton,
  surfaceCardStyle,
  votingCardOverlay,
} from "../siteUi";
import { OrbGlow } from "./Intro";

type Rater = { initials: string; commitAt: number };

const RATERS: Rater[] = [
  { initials: "MK", commitAt: 60 },
  { initials: "JR", commitAt: 84 },
  { initials: "AL", commitAt: 112 },
  { initials: "SK", commitAt: 136 },
  { initials: "TS", commitAt: 168 },
  { initials: "NV", commitAt: 196 },
  { initials: "PD", commitAt: 228 },
  { initials: "EH", commitAt: 256 },
];

const VOTE_AT = 150;
const SHEET_AT = 205;
const SUBMIT_PRESS_AT = 330;

const RaterChip = ({ rater }: { rater: Rater }) => {
  const frame = useCurrentFrame();
  const entrance = useFadeInUp(rater.commitAt - 16, 14);
  const locked = frame >= rater.commitAt;
  const lockPop = interpolate(
    frame,
    [rater.commitAt, rater.commitAt + 8],
    [0.6, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const earnT = interpolate(
    frame,
    [rater.commitAt + 10, rater.commitAt + 52],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  return (
    <div
      style={{
        ...entrance,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
      }}
    >
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
          background: colors.surfaceNested,
          border: `1px solid ${colors.shellBorder}`,
        }}
      >
        <span>{rater.initials}</span>
      </div>
      <div
        style={{
          height: 26,
          display: "flex",
          alignItems: "center",
          transform: `scale(${locked ? lockPop : 0})`,
        }}
      >
        <LockIcon size={22} color={locked ? colors.yellow : "transparent"} />
      </div>
    </div>
  );
};

/** Range-slider replica for the crowd-forecast control. */
const SheetSlider = ({ pct }: { pct: number }) => (
  <div
    style={{
      position: "relative",
      height: 12,
      borderRadius: 6,
      background: "rgb(245 245 245 / 0.1)",
    }}
  >
    <div
      style={{
        position: "absolute",
        inset: 0,
        width: `${pct}%`,
        borderRadius: 6,
        backgroundImage: spectrumGradient,
      }}
    />
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: `${pct}%`,
        transform: "translate(-50%, -50%)",
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: colors.warmWhite,
        boxShadow: "0 4px 10px rgb(0 0 0 / 0.45)",
      }}
    />
  </div>
);

const SheetLabelRow = ({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: 20,
    }}
  >
    <MicroLabel>{label}</MicroLabel>
    <span
      style={{
        fontFamily: bodyFont,
        fontWeight: 700,
        fontSize: 30,
        color: valueColor ?? colors.warmWhite,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {value}
    </span>
  </div>
);

/** Beat 4 — a blind answer followed by a crowd forecast and sealed submission. */
export const Raters = () => {
  const frame = useCurrentFrame();
  const upPick = frame >= VOTE_AT;
  const pickScale = interpolate(
    frame,
    [VOTE_AT, VOTE_AT + 8, VOTE_AT + 18],
    [1, 1.06, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const slider = interpolate(frame, [SHEET_AT + 25, SHEET_AT + 95], [50, 70], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const voteOpacity = interpolate(
    frame,
    [SHEET_AT - 5, SHEET_AT + 10],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const sheetOpacity = interpolate(
    frame,
    [SHEET_AT + 6, SHEET_AT + 22],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const sheetRise = interpolate(frame, [SHEET_AT + 6, SHEET_AT + 24], [36, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const hintBlink = 0.65 + 0.35 * Math.sin(frame * 0.14);

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <OrbGlow size={840} opacity={0.13} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 38,
        }}
      >
        {/* Committing raters */}
        <div style={{ display: "flex", gap: 34 }}>
          {RATERS.map((r) => (
            <RaterChip key={r.initials} rater={r} />
          ))}
        </div>

        <div style={{ display: "flex", gap: 48, alignItems: "stretch" }}>
          {/* Voting card replica: warm radial overlay, orb, RATE HERE, Up/Down */}
          <Card
            startFrame={84}
            style={{
              ...surfaceCardStyle,
              position: "relative",
              width: 680,
              height: 580,
              padding: "26px 38px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                ...votingCardOverlay,
                pointerEvents: "none",
              }}
            />

            {/* Phase A — blind vote on the signal card */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                padding: "26px 38px",
                opacity: voteOpacity,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  alignSelf: "flex-start",
                }}
              >
                <Chip startFrame={96} color={colors.green}>
                  <CheckDot /> Eligible human
                </Chip>
                <Chip startFrame={108}>blind vote</Chip>
                <Chip startFrame={120} color={colors.yellow}>
                  <LockIcon size={16} color={colors.yellow} /> criterion fixed
                </Chip>
              </div>
              <div style={{ marginTop: 26 }}>
                <RatingOrb
                  score={null}
                  progress={0}
                  size={230}
                  idPrefix="raters"
                />
              </div>
              <div
                style={{
                  marginTop: 16,
                  fontFamily: bodyFont,
                  fontWeight: 600,
                  fontSize: 21,
                  textTransform: "uppercase",
                  letterSpacing: "0.16em",
                  color: colors.yellow,
                  opacity: upPick ? 0 : hintBlink,
                }}
              >
                Rate here
              </div>
              <div style={{ marginTop: 18, display: "flex", gap: 24 }}>
                <VoteButton up pressed={upPick} scale={pickScale} />
                <VoteButton up={false} />
              </div>
            </div>

            {/* Phase B — confirm the answer, forecast the crowd, and submit it sealed. */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                padding: "30px 42px",
                opacity: sheetOpacity,
                transform: `translateY(${sheetRise}px)`,
                background: "rgb(18 18 18 / 0.97)",
                display: "flex",
                flexDirection: "column",
                gap: 24,
              }}
            >
              <SheetLabelRow
                label="Your signal"
                value="Thumbs up"
                valueColor={colors.voteYes}
              />
              <div
                style={{
                  borderTop: "1px solid rgb(245 245 245 / 0.1)",
                  paddingTop: 22,
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                }}
              >
                <SheetLabelRow
                  label="Crowd forecast"
                  value={`${Math.round(slider)}% up`}
                />
                <SheetSlider pct={slider} />
              </div>
              <div style={{ marginTop: "auto" }}>
                <GradientActionButton
                  label={
                    frame >= SUBMIT_PRESS_AT + 12
                      ? "Submitting..."
                      : "Submit sealed response"
                  }
                  frame={frame}
                  startFrame={SHEET_AT + 14}
                  pressedAt={SUBMIT_PRESS_AT}
                />
              </div>
            </div>
          </Card>

          {/* Feedback note */}
          <Card
            startFrame={250}
            style={{
              ...surfaceCardStyle,
              width: 560,
              padding: "28px 34px",
              alignSelf: "center",
            }}
          >
            <div
              style={{
                fontFamily: monoFont,
                fontSize: 19,
                color: colors.steel,
                marginBottom: 14,
              }}
            >
              HUMAN RATIONALE · included in the panel
            </div>
            <ChatBubble from="agent" startFrame={258} width="100%">
              <TypeOn
                text={
                  '"Pricing section is unclear. Why two tiers at the same price?"'
                }
                startFrame={266}
                charsPerFrame={1.1}
                style={{ fontFamily: bodyFont, fontStyle: "italic" }}
              />
            </ChatBubble>
          </Card>
        </div>
      </div>
      <Caption
        text="Sealed answers. Useful forecasts earn more."
        startFrame={252}
      />
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
