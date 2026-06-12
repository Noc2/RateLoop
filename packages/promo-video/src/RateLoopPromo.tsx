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

export const PROMO_FPS = 30;

// Beat lengths (frames @30fps): one narrative ask, end to end. ~66s total.
const HOOK = 180; // 6s   — founder prompts their agent
const ASK = 240; // 8s    — agent drafts the RateLoop question
const HANDOFF = 210; // 7s — review + fund via handoff link
const RATERS = 435; // 14.5s — blind votes, predictions, feedback, USDC
const SETTLE = 240; // 8s  — reveal + on-chain settlement
const REPORT = 360; // 12s — agent delivers the validation report
const OUTRO = 315; // 10.5s — logo, tagline, rateloop.ai

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
  { start: 0, duration: HOOK, vo: "audio/vo-01-hook.m4a", voDurationInFrames: 167, Scene: Hook, fadeIn: 6 },
  { start: starts[1], duration: ASK, vo: "audio/vo-02-ask.m4a", voDurationInFrames: 186, Scene: AgentAsk },
  { start: starts[2], duration: HANDOFF, vo: "audio/vo-03-handoff.m4a", voDurationInFrames: 155, Scene: Handoff },
  { start: starts[3], duration: RATERS, vo: "audio/vo-04-raters.m4a", voDurationInFrames: 258, Scene: Raters },
  { start: starts[4], duration: SETTLE, vo: "audio/vo-05-settle.m4a", voDurationInFrames: 117, Scene: Settle },
  {
    start: starts[4] + SETTLE,
    duration: REPORT,
    vo: "audio/vo-06-report.m4a",
    voDurationInFrames: 228,
    Scene: Report,
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

const VO_OFFSET = 6; // VO starts shortly after each beat's fade-in

const VO_WINDOWS = BEATS.map(
  beat => [beat.start + VO_OFFSET, beat.start + VO_OFFSET + beat.voDurationInFrames] as const,
);

/** Music bed: brighter when VO rests, tightly ducked under narration. */
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

export const RateLoopPromo = () => (
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
