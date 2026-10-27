/**
 * Centre emblems of the «Олимп» coins, drawn in the coin's 200×200 box around (100, 100), about ±42 wide.
 * Each emblem is painted three times by the coin (shadow, highlight, face) to read as struck relief, so it takes the
 * paint as an argument: `body` = raised surfaces, `line` = engraved outlines, `deep` = recesses.
 *
 *   stage:    owl (Athena, learning — Джун) · caduceus (Hermes, trade — Трейдер) · keraunos (Zeus' thunderbolt — Сеньор)
 *   category: shield · scroll · bow · scales · temple · lamp · sprig      (achievement lines)
 *   scope:    torch · sun · moon · amphora · helmet                       (quests)
 */
import type { ReactNode } from "react";

export type EmblemPaint = { body: string; line: string; deep: string };
export type EmblemKey =
  | "owl" | "caduceus" | "keraunos"
  | "shield" | "scroll" | "bow" | "scales" | "temple" | "lamp" | "sprig"
  | "torch" | "sun" | "moon" | "amphora" | "helmet"
  | "unknown";

const MIRROR = "matrix(-1 0 0 1 200 0)";
const LEAF = "M0 0 C3.5 -3.6 8.5 -3.8 12 0 C8.5 3.8 3.5 3.6 0 0 Z";

/** A stroked shape with an engraved outline: the outline colour a little wider under the body colour. */
function Stroke({ d, w, p, cap = "round" }: { d: string; w: number; p: EmblemPaint; cap?: "round" | "butt" }) {
  return (
    <>
      <path d={d} fill="none" stroke={p.line} strokeWidth={w + 2.2} strokeLinecap={cap} strokeLinejoin="round" />
      <path d={d} fill="none" stroke={p.body} strokeWidth={w} strokeLinecap={cap} strokeLinejoin="round" />
    </>
  );
}

function Shape({ d, p, w = 1.3 }: { d: string; p: EmblemPaint; w?: number }) {
  return <path d={d} fill={p.body} stroke={p.line} strokeWidth={w} strokeLinejoin="round" />;
}

