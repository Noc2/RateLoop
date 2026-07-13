import { bodyFont, headingFont } from "./fonts";
import { colors } from "./theme";

const polarToCartesian = (center: number, radius: number, angleInDegrees: number) => {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: center + radius * Math.cos(angleInRadians),
    y: center + radius * Math.sin(angleInRadians),
  };
};

/**
 * Frame-driven replica of the site's RatingOrb
 * (packages/nextjs/components/shared/RatingOrb.tsx): same geometry, spectrum
 * progress ring with highlight pass and end-cap dot, radial inner disc, and
 * display-metric score. `score` null renders the unsettled N/A state.
 */
export const RatingOrb = ({
  score,
  progress,
  size = 196,
  idPrefix,
}: {
  /** Display score like "7.8"; null shows N/A. */
  score: string | null;
  /** Ring fill 0..1, driven by the caller per frame. */
  progress: number;
  size?: number;
  idPrefix: string;
}) => {
  const center = size / 2;
  const trackRadius = size * 0.41;
  const trackWidth = Math.max(8, size * 0.034);
  const progressStrokeWidth = trackWidth * 0.6;
  const progressHighlightStrokeWidth = Math.max(2, trackWidth * 0.22);
  const innerCircleGap = Math.max(2, trackWidth * 0.5);
  const innerCircleRadius = trackRadius - progressStrokeWidth / 2 - innerCircleGap;
  const circumference = 2 * Math.PI * trackRadius;
  const clamped = Math.min(1, Math.max(0, progress));
  const progressLength = circumference * clamped;
  const endPoint = polarToCartesian(center, trackRadius, clamped * 360);
  const ratingFontSize = Math.max(34, size * 0.23);
  const scaleFontSize = Math.max(15, ratingFontSize * 0.38);
  const gradientId = `${idPrefix}-orb-progress`;
  const fillId = `${idPrefix}-orb-inner`;
  const stroke = `url(#${gradientId})`;

  return (
    <div style={{ position: "relative", width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <defs>
          <radialGradient id={fillId} cx="46%" cy="38%" r="72%">
            <stop offset="0%" stopColor={colors.surfaceElevatedHover} stopOpacity="0.98" />
            <stop offset="68%" stopColor={colors.surfaceNested} stopOpacity="0.95" />
            <stop offset="100%" stopColor={colors.surfaceElevatedHover} stopOpacity="0.9" />
          </radialGradient>
          <linearGradient id={gradientId} x1="0%" y1="50%" x2="100%" y2="50%">
            <stop offset="0%" stopColor={colors.blue} />
            <stop offset="38%" stopColor={colors.green} />
            <stop offset="68%" stopColor={colors.yellow} />
            <stop offset="100%" stopColor={colors.pink} />
          </linearGradient>
        </defs>

        {clamped > 0 ? (
          <>
            <circle
              cx={center}
              cy={center}
              r={trackRadius}
              fill="none"
              stroke={stroke}
              strokeWidth={progressStrokeWidth}
              strokeLinecap="round"
              strokeDasharray={clamped >= 1 ? undefined : `${progressLength} ${circumference}`}
              transform={clamped >= 1 ? undefined : `rotate(-90 ${center} ${center})`}
            />
            <circle
              cx={center}
              cy={center}
              r={trackRadius}
              fill="none"
              stroke={stroke}
              strokeWidth={progressHighlightStrokeWidth}
              strokeLinecap="round"
              opacity="0.82"
              strokeDasharray={clamped >= 1 ? undefined : `${progressLength} ${circumference}`}
              transform={clamped >= 1 ? undefined : `rotate(-90 ${center} ${center})`}
            />
            {clamped < 1 ? <circle cx={endPoint.x} cy={endPoint.y} r={trackWidth * 0.3} fill={stroke} /> : null}
          </>
        ) : null}

        <circle
          cx={center}
          cy={center}
          r={innerCircleRadius}
          fill={`url(#${fillId})`}
          stroke="rgba(245,245,245,0.14)"
          strokeWidth={Math.max(1, trackWidth * 0.12)}
        />
      </svg>

      <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
        <span
          style={{
            fontFamily: headingFont,
            fontWeight: 600,
            fontSize: ratingFontSize,
            color: colors.warmWhite,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {score ?? "N/A"}
        </span>
        {score !== null ? (
          <span
            style={{
              fontFamily: bodyFont,
              fontWeight: 500,
              fontSize: scaleFontSize,
              color: "rgb(255 255 255 / 0.72)",
              lineHeight: 0.92,
              marginLeft: Math.max(4, size * 0.04),
              marginBottom: ratingFontSize * 0.12,
            }}
          >
            /10
          </span>
        ) : null}
      </div>
    </div>
  );
};
