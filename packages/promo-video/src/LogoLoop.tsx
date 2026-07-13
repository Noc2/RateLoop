import { interpolate, useCurrentFrame } from "remotion";
import { ENTRANCE } from "./primitives";
import { colors } from "./theme";

// Segment geometry and gradients copied from packages/nextjs/public/rateloop-logo.svg.
type Segment = { d: string; from: string; to: string; x1: number; y1: number; x2: number; y2: number };

const SEGMENTS: Segment[] = [
  { d: "M64 21 A43 43 0 0 1 85.5 26.761", from: colors.yellow, to: colors.yellow, x1: 64, y1: 21, x2: 85.5, y2: 26.761 },
  { d: "M85.5 26.761 A43 43 0 0 1 101.239 42.5", from: colors.yellow, to: colors.yellow, x1: 85.5, y1: 26.761, x2: 101.239, y2: 42.5 },
  { d: "M101.239 42.5 A43 43 0 0 1 107 64", from: colors.yellow, to: colors.yellow, x1: 101.239, y1: 42.5, x2: 107, y2: 64 },
  { d: "M107 64 A43 43 0 0 1 101.239 85.5", from: colors.yellow, to: colors.pink, x1: 107, y1: 64, x2: 101.239, y2: 85.5 },
  { d: "M101.239 85.5 A43 43 0 0 1 85.5 101.239", from: colors.pink, to: colors.pink, x1: 101.239, y1: 85.5, x2: 85.5, y2: 101.239 },
  { d: "M85.5 101.239 A43 43 0 0 1 64 107", from: colors.pink, to: colors.pink, x1: 85.5, y1: 101.239, x2: 64, y2: 107 },
  { d: "M64 107 A43 43 0 0 1 42.5 101.239", from: colors.pink, to: colors.pink, x1: 64, y1: 107, x2: 42.5, y2: 101.239 },
  { d: "M42.5 101.239 A43 43 0 0 1 26.761 85.5", from: colors.pink, to: colors.blue, x1: 42.5, y1: 101.239, x2: 26.761, y2: 85.5 },
  { d: "M26.761 85.5 A43 43 0 0 1 21 64", from: colors.blue, to: colors.blue, x1: 26.761, y1: 85.5, x2: 21, y2: 64 },
  { d: "M21 64 A43 43 0 0 1 26.761 42.5", from: colors.blue, to: colors.blue, x1: 21, y1: 64, x2: 26.761, y2: 42.5 },
  { d: "M26.761 42.5 A43 43 0 0 1 42.5 26.761", from: colors.blue, to: colors.green, x1: 26.761, y1: 42.5, x2: 42.5, y2: 26.761 },
  { d: "M42.5 26.761 A43 43 0 0 1 64 21", from: colors.green, to: colors.yellow, x1: 42.5, y1: 26.761, x2: 64, y2: 21 },
];

/**
 * The RateLoop loop mark. Segments draw in clockwise (staggered) starting at
 * `startFrame`; with `spinDegPerFrame` the finished loop rotates slowly.
 */
export const LogoLoop = ({
  size,
  startFrame = 0,
  segmentStagger = 3,
  segmentDraw = 14,
  spinDegPerFrame = 0,
  idPrefix = "loop",
}: {
  size: number;
  startFrame?: number;
  segmentStagger?: number;
  segmentDraw?: number;
  spinDegPerFrame?: number;
  idPrefix?: string;
}) => {
  const frame = useCurrentFrame();
  const drawEnd = startFrame + segmentStagger * (SEGMENTS.length - 1) + segmentDraw;
  const spin = spinDegPerFrame !== 0 && frame > drawEnd ? (frame - drawEnd) * spinDegPerFrame : 0;

  return (
    <svg
      viewBox="0 0 128 128"
      width={size}
      height={size}
      style={{ transform: `rotate(${spin}deg)` }}
    >
      <defs>
        {SEGMENTS.map((seg, i) => (
          <linearGradient
            key={i}
            id={`${idPrefix}-seg-${i}`}
            x1={seg.x1}
            y1={seg.y1}
            x2={seg.x2}
            y2={seg.y2}
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor={seg.from} />
            <stop offset="1" stopColor={seg.to} />
          </linearGradient>
        ))}
      </defs>
      <g fill="none" strokeWidth={10} strokeLinecap="butt" strokeLinejoin="round">
        {SEGMENTS.map((seg, i) => {
          const segStart = startFrame + i * segmentStagger;
          const t = interpolate(frame, [segStart, segStart + segmentDraw], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: ENTRANCE,
          });
          return (
            <path
              key={i}
              d={seg.d}
              stroke={`url(#${idPrefix}-seg-${i})`}
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - t}
              opacity={t === 0 ? 0 : 1}
            />
          );
        })}
      </g>
    </svg>
  );
};
