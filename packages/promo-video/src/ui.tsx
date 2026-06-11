import type { CSSProperties, ReactNode } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { bodyFont, headingFont, monoFont } from "./fonts";
import { useFadeInUp } from "./primitives";
import { colors, radiusCard, spectrumGradient } from "./theme";

/** Elevated card matching the site's nested-surface panels. */
export const Card = ({
  children,
  startFrame = 0,
  style,
}: {
  children: ReactNode;
  startFrame?: number;
  style?: CSSProperties;
}) => {
  const entrance = useFadeInUp(startFrame);
  return (
    <div
      style={{
        ...entrance,
        background: colors.surfaceElevated,
        border: `1px solid ${colors.shellBorder}`,
        borderRadius: radiusCard + 4,
        boxShadow: "0 24px 60px rgb(0 0 0 / 0.45)",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const Chip = ({
  children,
  startFrame = 0,
  color = "rgb(245 245 245 / 0.72)",
  style,
}: {
  children: ReactNode;
  startFrame?: number;
  color?: string;
  style?: CSSProperties;
}) => {
  const entrance = useFadeInUp(startFrame, 12);
  return (
    <span
      style={{
        ...entrance,
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        borderRadius: radiusCard,
        border: `1px solid ${colors.shellBorder}`,
        background: "rgb(245 245 245 / 0.06)",
        padding: "10px 18px",
        fontFamily: bodyFont,
        fontWeight: 600,
        fontSize: 22,
        color,
        ...style,
      }}
    >
      {children}
    </span>
  );
};

/** Bottom-left sound-off caption: the beat's narrative line. */
export const Caption = ({ text, startFrame = 12 }: { text: string; startFrame?: number }) => {
  const entrance = useFadeInUp(startFrame, 14);
  return (
    <div style={{ position: "absolute", left: 84, bottom: 64, ...entrance }}>
      <div style={{ width: 64, height: 4, borderRadius: 2, backgroundImage: spectrumGradient, marginBottom: 14 }} />
      <div style={{ fontFamily: headingFont, fontWeight: 600, fontSize: 34, color: "rgb(245 245 245 / 0.9)" }}>
        {text}
      </div>
    </div>
  );
};

/** Character-by-character type-on, like text being typed into the product. */
export const TypeOn = ({
  text,
  startFrame,
  charsPerFrame = 1.4,
  showCaret = true,
  style,
}: {
  text: string;
  startFrame: number;
  charsPerFrame?: number;
  showCaret?: boolean;
  style?: CSSProperties;
}) => {
  const frame = useCurrentFrame();
  const chars = Math.max(0, Math.floor((frame - startFrame) * charsPerFrame));
  const done = chars >= text.length;
  const caretOn = !done && frame >= startFrame && Math.floor(frame / 9) % 2 === 0;
  return (
    <span style={style}>
      {text.slice(0, chars)}
      <span style={{ opacity: caretOn ? 0.85 : 0, fontFamily: monoFont }}>|</span>
    </span>
  );
};

/** Chat shell shared by the hook and report beats. */
export const ChatPanel = ({
  children,
  startFrame = 0,
  width = 1080,
}: {
  children: ReactNode;
  startFrame?: number;
  width?: number;
}) => {
  const frame = useCurrentFrame();
  const dot = 0.55 + 0.45 * Math.abs(Math.sin(frame * 0.06));
  return (
    <Card startFrame={startFrame} style={{ width, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "20px 30px",
          borderBottom: `1px solid ${colors.shellBorder}`,
          background: "rgb(245 245 245 / 0.03)",
        }}
      >
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            backgroundImage: spectrumGradient,
            opacity: dot,
          }}
        />
        <span style={{ fontFamily: headingFont, fontWeight: 700, fontSize: 26, color: colors.warmWhite }}>
          Your Agent
        </span>
        <span style={{ marginLeft: "auto", fontFamily: monoFont, fontSize: 18, color: colors.steel }}>
          agent session
        </span>
      </div>
      <div style={{ padding: "30px 34px", display: "flex", flexDirection: "column", gap: 22 }}>{children}</div>
    </Card>
  );
};

export const ChatBubble = ({
  from,
  children,
  startFrame,
  width = "78%",
}: {
  from: "user" | "agent";
  children: ReactNode;
  startFrame: number;
  width?: string;
}) => {
  const entrance = useFadeInUp(startFrame, 14);
  const isUser = from === "user";
  return (
    <div
      style={{
        ...entrance,
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: width,
        borderRadius: radiusCard + 4,
        border: `1px solid ${isUser ? "rgb(53 158 238 / 0.35)" : colors.shellBorder}`,
        background: isUser ? "rgb(53 158 238 / 0.12)" : colors.surfaceNested,
        padding: "20px 26px",
        fontFamily: bodyFont,
        fontSize: 26,
        lineHeight: 1.55,
        color: "rgb(245 245 245 / 0.92)",
      }}
    >
      {children}
    </div>
  );
};

/** Key/value row used inside the question, handoff, and report cards. */
export const FieldRow = ({
  label,
  value,
  startFrame,
  valueColor = colors.warmWhite,
}: {
  label: string;
  value: ReactNode;
  startFrame: number;
  valueColor?: string;
}) => {
  const entrance = useFadeInUp(startFrame, 12);
  return (
    <div
      style={{
        ...entrance,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 26,
        padding: "14px 0",
        borderBottom: `1px solid rgb(245 245 245 / 0.06)`,
      }}
    >
      <span style={{ fontFamily: monoFont, fontSize: 20, color: colors.steel, whiteSpace: "nowrap" }}>{label}</span>
      <span
        style={{
          fontFamily: bodyFont,
          fontWeight: 600,
          fontSize: 24,
          color: valueColor,
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
};

const THUMB_PATH =
  "M1 21h4V9H1v12zM23 10c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z";

export const ThumbIcon = ({ up, size = 30, color }: { up: boolean; size?: number; color: string }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} style={{ transform: up ? undefined : "rotate(180deg)" }}>
    <path d={THUMB_PATH} fill={color} />
  </svg>
);

export const LockIcon = ({ size = 22, open = false, color }: { size?: number; open?: boolean; color: string }) => (
  <svg viewBox="0 0 24 24" width={size} height={size}>
    <rect x="5" y="10" width="14" height="10" rx="2" fill={color} />
    {open ? (
      <path d="M8 10V7a4 4 0 0 1 7.5-2" stroke={color} strokeWidth="2.4" fill="none" strokeLinecap="round" />
    ) : (
      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke={color} strokeWidth="2.4" fill="none" strokeLinecap="round" />
    )}
  </svg>
);

export const CheckIcon = ({ size = 24, color }: { size?: number; color: string }) => (
  <svg viewBox="0 0 24 24" width={size} height={size}>
    <path d="M4 12.5 9.5 18 20 6.5" stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Counts a number up with the entrance easing. */
export const useCountUp = (startFrame: number, to: number, durationInFrames = 40) => {
  const frame = useCurrentFrame();
  return Math.round(
    interpolate(frame, [startFrame, startFrame + durationInFrames], [0, to], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
};
