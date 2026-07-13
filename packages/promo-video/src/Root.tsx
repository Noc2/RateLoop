import { Composition } from "remotion";
import { PROMO_DURATION_IN_FRAMES, PROMO_FPS, RateLoopPromo } from "./RateLoopPromo";

export const RemotionRoot = () => (
  <Composition
    id="RateLoopPromo"
    component={RateLoopPromo}
    durationInFrames={PROMO_DURATION_IN_FRAMES}
    fps={PROMO_FPS}
    width={1920}
    height={1080}
    defaultProps={{ musicSrc: "audio/music.mp3" }}
  />
);
