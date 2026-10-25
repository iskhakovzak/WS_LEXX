/**
 * Text whose words surface one after another out of a blur (ws-word-in, index.css): the lock screen's quote and the
 * sign-in page's greeting. `delay` shifts the whole line, the per-word step is capped so a long line is fully in within
 * `within` ms. Without `motion` the words are simply there. Screen readers read the plain text once.
 */

export function WordReveal({
  text, motion = true, delay = 0, within = 1400, maxStep = 55, duration = 700,
}: { text: string; motion?: boolean; delay?: number; within?: number; maxStep?: number; duration?: number }) {
  if (!motion) return <>{text}</>;
  const parts = text.split(/(\s+)/);
  const count = parts.filter((w) => w.trim()).length;
  const step = Math.min(maxStep, within / Math.max(1, count));
  let i = 0;
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {parts.map((w, k) => {
          if (!w.trim()) return w;
          const d = Math.round(delay + i++ * step);
          return (
            <span key={k} className="inline-block" style={{ animation: `ws-word-in ${duration}ms cubic-bezier(0.2, 0.9, 0.2, 1) ${d}ms both` }}>
              {w}
            </span>
          );
        })}
      </span>
    </>
  );
}
