import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, LayoutDashboard, ListChecks, BookOpen, Lightbulb, Eye, Compass, Target, CalendarDays, FlaskConical, NotebookPen, ShieldAlert, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type Dest = { href: string; label: string; icon: LucideIcon; keys: string[]; chip?: boolean };

// Main sections + loose keywords so a mistyped / outdated URL can suggest the right place.
const DESTS: Dest[] = [
  { href: "/", label: "Дашборд", icon: LayoutDashboard, keys: ["dashboard", "home", "main", "today", "dash"] },
  { href: "/game-plan", label: "Гейм-план", icon: Target, keys: ["game-plan", "gameplan", "plan", "premarket"], chip: true },
  { href: "/trades", label: "Сделки", icon: ListChecks, keys: ["trades", "trade", "deal", "sdelki", "positions"], chip: true },
  { href: "/playbook", label: "Плейбук", icon: BookOpen, keys: ["playbook", "setup", "setups", "play"], chip: true },
  { href: "/trade-ideas", label: "Идеи", icon: Lightbulb, keys: ["trade-ideas", "ideas", "idea"], chip: true },
  { href: "/watchlist", label: "Вотчлист", icon: Eye, keys: ["watchlist", "watch", "list"], chip: true },
  { href: "/events", label: "Катализаторы", icon: CalendarDays, keys: ["events", "event", "calendar", "earnings"] },
  { href: "/research", label: "Архив исследований", icon: FlaskConical, keys: ["research", "study"] },
  { href: "/journal", label: "Дневник", icon: NotebookPen, keys: ["journal", "diary", "notes"] },
  { href: "/risk", label: "Риск-деск", icon: ShieldAlert, keys: ["risk", "limits"] },
];

function score(path: string, d: Dest) {
  const p = path.toLowerCase().replace(/[^a-z0-9/-]/g, "");
  const seg = p.split("/").filter(Boolean)[0] ?? "";
  if (!seg) return 0;
  let best = 0;
  for (const k of d.keys) {
    if (seg === k) best = Math.max(best, 3);
    else if (seg.startsWith(k) || k.startsWith(seg)) best = Math.max(best, 2);
    else if (seg.includes(k) || k.includes(seg)) best = Math.max(best, 1);
  }
  return best;
}

export default function NotFound() {
  const [location] = useLocation();
  const canGoBack = typeof window !== "undefined" && window.history.length > 1;

  const suggestion = useMemo(() => {
    const ranked = DESTS.map((d) => ({ d, s: score(location, d) })).filter((x) => x.s > 0 && x.d.href !== "/").sort((a, b) => b.s - a.s);
    return ranked[0]?.d ?? null;
  }, [location]);

  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center px-1 py-8">
      <div className="glass-panel w-full max-w-md rounded-3xl p-6 text-center sm:p-8">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/15 text-primary">
          <Compass className="h-6 w-6" aria-hidden="true" />
        </span>
        <p className="mt-4 text-5xl font-semibold tabular-nums tracking-tight text-foreground">404</p>
        <h1 className="mt-1 text-lg font-semibold text-foreground">Страница не найдена</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ссылка устарела или в адресе опечатка.
        </p>
        <p className="mx-auto mt-3 max-w-full truncate rounded-full bg-[var(--glass-bg)] px-3 py-1 text-xs text-muted-foreground" title={location}>
          {location}
        </p>

        {suggestion && (
          <Link
            href={suggestion.href}
            className="lift mt-5 flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
              <suggestion.icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs text-muted-foreground">Возможно, вы искали</span>
              <span className="block text-sm font-semibold text-foreground">{suggestion.label}</span>
            </span>
          </Link>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {canGoBack && (
            <Button type="button" variant="outline" onClick={() => window.history.back()}>
              <ArrowLeft aria-hidden="true" />
              Назад
            </Button>
          )}
          <Button asChild variant={suggestion ? "outline" : "default"}>
            <Link href="/">
              <LayoutDashboard aria-hidden="true" />
              На дашборд
            </Link>
          </Button>
        </div>

        <nav aria-label="Разделы" className="mt-6 border-t border-[var(--glass-border)] pt-4">
          <ul className="flex flex-wrap justify-center gap-1.5">
            {DESTS.filter((d) => d.chip).map((d) => (
              <li key={d.href}>
                <Link
                  href={d.href}
                  className="chip inline-flex min-h-8 items-center gap-1.5 px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <d.icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {d.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
