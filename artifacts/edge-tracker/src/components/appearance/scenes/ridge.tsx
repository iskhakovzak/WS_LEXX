/**
 * «Хребет»: a mountain ridge in fog, drawn here (CC0, no external material). Three seeded ridgelines in the text
 * colour at low alpha (aerial perspective: the far one faintest) and a pale moon. The overall strength is
 * --ridge-k per theme family (index.css), sized so muted text on the canvas keeps 4.5:1.
 */
import * as React from "react";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** A ridgeline across 0…1600 as a closed path down to the bottom of a 1600×1000 box. */
function ridge(seed: number, base: number, amp: number, step = 40): string {
  const r = rng(seed);
  const pts: [number, number][] = [];
  let y = base;
  for (let x = -40; x <= 1640; x += step) {
    y += (r() - 0.5) * amp;
    y = Math.max(base - amp * 2.2, Math.min(base + amp * 1.2, y));
    pts.push([x, y]);
  }
  const d = pts.map(([x, yy], i) => `${i ? "L" : "M"}${x},${yy.toFixed(1)}`).join(" ");
  return `${d} L1640,1000 L-40,1000 Z`;
}

export const RIDGE_LAYERS: { depth: number; node: React.ReactNode }[] = [
  {
    depth: 0.15,
    node: <circle cx="1180" cy="250" r="70" style={{ fill: "hsl(var(--foreground) / calc(0.05 * var(--ridge-k, 1)))" }} />,
  },
  { depth: 0.3, node: <path d={ridge(7, 560, 46, 30)} style={{ fill: "hsl(var(--foreground) / calc(0.035 * var(--ridge-k, 1)))" }} /> },
  { depth: 0.6, node: <path d={ridge(19, 700, 60, 36)} style={{ fill: "hsl(var(--foreground) / calc(0.04 * var(--ridge-k, 1)))" }} /> },
  { depth: 1, node: <path d={ridge(41, 840, 80, 44)} style={{ fill: "hsl(var(--foreground) / calc(0.05 * var(--ridge-k, 1)))" }} /> },
];

export function RidgeSvg({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 h-full w-full" aria-hidden="true">
      {children}
    </svg>
  );
}
