/**
 * The quote under the lock clock: from the bundled library (lib/quotes — no API call; the lock gate blocks data routes),
 * mostly «Олимп» and the philosophers, changing every N minutes on wall-clock slots (Settings → Безопасность: 1 / 5 /
 * 15 min or off): the old quote drifts up into a blur while the new one surfaces word by word out of it (the
 * viewer's «Движение фона»; without it, an instant swap). The reader's own no-repeat cycle
 * (rotation «lock», per browser) and quote language (the dashboard card's pick, else the interface language). Each
 * new quote also lands in the card's history.
 */
import * as React from "react";
import { quotesI18n } from "@/i18n/ns/quotes";
import { citationOf, loadQuoteLibrary, quoteOf, type QuoteLibrary } from "@/lib/quotes/library";
import { crossFadeMs, lockQuotePlan } from "@/lib/quotes/lock-timer";
import { SURFACE_WEIGHTS, quoteForSlot } from "@/lib/quotes/rotation";
import { pushHistory, readPrefs, readQuoteLang, readRotation, seedFor, useLockQuoteInterval, writeRotation } from "@/lib/quotes/store";
import type { Quote } from "@/lib/quotes/types";
import { WordReveal } from "@/components/shared/word-reveal";

const SERIF = "var(--app-font-serif)";

type Layers = { a: Quote | null; b: Quote | null; front: "a" | "b" };

export function LockQuote({ owner, dim, motion }: { owner: string | null; dim: boolean; motion: boolean }) {
  const { t, lang: uiLang } = quotesI18n.useT();
  const interval = useLockQuoteInterval();
  const lang = React.useMemo(() => readQuoteLang(uiLang), [uiLang]);
  const [lib, setLib] = React.useState<QuoteLibrary | null>(null);
  const [layers, setLayers] = React.useState<Layers>({ a: null, b: null, front: "a" });
  const fade = crossFadeMs(!motion);

  React.useEffect(() => {
    if (interval === 0) return;
    let alive = true;
    void loadQuoteLibrary(lang).then((l) => { if (alive) setLib(l); }).catch(() => undefined);
    return () => { alive = false; };
  }, [lang, interval]);

  React.useEffect(() => {
    if (!lib || interval === 0) return;
    let timer = 0;
    const show = (q: Quote) => setLayers((s) => {
      const cur = s.front === "a" ? s.a : s.b;
      if (cur?.id === q.id && cur.text === q.text) return s;
      return s.front === "a" ? { ...s, b: q, front: "b" } : { ...s, a: q, front: "a" };
    });
    const tick = () => {
      const plan = lockQuotePlan(Date.now(), interval);
      if (!plan) return;
      const opt = { seed: seedFor(readPrefs(owner), owner, "lock"), weights: SURFACE_WEIGHTS.lock };
      const r = quoteForSlot(lib.quotes, readRotation("lock", owner), opt, plan.slot);
      if (r) {
        if (r.changed) {
          writeRotation("lock", owner, r.state);
          pushHistory(owner, { id: r.id, at: Date.now(), s: "lock" });
        }
        const q = quoteOf(lib, r.id);
        if (q) show(q);
      }
      timer = window.setTimeout(tick, plan.nextInMs + 30);
    };
    tick();
    // A sleeping laptop wakes past the boundary: re-check when the tab is shown again.
    const onVisible = () => { if (document.visibilityState === "visible") { window.clearTimeout(timer); tick(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [lib, interval, owner]);

  if (interval === 0 || (!layers.a && !layers.b)) return null;

  const layer = (q: Quote | null, on: boolean, key: string) => (
    <figure
      key={key}
      aria-hidden={!on}
      className="relative col-start-1 row-start-1 flex flex-col items-center"
      style={{
        opacity: on ? 1 : 0,
        // Leaving: up and into a blur; arriving: the words do their own entrance.
        transform: on || !fade ? undefined : "translateY(-10px)",
        filter: on || !fade ? undefined : "blur(8px)",
        transition: fade ? `opacity ${fade}ms ease-in-out, transform ${fade}ms ease-in-out, filter ${fade}ms ease-in-out` : undefined,
      }}
      data-testid={on ? "lock-quote" : undefined}
      data-quote-id={on ? q?.id : undefined}
    >
      {q && (
        <>
          <blockquote
            lang={lang}
            className="text-balance text-[clamp(1rem,1.55vw,1.3rem)] leading-relaxed text-white/90"
            style={{ fontFamily: SERIF, textShadow: "0 1px 18px rgba(0,0,0,0.75), 0 0 2px rgba(0,0,0,0.5)" }}
          >
            {on && fade ? <WordReveal key={q.id} text={q.text} delay={Math.round(fade * 0.35)} /> : q.text}
          </blockquote>
          <figcaption
            key={on ? `c-${q.id}` : "c"}
            className="mt-2 text-[clamp(0.7rem,0.95vw,0.82rem)] italic text-white/60"
            style={{ textShadow: "0 1px 10px rgba(0,0,0,0.8)", animation: on && fade ? `ws-word-in 800ms ease-out ${Math.round(fade * 0.35 + 900)}ms both` : undefined }}
          >
            — {q.authorName} · {citationOf(q)}
          </figcaption>
        </>
      )}
    </figure>
  );

  return (
    <section
      aria-label={t("lock.aria")}
      aria-live="off"
      className={`relative mx-auto mt-8 grid w-[min(40rem,88vw)] text-center transition-opacity duration-500 ${dim ? "opacity-25" : "opacity-100"}`}
    >
      {/* A soft dark halo behind the lines keeps them readable over bright scenes and photos. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-10 -inset-y-6 rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(0,0,0,0.38), rgba(0,0,0,0.12) 70%, transparent)", filter: "blur(20px)" }}
      />
      {layer(layers.a, layers.front === "a", "a")}
      {layer(layers.b, layers.front === "b", "b")}
    </section>
  );
}
