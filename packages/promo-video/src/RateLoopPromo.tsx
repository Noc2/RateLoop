import { AbsoluteFill, Sequence } from "remotion";
import { SceneFade } from "./primitives";
import { HowItWorks } from "./scenes/HowItWorks";
import { Intro } from "./scenes/Intro";
import { Outro } from "./scenes/Outro";
import { WhyItWorks } from "./scenes/WhyItWorks";
import { colors } from "./theme";

export const PROMO_FPS = 30;

const INTRO = 180; // 6s
const HOW = 270; // 9s
const WHY = 270; // 9s
const OUTRO = 180; // 6s

export const PROMO_DURATION_IN_FRAMES = INTRO + HOW + WHY + OUTRO;

export const RateLoopPromo = () => (
  <AbsoluteFill style={{ background: colors.surface }}>
    <Sequence durationInFrames={INTRO}>
      <SceneFade fadeIn={6}>
        <Intro />
      </SceneFade>
    </Sequence>
    <Sequence from={INTRO} durationInFrames={HOW}>
      <SceneFade>
        <HowItWorks />
      </SceneFade>
    </Sequence>
    <Sequence from={INTRO + HOW} durationInFrames={WHY}>
      <SceneFade>
        <WhyItWorks />
      </SceneFade>
    </Sequence>
    <Sequence from={INTRO + HOW + WHY} durationInFrames={OUTRO}>
      <SceneFade fadeOut={18}>
        <Outro />
      </SceneFade>
    </Sequence>
  </AbsoluteFill>
);
