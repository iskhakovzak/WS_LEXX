/**
 * The scouting radar: the person's eight scores as a filled shape over the desk median (a shaded ring), concentric
 * guides at 25/50/75/100. Low-sample axes are drawn hollow with a dashed spoke — the shape never pretends precision.
 * One orchestrated motion: the shape grows out of the centre once (skipped under reduced motion).
 */
import { motion } from "framer-motion";
import { useReducedMotion } from "@/lib/motion";
import { profileI18n } from "@/i18n/ns/profile";
import { CHART, tint } from "@/components/shared/charts";
import type { Attribute } from "./api";
import { attrName, attrValueText, radarPath, radarPoint } from "./model";

const SIZE = 340;
const PAD = 46;
/** Side room for the axis labels (long names such as «Восстановление» sit outside the circle). */
const PADX = 92;

export function AttributeRadar({ attrs, className }: { attrs: readonly Attribute[]; className?: string }) {
  const { t } = profileI18n.useT();
  const reduce = useReducedMotion();
  const n = attrs.length;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const r = SIZE / 2 - PAD;
  const values = attrs.map((a) => a.score ?? 0);
  const desk = attrs.map((a) => a.deskMedian);
  const hasDesk = desk.some((v) => v !== null);
  const aria = t("card.radarAria", { list: attrs.map((a) => `${attrName(a.key)} ${attrValueText(a)}`).join(", ") });

  return (
    <svg viewBox={`${-PADX} 0 ${SIZE + 2 * PADX} ${SIZE}`} role="img" aria-label={aria} className={className}>
      {[25, 50, 75, 100].map((ring) => (
        <path key={ring} d={radarPath(Array(n).fill(ring), r, cx, cy)} fill="none" stroke={CHART.grid} strokeOpacity={ring === 100 ? 0.9 : 0.55} strokeWidth={1} />
      ))}
      {attrs.map((a, i) => {
        const [x, y] = radarPoint(i, n, 100, r, cx, cy);
        return <line key={a.key} x1={cx} y1={cy} x2={x} y2={y} stroke={CHART.grid} strokeOpacity={0.6} strokeDasharray={a.low ? "2 4" : undefined} />;
      })}
      {hasDesk && (
        <path d={radarPath(desk.map((v) => v ?? 0), r, cx, cy)} fill={tint("muted-foreground", 0.16)} stroke={tint("muted-foreground", 0.55)} strokeWidth={1.25} strokeDasharray="4 3" />
      )}
      <motion.g
        initial={reduce ? false : { scale: 0.2, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      >
        <path d={radarPath(values, r, cx, cy)} fill={tint("primary", 0.2)} stroke={CHART.accent} strokeWidth={2.25} strokeLinejoin="round" />
        {attrs.map((a, i) => {
          const [x, y] = radarPoint(i, n, a.score ?? 0, r, cx, cy);
          return a.low
            ? <circle key={a.key} cx={x} cy={y} r={4} fill={CHART.surface} stroke={CHART.accent} strokeWidth={1.5} strokeDasharray="2 2" />
            : <circle key={a.key} cx={x} cy={y} r={4.5} fill={CHART.accent} stroke={CHART.surface} strokeWidth={2} />;
        })}
      </motion.g>
      {attrs.map((a, i) => {
        const [x, y] = radarPoint(i, n, 100, r + 22, cx, cy);
        const anchor = Math.abs(x - cx) < 8 ? "middle" : x > cx ? "start" : "end";
        return (
          <g key={a.key}>
            <text x={x} y={y - 4} textAnchor={anchor} fontSize={13} fontWeight={600} fill={CHART.fg}>{attrName(a.key)}</text>
            <text x={x} y={y + 12} textAnchor={anchor} fontSize={12} fill={CHART.axis} style={{ fontVariantNumeric: "tabular-nums" }}>
              {attrValueText(a)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
