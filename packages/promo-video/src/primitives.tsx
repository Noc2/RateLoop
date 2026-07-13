import type { CSSProperties, ReactNode } from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { spectrumGradient } from "./theme";

/** The site's entrance curve: `cubic-bezier(0.22, 1, 0.36, 1)` (`fade-in-up`). */
export const ENTRANCE = Easing.bezier(0.22, 1, 0.36, 1);

/** Mirror of the site's `animate-fade-in-up` keyframes (24px rise, 0.6s). */
export const useFadeInUp = (startFrame: number, durationInFrames = 18): CSSProperties => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [startFrame, startFrame + durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ENTRANCE,
  });
  return { opacity: t, transform: `translateY(${(1 - t) * 24}px)` };
};

/** Mirror of `.rateloop-text-gradient`. */
export const GradientText = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <span
    style={{
      backgroundImage: spectrumGradient,
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
      ...style,
    }}
  >
    {children}
  </span>
);

/** Fades a scene in and out at its sequence boundaries. */
export const SceneFade = ({
  children,
  fadeIn = 10,
  fadeOut = 10,
}: {
  children: ReactNode;
  fadeIn?: number;
  fadeOut?: number;
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = Math.min(
    interpolate(frame, [0, fadeIn], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    interpolate(frame, [durationInFrames - fadeOut, durationInFrames], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  return <div style={{ width: "100%", height: "100%", opacity }}>{children}</div>;
};
