import type { CSSProperties, ReactNode } from "react";
import { bodyFont } from "./fonts";
import { useFadeInUp } from "./primitives";
import { colors, orbitGradient } from "./theme";

/**
 * Primitives mirroring real site components for the promo scenes.
 * Sizes are roughly 1.9x the site's rem values so they read at 1920x1080.
 */

/** Real `surface-card`s are borderless #121212 panels with a deep shadow. */
export const surfaceCardStyle: CSSProperties = {
  border: "none",
  boxShadow: "0 24px 56px rgb(0 0 0 / 0.56)",
};

/** Warm radial overlay unique to the voting card (VotingQuestionCard signal variant). */
export const votingCardOverlay: CSSProperties = {
  backgroundImage:
    "radial-gradient(circle at 50% 14%, rgba(255,153,104,0.18), transparent 34%), radial-gradient(circle at 50% 58%, rgba(255,241,216,0.08), transparent 40%)",
};

/** Heroicons 24/outline hand-thumb-up, as used by RateLoopVoteButton. */
const HERO_THUMB_PATH =
  "M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 0 1 2.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 0 0 .322-1.672V3a.75.75 0 0 1 .75-.75 2.25 2.25 0 0 1 2.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282m0 0h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 0 1-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 0 0-1.423-.23H5.904m10.598-9.75H14.25M5.904 18.5c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 0 1-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 9.953 4.167 9.5 5 9.5h1.053c.472 0 .745.556.5.96a8.958 8.958 0 0 0-1.302 4.665c0 1.194.232 2.333.654 3.375Z";

const HeroThumbIcon = ({ up, size = 38, color }: { up: boolean; size?: number; color: string }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    style={{ transform: up ? undefined : "rotate(180deg)" }}
  >
    <path d={HERO_THUMB_PATH} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Replica of `.vote-btn.vote-yes` / `.vote-no` (5.25rem x 2.5rem, "Up"/"Down" labels). */
export const VoteButton = ({ up, pressed = false, scale = 1 }: { up: boolean; pressed?: boolean; scale?: number }) => {
  const bg = up ? colors.voteYes : colors.voteNo;
  const fg = up ? "#050505" : "#ffffff";
  const ring = up ? "rgb(32 214 163 / 0.18)" : "rgb(255 107 122 / 0.2)";
  const border = up ? "rgb(32 214 163 / 0.68)" : "rgb(255 107 122 / 0.76)";
  return (
    <div
      style={{
        width: 160,
        height: 76,
        borderRadius: 15,
        background: bg,
        border: `2px solid ${border}`,
        boxShadow: `0 0 0 2px ${ring}, inset 0 2px 0 rgb(245 245 245 / ${up ? 0.24 : 0.2})${
          pressed ? `, 0 0 0 6px ${ring}` : ""
        }`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        transform: `scale(${scale})`,
      }}
    >
      <HeroThumbIcon up={up} size={38} color={fg} />
      <span style={{ fontFamily: bodyFont, fontWeight: 700, fontSize: 27, color: fg }}>{up ? "Up" : "Down"}</span>
    </div>
  );
};

/** Replica of `.reward-chip-brand-{blue|green}`: saturated brand bg, near-black text. */
export const RewardChip = ({
  children,
  brand,
  startFrame = 0,
}: {
  children: ReactNode;
  brand: "blue" | "green";
  startFrame?: number;
}) => {
  const entrance = useFadeInUp(startFrame, 12);
  return (
    <span
      style={{
        ...entrance,
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        borderRadius: 10,
        padding: "11px 22px",
        background: brand === "blue" ? colors.blue : colors.green,
        color: "#050505",
        fontFamily: bodyFont,
        fontWeight: 600,
        fontSize: 25,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
};

/** Uppercase micro-label used across the stake sheet and handoff page. */
export const MicroLabel = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <span
    style={{
      fontFamily: bodyFont,
      fontSize: 21,
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: "0.16em",
      color: "rgb(245 245 245 / 0.55)",
      ...style,
    }}
  >
    {children}
  </span>
);

/** Replica of `.rateloop-gradient-action` (GradientActionButton): orbit border + dark inner. */
export const GradientActionButton = ({
  label,
  frame,
  startFrame = 0,
  pressedAt,
  width,
}: {
  label: string;
  frame: number;
  startFrame?: number;
  /** Frame at which the button gets a press pulse. */
  pressedAt?: number;
  width?: number;
}) => {
  const entrance = useFadeInUp(startFrame, 12);
  const press =
    pressedAt !== undefined && frame >= pressedAt && frame <= pressedAt + 14
      ? 1 - 0.04 * Math.sin(((frame - pressedAt) / 14) * Math.PI)
      : 1;
  return (
    <div
      style={{
        ...entrance,
        padding: 2.5,
        borderRadius: 12,
        backgroundImage: orbitGradient(frame * 2.4),
        transform: `scale(${press})`,
        width,
        boxShadow: "0 0 0 1px rgb(245 245 245 / 0.08), 0 14px 30px rgb(0 0 0 / 0.32)",
      }}
    >
      <div
        style={{
          borderRadius: 10,
          padding: "18px 38px",
          background: "linear-gradient(180deg, rgb(18 18 18 / 0.98), rgb(18 18 18 / 0.96))",
          boxShadow: "inset 0 1px 0 rgb(245 245 245 / 0.08)",
          fontFamily: bodyFont,
          fontWeight: 700,
          fontSize: 26,
          color: colors.warmWhite,
          textAlign: "center",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
    </div>
  );
};

/** Muted secondary button (`.btn-outline`: translucent warm-white fill). */
export const OutlineButton = ({ label, startFrame = 0 }: { label: string; startFrame?: number }) => {
  const entrance = useFadeInUp(startFrame, 12);
  return (
    <span
      style={{
        ...entrance,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 10,
        padding: "16px 34px",
        background: "rgb(245 245 245 / 0.18)",
        fontFamily: bodyFont,
        fontWeight: 700,
        fontSize: 25,
        color: colors.warmWhite,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
};
