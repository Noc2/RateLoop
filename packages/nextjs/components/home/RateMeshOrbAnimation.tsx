"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";

gsap.registerPlugin(useGSAP, CustomEase, MotionPathPlugin);

const ELLIPSE_COUNT = 30;
const GRADIENT_ID = "ratemesh-orb-gradient";

export function RateMeshOrbAnimation() {
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const svg = containerRef.current?.querySelector("#ratemesh-main-svg");
      const ellipses = containerRef.current?.querySelectorAll(".ratemesh-orb-ellipse");
      const signalPath = containerRef.current?.querySelector("#ratemesh-signal-path");
      const gradient = containerRef.current?.querySelector(`#${GRADIENT_ID}`);

      if (!svg || !ellipses?.length || !signalPath || !gradient) {
        return;
      }

      const ellipseElements = Array.from(ellipses);
      const ease = CustomEase.create("ratemeshCustom", "M0,0 C0.2,0 0.432,0.147 0.507,0.374 0.59,0.629 0.822,1 1,1");
      const easeIn = CustomEase.create(
        "ratemeshCustomIn",
        "M0,0 C0.266,0.412 0.297,0.582 0.453,0.775 0.53,0.87 0.78,1 1,1",
      );
      const easeOut = CustomEase.create("ratemeshCustomOut", "M0,0 C0.594,0.062 0.79,0.698 1,1");

      const colorInterpolate = gsap.utils.interpolate(["#359EEE", "#FFC43D", "#EF476F", "#03CEA4"]);

      gsap.set(svg, { visibility: "visible" });

      function animateEllipse(el: Element, index: number) {
        const timeline = gsap.timeline({
          defaults: { ease },
          repeat: -1,
        });

        gsap.set(el, {
          opacity: 1 - index / ellipseElements.length,
          stroke: colorInterpolate(index / ellipseElements.length),
        });

        timeline
          .to(el, {
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

        timeline.timeScale(0.5);
      }

      const pathLength = MotionPathPlugin.getLength(signalPath as SVGPathElement);
      if (pathLength > 0) {
        ellipseElements.forEach((el, i) => {
          gsap.delayedCall(i / Math.max(1, ellipseElements.length - 1), animateEllipse, [el, i + 1]);
        });
      }

      gsap.to(gradient, {
        duration: 4,
        delay: 0.75,
        attr: { x1: "-=300", x2: "-=300" },
        scale: 1.2,
        transformOrigin: "50% 50%",
        repeat: -1,
        ease: "none",
      });

      gsap.to(signalPath, {
        duration: 1,
        scale: 1.1,
        transformOrigin: "50% 50%",
        repeat: -1,
        yoyo: true,
        ease,
      });
    },
    { scope: containerRef },
  );

  const ellipses = Array.from({ length: ELLIPSE_COUNT });

  return (
    <div ref={containerRef} className="ratemesh-orb-animation-shell w-full mx-auto" aria-hidden="true">
      <svg
        id="ratemesh-main-svg"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="150 140 500 360"
        className="h-auto w-full"
        style={{ visibility: "hidden" }}
      >
        <defs>
          <linearGradient id={GRADIENT_ID} x1="513.98" y1="290" x2="479.72" y2="320" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#000" stopOpacity="0" />
            <stop offset=".15" stopColor="#EF476F" />
            <stop offset=".4" stopColor="#359EEE" />
            <stop offset=".6" stopColor="#03CEA4" />
            <stop offset=".78" stopColor="#FFC43D" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ellipses.map((_, i) => (
          <ellipse key={i} className="ratemesh-orb-ellipse" cx="400" cy="300" rx="110" ry="110" fill="none" />
        ))}

        <path
          id="ratemesh-signal-path"
          opacity="0.82"
          d="m417.17,323.85h-34.34c-3.69,0-6.67-2.99-6.67-6.67v-34.34c0-3.69,2.99-6.67,6.67-6.67h34.34c3.69,0,6.67,2.99,6.67,6.67v34.34c0,3.69-2.99,6.67-6.67,6.67Zm-5.25-12.92v-21.85c0-.55-.45-1-1-1h-21.85c-.55,0-1,.45-1,1v21.85c0,.55.45,1,1,1h21.85c.55,0,1-.45,1-1Zm23.08-16.29h-11.15m-47.69,0h-11.15m70,10.73h-11.15m-47.69,0h-11.15m40.37,29.63v-11.15m0-47.69v-11.15m-10.73,70v-11.15m0-47.69v-11.15"
          stroke={`url(#${GRADIENT_ID})`}
          strokeLinecap="round"
          strokeMiterlimit="10"
          strokeWidth="2"
          fill="none"
        />
      </svg>
    </div>
  );
}
