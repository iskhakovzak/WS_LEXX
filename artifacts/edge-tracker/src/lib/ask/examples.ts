// «Спроси журнал» — example questions, chip alternatives and «не понял» suggestions (pure data, no React).

import type { AskQuery, AskTokenKind } from "./parse";

export interface AskExampleGroup { title: string; items: string[] }

export const ASK_EXAMPLE_GROUPS: AskExampleGroup[] = [
  {
    title: "Результаты",
    items: ["нетто за эту неделю", "винрейт за последние 2 недели", "сколько съели комиссии в этом месяце", "профит-фактор за всё время", "максимальная просадка в сентябре"],
  },
  {
    title: "Время и дни",
    items: ["утро vs после обеда", "результат по часам входа", "средний винрейт по пятницам", "power hour в октябре", "по дням недели"],
  },
  {
    title: "Тикеры и сетапы",
    items: ["топ 5 тикеров", "худший тикер за месяц", "AAPL vs NVDA", "результат по сетапам", "шорты дешевле 10$"],
  },
  {
    title: "Сравнения",
    items: ["лонги vs шорты", "сентябрь vs октябрь", "понедельник vs пятница", "прибыльные vs убыточные по удержанию"],
  },
  {
    title: "Слабые места",
    items: ["когда я теряю больше всего", "худшие дни", "после 2 убытков подряд", "самая длинная серия убытков", "сделки дольше 15 минут"],
  },
  {
    title: "Периоды",
    items: ["в сентябре", "с 1 августа", "за последние 2 недели", "вчера", "прошлая неделя по дням"],
  },
];

export const ASK_EXAMPLES: string[] = ASK_EXAMPLE_GROUPS.flatMap((g) => g.items);

/** What a chip of this kind can be swapped to (the replacement text is re-parsed in place). */
export const CHIP_ALTERNATIVES: Partial<Record<AskTokenKind, string[]>> = {
  date: ["сегодня", "вчера", "на этой неделе", "на прошлой неделе", "в этом месяце", "за последние 2 недели", "за последние 30 дней", "за всё время"],
  time: ["на открытии", "утром", "в обед", "после обеда", "power hour", "до 10:00", "после 11:00"],
  side: ["лонги", "шорты"],
  outcome: ["прибыльные", "убыточные"],
  weekday: ["по понедельникам", "по вторникам", "по средам", "по четвергам", "по пятницам"],
  hold: ["короче 1 минуты", "дольше 5 минут", "дольше 15 минут", "дольше 1 часа"],
  qty: ["размер меньше 100 акций", "размер от 100 акций", "размер от 500 акций"],
  price: ["дешевле 5$", "дешевле 10$", "дороже 20$", "дороже 50$"],
  after: ["после убытка", "после 2 убытков подряд", "после прибыльной сделки"],
  group: ["по тикерам", "по дням", "по часам", "по дням недели", "по неделям", "по месяцам", "по времени дня", "по удержанию", "по размеру", "по сетапам"],
  intent: ["нетто", "сколько", "винрейт", "комиссии", "средний результат", "профит-фактор", "среднее удержание", "просадка"],
  last: ["последние 10 сделок", "последние 20 сделок", "последние 50 сделок"],
};

/** Ticker / setup chips: alternatives come from the data. */
export function chipAlternatives(kind: AskTokenKind, data: { tickers?: string[]; setups?: string[] } = {}): string[] {
  if (kind === "ticker") return (data.tickers ?? []).slice(0, 10);
  if (kind === "setup") return (data.setups ?? []).slice(0, 10).map((s) => `сетап ${s}`);
  return CHIP_ALTERNATIVES[kind] ?? [];
}

const KEYWORD_SUGGESTIONS: Array<{ re: RegExp; items: string[] }> = [
  { re: /(комис|fee)/i, items: ["сколько съели комиссии", "комиссии по месяцам"] },
  { re: /(вин|win|процент)/i, items: ["винрейт за последние 2 недели", "винрейт по дням недели"] },
  { re: /(утр|обед|час|врем|откр)/i, items: ["утро vs после обеда", "результат по часам входа"] },
  { re: /(пятниц|понедел|вторн|сред|четвер|недел)/i, items: ["средний винрейт по пятницам", "по дням недели"] },
  { re: /(теря|слив|минус|убыт|плох|худш)/i, items: ["когда я теряю больше всего", "худшие дни", "после убытка"] },
  { re: /(лучш|топ|зараб|плюс|прибыл)/i, items: ["топ 5 тикеров", "лучший день", "когда я зарабатываю больше всего"] },
  { re: /(серия|подряд|стрик)/i, items: ["самая длинная серия убытков", "серия побед по дням"] },
  { re: /(держ|удерж|долго|быстр)/i, items: ["среднее удержание", "результат по удержанию"] },
  { re: /(размер|объ[её]м|акци|лот)/i, items: ["результат по размеру", "размер от 500 акций"] },
  { re: /(лонг|шорт|long|short)/i, items: ["лонги vs шорты", "шорты в этом месяце"] },
];

/** Suggestions for an unparsed question: keyword-based first, then generic examples. */
export function suggestFor(raw: string, q?: AskQuery | null, tickers: string[] = []): string[] {
  const out: string[] = [];
  for (const k of KEYWORD_SUGGESTIONS) if (k.re.test(raw)) out.push(...k.items);
  const upper = raw.match(/\b[A-Za-z]{1,5}\b/g)?.map((w) => w.toUpperCase()).find((w) => tickers.includes(w));
  if (upper) out.unshift(`${upper} за всё время`, `${upper} по дням`);
  if (q?.unknown.length && tickers.length && !upper) out.push(`${tickers[0]} в этом месяце`);
  out.push("нетто за эту неделю", "когда я теряю больше всего", "топ 5 тикеров", "утро vs после обеда");
  return [...new Set(out)].slice(0, 6);
}
