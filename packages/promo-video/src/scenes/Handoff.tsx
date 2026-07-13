import type { ReactNode } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { bodyFont, headingFont, monoFont } from "../fonts";
import { useFadeInUp } from "../primitives";
import { colors, radiusCard } from "../theme";
import { Card, CheckIcon } from "../ui";
import { GradientActionButton, MicroLabel, surfaceCardStyle } from "../siteUi";
import { OrbGlow } from "./Intro";

const SUBMIT_AT = 100;
const LIVE_AT = 145;

/** Summary-grid cell mirroring the buyer handoff page (icon label + bold value). */
const SummaryCell = ({
  label,
  value,
  startFrame,
  valueColor = colors.warmWhite,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  startFrame: number;
  valueColor?: string;
  mono?: boolean;
}) => {
  const entrance = useFadeInUp(startFrame, 12);
  return (
    <div
      style={{
        ...entrance,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontFamily: bodyFont,
          fontWeight: 500,
          fontSize: 21,
          color: "rgb(245 245 245 / 0.6)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: mono ? monoFont : bodyFont,
          fontWeight: 600,
          fontSize: mono ? 22 : 25,
          color: valueColor,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
};

/** Beat 3 — the buyer reviews the panel terms before funding. */
export const Handoff = () => {
  const frame = useCurrentFrame();
  const submitting = frame >= SUBMIT_AT + 10 && frame < LIVE_AT;
  const live = useFadeInUp(LIVE_AT, 16);

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <OrbGlow size={760} opacity={0.15} />
      <Card
        startFrame={6}
        style={{ ...surfaceCardStyle, width: 1060, overflow: "hidden" }}
      >
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
            {[colors.pink, colors.yellow, colors.green].map((c) => (
              <span
                key={c}
                style={{
                  width: 13,
                  height: 13,
                  borderRadius: "50%",
                  background: c,
                  opacity: 0.7,
                }}
              />
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
            rateloop-tokenless.vercel.app/ask
          </div>
        </div>

        <div style={{ padding: "32px 40px 38px" }}>
          <MicroLabel>Human assurance review</MicroLabel>
          <div
            style={{
              fontFamily: headingFont,
              fontWeight: 700,
              fontSize: 36,
              color: colors.warmWhite,
              margin: "14px 0 30px",
            }}
          >
            Would you approve this AI-drafted reply for a customer?
          </div>

          {/* Summary grid, like the real page's 5-column overview */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 0.9fr 1.2fr 1.4fr 0.9fr",
              gap: 26,
              paddingBottom: 30,
              borderBottom: `1px solid rgb(245 245 245 / 0.06)`,
            }}
          >
            <SummaryCell
              label="Funding wallet"
              value="0x7f3a…c41"
              startFrame={28}
              mono
            />
            <SummaryCell
              label="Bounty"
              value="25 USDC"
              startFrame={38}
              valueColor={colors.green}
            />
            <SummaryCell
              label="Attempt reserve"
              value="5 USDC"
              startFrame={48}
              valueColor={colors.green}
            />
            <SummaryCell
              label="Material"
              value="Redacted sample"
              startFrame={58}
              valueColor={colors.yellow}
            />
            <SummaryCell
              label="Status"
              value={
                <span
                  style={{
                    display: "inline-flex",
                    borderRadius: 999,
                    padding: "5px 16px",
                    background: "rgb(245 245 245 / 0.08)",
                    fontSize: 22,
                  }}
                >
                  ready
                </span>
              }
              startFrame={68}
            />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 30,
              marginTop: 30,
            }}
          >
            <GradientActionButton
              label={submitting ? "Funding..." : "Fund and start panel"}
              frame={frame}
              startFrame={20}
              pressedAt={SUBMIT_AT}
              width={300}
            />
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
              Panel live — evaluation open
            </div>
          </div>
        </div>
      </Card>
    </AbsoluteFill>
  );
};
