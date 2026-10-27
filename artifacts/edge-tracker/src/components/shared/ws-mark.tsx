/**
 * The assistant's own mark: a luminous orb — a thin ring with an orbiting arc, a four-point spark at its core and a
 * soft breathing glow — in currentColor (monochrome, follows the theme). Not a generic sparkle: the ring says
 * «it sees your desk», the spark «it thinks». `still` freezes it (static places: lists, the trade sheet header);
 * reduced motion freezes it everywhere (ws-mark.css). Decorative by default (aria-hidden).
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import "./ws-mark.css";

export function WsMark({ className, still, title }: { className?: string; still?: boolean; title?: string }) {
  const id = React.useId().replace(/:/g, "");
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("ws-mark h-4 w-4 shrink-0", className)}
      data-still={still ? "true" : undefined}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      fill="none"
    >
      <defs>
        <radialGradient id={`wsg${id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle className="ws-mark-glow" cx="12" cy="12" r="11" fill={`url(#wsg${id})`} opacity=".25" />
      <circle cx="12" cy="12" r="8.75" stroke="currentColor" strokeOpacity=".32" strokeWidth="1.25" />
      <g className="ws-mark-orbit">
        <path d="M12 3.25a8.75 8.75 0 0 1 8.2 5.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="20.2" cy="8.95" r="1.25" fill="currentColor" />
      </g>
      <path
        className="ws-mark-core"
        d="M12 6.6c.36 2.62 1.18 3.98 2.45 4.73 1 .58 1.9.67 2.95.67-1.05 0-1.95.09-2.95.67-1.27.75-2.09 2.11-2.45 4.73-.36-2.62-1.18-3.98-2.45-4.73-1-.58-1.9-.67-2.95-.67 1.05 0 1.95-.09 2.95-.67C10.82 10.58 11.64 9.22 12 6.6Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** The ⚡ of the boost / deep marks: a compact bolt in currentColor. */
export function BoltMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("h-3 w-3 shrink-0", className)} aria-hidden="true" fill="currentColor">
      <path d="M9.2 1.2 3.4 9.1c-.2.3 0 .7.4.7h3.3l-.9 4.9c-.1.5.5.8.8.4l5.8-7.9c.2-.3 0-.7-.4-.7H9.1l.9-4.9c.1-.5-.5-.8-.8-.4Z" />
    </svg>
  );
}
