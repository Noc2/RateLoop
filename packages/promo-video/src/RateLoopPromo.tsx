import { AbsoluteFill, Audio, Sequence, interpolate, staticFile } from "remotion";
import { SceneFade } from "./primitives";
import { AgentAsk } from "./scenes/AgentAsk";
import { Handoff } from "./scenes/Handoff";
import { Hook } from "./scenes/Hook";
import { Outro } from "./scenes/Outro";
import { Raters } from "./scenes/Raters";
import { Report } from "./scenes/Report";
import { Settle } from "./scenes/Settle";
import { colors } from "./theme";

/**
 * One narrative ask, end to end. The product beats reuse the real site UI —
 * the RatingOrb, Up/Down vote buttons, the sealed-response sheet, the agent-ask handoff
 * page, and the discover-card question preview.
 */

export const PROMO_FPS = 30;

const HOOK = 180;
const ASK = 240;
const HANDOFF = 240;
const RATERS = 435;
const SETTLE = 240;
const REPORT = 360;
const OUTRO = 315;

export const PROMO_DURATION_IN_FRAMES = HOOK + ASK + HANDOFF + RATERS + SETTLE + REPORT + OUTRO;

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
  { start: 0, duration: HOOK, vo: "audio/vo-01-hook.m4a", voDurationInFrames: 138, Scene: Hook, fadeIn: 6 },
  { start: starts[1], duration: ASK, vo: "audio/vo-02-ask.m4a", voDurationInFrames: 201, Scene: AgentAsk },
  { start: starts[2], duration: HANDOFF, vo: "audio/vo-03-handoff.m4a", voDurationInFrames: 148, Scene: Handoff },
  { start: starts[3], duration: RATERS, vo: "audio/vo-04-raters.m4a", voDurationInFrames: 261, Scene: Raters },
  { start: starts[4], duration: SETTLE, vo: "audio/vo-05-settle.m4a", voDurationInFrames: 112, Scene: Settle },
  {
    start: starts[4] + SETTLE,
    duration: REPORT,
    vo: "audio/vo-06-report.m4a",
    voDurationInFrames: 221,
    Scene: Report,
  },
  {
    start: starts[4] + SETTLE + REPORT,
    duration: OUTRO,
    vo: "audio/vo-07-outro.m4a",
    voDurationInFrames: 62,
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
    [0, HOOK, starts[3], starts[4], PROMO_DURATION_IN_FRAMES - OUTRO, PROMO_DURATION_IN_FRAMES - 30],
    [0.44, 0.34, 0.36, 0.38, 0.42, 0.48],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const fadeIn = interpolate(frame, [0, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [PROMO_DURATION_IN_FRAMES - 60, PROMO_DURATION_IN_FRAMES], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return base * duck * fadeIn * fadeOut;
};

export const RateLoopPromo = ({ musicSrc = "audio/music.mp3" }: { musicSrc?: string }) => (
  <AbsoluteFill style={{ background: colors.surface }}>
    <Audio src={staticFile(musicSrc)} volume={musicVolume} />
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
