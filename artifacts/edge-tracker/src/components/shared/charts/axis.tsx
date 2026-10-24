/**
 * Category tick that wraps a two-word label onto two lines ("10–20 min" → "10–20" / "min") instead of letting
 * neighbours overlap. Use as `<XAxis tick={<WrapTick />} interval={0} height={44} />`.
 */
import { CHART } from "./theme";

export function WrapTick(props: { x?: number; y?: number; payload?: { value?: unknown } }) {
  const { x = 0, y = 0, payload } = props;
  const text = String(payload?.value ?? "");
  // Break at the space nearest the middle, so "not after a loss" → "not after" / "a loss".
  let i = -1;
  for (let k = text.indexOf(" "); k > 0; k = text.indexOf(" ", k + 1)) if (i < 0 || Math.abs(k - text.length / 2) < Math.abs(i - text.length / 2)) i = k;
  const lines = i > 0 && text.length > 6 ? [text.slice(0, i), text.slice(i + 1)] : [text];
  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="middle" fontSize={11} fill={CHART.axis} style={{ fontVariantNumeric: "tabular-nums" }}>
        {lines.map((l, k) => <tspan key={k} x={0} dy={k === 0 ? 12 : 13}>{l}</tspan>)}
      </text>
    </g>
  );
}
