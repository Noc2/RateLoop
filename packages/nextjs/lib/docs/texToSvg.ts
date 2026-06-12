import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import "server-only";

/**
 * Server-side LaTeX -> inline SVG for docs pages.
 *
 * Reuses the same MathJax pipeline as the whitepaper PDF generator
 * (`scripts/whitepaper/latex.tsx`), but emits the raw SVG markup so server
 * components can inline typeset formulas with zero client-side JS.
 * `fontCache: "none"` inlines every glyph path, so multiple formulas on one
 * page cannot collide on shared `<defs>` ids.
 */
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const tex = new TeX({ packages: AllPackages });
const svg = new SVG({ fontCache: "none" });
const mjDocument = mathjax.document("", { InputJax: tex, OutputJax: svg });

const svgCache = new Map<string, string>();

export function texToSvg(texSource: string, display: boolean): string {
  const cacheKey = `${display ? "D" : "I"}:${texSource}`;
  const cached = svgCache.get(cacheKey);
  if (cached) return cached;

  const node = mjDocument.convert(texSource, { display });
  const html = adaptor.outerHTML(node as Parameters<typeof adaptor.outerHTML>[0]);
  const match = html.match(/<svg[\s\S]*<\/svg>/);
  const result = match ? match[0] : "";
  svgCache.set(cacheKey, result);
  return result;
}
