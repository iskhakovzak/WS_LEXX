// Deep links between sections of the desk workflow (game plan → watchlist → trade → setup → journal →
// review → rating → risk). Build every cross-section href here; each target page reads these params.

type Params = Record<string, string | number | null | undefined | false>;

function href(path: string, params: Params = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === false || v === "") continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

export const links = {
  trade: (id: number) => href("/trades", { highlight: id }),
  trades: (p: { ticker?: string; date?: string; from?: string; to?: string; playbookId?: number; setup?: string; horizon?: string; source?: string; ids?: number[]; side?: string; outcome?: string; trader?: string } = {}) =>
    href("/trades", { ...p, ids: p.ids?.length ? p.ids.join(",") : undefined }),
  newTrade: (p: { ticker?: string; fromIdea?: number } = {}) => href("/trades", { new: 1, ...p }),
  journalDay: (date: string, trader?: string) => href("/journal", { date, trader }),
  dayReport: (date: string, trader?: string) => href("/day-report", { date, trader }),
  behavior: (p: { trader?: string; from?: string; to?: string } = {}) => href("/behavior", p),
  gamePlan: (date?: string) => href("/game-plan", { date }),
  setup: (id: number) => href("/playbook", { id }),
  playbookSearch: (q: string) => href("/playbook", { q }),
  idea: (id: number) => href("/trade-ideas", { idea: id }),
  newIdea: (ticker?: string) => href("/trade-ideas", { new: 1, ticker }),
  thread: (id: number) => href("/discussions", { thread: id }),
  newThread: (p: { tradeId?: number; ticker?: string } = {}) => href("/discussions", { new: 1, ...p }),
  events: (ticker?: string) => href("/events", { ticker }),
  watchlist: (ticker?: string) => href("/watchlist", { ticker }),
  risk: (trader?: string) => href("/risk", { trader }),
  weeklyReview: (p: { trader?: string; week?: string } = {}) => href("/weekly-review", p),
  scaling: (trader?: string) => href("/scaling", { trader }),
  offerings: (ticker?: string) => href("/offerings", { ticker }),
} as const;
