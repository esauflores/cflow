import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@web/lib/utils.ts";

// The dashboard's two charts, in plain SVG with Motion. No chart library: a
// slot per category on x, a linear y up to a rounded maximum, and rings drawn
// as stroked circles whose dash length is the progress.

/** The element's size, updated as it resizes. Zero until measured. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Rounds up to 1, 2, 2.5 or 5 × 10ⁿ, so grid lines land on round numbers. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= value)!;
  return step * magnitude;
}

export interface BarSeries {
  key: string;
  label: string;
  color: string;
}

const GRID_LINES = 4;
const MARGIN = { top: 8, bottom: 24, left: 8, right: 8 };
const BAR_SPRING = { type: "spring", stiffness: 200, damping: 26 } as const;

/**
 * Grouped bars, one group per row of `data`. `selected` gets a highlight band that springs between groups.
 * Hovering a group shows its values. Bars grow from the baseline on mount and spring to new values.
 */
export function BarChart({
  data,
  series,
  selected,
  format,
  className,
}: {
  data: ({ label: string } & Record<string, number | string>)[];
  series: BarSeries[];
  selected?: string;
  format: (value: number) => string;
  className?: string;
}) {
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const [hovered, setHovered] = useState<number | null>(null);

  const innerWidth = Math.max(width - MARGIN.left - MARGIN.right, 0);
  const innerHeight = Math.max(height - MARGIN.top - MARGIN.bottom, 0);
  const max = niceMax(Math.max(0, ...data.flatMap((row) => series.map((s) => Number(row[s.key]) || 0))));
  const slot = data.length > 0 ? innerWidth / data.length : 0;
  const groupWidth = slot * 0.6;
  const gap = Math.min(4, groupWidth * 0.1);
  const barWidth = Math.max((groupWidth - gap * (series.length - 1)) / series.length, 0);
  const yOf = (value: number) => innerHeight - (value / max) * innerHeight;
  const selectedIndex = data.findIndex((row) => row.label === selected);
  const hoveredRow = hovered === null ? undefined : data[hovered];

  return (
    <div ref={ref} className={cn("relative", className)}>
      {/* Drawn once measured: bars that grow in a 0×0 box would finish unseen. */}
      {width > 0 && height > 0 && (
        <svg
          width={width}
          height={height}
          className="overflow-visible"
          onMouseMove={(event) => {
            const x = event.clientX - event.currentTarget.getBoundingClientRect().left - MARGIN.left;
            const index = Math.floor(x / slot);
            setHovered(index >= 0 && index < data.length ? index : null);
          }}
          onMouseLeave={() => setHovered(null)}
        >
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {Array.from({ length: GRID_LINES }, (_, i) => {
              const y = (innerHeight / GRID_LINES) * i;
              return <line key={i} x1={0} x2={innerWidth} y1={y} y2={y} stroke="var(--border)" strokeDasharray="4 4" />;
            })}
            {selectedIndex >= 0 && (
              <motion.rect
                initial={false}
                animate={{ x: selectedIndex * slot + slot * 0.1 }}
                transition={{ type: "spring", stiffness: 280, damping: 30 }}
                y={-MARGIN.top}
                width={slot * 0.8}
                height={innerHeight + MARGIN.top}
                rx={8}
                fill="var(--muted)"
                opacity={0.6}
              />
            )}
            {data.map((row, i) => {
              const groupX = i * slot + (slot - groupWidth) / 2;
              return (
                <g key={row.label} opacity={hovered === null || hovered === i ? 1 : 0.4} className="transition-opacity">
                  {series.map((s, j) => {
                    const y = yOf(Number(row[s.key]) || 0);
                    return (
                      <motion.rect
                        key={s.key}
                        x={groupX + j * (barWidth + gap)}
                        y={y}
                        width={barWidth}
                        height={innerHeight - y}
                        rx={Math.min(4, barWidth / 2)}
                        fill={s.color}
                        // Grows by scaling from its base, a transform: no layout on every frame, unlike animating
                        // y and height. All bars grow at once.
                        style={{ transformBox: "fill-box", originY: 1 }}
                        initial={{ scaleY: 0 }}
                        animate={{ scaleY: 1 }}
                        transition={BAR_SPRING}
                      />
                    );
                  })}
                  <text
                    x={i * slot + slot / 2}
                    y={innerHeight + 16}
                    textAnchor="middle"
                    className={cn(
                      "fill-muted-foreground text-xs",
                      row.label === selected && "fill-foreground font-semibold",
                    )}
                  >
                    {/* Narrow slots (phones) get one letter; the selected month keeps its full label. */}
                    {slot < 34 && row.label !== selected ? row.label.charAt(0) : row.label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      )}
      {hoveredRow && hovered !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 grid min-w-36 gap-1 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
          style={{
            // Beside the hovered group, flipped to its left past the middle.
            left: MARGIN.left + (hovered < data.length / 2 ? (hovered + 1) * slot : hovered * slot),
            transform: hovered < data.length / 2 ? undefined : "translateX(-100%)",
          }}
        >
          <div className="font-medium">{hoveredRow.label}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              <span className="flex-1 text-muted-foreground">{s.label}</span>
              <span className="tabular-nums">{format(Number(hoveredRow[s.key]) || 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface Ring {
  label: string;
  value: number;
  max: number;
  color: string;
}

/**
 * Concentric progress rings, `rings[0]` innermost, each a stroked circle whose visible dash is its share of
 * `max`. They sweep in from empty on mount and spring to new values.
 */
export function RingChart({
  rings,
  size,
  strokeWidth,
  gap,
}: {
  rings: Ring[];
  size: number;
  strokeWidth: number;
  gap: number;
}) {
  const center = size / 2;
  const outerRadius = center - strokeWidth / 2;
  return (
    // Rotated so the arcs start at the top and run clockwise.
    <svg width={size} height={size} className="-rotate-90" aria-hidden>
      {rings.map((ring, i) => {
        const radius = outerRadius - (rings.length - 1 - i) * (strokeWidth + gap);
        const circumference = 2 * Math.PI * radius;
        const share = ring.max > 0 ? Math.min(Math.max(ring.value / ring.max, 0), 1) : 0;
        return (
          <g key={ring.label}>
            <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--muted)" strokeWidth={strokeWidth} />
            <motion.circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={ring.color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              // A round cap still shows at zero, so an empty ring hides its stroke.
              animate={{ strokeDashoffset: circumference * (1 - share), opacity: share > 0 ? 1 : 0 }}
              transition={{ type: "spring", stiffness: 180, damping: 26 }}
            />
          </g>
        );
      })}
    </svg>
  );
}
