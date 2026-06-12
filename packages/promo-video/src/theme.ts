/**
 * Brand tokens lifted verbatim from `packages/nextjs/styles/globals.css` (:root)
 * so the video matches the website exactly.
 */
export const colors = {
  surface: "#000000",
  surfaceElevated: "#121212",
  surfaceNested: "#121212",
  warmWhite: "#f5f5f5",
  steel: "#a3a3a3",
  blue: "#359eee",
  green: "#03cea4",
  yellow: "#ffc43d",
  pink: "#ef476f",
  voteYes: "#20d6a3",
  voteNo: "#ff6b7a",
  actionContent: "#050505",
  shellBorder: "rgb(245 245 245 / 0.1)",
} as const;

/** `--rateloop-spectrum-gradient` */
export const spectrumGradient = `linear-gradient(90deg, ${colors.blue}, ${colors.green}, ${colors.yellow}, ${colors.pink})`;

/** `--rateloop-orbit-gradient` with a frame-driven angle */
export const orbitGradient = (angleDeg: number) =>
  `conic-gradient(from ${angleDeg}deg, rgb(53 158 238 / 0.95), rgb(3 206 164 / 0.95) 28%, rgb(255 196 61 / 0.96) 53%, rgb(239 71 111 / 0.96) 76%, rgb(53 158 238 / 0.95))`;

/** `--rateloop-radius-card` = 0.5rem */
export const radiusCard = 8;
