import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { monoFont } from "../../fonts";
import { useFadeInUp } from "../../primitives";
import { RatingOrb } from "../../RatingOrb";
import { colors } from "../../theme";
import { Caption, CheckIcon, Chip } from "../../ui";
import { OrbGlow } from "../Intro";

const SWEEP_START = 30;
const SWEEP_END = 110;
const TARGET = 7.8; // out of 10, like the site's orb

/** Beat 5 (v2) — the real RatingOrb sweeps to the settled 7.8/10 score. */
export const SettleV2 = () => {
  const frame = useCurrentFrame();
  const score = interpolate(frame, [SWEEP_START, SWEEP_END], [0, TARGET], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const subline = useFadeInUp(120);
  const settled = useFadeInUp(150);

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <OrbGlow size={900} opacity={0.18} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 36 }}>
        <RatingOrb score={score.toFixed(1)} progress={score / 10} size={460} idPrefix="settle" />

        <div style={{ ...subline, fontFamily: monoFont, fontSize: 23, color: colors.steel }}>
          crowd prediction 74% · calibrated reports rewarded
        </div>

        <div style={{ ...settled, display: "flex", alignItems: "center", gap: 16 }}>
          <Chip color={colors.green}>
            <CheckIcon size={22} color={colors.green} />
            Settled on-chain
          </Chip>
          <Chip>
            <span style={{ fontFamily: monoFont }}>World Chain · block 0x8f2…c41</span>
          </Chip>
        </div>
      </div>
      <Caption text="Settles on-chain. Auditable forever." startFrame={22} />
    </AbsoluteFill>
  );
};