function Leaf({ x, y, rot, s = 1, p }: { x: number; y: number; rot: number; s?: number; p: EmblemPaint }) {
  return <path d={LEAF} transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`} fill={p.body} stroke={p.line} strokeWidth={0.9 / s} />;
}

function Star4({ x, y, r, p }: { x: number; y: number; r: number; p: EmblemPaint }) {
  const k = r * 0.28;
  return <path d={`M${x} ${y - r} L${x + k} ${y - k} L${x + r} ${y} L${x + k} ${y + k} L${x} ${y + r} L${x - k} ${y + k} L${x - r} ${y} L${x - k} ${y - k} Z`} fill={p.body} stroke={p.line} strokeWidth={0.6} />;
}

// ─── stage emblems ────────────────────────────────────────────────────────────

function Owl(p: EmblemPaint) {
  return (
    <g>
      <Stroke d="M66 141 L134 141" w={4} p={p} />
      <Shape p={p} w={1.4} d="M100 60 C121 60 131 79 130 101 C129 125 117 139 100 139 C83 139 71 125 70 101 C69 79 79 60 100 60 Z" />
      <Shape p={p} d="M74 75 L76 50 L92 63 Z" />
      <Shape p={p} d={`M126 75 L124 50 L108 63 Z`} />
      <circle cx="87" cy="88" r="12" fill={p.deep} />
      <circle cx="113" cy="88" r="12" fill={p.deep} />
      <circle cx="87" cy="88" r="6.5" fill={p.body} />
      <circle cx="113" cy="88" r="6.5" fill={p.body} />
      <circle cx="87" cy="88" r="2.8" fill={p.deep} />
      <circle cx="113" cy="88" r="2.8" fill={p.deep} />
      <Shape p={p} w={1.1} d="M100 95 L94.5 104 L100 114 L105.5 104 Z" />
      <path d="M75 76 Q88 69 100 79 Q112 69 125 76" fill="none" stroke={p.line} strokeWidth={2.2} strokeLinecap="round" />
      <path d="M76 104 Q80 124 96 134 M124 104 Q120 124 104 134" fill="none" stroke={p.line} strokeWidth={2} strokeLinecap="round" />
      <path d="M91 119 l4.5 4 l4.5 -4 l4.5 4 l4.5 -4 M93.5 128 l3.25 3 l3.25 -3 l3.25 3 l3.25 -3" fill="none" stroke={p.line} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function CaduceusWing(p: EmblemPaint) {
  return (
    <g>
      <Shape p={p} d="M96 70 C86 60 72 55 57 57 C63 61 67 63 70 66 C64 66 60 68 58 71 C65 71 71 72 75 74 C71 75 68 77 67 80 C78 80 89 77 96 76 Z" />
      <path d="M93 72 C85 67 77 64 66 63 M93 74 C86 72 79 71 70 72" fill="none" stroke={p.line} strokeWidth={1} strokeLinecap="round" />
    </g>
  );
}

function Snake(p: EmblemPaint) {
  return (
    <g>
      <Stroke d="M86 87 C78 91 80 99 100 103 C120 107 120 117 100 121 C82 125 84 135 100 139" w={5} p={p} />
      <ellipse cx="85" cy="85.5" rx="5.4" ry="3.8" transform="rotate(-24 85 85.5)" fill={p.body} stroke={p.line} strokeWidth={1.1} />
    </g>
  );
}

function Caduceus(p: EmblemPaint) {
  return (
    <g>
      <rect x="96.5" y="58" width="7" height="88" rx="3.5" fill={p.body} stroke={p.line} strokeWidth={1} />
      <CaduceusWing {...p} />
      <g transform={MIRROR}><CaduceusWing {...p} /></g>
      <Snake {...p} />
      <g transform={MIRROR}><Snake {...p} /></g>
      <circle cx="100" cy="53" r="6" fill={p.body} stroke={p.line} strokeWidth={1.1} />
    </g>
  );
}

/** Zeus' thunderbolt: one bold bolt (legible at 24 px) with an engraved spine and two sparks. */
function Keraunos(p: EmblemPaint) {
  return (
    <g transform="translate(-2 0)">
      <Shape p={p} w={1.5} d="M110 44 H131 L109 89 H127 L80 157 L94 106 H73 Z" />
      <path d="M118 52 L101 96 M96 113 L88 140" fill="none" stroke={p.line} strokeWidth={1.1} strokeLinecap="round" />
      <Star4 p={p} x={68} y={70} r={7} />
      <Star4 p={p} x={138} y={128} r={7} />
      <Star4 p={p} x={140} y={66} r={4.5} />
      <Star4 p={p} x={64} y={132} r={4.5} />
    </g>
  );
}

// ─── achievement categories ───────────────────────────────────────────────────

function ShieldE(p: EmblemPaint) {
  return (
    <g>
      <circle cx="100" cy="100" r="40" fill={p.body} stroke={p.line} strokeWidth={1.5} />
      <circle cx="100" cy="100" r="32" fill="none" stroke={p.line} strokeWidth={1.6} />
      <path d="M83 122 L100 76 L117 122" fill="none" stroke={p.deep} strokeWidth={6.5} strokeLinejoin="miter" />
    </g>
  );
}

function ScrollE(p: EmblemPaint) {
  return (
    <g>
      <rect x="68" y="70" width="64" height="60" fill={p.body} stroke={p.line} strokeWidth={1.4} />
      <rect x="61" y="63" width="78" height="13" rx="6.5" fill={p.body} stroke={p.line} strokeWidth={1.4} />
      <rect x="61" y="124" width="78" height="13" rx="6.5" fill={p.body} stroke={p.line} strokeWidth={1.4} />
      <path d="M78 88 H122 M78 98 H122 M78 108 H110" stroke={p.line} strokeWidth={2.6} strokeLinecap="round" />
      <circle cx="67" cy="69.5" r="2.6" fill={p.deep} />
      <circle cx="133" cy="69.5" r="2.6" fill={p.deep} />
      <circle cx="67" cy="130.5" r="2.6" fill={p.deep} />
      <circle cx="133" cy="130.5" r="2.6" fill={p.deep} />
    </g>
  );
}

function BowE(p: EmblemPaint) {
  return (
    <g transform="translate(100 100) scale(0.86) translate(-102 -100)">
      <path d="M76 56 L76 144" stroke={p.line} strokeWidth={1.5} />
      <Stroke d="M76 56 Q44 100 76 144" w={7.5} p={p} />
      <Stroke d="M64 100 L138 100" w={4.6} p={p} cap="butt" />
      <Shape p={p} w={1.2} d="M136 91 L154 100 L136 109 Z" />
      <path d="M66 100 L58 91 M66 100 L58 109 M73 100 L65 91 M73 100 L65 109" stroke={p.line} strokeWidth={2.2} strokeLinecap="round" />
    </g>
  );
}

function ScalesE(p: EmblemPaint) {
  return (
    <g transform="translate(100 100) scale(0.88) translate(-100 -100)">
      <Stroke d="M100 62 V136" w={4.5} p={p} cap="butt" />
      <Stroke d="M80 140 H120" w={5.5} p={p} />
      <Stroke d="M60 72 H140" w={4} p={p} />
      <circle cx="100" cy="58" r="5.5" fill={p.body} stroke={p.line} strokeWidth={1.1} />
      <path d="M64 72 L53 108 M64 72 L75 108 M136 72 L125 108 M136 72 L147 108" stroke={p.line} strokeWidth={1.5} />
      <Shape p={p} w={1.2} d="M49 108 Q64 124 79 108 Z" />
      <Shape p={p} w={1.2} d="M121 108 Q136 124 151 108 Z" />
    </g>
  );
}

function TempleE(p: EmblemPaint) {
  const cols = [72, 90.7, 109.3, 128];
  return (
    <g>
      <Shape p={p} w={1.4} d="M58 80 L100 57 L142 80 Z" />
      <path d="M70 77 L100 63 L130 77 Z" fill="none" stroke={p.line} strokeWidth={1} />
      <rect x="61" y="80" width="78" height="9" fill={p.body} stroke={p.line} strokeWidth={1.3} />
      {cols.map((x) => (
        <g key={x}>
          <rect x={x - 4.5} y="91" width="9" height="36" fill={p.body} stroke={p.line} strokeWidth={1.2} />
          <path d={`M${x} 94 V124`} stroke={p.line} strokeWidth={0.9} />
        </g>
      ))}
      <rect x="59" y="127" width="82" height="6.5" fill={p.body} stroke={p.line} strokeWidth={1.2} />
      <rect x="54" y="133.5" width="92" height="6.5" fill={p.body} stroke={p.line} strokeWidth={1.2} />
    </g>
  );
}

function LampE(p: EmblemPaint) {
  return (
    <g transform="translate(100 100) scale(0.92) translate(-101 -102)">
      <Stroke d="M63 108 C50 104 50 121 64 118" w={3.6} p={p} />
      <Shape p={p} w={1.4} d="M84 124 L80 133 H106 L102 124 Z" />
      <Shape p={p} w={1.4} d="M62 112 C62 98 84 92 104 96 L136 104 C142 106 142 112 136 114 L110 118 C96 128 70 126 62 112 Z" />
      <circle cx="92" cy="105" r="4.2" fill={p.deep} />
      <Shape p={p} w={1.1} d="M138 101 C132 91 138 79 146 72 C144 83 152 90 147 99 C145 103 141 104 138 101 Z" />
      <path d="M141 99 C139 93 141 88 144 84" fill="none" stroke={p.line} strokeWidth={1} strokeLinecap="round" />
    </g>
  );
}

function SprigE(p: EmblemPaint) {
  return (
    <g>
      <Stroke d="M100 144 C98 122 99 92 108 58" w={2.6} p={p} />
      <Leaf p={p} x={99.2} y={131} rot={212} s={1.55} />
      <Leaf p={p} x={99.6} y={124} rot={-28} s={1.55} />
      <Leaf p={p} x={99.5} y={113} rot={208} s={1.4} />
      <Leaf p={p} x={100.2} y={105} rot={-32} s={1.4} />
      <Leaf p={p} x={101.2} y={94} rot={204} s={1.25} />
      <Leaf p={p} x={102.4} y={86} rot={-36} s={1.25} />
      <Leaf p={p} x={104.2} y={75} rot={202} s={1.05} />
      <Leaf p={p} x={105.6} y={68} rot={-40} s={1.05} />
      <ellipse cx="86" cy="140" rx="4.5" ry="6" transform="rotate(-20 86 140)" fill={p.body} stroke={p.line} strokeWidth={1.1} />
      <ellipse cx="116" cy="118" rx="4.2" ry="5.6" transform="rotate(20 116 118)" fill={p.body} stroke={p.line} strokeWidth={1.1} />
    </g>
  );
}

// ─── quest scopes ─────────────────────────────────────────────────────────────

function TorchE(p: EmblemPaint) {
  return (
    <g>
      <Shape p={p} w={1.3} d="M91 99 L100 146 L109 99 Z" />
      <path d="M95 113 H105 M97 127 H103" stroke={p.line} strokeWidth={1.3} />
      <Shape p={p} w={1.3} d="M83 86 H117 L110 100 H90 Z" />
      <Shape p={p} w={1.2} d="M100 46 C113 58 121 71 112 84 H88 C80 71 89 62 94 52 C96 60 98 62 100 64 C100 58 100 52 100 46 Z" />
      <path d="M100 82 C93 74 97 68 100 64" fill="none" stroke={p.line} strokeWidth={1.1} strokeLinecap="round" />
    </g>
  );
}

function SunE(p: EmblemPaint) {
  const rays = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6;
    const tip = i % 2 ? 37 : 44;
    const b = 26;
    const w = 0.13;
    const pt = (r: number, da: number) => `${(100 + r * Math.cos(a + da)).toFixed(2)} ${(100 + r * Math.sin(a + da)).toFixed(2)}`;
    return `M${pt(b, -w)} L${pt(tip, 0)} L${pt(b, w)} Z`;
  }).join(" ");
  return (
    <g>
      <path d={rays} fill={p.body} stroke={p.line} strokeWidth={1.1} strokeLinejoin="round" />
      <circle cx="100" cy="100" r="21" fill={p.body} stroke={p.line} strokeWidth={1.4} />
      <circle cx="100" cy="100" r="14" fill="none" stroke={p.line} strokeWidth={1.1} />
    </g>
  );
}

function MoonE(p: EmblemPaint) {
  return (
    <g>
      <Shape p={p} w={1.4} d="M110 61 A40 40 0 1 0 110 139 A46 46 0 0 1 110 61 Z" />
      <Star4 p={p} x={127} y={84} r={6.5} />
      <Star4 p={p} x={137} y={104} r={5} />
      <Star4 p={p} x={124} y={120} r={5.5} />
    </g>
  );
}

function AmphoraE(p: EmblemPaint) {
  return (
    <g>
      <Stroke d="M94 77 C79 70 73 81 80 93" w={3.4} p={p} />
      <Stroke d="M106 77 C121 70 127 81 120 93" w={3.4} p={p} />
      <Shape p={p} w={1.4} d="M90 55 H110 V61 C110 65 106 67 106 71 C124 79 130 99 122 119 C118 129 110 135 104 137 L106 145 H94 L96 137 C90 135 82 129 78 119 C70 99 76 79 94 71 C94 67 90 65 90 61 Z" />
      <path d="M79 99 H121 M78 113 H122" stroke={p.line} strokeWidth={1.2} />
      <path d="M81 106 l4 -4 l4 4 l4 -4 l4 4 l4 -4 l4 4 l4 -4 l4 4 l4 -4" fill="none" stroke={p.line} strokeWidth={1.2} strokeLinejoin="round" />
    </g>
  );
}

function HelmetE(p: EmblemPaint) {
  return (
    <g transform="translate(0 2)">
      <Shape p={p} w={1.4} d="M100 50 C124 50 138 68 138 92 L138 132 C132 138 122 140 114 136 L112 112 C110 106 104 104 104 112 L104 140 H96 L96 112 C96 104 90 106 88 112 L86 136 C78 140 68 138 62 132 L62 92 C62 68 76 50 100 50 Z" />
      <path d="M70 93 C78 86 88 88 96 95 M130 93 C122 86 112 88 104 95" fill="none" stroke={p.deep} strokeWidth={4.6} strokeLinecap="round" />
      <path d="M100 51 V84" stroke={p.line} strokeWidth={1.1} />
    </g>
  );
}

function UnknownE(p: EmblemPaint) {
  return (
    <text x="100" y="128" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontWeight={700} fontSize="82" fill={p.body} stroke={p.line} strokeWidth={1.2}>?</text>
  );
}

const DRAW: Readonly<Record<EmblemKey, (p: EmblemPaint) => ReactNode>> = {
  owl: Owl, caduceus: Caduceus, keraunos: Keraunos,
  shield: ShieldE, scroll: ScrollE, bow: BowE, scales: ScalesE, temple: TempleE, lamp: LampE, sprig: SprigE,
  torch: TorchE, sun: SunE, moon: MoonE, amphora: AmphoraE, helmet: HelmetE,
  unknown: UnknownE,
};

export function Emblem({ name, paint }: { name: EmblemKey; paint: EmblemPaint }) {
  const draw = DRAW[name] ?? UnknownE;
  return <>{draw(paint)}</>;
}
