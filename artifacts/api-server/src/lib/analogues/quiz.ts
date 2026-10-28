/**
 * Academy quiz «на что похоже» (routes/analogues.ts): an anonymised chart of one of the desk's own playbook examples
 * (a case, or a T1 / T2 trade example) of an «Офис» setup; the junior names the setup, then the answer is revealed.
 *
 * Anonymised = no ticker, no date: the bars come from the candle archive only (no provider call), the prices are
 * rebased so the first bar opens at 100, the volume is scaled to the day's maximum, and the times are moved onto a
 * fixed reference day (same New York wall clock). The question carries an opaque ref ("c:12" / "e:34"); the answer
 * is checked on the server and only then names the ticker, the day and the note.
 */
import { pool } from "@workspace/db";
import { readArchivedDays } from "../candleArchive/service";
import { etWallToUtcSeconds, parseDateStrict } from "../candleDay";
import { nyStamp } from "../analystReaction";
import { quizChoices } from "./model";
import type { Queryable } from "../interventions/log";

export type QuizBar = { t: number; o: number; h: number; l: number; c: number; v: number };
export type QuizQuestion = {
  ref: string;
  bars: QuizBar[];
  /** The example's entry on the reference day (epoch s) and side, when known. */
  entryAt: number | null;
  side: "long" | "short" | null;
  choices: { id: number; name: string }[];
};
export type QuizAnswer = { correct: boolean; setup: { id: number; name: string }; ticker: string; day: string; note: string | null; entryTime: string | null; side: string | null };

const REF_DAY = parseDateStrict("2000-01-03")!; // a plain winter Monday: same NY wall clock, no real date
const BUCKET_MIN = 5;
const CHOICES = 4;

type Item = { ref: string; setupId: number; setupName: string; ticker: string; day: string; note: string | null; entryTime: string | null; side: string | null };

/** Office setups (top level) with at least one case or T1 / T2 example, and those items. */
async function pool_(db: Queryable): Promise<Item[]> {
  const { rows } = await db.query(
    `WITH top AS (
       SELECT s.id, COALESCE(ps.id, s.id) AS top_id, COALESCE(ps.name, s.name) AS top_name FROM playbook s
         LEFT JOIN playbook ps ON ps.id = s.parent_id AND ps.deleted_at IS NULL
        WHERE s.deleted_at IS NULL AND COALESCE(COALESCE(ps.space, s.space), CASE WHEN COALESCE(ps.trader, s.trader) IS NULL THEN 'office' ELSE 'personal' END) = 'office'
     )
     SELECT 'c:' || c.id AS ref, top.top_id AS setup_id, top.top_name AS setup_name, c.ticker, c.day, c.note, c.entry_time, c.side
       FROM playbook_cases c JOIN top ON top.id = c.playbook_id WHERE c.deleted_at IS NULL
     UNION ALL
     SELECT 'e:' || e.id, top.top_id, top.top_name, UPPER(TRIM(t.ticker)), LEFT(t.date, 10), e.note,
            to_char((SELECT MIN(x.executed_at) FROM trade_executions x WHERE x.trade_id = t.id AND x.kind IN ('entry', 'add')) AT TIME ZONE 'America/New_York', 'HH24:MI'),
            LOWER(t.side)
       FROM playbook_examples e JOIN top ON top.id = e.playbook_id JOIN trades t ON t.id = e.trade_id AND t.deleted_at IS NULL
      WHERE e.deleted_at IS NULL AND e.tier < 3 AND t.date ~ '^\\d{4}-\\d{2}-\\d{2}'
     LIMIT 2000`,
  );
  return rows.map((r) => ({
    ref: String(r.ref), setupId: Number(r.setup_id), setupName: String(r.setup_name), ticker: String(r.ticker), day: String(r.day),
    note: r.note ?? null, entryTime: r.entry_time ?? null, side: r.side ? (String(r.side).startsWith("s") ? "short" : "long") : null,
  }));
}

/** Regular-session bars of an archived day, 5-minute buckets, anonymised (see header); null when not archived. */
async function anonymisedBars(ticker: string, day: string): Promise<QuizBar[] | null> {
  const a = (await readArchivedDays(ticker, [day])).get(day);
  if (!a?.bars?.length) return null;
  const buckets = new Map<number, QuizBar>();
  for (const b of a.bars) {
    const { minutes } = nyStamp(new Date(b.t * 1000));
    if (minutes < 9 * 60 + 30 || minutes >= 16 * 60) continue;
    const m = minutes - (minutes % BUCKET_MIN);
    const cur = buckets.get(m);
    if (!cur) buckets.set(m, { t: m, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
  }
  const list = [...buckets.values()].sort((x, y) => x.t - y.t);
  if (list.length < 12) return null;
  const base = list[0].o;
  const vmax = Math.max(1, ...list.map((b) => b.v));
  const px = (p: number) => Math.round((p / base) * 100 * 100) / 100;
  return list.map((b) => ({
    t: etWallToUtcSeconds(REF_DAY, Math.floor(b.t / 60), b.t % 60), o: px(b.o), h: px(b.h), l: px(b.l), c: px(b.c), v: Math.round((b.v / vmax) * 1000),
  }));
}

const refAt = (hhmm: string | null): number | null => {
  const m = hhmm ? /^(\d{2}):(\d{2})$/.exec(hhmm) : null;
  return m ? etWallToUtcSeconds(REF_DAY, Number(m[1]), Number(m[2])) : null;
};

/** One question, or null when the desk has fewer than two setups with archived examples. */
export async function nextQuestion(opts: { exclude?: readonly string[]; rand?: () => number } = {}, db: Queryable = pool): Promise<QuizQuestion | null> {
  const rand = opts.rand ?? Math.random;
  const items = await pool_(db);
  const setups = new Map<number, { id: number; name: string }>();
  for (const i of items) setups.set(i.setupId, { id: i.setupId, name: i.setupName });
  if (setups.size < 2) return null;
  const skip = new Set(opts.exclude ?? []);
  const order = items.filter((i) => !skip.has(i.ref)).sort(() => rand() - 0.5);
  for (const it of order.slice(0, 15)) {
    const bars = await anonymisedBars(it.ticker, it.day);
    if (!bars) continue;
    return {
      ref: it.ref, bars, entryAt: refAt(it.entryTime), side: (it.side as "long" | "short" | null) ?? null,
      choices: quizChoices(setups.get(it.setupId)!, [...setups.values()], CHOICES, rand),
    };
  }
  return null;
}

/** Checks one answer and reveals the case. Null when the ref is unknown (deleted, or not an office example). */
export async function checkAnswer(ref: string, setupId: number, db: Queryable = pool): Promise<QuizAnswer | null> {
  const it = (await pool_(db)).find((i) => i.ref === ref);
  if (!it) return null;
  return {
    correct: it.setupId === setupId, setup: { id: it.setupId, name: it.setupName }, ticker: it.ticker, day: it.day, note: it.note,
    entryTime: it.entryTime, side: it.side,
  };
}
