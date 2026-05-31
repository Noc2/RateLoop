"use client";

import { useEffect, useRef } from "react";

const ELLIPSE_COUNT = 30;
const ORB_COLORS = ["#359EEE", "#FFC43D", "#EF476F", "#03CEA4"];

export default function OrbAnimation() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    let cancelled = false;
    let animationContext: { revert: () => void } | null = null;
    let intersectionObserver: IntersectionObserver | null = null;
    let idleCallbackId: number | null = null;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const startAnimation = async () => {
      if (cancelled || animationContext) return;

      const [{ default: gsap }, { CustomEase }] = await Promise.all([import("gsap"), import("gsap/CustomEase")]);

      if (cancelled || !containerRef.current) return;

      gsap.registerPlugin(CustomEase);

      animationContext = gsap.context(() => {
        const svg = containerRef.current?.querySelector("#mainSVG");
        const ellipses = containerRef.current?.querySelectorAll(".ell");

        if (!svg || !ellipses) return;

        const ease = CustomEase.create("custom", "M0,0 C0.2,0 0.432,0.147 0.507,0.374 0.59,0.629 0.822,1 1,1");
        const easeIn = CustomEase.create("customIn", "M0,0 C0.266,0.412 0.297,0.582 0.453,0.775 0.53,0.87 0.78,1 1,1");
        const easeOut = CustomEase.create("customOut", "M0,0 C0.594,0.062 0.79,0.698 1,1");

        const colorInterpolate = gsap.utils.interpolate(ORB_COLORS);
        const ellipseCount = ellipses.length || 1;

        gsap.set(svg, { visibility: "visible" });

        function animateEllipse(el: Element, index: number) {
          const tl = gsap.timeline({
            defaults: { ease },
            repeat: -1,
          });

          gsap.set(el, {
            opacity: 1 - index / ellipseCount,
            stroke: colorInterpolate(index / ellipseCount),
          });

          tl.to(el, {
            attr: {
              ry: `-=${index * 2.3}`,
              rx: `+=${index * 1.4}`,
            },
            ease: easeOut,
          })
            .to(el, {
              attr: {
                ry: `+=${index * 2.3}`,
                rx: `-=${index * 1.4}`,
              },
              ease: easeIn,
            })
            .to(
              el,
              {
                duration: 1,
                rotation: -180,
                transformOrigin: "50% 50%",
              },
              0,
            );

          tl.timeScale(0.5);
        }

        ellipses.forEach((el, i) => {
          gsap.delayedCall(i / (ellipses.length - 1), animateEllipse, [el, i + 1]);
        });
      }, container);
    };

    const scheduleAnimation = () => {
      if (idleCallbackId !== null || timeoutId !== null || animationContext) return;

      if (idleWindow.requestIdleCallback) {
        idleCallbackId = idleWindow.requestIdleCallback(
          () => {
            idleCallbackId = null;
            void startAnimation();
          },
          { timeout: 1_500 },
        );
        return;
      }

      timeoutId = globalThis.setTimeout(() => {
        timeoutId = null;
        void startAnimation();
      }, 200);
    };

    if ("IntersectionObserver" in window) {
      intersectionObserver = new IntersectionObserver(
        entries => {
          if (!entries.some(entry => entry.isIntersecting)) return;
          intersectionObserver?.disconnect();
          intersectionObserver = null;
          scheduleAnimation();
        },
        { rootMargin: "160px" },
      );
      intersectionObserver.observe(container);
    } else {
      scheduleAnimation();
    }

    return () => {
      cancelled = true;
      intersectionObserver?.disconnect();
      if (idleCallbackId !== null && idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(idleCallbackId);
      }
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
      animationContext?.revert();
    };
  }, []);

  const ellipses = Array.from({ length: ELLIPSE_COUNT });

  return (
    <div ref={containerRef} className="orb-animation-shell w-full mx-auto">
      <svg id="mainSVG" xmlns="http://www.w3.org/2000/svg" viewBox="150 140 500 360" className="w-full h-auto">
        {ellipses.map((_, i) => (
          <ellipse
            key={i}
            className="ell"
            cx="400"
            cy="300"
            rx="110"
            ry="110"
            fill="none"
            stroke={ORB_COLORS[i % ORB_COLORS.length]}
            strokeOpacity={Math.max(0.08, 0.75 - i / ELLIPSE_COUNT)}
            strokeWidth="1.4"
          />
        ))}
      </svg>
    </div>
  );
}
