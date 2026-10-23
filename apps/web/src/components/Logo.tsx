import { animate, svg } from "animejs";
import { useEffect, useRef } from "react";

import { cn, prefersReducedMotion } from "@web/lib/utils.ts";

/** The CFlow "C" with speed lines. `draw` traces it in with anime.js. */
export function Logo({ draw = false, className }: { draw?: boolean; className?: string }) {
  const path = useRef<SVGPathElement>(null);

  useEffect(() => {
    if (!draw || !path.current || prefersReducedMotion()) return;
    const animation = animate(svg.createDrawable(path.current), {
      draw: ["0 0", "0 1"],
      duration: 600,
      ease: "outCubic",
    });
    return () => {
      animation.revert();
    };
  }, [draw]);

  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("text-primary", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden
    >
      <path
        ref={path}
        d="M17.1 7.4A6.5 6.5 0 1 0 17.1 16.6M2 8h2M1.5 12h2.5M2 16h2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
