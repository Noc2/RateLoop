import { texToSvg } from "~~/lib/docs/texToSvg";

/**
 * Server-rendered typeset formula (MathJax TeX -> inline SVG, no client JS).
 * The SVG inherits `currentColor`, so it follows the surrounding text color.
 */
export function TexFormula({
  tex,
  display = false,
  className = "",
}: {
  tex: string;
  display?: boolean;
  className?: string;
}) {
  const svg = texToSvg(tex, display);
  if (display) {
    return (
      <div
        role="img"
        aria-label={tex}
        className={`overflow-x-auto py-1 text-base-content [&_svg]:max-w-full ${className}`.trim()}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={tex}
      className={`inline-block align-middle ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
