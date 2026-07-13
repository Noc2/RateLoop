import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadSpaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";

// The site loads Space Grotesk as `--font-hawig-heading` and Inter as
// `--font-hawig-body` (see packages/nextjs/app/layout.tsx).
const heading = loadSpaceGrotesk();
const body = loadInter();

export const headingFont = heading.fontFamily;
export const bodyFont = body.fontFamily;
// Tailwind's default `font-mono` stack, used for the section numbers on the site.
export const monoFont = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
