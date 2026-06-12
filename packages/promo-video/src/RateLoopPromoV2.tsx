import { AbsoluteFill, Audio, Sequence, interpolate, staticFile } from "remotion";
import { SceneFade } from "./primitives";
import { Hook } from "./scenes/Hook";
import { Outro } from "./scenes/Outro";
import { AgentAskV2 } from "./scenes/v2/AgentAskV2";
import { HandoffV2 } from "./scenes/v2/HandoffV2";
import { RatersV2 } from "./scenes/v2/RatersV2";
import { ReportV2 } from "./scenes/v2/ReportV2";
import { SettleV2 } from "./scenes/v2/SettleV2";
import { colors } from "./theme";

/**
 * V2 of the promo: identical narrative, audio, and beat timings as
 * RateLoopPromo, but the product beats reuse the real site UI — the RatingOrb,
 * Up/Down vote buttons, the stake sheet, the agent-ask handoff page, and the
 * discover-card question preview. V1 is kept for comparison.
 */

export const PROMO_FPS = 30;

const HOOK = 180;
const ASK = 240;
const HANDOFF = 240;
const RATERS = 435;
const SETTLE = 240;
const REPORT = 360;
const OUTRO = 315;

export const PROMO_V2_DURATION_IN_FRAMES = HOOK + ASK + HANDOFF + RATERS + SETTLE + REPORT + OUTRO;

type Beat = {
  start: number;
  duration: number;
  vo: string;
  voDurationInFrames: number;
  Scene: () => React.ReactElement;
  fadeIn?: number;
  fadeOut?: number;
};

const starts = [0, HOOK, HOOK + ASK, HOOK + ASK + HANDOFF, HOOK + ASK + HANDOFF + RATERS];
const BEATS: Beat[] = [
  { start: 0, duration: HOOK, vo: "audio/vo-01-hook.m4a", voDurationInFrames: 167, Scene: Hook, fadeIn: 6 },
  { start: starts[1], duration: ASK, vo: "audio/vo-02-ask.m4a", voDurationInFrames: 177, Scene: AgentAskV2 },
  { start: starts[2], duration: HANDOFF, vo: "audio/vo-03-handoff.m4a", voDurationInFrames: 203, Scene: HandoffV2 },
  { start: starts[3], duration: RATERS, vo: "audio/vo-04-raters.m4a", voDurationInFrames: 258, Scene: RatersV2 },
  { start: starts[4], duration: SETTLE, vo: "audio/vo-05-settle.m4a", voDurationInFrames: 117, Scene: SettleV2 },
  {
    start: starts[4] + SETTLE,
    duration: REPORT,
    vo: "audio/vo-06-report.m4a",
    voDurationInFrames: 228,
    Scene: ReportV2,
  },
  {
    start: starts[4] + SETTLE + REPORT,
    duration: OUTRO,
    vo: "audio/vo-07-outro.m4a",
    voDurationInFrames: 77,
    Scene: Outro,
    fadeOut: 20,
  },
];

const VO_OFFSET = 6;

const VO_WINDOWS = BEATS.map(
  beat => [beat.start + VO_OFFSET, beat.start + VO_OFFSET + beat.voDurationInFrames] as const,
);

const musicVolume = (frame: number) => {
  let duck = 1;
  for (const [a, b] of VO_WINDOWS) {
    if (frame < a - 9 || frame > b + 21) continue;
    const v =
      frame < a
        ? interpolate(frame, [a - 9, a], [1, 0.24])
        : frame <= b
          ? 0.24
          : interpolate(frame, [b, b + 21], [0.24, 1]);
    duck = Math.min(duck, v);
  }
  const base = interpolate(
    frame,
    [0, HOOK, starts[3], starts[4], PROMO_V2_DURATION_IN_FRAMES - OUTRO, PROMO_V2_DURATION_IN_FRAMES - 30],
    [0.44, 0.34, 0.36, 0.38, 0.42, 0.48],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const fadeIn = interpolate(frame, [0, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [PROMO_V2_DURATION_IN_FRAMES - 60, PROMO_V2_DURATION_IN_FRAMES], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return base * duck * fadeIn * fadeOut;
};

export const RateLoopPromoV2 = () => (
  <AbsoluteFill style={{ background: colors.surface }}>
    <Audio src={staticFile("audio/music.mp3")} volume={musicVolume} />
    {BEATS.map(({ start, duration, vo, Scene, fadeIn, fadeOut }) => (
      <Sequence key={vo} from={start} durationInFrames={duration}>
        <SceneFade fadeIn={fadeIn} fadeOut={fadeOut}>
          <Scene />
        </SceneFade>
        <Sequence from={VO_OFFSET}>
          <Audio src={staticFile(vo)} />
        </Sequence>
      </Sequence>
    ))}
  </AbsoluteFill>
);
