"use client";

import { useState } from "react";
import { LREP_INITIAL_MINTED_SUPPLY_COMPACT_LABEL, tokenAllocationChartSlices } from "~~/lib/docs/tokenomics";

const SIZE = 200;
const CENTER = SIZE / 2;
const RADIUS = 80;
const INNER_RADIUS = 48;

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

function describeDonut(cx: number, cy: number, outer: number, inner: number, startAngle: number, endAngle: number) {
  const outerStart = polarToCartesian(cx, cy, outer, endAngle);
  const outerEnd = polarToCartesian(cx, cy, outer, startAngle);
  const innerStart = polarToCartesian(cx, cy, inner, startAngle);
  const innerEnd = polarToCartesian(cx, cy, inner, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outer} ${outer} 0 ${largeArc} 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${inner} ${inner} 0 ${largeArc} 1 ${innerEnd.x} ${innerEnd.y}`,
    "Z",
  ].join(" ");
}

export function TokenAllocationChart() {
  const [hovered, setHovered] = useState<number | null>(null);

  let currentAngle = 0;
  const arcs = tokenAllocationChartSlices.map(slice => {
    const angle = (slice.value / 100) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    currentAngle = endAngle;
    return { ...slice, startAngle, endAngle };
  });

  return (
    <figure className="not-prose my-6 rounded-lg bg-base-200 p-4 text-base-content">
      <h3 className="mb-4 text-xl font-semibold leading-tight text-base-content">Launch Distribution Map</h3>

      <div className="grid gap-4 rounded-lg bg-base-100 p-3 sm:p-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center lg:flex-col lg:items-start">
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="h-[160px] w-[160px] shrink-0"
            role="img"
            aria-label="LREP allocation chart: 35 percent human verified and referral rewards, 33 percent earned rater rewards, and 32 percent treasury"
          >
            {arcs.map(arc => (
              <path
                key={arc.index}
                d={describeDonut(CENTER, CENTER, RADIUS, INNER_RADIUS, arc.startAngle, arc.endAngle)}
                fill={arc.color}
                fillOpacity={hovered === null || hovered === arc.index ? 0.82 : 0.32}
                stroke="var(--color-base-100)"
                strokeWidth={1.5}
                onMouseEnter={() => setHovered(arc.index)}
                onMouseLeave={() => setHovered(null)}
                className="cursor-default transition-[fill-opacity] duration-150"
              />
            ))}
            <text
              x={CENTER}
              y={CENTER - 4}
              textAnchor="middle"
              fill="var(--color-base-content)"
              fillOpacity={0.58}
              fontSize={11}
              fontWeight={500}
            >
              {LREP_INITIAL_MINTED_SUPPLY_COMPACT_LABEL}
            </text>
            <text
              x={CENTER}
              y={CENTER + 10}
              textAnchor="middle"
              fill="var(--color-base-content)"
              fillOpacity={0.36}
              fontSize={9}
            >
              LREP
            </text>
          </svg>

          <div className="flex min-w-0 flex-col gap-2">
            {tokenAllocationChartSlices.map(slice => (
              <div
                key={slice.index}
                className={`flex items-start gap-2 text-sm transition-opacity duration-150 ${
                  hovered !== null && hovered !== slice.index ? "opacity-45" : ""
                }`}
                onMouseEnter={() => setHovered(slice.index)}
                onMouseLeave={() => setHovered(null)}
              >
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
                <span className="min-w-0 text-base-content/70">
                  <span className="font-mono font-medium text-base-content/90">{slice.percentLabel}</span> {slice.label}{" "}
                  <span className="text-base-content/60">({slice.amountLabel})</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3">
          {tokenAllocationChartSlices.map(slice => (
            <section
              key={slice.index}
              className={`rounded-lg border border-base-content/10 bg-base-content/[0.05] p-3 transition-opacity duration-150 ${
                hovered !== null && hovered !== slice.index ? "opacity-45" : ""
              }`}
              onMouseEnter={() => setHovered(slice.index)}
              onMouseLeave={() => setHovered(null)}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
                  <h4 className="text-sm font-semibold leading-snug text-base-content">{slice.label}</h4>
                </div>
                <div className="font-mono text-xs leading-5 text-base-content/62 sm:text-right">
                  <p>{slice.amountLabel}</p>
                  <p>{slice.percentLabel} of supply</p>
                </div>
              </div>
              <p className="mt-2 text-xs leading-5 text-base-content/58">{slice.purpose}</p>
            </section>
          ))}
        </div>
      </div>
    </figure>
  );
}
