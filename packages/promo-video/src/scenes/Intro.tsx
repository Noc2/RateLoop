import { useCurrentFrame } from "remotion";
import { colors, orbitGradient } from "../theme";

/** Soft, blurred echo of the site's hero orb animation. */
export const OrbGlow = ({ size, opacity }: { size: number; opacity: number }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundImage: orbitGradient(frame * 0.8),
        filter: "blur(160px)",
        opacity,
      }}
    />
  );
};
