/**
 * Schematic pictures of the office setups (cheat sheet, «Сегодня» rows, quick sheet): one small inline SVG per
 * `TodaySetup.schema` key. One visual language for all 16: price = foreground line, levels = dashed muted, VWAP =
 * dashed purple, entry = primary dot, stop = red tick, target = green tick, the bell = dotted vertical, a time zone =
 * faint primary fill. Theme tokens only (Tailwind stroke-/fill- utilities over the CSS variables), so light / dim /
 * dark all work. viewBox 120 × 72; the caller sizes it.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { playbookTodayI18n } from "@/i18n/ns/playbookToday";

export const SCHEMA_KEYS = [
  "routine", "orb", "gap_go", "opening_drive", "red_to_green", "first_pullback", "vwap_hold", "flag", "hod_break",
  "vwap_fade", "failed_breakout", "parabolic", "day2", "gap_fill", "power_hour", "moc",
] as const;
export type SchemaKey = (typeof SCHEMA_KEYS)[number];
export const isSchemaKey = (v: unknown): v is SchemaKey => typeof v === "string" && (SCHEMA_KEYS as readonly string[]).includes(v);

/* ── primitives ─────────────────────────────────────────────────────────── */

const Price = ({ d, className }: { d: string; className?: string }) => (
  <path d={d} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className={cn("stroke-foreground", className)} />
);
const Level = ({ y, x1 = 4, x2 = 116 }: { y: number; x1?: number; x2?: number }) => (
  <line x1={x1} x2={x2} y1={y} y2={y} strokeWidth={1} strokeDasharray="3 3" className="stroke-muted-foreground/70" />
);
const Vwap = ({ d }: { d: string }) => <path d={d} fill="none" strokeWidth={1.5} strokeDasharray="5 3" className="stroke-purple" />;
const Bell = ({ x }: { x: number }) => (
  <line x1={x} x2={x} y1={4} y2={68} strokeWidth={1} strokeDasharray="1 3" strokeLinecap="round" className="stroke-muted-foreground" />
);
const Zone = ({ x, w, y = 2, h = 68 }: { x: number; w: number; y?: number; h?: number }) => (
  <rect x={x} y={y} width={w} height={h} rx={3} className="fill-primary/10" />
);
const Entry = ({ x, y }: { x: number; y: number }) => <circle cx={x} cy={y} r={3.2} strokeWidth={1.5} className="fill-primary stroke-background" />;
const Stop = ({ x, y, w = 14 }: { x: number; y: number; w?: number }) => (
  <line x1={x - w / 2} x2={x + w / 2} y1={y} y2={y} strokeWidth={2} strokeLinecap="round" className="stroke-down" />
);
const Target = ({ x, y, w = 14 }: { x: number; y: number; w?: number }) => (
  <line x1={x - w / 2} x2={x + w / 2} y1={y} y2={y} strokeWidth={2} strokeLinecap="round" className="stroke-up" />
);

/* ── the 16 pictures ────────────────────────────────────────────────────── */

