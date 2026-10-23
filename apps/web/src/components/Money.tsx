import { animate } from "animejs";
import { useEffect, useRef } from "react";

import { cn, formatMoney, prefersReducedMotion } from "@web/lib/utils.ts";

/** "$5,364" and ".00", so the cents can be dimmed. */
function splitMoney(amount: number): [string, string] {
  const text = formatMoney(amount);
  const dot = text.lastIndexOf(".");
  return [text.slice(0, dot), text.slice(dot)];
}

/**
 * Rolls a number from its last value to `target` with anime.js, handing each frame's value to `paint`. It
 * writes straight to the DOM: going through React state would re-render on every frame.
 */
function useCountUp(target: number, enabled: boolean, paint: (value: number) => void) {
  const current = useRef(enabled ? 0 : target);
  const paintRef = useRef(paint);
  paintRef.current = paint;

  useEffect(() => {
    if (!enabled || prefersReducedMotion()) {
      current.current = target;
      paintRef.current(target);
      return;
    }
    const state = { value: current.current };
    paintRef.current(state.value);
    const animation = animate(state, {
      value: target,
      duration: 700,
      ease: "outExpo",
      onUpdate: () => {
        current.current = state.value;
        paintRef.current(state.value);
      },
    });
    return () => {
      animation.pause();
    };
  }, [target, enabled]);
}

/**
 * An amount with dimmed cents ("$5,364" + ".00"), the way the dashboard shows
 * totals. `signed` adds "+" to money in; `countUp` rolls the number to each
 * new value with anime.js.
 */
export function Money({
  amount,
  signed = false,
  countUp = false,
  className,
}: {
  amount: number;
  signed?: boolean;
  countUp?: boolean;
  className?: string;
}) {
  const whole = useRef<HTMLSpanElement>(null);
  const cents = useRef<HTMLSpanElement>(null);
  useCountUp(amount, countUp, (value) => {
    const [w, c] = splitMoney(value);
    if (whole.current) whole.current.textContent = w;
    if (cents.current) cents.current.textContent = c;
  });
  // React renders the final value; a count-up repaints these two spans in place until it gets there.
  const [w, c] = splitMoney(amount);
  return (
    // inline-block + contain: a number changing every frame of a count-up only re-lays-out itself, not its card.
    <span className={cn("inline-block tabular-nums [contain:layout_paint]", className)}>
      {signed && amount > 0 ? "+" : ""}
      <span ref={whole}>{w}</span>
      <span ref={cents} className="opacity-60">
        {c}
      </span>
    </span>
  );
}

/** A whole-number percentage that counts up like `Money`. */
export function Percent({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useCountUp(value, true, (shown) => {
    if (ref.current) ref.current.textContent = `${Math.round(shown)}%`;
  });
  return (
    <span ref={ref} className={cn("inline-block [contain:layout_paint]", className)}>
      {Math.round(value)}%
    </span>
  );
}
