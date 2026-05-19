"use client";

import { useState } from "react";
import {
  LAUNCH_DISTRIBUTION_POOL_AMOUNT_COMPACT_LABEL,
  LREP_INITIAL_MINTED_SUPPLY_COMPACT_LABEL,
  launchDistributionChartSlices,
  tokenAllocationChartSlices,
} from "~~/lib/docs/tokenomics";

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

/**
 * SVG donut chart showing the token allocation across all system-controlled pools.
 */
export function TokenAllocationChart() {
  const [hovered, setHovered] = useState<number | null>(null);

  let currentAngle = 0;
  const arcs = tokenAllocationChartSlices
    .filter(slice => slice.value > 0)
    .map(slice => {
      const angle = (slice.value / 100) * 360;
      const startAngle = currentAngle;
      const endAngle = currentAngle + angle;
      currentAngle = endAngle;
      return { ...slice, startAngle, endAngle };
    });

  return (
    <div className="not-prose my-6 rounded-lg bg-base-200 p-4 text-base-content">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-wider text-base-content/45">
            Initial minted supply
          </p>
          <h3 className="mt-1 text-xl font-semibold leading-tight text-base-content">100M LREP Allocation Map</h3>
        </div>
        <p className="max-w-xl text-sm leading-6 text-base-content/62 sm:text-right">
          The launch pool is shown once, then expanded into the three rails that draw from it.
        </p>
      </div>
      <div className="grid gap-4 rounded-lg bg-base-100 p-3 sm:p-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center lg:flex-col lg:items-start">
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="h-[160px] w-[160px] shrink-0"
            role="img"
            aria-label="LREP allocation chart: 68 percent launch distribution pool and 32 percent treasury"
          >
            {arcs.map(arc => (
              <path
                key={arc.index}
                d={describeDonut(CENTER, CENTER, RADIUS, INNER_RADIUS, arc.startAngle, arc.endAngle)}
                fill={arc.color}
                fillOpacity={hovered === null || hovered === arc.index ? 0.8 : 0.3}
                stroke="var(--color-base-100)"
                strokeWidth={1.5}
                onMouseEnter={() => setHovered(arc.index)}
                onMouseLeave={() => setHovered(null)}
                className="transition-[fill-opacity] duration-150 cursor-default"
              />
            ))}
            <text
              x={CENTER}
              y={CENTER - 4}
              textAnchor="middle"
              fill="var(--color-base-content)"
              fillOpacity={0.5}
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
              fillOpacity={0.3}
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
                  hovered !== null && hovered !== slice.index ? "opacity-40" : ""
                }`}
                onMouseEnter={() => setHovered(slice.index)}
                onMouseLeave={() => setHovered(null)}
              >
                <div className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
                <span className="min-w-0 text-base-content/70">
                  <span className="font-mono font-medium text-base-content/90">{slice.percentLabel}</span> {slice.label}{" "}
                  <span className="text-base-content/60">({slice.amountLabel})</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3">
          <div
            className={`rounded-lg border border-base-content/10 bg-base-content/[0.05] p-3 transition-opacity duration-150 ${
              hovered === 1 ? "opacity-45" : ""
            }`}
            onMouseEnter={() => setHovered(0)}
            onMouseLeave={() => setHovered(null)}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold leading-snug text-base-content">Launch Distribution Pool</p>
              <p className="font-mono text-xs text-base-content/55">
                {LAUNCH_DISTRIBUTION_POOL_AMOUNT_COMPACT_LABEL} LREP
              </p>
            </div>
            <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-base-content/10">
              {launchDistributionChartSlices.map(slice => (
                <div
                  key={slice.index}
                  className="h-full"
                  style={{ width: `${slice.launchValue}%`, backgroundColor: slice.color }}
                />
              ))}
            </div>
            <div className="mt-3 grid gap-2">
              {launchDistributionChartSlices.map(slice => (
                <div
                  key={slice.index}
                  className="grid gap-1 rounded-md bg-base-content/[0.04] p-2 sm:grid-cols-[1fr_auto]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
                      <p className="text-sm font-semibold leading-snug text-base-content">{slice.label}</p>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-base-content/58">{slice.purpose}</p>
                  </div>
                  <div className="font-mono text-xs leading-5 text-base-content/62 sm:text-right">
                    <p>{slice.amountLabel}</p>
                    <p>{slice.launchShareLabel}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            className={`rounded-lg border border-base-content/10 bg-base-content/[0.05] p-3 transition-opacity duration-150 ${
              hovered === 0 ? "opacity-45" : ""
            }`}
            onMouseEnter={() => setHovered(1)}
            onMouseLeave={() => setHovered(null)}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold leading-snug text-base-content">Treasury</p>
              <p className="font-mono text-xs text-base-content/55">32M LREP</p>
            </div>
            <p className="mt-2 text-xs leading-5 text-base-content/58">
              Governance-controlled LREP for safety responses, verification acceleration, ecosystem grants, partner
              activation, and protocol development.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