const ART: Record<SchemaKey, () => ReactNode> = {
  /** Morning prep: a clipboard with three ticked lines. */
  routine: () => (
    <>
      <rect x={38} y={8} width={44} height={56} rx={6} fill="none" strokeWidth={2} className="stroke-foreground" />
      <rect x={50} y={4} width={20} height={8} rx={3} className="fill-muted-foreground/60" />
      {[24, 38, 52].map((y) => (
        <g key={y}>
          <path d={`M45,${y} l3,3 l6,-6`} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="stroke-up" />
          <line x1={58} x2={75} y1={y} y2={y} strokeWidth={2} strokeLinecap="round" className="stroke-muted-foreground" />
        </g>
      ))}
    </>
  ),
  /** Opening range box, a break of its high, stop under the range. */
  orb: () => (
    <>
      <rect x={8} y={30} width={34} height={16} rx={2} strokeWidth={1} strokeDasharray="3 3" className="fill-primary/10 stroke-muted-foreground/70" />
      <Price d="M8,40 L14,32 L20,44 L26,34 L32,42 L38,33 L44,36 L50,27 L60,22 L72,16 L86,12 L110,7" />
      <Entry x={47} y={30} />
      <Stop x={47} y={50} />
      <Target x={100} y={9} />
    </>
  ),
  /** Yesterday low, a gap up at the bell, the premarket high breaks. */
  gap_go: () => (
    <>
      <Bell x={36} />
      <Price d="M6,58 L13,55 L20,57 L28,54" className="stroke-muted-foreground" />
      <path d="M32,54 L32,32" strokeWidth={1.5} strokeDasharray="2 2" className="stroke-up" />
      <Level y={24} x1={38} />
      <Price d="M40,32 L46,27 L52,31 L58,26 L64,20 L76,15 L92,10 L112,6" />
      <Entry x={60} y={24} />
      <Stop x={52} y={36} />
    </>
  ),
  /** One-way move from the bell with shallow pauses. */
  opening_drive: () => (
    <>
      <Bell x={10} />
      <Price d="M10,62 L20,53 L25,55 L35,43 L40,45 L51,31 L56,33 L69,21 L74,23 L92,11 L112,6" />
      <Entry x={25} y={55} />
      <Stop x={25} y={62} />
      <Target x={100} y={8} />
    </>
  ),
  /** Opens below yesterday's close (red), crosses it and turns green. */
  red_to_green: () => (
    <>
      <Level y={36} />
      <Price d="M8,48 L16,54 L24,50 L32,58 L40,52 L50,42 L56,36" className="stroke-down" />
      <Price d="M56,36 L64,30 L76,24 L92,18 L112,12" className="stroke-up" />
      <Entry x={56} y={36} />
      <Stop x={44} y={58} />
    </>
  ),
  /** Strong push, the first pullback to the rising average, entry on the break of the pullback high. */
  first_pullback: () => (
    <>
      <Vwap d="M6,66 Q44,52 116,22" />
      <Price d="M8,62 L20,46 L32,28 L40,36 L46,41 L52,35 L58,28 L66,22 L82,16 L110,9" />
      <Entry x={56} y={30} />
      <Stop x={46} y={47} />
    </>
  ),
  /** Pullback to VWAP holds twice, then the trend resumes. */
  vwap_hold: () => (
    <>
      <Vwap d="M6,52 C40,48 80,44 114,40" />
      <Price d="M6,28 L16,36 L24,41 L30,47 L36,39 L44,34 L50,41 L56,45 L62,37 L72,29 L86,23 L100,17 L114,12" />
      <Entry x={62} y={37} />
      <Stop x={56} y={53} />
    </>
  ),
  /** Pole, a tight falling channel, breakout of the channel top. */
  flag: () => (
    <>
      <line x1={28} y1={19} x2={58} y2={31} strokeWidth={1} strokeDasharray="3 3" className="stroke-muted-foreground/70" />
      <line x1={30} y1={31} x2={60} y2={43} strokeWidth={1} strokeDasharray="3 3" className="stroke-muted-foreground/70" />
      <Price d="M8,64 L28,21 L34,29 L39,25 L45,34 L50,30 L56,38 L61,31 L70,21 L84,13 L104,6" />
      <Entry x={60} y={32} />
      <Stop x={56} y={44} />
    </>
  ),
  /** High of day tested again and again, then taken out. */
  hod_break: () => (
    <>
      <Level y={22} />
      <Price d="M6,58 L16,41 L24,22 L32,34 L42,26 L50,22 L58,31 L66,26 L74,22 L80,15 L94,10 L112,6" />
      <Entry x={76} y={21} />
      <Stop x={66} y={32} />
    </>
  ),
  /** Short: stretched far above VWAP, a lower high breaks, back to VWAP. */
  vwap_fade: () => (
    <>
      <Vwap d="M6,54 L114,50" />
      <Price d="M6,50 L18,37 L30,23 L40,12 L46,17 L52,15 L58,23 L66,31 L76,39 L88,46 L104,49" />
      <Entry x={58} y={23} />
      <Stop x={44} y={8} />
      <Target x={96} y={50} />
    </>
  ),
  /** Short: a poke above the level fails, price falls back below and keeps going. */
  failed_breakout: () => (
    <>
      <Level y={26} />
      <Price d="M6,52 L16,42 L26,31 L34,29 L40,23 L46,18 L52,26 L58,32 L66,38 L78,46 L92,54 L112,61" />
      <Entry x={54} y={28} />
      <Stop x={46} y={13} />
      <Target x={98} y={56} />
    </>
  ),
  /** Short: an accelerating run, the first lower high cracks. */
  parabolic: () => (
    <>
      <Price d="M6,64 Q52,60 70,10 L76,15 L80,12 L86,24 L94,36 L104,44 L114,48" />
      <Entry x={86} y={24} />
      <Stop x={76} y={6} />
      <Target x={106} y={46} />
    </>
  ),
  /** Yesterday's big move closes near the high; today holds and continues. */
  day2: () => (
    <>
      <Bell x={44} />
      <Level y={22} />
      <Price d="M6,62 L14,53 L22,41 L30,31 L38,24" className="stroke-muted-foreground" />
      <Price d="M48,28 L54,33 L60,27 L66,25 L72,18 L84,14 L98,10 L112,6" />
      <Entry x={70} y={21} />
      <Stop x={54} y={38} />
    </>
  ),
  /** Gap down under yesterday's close, the rally back fills the gap. */
  gap_fill: () => (
    <>
      <Bell x={36} />
      <Level y={20} />
      <Price d="M6,22 L14,18 L22,22 L30,20" className="stroke-muted-foreground" />
      <Price d="M40,52 L46,57 L52,50 L60,44 L66,47 L74,37 L84,29 L94,23 L102,20" />
      <Entry x={60} y={44} />
      <Stop x={46} y={62} />
      <Target x={104} y={20} />
    </>
  ),
  /** A flat afternoon, then the trend of the last hour (15:00–16:00 shaded). */
  power_hour: () => (
    <>
      <Zone x={80} w={36} />
      <Price d="M6,40 L16,36 L26,42 L36,38 L46,44 L56,40 L66,42 L76,38 L84,36 L92,28 L100,20 L108,14 L114,10" />
      <Entry x={86} y={34} />
      <Stop x={80} y={45} />
    </>
  ),
  /** Closing imbalance builds (bars) and pulls price into the bell. */
  moc: () => (
    <>
      <Bell x={108} />
      <rect x={82} y={62} width={5} height={4} rx={1} className="fill-up/50" />
      <rect x={89} y={58} width={5} height={8} rx={1} className="fill-up/50" />
      <rect x={96} y={52} width={5} height={14} rx={1} className="fill-up/50" />
      <Price d="M6,40 L20,42 L34,38 L48,41 L62,39 L76,40 L86,36 L94,30 L100,22 L106,17" />
      <Entry x={86} y={36} />
      <Target x={106} y={12} w={10} />
    </>
  ),
};

/** The picture for `schema` (null → nothing). `title` = the accessible name (default: «Схема: …»); "" = decorative. */
export function SetupSchema({ schema, className, title }: { schema: string | null | undefined; className?: string; title?: string }) {
  if (!isSchemaKey(schema)) return null;
  const label = title ?? playbookTodayI18n.t(`schema.${schema}`);
  return (
    <svg
      viewBox="0 0 120 72"
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      data-schema={schema}
      className={cn("h-[72px] w-[120px] shrink-0 overflow-visible", className)}
    >
      {label && <title>{label}</title>}
      {ART[schema]()}
    </svg>
  );
}
