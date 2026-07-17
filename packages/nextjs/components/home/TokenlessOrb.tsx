"use client";

import { useEffect, useRef } from "react";

const ELLIPSE_COUNT = 30;
const ORB_COLORS = ["#359EEE", "#FFC43D", "#EF476F", "#03CEA4"];

// Keep the production RateLoop orb animation intact so the tokenless product
// remains visually identical to the established site.
export function TokenlessOrb() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cancelled = false;
    let animationContext: { revert: () => void } | null = null;
    let intersectionObserver: IntersectionObserver | null = null;

    const startAnimation = async () => {
      if (cancelled || animationContext) return;
      const [{ default: gsap }, { CustomEase }] = await Promise.all([import("gsap"), import("gsap/CustomEase")]);
      if (cancelled || !containerRef.current) return;

      gsap.registerPlugin(CustomEase);
      animationContext = gsap.context(() => {
        const svg = containerRef.current?.querySelector("svg");
        const ellipses = containerRef.current?.querySelectorAll(".ell");
        if (!svg || !ellipses) return;

        const ease = CustomEase.create("rateloop-orb", "M0,0 C0.2,0 0.432,0.147 0.507,0.374 0.59,0.629 0.822,1 1,1");
        const easeIn = CustomEase.create(
          "rateloop-orb-in",
          "M0,0 C0.266,0.412 0.297,0.582 0.453,0.775 0.53,0.87 0.78,1 1,1",
        );
        const easeOut = CustomEase.create("rateloop-orb-out", "M0,0 C0.594,0.062 0.79,0.698 1,1");
        const colorInterpolate = gsap.utils.interpolate(ORB_COLORS);
        const ellipseCount = ellipses.length || 1;

        gsap.set(svg, { visibility: "visible" });
        ellipses.forEach((element, index) => {
          const timeline = gsap.timeline({ defaults: { ease }, repeat: -1 });
          const position = index + 1;
          gsap.set(element, {
            opacity: 1 - index / ellipseCount,
            stroke: colorInterpolate(index / ellipseCount),
          });
          timeline
            .to(element, { attr: { ry: `-=${position * 2.3}`, rx: `+=${position * 1.4}` }, ease: easeOut })
            .to(element, { attr: { ry: `+=${position * 2.3}`, rx: `-=${position * 1.4}` }, ease: easeIn })
            .to(element, { duration: 1, rotation: -180, transformOrigin: "50% 50%" }, 0);
          timeline.timeScale(0.5);
          timeline.delay(index / Math.max(ellipses.length - 1, 1));
        });
      }, container);
    };

    if ("IntersectionObserver" in window) {
      intersectionObserver = new IntersectionObserver(
        entries => {
          if (!entries.some(entry => entry.isIntersecting)) return;
          intersectionObserver?.disconnect();
          intersectionObserver = null;
          void startAnimation();
        },
        { rootMargin: "160px" },
      );
      intersectionObserver.observe(container);
    } else {
      void startAnimation();
    }

    return () => {
      cancelled = true;
      intersectionObserver?.disconnect();
      animationContext?.revert();
    };
  }, []);

  return (
    <div ref={containerRef} className="orb-animation-shell mx-auto w-full" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="150 140 500 360" className="h-auto w-full">
        {Array.from({ length: ELLIPSE_COUNT }, (_, index) => (
          <ellipse
            key={index}
            className="ell"
            cx="400"
            cy="300"
            rx="110"
            ry="110"
            fill="none"
            stroke={ORB_COLORS[index % ORB_COLORS.length]}
            strokeOpacity={Math.max(0.08, 0.75 - index / ELLIPSE_COUNT)}
            strokeWidth="1.4"
          />
        ))}
      </svg>
    </div>
  );
}
