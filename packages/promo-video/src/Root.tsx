import { Composition } from "remotion";
import { PROMO_DURATION_IN_FRAMES, PROMO_FPS, RateLoopPromo } from "./RateLoopPromo";
import { PROMO_V2_DURATION_IN_FRAMES, RateLoopPromoV2 } from "./RateLoopPromoV2";

export const RemotionRoot = () => (
  <>
    <Composition
      id="RateLoopPromo"
      component={RateLoopPromo}
      durationInFrames={PROMO_DURATION_IN_FRAMES}
      fps={PROMO_FPS}
      width={1920}
      height={1080}
    />
    <Composition
      id="RateLoopPromoV2"
      component={RateLoopPromoV2}
      durationInFrames={PROMO_V2_DURATION_IN_FRAMES}
      fps={PROMO_FPS}
      width={1920}
      height={1080}
    />
  </>
);
