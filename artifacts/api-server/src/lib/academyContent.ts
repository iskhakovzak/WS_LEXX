/**
 * «Академия → Обучение» (F1): чистая логика контента — без БД и Express, чтобы её можно было проверить
 * юнит-тестами (lib/__tests__/academyContent.test.ts) и офлайн-скриптом.
 *
 * Модель (таблицы создаёт routes/academy-content.ts, ensure-функция):
 *   academy_programs      программа (курс): title, slug, level, published, position, archived_at
 *   academy_modules       модуль программы: program_id, title, position
 *   academy_lessons       урок: module_id, body_md (markdown), video_url (allow-list), attachments [{title,url}],
 *                         playbook_ids int[] / setup_names text[] — привязка к сетапам плейбука
 *   academy_quizzes       тест: module_id, questions jsonb (single / multiple / numeric), pass_pct, max_attempts
 *   academy_quiz_attempts попытка: answers, score, pct, passed
 *   academy_assignments   задание: module_id, body_md, rubric [{key,label,maxPoints}], pass_pct, min_trades
 *   academy_submissions   сдача: text, url, trade_ids int[], status submitted|graded|returned, scores, mentor_comment
 *   academy_lesson_progress (user_name, lesson_id) → completed_at
 *
 * Элементы модуля (урок / тест / задание) делят одно пространство `position`, поэтому порядок внутри
 * модуля смешанный: «урок → урок → тест → задание».
 */

/* ─── Общие типы ─────────────────────────────────────────────────────────── */

export type ItemKind = "lesson" | "quiz" | "assignment";
export const ITEM_KINDS: readonly ItemKind[] = ["lesson", "quiz", "assignment"];

/** Лестница деска (решение владельца): ровно 4 ступени. Программа может быть привязана к ступени. */
export type Stage = "trainee" | "junior" | "trader" | "senior";
export const STAGES: readonly Stage[] = ["trainee", "junior", "trader", "senior"];
export const STAGE_LABELS: Record<Stage, string> = { trainee: "Стажёр", junior: "Джун", trader: "Трейдер", senior: "Сеньор" };
export function normalizeStage(v: unknown): Stage | null {
  return typeof v === "string" && (STAGES as readonly string[]).includes(v) ? (v as Stage) : null;
}

export type ItemStatus = "not_started" | "in_progress" | "completed";

export type Attachment = { title: string; url: string };

/* ─── URL: вложения и видео ──────────────────────────────────────────────── */

/** http(s) URL или null (тот же контракт, что lib/safe-url.ts, но без зависимостей). */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t || t.length > 2000) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export type VideoEmbed = { provider: "youtube" | "vimeo" | "loom"; id: string; embedUrl: string; watchUrl: string };

const YT_ID = /^[A-Za-z0-9_-]{6,20}$/;
const VIMEO_ID = /^\d{4,15}$/;
const LOOM_ID = /^[A-Za-z0-9]{10,64}$/;

/** Разбор `t=` / `start=` YouTube ("90", "1m30s", "1h2m3s") в секунды. */
export function parseStartSeconds(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (/^\d+$/.test(s)) return Number(s) || null;
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(s);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const sec = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return sec > 0 ? sec : null;
}

/**
 * Allow-list видео: YouTube (watch / youtu.be / shorts / embed / live), Vimeo (vimeo.com/ID, player.vimeo.com/video/ID),
 * Loom (share / embed). Всё остальное → null (в уроке такая ссылка показывается как обычная внешняя ссылка не будет —
 * валидатор отклоняет её при сохранении). Встраивание только https, YouTube — через youtube-nocookie.com.
 */
export function videoEmbed(raw: unknown): VideoEmbed | null {
  const url = safeHttpUrl(raw);
  if (!url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "youtu.be" || host === "music.youtube.com") {
    let id: string | null = null;
    if (host === "youtu.be") id = parts[0] ?? null;
    else if (parts[0] === "watch") id = u.searchParams.get("v");
    else if (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live" || parts[0] === "v") id = parts[1] ?? null;
    if (!id || !YT_ID.test(id)) return null;
    const start = parseStartSeconds(u.searchParams.get("t") ?? u.searchParams.get("start"));
    const q = start ? `?start=${start}` : "";
    return { provider: "youtube", id, embedUrl: `https://www.youtube-nocookie.com/embed/${id}${q}`, watchUrl: `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ""}` };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = host === "player.vimeo.com" ? (parts[0] === "video" ? parts[1] : null) : parts.find((p) => VIMEO_ID.test(p)) ?? null;
    if (!id || !VIMEO_ID.test(id)) return null;
    return { provider: "vimeo", id, embedUrl: `https://player.vimeo.com/video/${id}`, watchUrl: `https://vimeo.com/${id}` };
  }
  if (host === "loom.com") {
    const id = parts[0] === "share" || parts[0] === "embed" ? parts[1] : null;
    if (!id || !LOOM_ID.test(id)) return null;
    return { provider: "loom", id, embedUrl: `https://www.loom.com/embed/${id}`, watchUrl: `https://www.loom.com/share/${id}` };
  }
  return null;
}

/** Вложения: до 20 штук, только http(s), заголовок по умолчанию — хост. Невалидные молча отбрасываются. */
export function normalizeAttachments(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return [];
  const out: Attachment[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const url = safeHttpUrl((a as { url?: unknown }).url);
    if (!url) continue;
    const t = typeof (a as { title?: unknown }).title === "string" ? (a as { title: string }).title.trim().slice(0, 200) : "";
    out.push({ title: t || new URL(url).hostname, url });
    if (out.length >= 20) break;
  }
  return out;
}

/* ─── Тесты (квизы) ──────────────────────────────────────────────────────── */

export type QuizOption = { id: string; text: string };

export type QuizQuestion =
  | { id: string; kind: "single"; prompt: string; options: QuizOption[]; correct: string[]; points: number; explanation?: string }
  | { id: string; kind: "multiple"; prompt: string; options: QuizOption[]; correct: string[]; points: number; partial: boolean; explanation?: string }
  | { id: string; kind: "numeric"; prompt: string; answer: number; tolerance: number; tolerancePct: boolean; unit?: string; points: number; explanation?: string };

export type QuizConfig = { passPct: number; maxAttempts: number | null };

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const finite = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Проверка и нормализация вопросов теста из админки. Ошибки — по-русски, с номером вопроса. */
export function normalizeQuestions(raw: unknown): ValidationResult<QuizQuestion[]> {
  if (!Array.isArray(raw)) return { ok: false, errors: ["Вопросы должны быть списком"] };
  if (raw.length > 100) return { ok: false, errors: ["Не больше 100 вопросов в тесте"] };
  const errors: string[] = [];
  const out: QuizQuestion[] = [];
  const seen = new Set<string>();
  raw.forEach((q, i) => {
    const n = i + 1;
    if (!q || typeof q !== "object") { errors.push(`Вопрос ${n}: пустой`); return; }
    const o = q as Record<string, unknown>;
    let id = str(o.id, 40) || `q${n}`;
    while (seen.has(id)) id = `${id}_${n}`;
    seen.add(id);
    const prompt = str(o.prompt, 4000);
    if (!prompt) errors.push(`Вопрос ${n}: нет текста`);
    const pointsRaw = finite(o.points);
    const points = pointsRaw != null && pointsRaw > 0 ? Math.min(100, pointsRaw) : 1;
    const explanation = str(o.explanation, 4000) || undefined;
    const kind = o.kind;
    if (kind === "single" || kind === "multiple") {
      const optsRaw = Array.isArray(o.options) ? o.options : [];
      const options: QuizOption[] = [];
      const optIds = new Set<string>();
      optsRaw.forEach((op, j) => {
        const oo = (op ?? {}) as Record<string, unknown>;
        const text = str(oo.text, 1000);
        if (!text) return;
        let oid = str(oo.id, 40) || String.fromCharCode(97 + j);
        while (optIds.has(oid)) oid = `${oid}${j}`;
        optIds.add(oid);
        options.push({ id: oid, text });
      });
      if (options.length < 2) errors.push(`Вопрос ${n}: нужно минимум 2 варианта ответа`);
      if (options.length > 12) errors.push(`Вопрос ${n}: не больше 12 вариантов`);
      const correct = (Array.isArray(o.correct) ? o.correct : []).map((c) => String(c)).filter((c, k, arr) => optIds.has(c) && arr.indexOf(c) === k);
      if (kind === "single" && correct.length !== 1) errors.push(`Вопрос ${n}: отметьте ровно один верный вариант`);
      if (kind === "multiple" && correct.length < 1) errors.push(`Вопрос ${n}: отметьте хотя бы один верный вариант`);
      if (kind === "single") out.push({ id, kind, prompt, options, correct, points, explanation });
      else out.push({ id, kind, prompt, options, correct, points, partial: o.partial === true, explanation });
      return;
    }
    if (kind === "numeric") {
      const answer = finite(o.answer);
      if (answer == null) errors.push(`Вопрос ${n}: укажите числовой ответ`);
      const tolRaw = finite(o.tolerance);
      const tolerance = tolRaw != null && tolRaw >= 0 ? tolRaw : 0;
      const unit = str(o.unit, 20) || undefined;
      out.push({ id, kind, prompt, answer: answer ?? 0, tolerance, tolerancePct: o.tolerancePct === true, unit, points, explanation });
      return;
    }
    errors.push(`Вопрос ${n}: неизвестный тип «${String(kind)}»`);
  });
  if (!errors.length && out.length === 0) errors.push("Добавьте хотя бы один вопрос");
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

/**
 * Числовой ответ ученика: «1,5», «1.5R», «$ 1 250», «-0.8», «12%» → число. Пробелы-разделители тысяч
 * (в том числе неразрывные) и валюта/единицы отбрасываются. Пустая строка / мусор → null.
 */
export function parseNumericAnswer(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  let s = raw.trim().replace(/[\s  ]/g, "").replace(/[−–—]/g, "-");
  s = s.replace(/^[$€₽]/, "").replace(/(?:r|R|р|Р|%|\$|usd|USD|шт|акций)+$/u, "");
  s = s.replace(/^\+/, "");
  if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Попадает ли число в допуск: абсолютный (±tol) или в процентах от ответа. Маленький эпсилон против ошибок float. */
export function withinTolerance(given: number, answer: number, tolerance: number, pct: boolean): boolean {
  const tol = pct ? Math.abs(answer) * (tolerance / 100) : tolerance;
  return Math.abs(given - answer) <= tol + 1e-9;
}

export type AnswerMap = Record<string, unknown>;

export type QuestionResult = {
  id: string;
  points: number;
  earned: number;
  correct: boolean;
  /** Ответ ученика в нормализованном виде (ids вариантов или число). */
  given: string[] | number | null;
};

export type QuizGrade = { score: number; maxScore: number; pct: number; passed: boolean; results: QuestionResult[] };

const round2 = (n: number) => Math.round(n * 100) / 100;

function asIdList(v: unknown): string[] {
  if (Array.isArray(v)) return [...new Set(v.map((x) => String(x)))];
  if (typeof v === "string" && v) return [v];
  return [];
}

/**
 * Автопроверка. single — ровно верный вариант; multiple — точное совпадение множества, либо (partial=true)
 * частичный балл (верно отмеченные − лишние) / число верных, не ниже 0; numeric — попадание в допуск.
 * Неотвеченный вопрос = 0. Проценты считаются от суммы баллов; pass = pct ≥ passPct.
 */
export function gradeQuiz(questions: readonly QuizQuestion[], answers: AnswerMap | null | undefined, passPct: number): QuizGrade {
  const a = answers ?? {};
  const results: QuestionResult[] = questions.map((q) => {
    const raw = a[q.id];
    if (q.kind === "numeric") {
      const given = parseNumericAnswer(raw);
      const ok = given != null && withinTolerance(given, q.answer, q.tolerance, q.tolerancePct);
      return { id: q.id, points: q.points, earned: ok ? q.points : 0, correct: ok, given };
    }
    const valid = new Set(q.options.map((o) => o.id));
    const given = asIdList(raw).filter((x) => valid.has(x));
    const correctSet = new Set(q.correct);
    if (q.kind === "single") {
      const ok = given.length === 1 && correctSet.has(given[0]);
      return { id: q.id, points: q.points, earned: ok ? q.points : 0, correct: ok, given };
    }
    const right = given.filter((x) => correctSet.has(x)).length;
    const wrong = given.length - right;
    const exact = wrong === 0 && right === correctSet.size;
    let earned = exact ? q.points : 0;
    if (!exact && q.partial && correctSet.size > 0) earned = round2(Math.max(0, (right - wrong) / correctSet.size) * q.points);
    return { id: q.id, points: q.points, earned, correct: exact, given };
  });
  const maxScore = round2(results.reduce((s, r) => s + r.points, 0));
  const score = round2(results.reduce((s, r) => s + r.earned, 0));
  const pct = maxScore > 0 ? round2((score / maxScore) * 100) : 0;
  return { score, maxScore, pct, passed: pct >= clampPct(passPct), results };
}

export function clampPct(v: unknown, def = 80): number {
  const n = finite(v);
  if (n == null) return def;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export type AttemptLite = { pct: number; passed: boolean; submittedAt: string };

export type AttemptState = {
  attempts: number;
  attemptsLeft: number | null;
  canAttempt: boolean;
  bestPct: number | null;
  passed: boolean;
  /** Показывать ли верные ответы и пояснения: после сдачи или когда попытки кончились. */
  revealAnswers: boolean;
};

/** Состояние попыток: лучший результат засчитывается; после сдачи пересдавать можно (если есть попытки) — для практики. */
export function attemptState(attempts: readonly AttemptLite[], cfg: QuizConfig): AttemptState {
  const n = attempts.length;
  const max = cfg.maxAttempts != null && cfg.maxAttempts > 0 ? cfg.maxAttempts : null;
  const attemptsLeft = max == null ? null : Math.max(0, max - n);
  const passed = attempts.some((x) => x.passed);
  const bestPct = n ? Math.max(...attempts.map((x) => x.pct)) : null;
  return { attempts: n, attemptsLeft, canAttempt: attemptsLeft == null || attemptsLeft > 0, bestPct, passed, revealAnswers: passed || attemptsLeft === 0 };
}

/** Публичная версия вопроса — без правильных ответов и пояснений. */
export type PublicQuestion =
  | { id: string; kind: "single" | "multiple"; prompt: string; options: QuizOption[]; points: number; multiple: boolean }
  | { id: string; kind: "numeric"; prompt: string; unit?: string; points: number };

export function publicQuestions(questions: readonly QuizQuestion[]): PublicQuestion[] {
  return questions.map((q) =>
    q.kind === "numeric"
      ? { id: q.id, kind: q.kind, prompt: q.prompt, unit: q.unit, points: q.points }
      : { id: q.id, kind: q.kind, prompt: q.prompt, options: q.options, points: q.points, multiple: q.kind === "multiple" },
  );
}

/** Разбор по вопросам для ответа API: верный ответ и пояснение — только если reveal. */
export function feedbackFor(questions: readonly QuizQuestion[], grade: QuizGrade, reveal: boolean) {
  return grade.results.map((r) => {
    const q = questions.find((x) => x.id === r.id)!;
    const base = { id: r.id, correct: r.correct, earned: r.earned, points: r.points, given: r.given };
    if (!reveal) return base;
    return {
      ...base,
      explanation: q.explanation ?? null,
      expected: q.kind === "numeric"
        ? { answer: q.answer, tolerance: q.tolerance, tolerancePct: q.tolerancePct, unit: q.unit ?? null }
        : { options: q.correct },
    };
  });
}

/* ─── Задания и рубрика ──────────────────────────────────────────────────── */

export type RubricCriterion = { key: string; label: string; maxPoints: number; description?: string };

export function normalizeRubric(raw: unknown): ValidationResult<RubricCriterion[]> {
  if (!Array.isArray(raw)) return { ok: false, errors: ["Рубрика должна быть списком критериев"] };
  const out: RubricCriterion[] = [];
  const errors: string[] = [];
  const keys = new Set<string>();
  raw.forEach((c, i) => {
    const o = (c ?? {}) as Record<string, unknown>;
    const label = str(o.label, 200);
    if (!label) { errors.push(`Критерий ${i + 1}: нет названия`); return; }
    const mp = finite(o.maxPoints);
    if (mp == null || mp <= 0 || mp > 100) { errors.push(`Критерий ${i + 1}: баллы 1–100`); return; }
    let key = str(o.key, 40).replace(/[^\w-]/g, "") || `c${i + 1}`;
    while (keys.has(key)) key = `${key}_${i + 1}`;
    keys.add(key);
    out.push({ key, label, maxPoints: mp, description: str(o.description, 1000) || undefined });
  });
  if (out.length > 20) errors.push("Не больше 20 критериев");
  if (!errors.length && !out.length) errors.push("Добавьте хотя бы один критерий");
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

export type RubricGrade = { scores: Record<string, number>; total: number; maxTotal: number; pct: number; passed: boolean; missing: string[] };

/**
 * Оценка по рубрике: баллы каждого критерия зажимаются в [0, max] (шаг 0.5), лишние ключи игнорируются,
 * отсутствующие — в `missing` (маршрут требует оценить все критерии).
 */
export function gradeRubric(rubric: readonly RubricCriterion[], rawScores: unknown, passPct: number): RubricGrade {
  const src = rawScores && typeof rawScores === "object" ? (rawScores as Record<string, unknown>) : {};
  const scores: Record<string, number> = {};
  const missing: string[] = [];
  for (const c of rubric) {
    const v = finite(src[c.key]);
    if (v == null) { missing.push(c.key); scores[c.key] = 0; continue; }
    scores[c.key] = Math.max(0, Math.min(c.maxPoints, Math.round(v * 2) / 2));
  }
  const maxTotal = round2(rubric.reduce((s, c) => s + c.maxPoints, 0));
  const total = round2(Object.values(scores).reduce((s, v) => s + v, 0));
  const pct = maxTotal > 0 ? round2((total / maxTotal) * 100) : 0;
  return { scores, total, maxTotal, pct, passed: pct >= clampPct(passPct), missing };
}

export type SubmissionCheck = { ok: true } | { ok: false; error: string };

/** Сдача задания: нужен хотя бы текст, ссылка или сделки; если задание требует N сделок — их не меньше N. */
export function checkSubmission(p: { text: string; url: string | null; tradeIds: number[] }, minTrades: number): SubmissionCheck {
  if (!p.text.trim() && !p.url && p.tradeIds.length === 0) return { ok: false, error: "Добавьте текст, ссылку или сделки" };
  if (minTrades > 0 && p.tradeIds.length < minTrades) return { ok: false, error: `Нужно привязать минимум ${minTrades} сделк${minTrades === 1 ? "у" : minTrades < 5 ? "и" : ""}` };
  return { ok: true };
}

/** id сделок из тела запроса: целые > 0, уникальные, не больше 50. */
export function parseTradeIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const v of raw) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    if (out.length >= 50) break;
  }
  return out;
}

/* ─── Прогресс ───────────────────────────────────────────────────────────── */

export type ProgressItem = { kind: ItemKind; id: number; moduleId: number; position: number; title: string };

export type ProgressFacts = {
  /** id пройденных уроков. */
  lessonsDone: ReadonlySet<number>;
  /** id просмотренных/начатых уроков (необязательно). */
  lessonsStarted?: ReadonlySet<number>;
  /** quizId → есть ли зачтённая попытка (true) / только незачтённые (false). */
  quizzes: ReadonlyMap<number, { passed: boolean; bestPct: number | null }>;
  /** assignmentId → статус последней сдачи. */
  assignments: ReadonlyMap<number, { status: "submitted" | "graded" | "returned"; passed: boolean | null }>;
};

export function itemStatus(item: ProgressItem, f: ProgressFacts): ItemStatus {
  if (item.kind === "lesson") return f.lessonsDone.has(item.id) ? "completed" : f.lessonsStarted?.has(item.id) ? "in_progress" : "not_started";
  if (item.kind === "quiz") {
    const q = f.quizzes.get(item.id);
    return !q ? "not_started" : q.passed ? "completed" : "in_progress";
  }
  const s = f.assignments.get(item.id);
  if (!s) return "not_started";
  return s.status === "graded" && s.passed !== false ? "completed" : "in_progress";
}

export type ModuleProgress = { moduleId: number; total: number; done: number; pct: number };
export type ProgramProgress = {
  total: number;
  done: number;
  pct: number;
  byKind: Record<ItemKind, { total: number; done: number }>;
  modules: ModuleProgress[];
  /** Следующий элемент: первый незавершённый в порядке модулей/позиций. */
  next: { kind: ItemKind; id: number; title: string } | null;
  status: Map<string, ItemStatus>;
};

export const itemKey = (kind: ItemKind, id: number) => `${kind}:${id}`;

/**
 * Прогресс программы для одного ученика: каждый элемент весит одинаково; задание засчитано, когда
 * последняя сдача проверена и не провалена; тест — когда есть зачтённая попытка.
 * `moduleOrder` — порядок модулей (элементы чужих/архивных модулей игнорируются).
 */
export function computeProgress(items: readonly ProgressItem[], moduleOrder: readonly number[], f: ProgressFacts): ProgramProgress {
  const modIndex = new Map(moduleOrder.map((id, i) => [id, i]));
  const ordered = items
    .filter((it) => modIndex.has(it.moduleId))
    .slice()
    .sort((a, b) => modIndex.get(a.moduleId)! - modIndex.get(b.moduleId)! || a.position - b.position || ITEM_KINDS.indexOf(a.kind) - ITEM_KINDS.indexOf(b.kind) || a.id - b.id);
  const byKind: ProgramProgress["byKind"] = { lesson: { total: 0, done: 0 }, quiz: { total: 0, done: 0 }, assignment: { total: 0, done: 0 } };
  const modAgg = new Map<number, { total: number; done: number }>(moduleOrder.map((id) => [id, { total: 0, done: 0 }]));
  const status = new Map<string, ItemStatus>();
  let next: ProgramProgress["next"] = null;
  let done = 0;
  for (const it of ordered) {
    const st = itemStatus(it, f);
    status.set(itemKey(it.kind, it.id), st);
    const m = modAgg.get(it.moduleId)!;
    m.total += 1;
    byKind[it.kind].total += 1;
    if (st === "completed") { m.done += 1; byKind[it.kind].done += 1; done += 1; }
    else if (!next) next = { kind: it.kind, id: it.id, title: it.title };
  }
  const pct = (d: number, t: number) => (t > 0 ? Math.round((d / t) * 1000) / 10 : 0);
  return {
    total: ordered.length,
    done,
    pct: pct(done, ordered.length),
    byKind,
    modules: moduleOrder.map((id) => {
      const m = modAgg.get(id)!;
      return { moduleId: id, total: m.total, done: m.done, pct: pct(m.done, m.total) };
    }),
    next,
    status,
  };
}

export type CohortStudentRow = { userName: string; pct: number; done: number; total: number; lastActivity: string | null };

export type CohortSummary = {
  students: number;
  avgPct: number | null;
  medianPct: number | null;
  completed: number;
  notStarted: number;
  /** Ученики без активности дольше staleDays (или вовсе без неё). */
  stale: string[];
};

/** Сводка по когорте: средний/медианный прогресс, сколько закончили, кто «завис». */
export function cohortSummary(rows: readonly CohortStudentRow[], nowIso: string, staleDays = 7): CohortSummary {
  if (!rows.length) return { students: 0, avgPct: null, medianPct: null, completed: 0, notStarted: 0, stale: [] };
  const pcts = rows.map((r) => r.pct).sort((a, b) => a - b);
  const mid = Math.floor(pcts.length / 2);
  const median = pcts.length % 2 ? pcts[mid] : (pcts[mid - 1] + pcts[mid]) / 2;
  const now = Date.parse(nowIso);
  const stale = rows
    .filter((r) => r.pct < 100 && (!r.lastActivity || now - Date.parse(r.lastActivity) > staleDays * 86_400_000))
    .map((r) => r.userName);
  return {
    students: rows.length,
    avgPct: Math.round((pcts.reduce((s, v) => s + v, 0) / pcts.length) * 10) / 10,
    medianPct: Math.round(median * 10) / 10,
    completed: rows.filter((r) => r.total > 0 && r.done >= r.total).length,
    notStarted: rows.filter((r) => r.done === 0).length,
    stale,
  };
}

/* ─── Порядок ────────────────────────────────────────────────────────────── */

/**
 * Новый порядок элементов модуля: принимает желаемую последовательность {kind,id}, возвращает позиции
 * 10, 20, 30… Неизвестные элементы отбрасываются; элементы модуля, которых нет в списке, идут в конце
 * в прежнем порядке (так одновременное добавление не теряет элемент).
 */
export function applyOrder<T extends { kind: ItemKind; id: number; position: number }>(
  current: readonly T[],
  desired: readonly { kind: ItemKind; id: number }[],
): { kind: ItemKind; id: number; position: number }[] {
  const byKey = new Map(current.map((c) => [itemKey(c.kind, c.id), c]));
  const used = new Set<string>();
  const seq: { kind: ItemKind; id: number }[] = [];
  for (const d of desired) {
    const k = itemKey(d.kind, d.id);
    if (!byKey.has(k) || used.has(k)) continue;
    used.add(k);
    seq.push({ kind: d.kind, id: d.id });
  }
  const rest = current.filter((c) => !used.has(itemKey(c.kind, c.id))).slice().sort((a, b) => a.position - b.position);
  return [...seq, ...rest.map((c) => ({ kind: c.kind, id: c.id }))].map((x, i) => ({ ...x, position: (i + 1) * 10 }));
}

/** Порядок по id (модули в программе / программы): то же правило, позиции 10, 20, … */
export function applyIdOrder(currentIds: readonly number[], desired: readonly number[]): { id: number; position: number }[] {
  const set = new Set(currentIds);
  const seq: number[] = [];
  for (const id of desired) if (set.has(id) && !seq.includes(id)) seq.push(id);
  for (const id of currentIds) if (!seq.includes(id)) seq.push(id);
  return seq.map((id, i) => ({ id, position: (i + 1) * 10 }));
}

export function slugify(s: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  const out = s.toLowerCase().split("").map((ch) => map[ch] ?? ch).join("").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return out.slice(0, 60) || "program";
}

/* ─── Демо-курс «Основы проп-трейдинга WS» ───────────────────────────────── */

export const DEMO_PROGRAM_SLUG = "ws-prop-basics";

export type SeedLesson = { kind: "lesson"; key: string; title: string; summary: string; durationMin: number; body: string; setupNames?: string[]; attachments?: Attachment[] };
export type SeedQuiz = { kind: "quiz"; key: string; title: string; description: string; passPct: number; maxAttempts: number | null; questions: QuizQuestion[] };
export type SeedAssignment = { kind: "assignment"; key: string; title: string; body: string; rubric: RubricCriterion[]; passPct: number; minTrades: number };
export type SeedItem = SeedLesson | SeedQuiz | SeedAssignment;
export type SeedModule = { key: string; title: string; description: string; items: SeedItem[] };
export type SeedProgram = { slug: string; title: string; description: string; level: string; stage: Stage | null; modules: SeedModule[] };

const L1_RISK = `Риск — это не «сколько я готов потерять вообще», а **заранее известная сумма, которую вы теряете, если сделка не сработала и сработал стоп**. Всё остальное в трейдинге считается от неё.

## 1R — единица измерения

**1R = (цена входа − цена стопа) × количество акций.**

Пример: лонг 500 акций по $12.40, стоп $12.20 → риск на акцию $0.20 → **1R = $100**.

Результат каждой сделки переводим в R:

| Сделка | P&L нетто | В R |
|---|---|---|
| Выход по стопу | −$100 | −1R |
| Частичный выход и BE | +$40 | +0.4R |
| Цель по уровню | +$250 | +2.5R |

Зачем R, если есть доллары? Потому что сделки разного размера несравнимы в долларах. Сделка на $50 при риске $25 (+2R) лучше, чем +$150 при риске $300 (+0.5R). В журнале WS R считается одинаково везде (общая формула \`signedR\`), поэтому ваши цифры в «Статистике», «Аналитике» и в отчётах куратора совпадают.

## Правила риска деска

1. **Стоп ставится до входа.** Нет стопа — нет R, нет размера, нет сделки. В журнале сделка без стопа видна как «R —».
2. **Риск на сделку фиксирован** (например, 0.25–0.5% от дневного лимита для стажёра). Не «чуть больше, потому что уверен».
3. **Дневной лимит убытка — жёсткий.** Достигли — торговля закончена, даже если «сейчас точно развернётся». Лимиты видны на странице «Риск».
4. **Не усредняем убыточную позицию.** Добор допустим только в плюс и по плану.

## Ожидание (expectancy)

Ожидание в R = WR × средний выигрыш(R) − (1 − WR) × средний убыток(R).

При WR 45%, среднем выигрыше 1.8R и убытке 1R: 0.45 × 1.8 − 0.55 × 1 = **+0.26R на сделку**. Сто таких сделок с риском $100 дают около +$2 600 — **до комиссий**. Про комиссии — следующий урок, и это самое неприятное место в арифметике внутридневного трейдера.

> **Практика:** откройте свои последние 20 сделок в журнале. Сколько из них имеют стоп? Для сделок без стопа восстановите, где он должен был стоять, и посчитайте R задним числом.`;

const L2_SIZE = `Размер позиции не выбирают «на глаз» — его **вычисляют из риска**.

## Формула размера

**Акций = риск на сделку ($) ÷ (вход − стоп).**

Риск $100, вход $8.50, стоп $8.35 → $100 ÷ $0.15 = **666 акций** (округляем вниз до 650 или до лота, удобного в платформе).

Проверки перед входом:
- **Ликвидность:** позиция не больше ~1% среднего минутного объёма в момент входа, иначе проскальзывание съест стоп.
- **Покупательная способность и лимит позиции** от деска.
- **Спред:** если спред $0.05 при стопе $0.15, вы на входе уже потеряли треть R.

## Комиссии: почему внутридневной трейдер платит за каждую акцию

В пропе комиссия обычно **за акцию** (per-share): клиринг, ECN-сборы за снятие ликвидности, SEC/TAF-сборы на продажу. Типичные величины — доли цента на акцию, но **вы платите их дважды: на входе и на выходе**.

Пример: 1 000 акций, всего ~$0.003 за акцию в каждую сторону → **$6 за круг**. Сделка «в плюс на 2 цента» даёт брутто +$20 и нетто +$14 — треть прибыли ушла в комиссии. Сделка «на 0.5 цента» (+$5 брутто) — **убыточна**.

## Реальный пример деска: 93% брутто ушло в комиссии

У одного из трейдеров деска (Ориф) за январь–октябрь 2026 — 910 внутридневных сделок:

| Показатель | Значение |
|---|---|
| Брутто P&L | +$932.68 |
| Комиссии и сборы | −$867.94 |
| **Нетто P&L** | **+$64.74** |
| Комиссии / брутто | **≈ 93%** |
| Средняя комиссия за сделку | ≈ $0.95 |

Win rate около 51% — то есть «угадывать» направление он умеет. Но средний выигрыш на сделку настолько мал, что почти весь результат забирает клиринг. Это не проблема входа — это проблема **размера движения, на котором он выходит**, и **частоты сделок**.

### Что из этого следует

1. **Считайте безубыток в центах:** комиссия за круг ÷ количество акций. Если ваш средний выигрыш меньше 2–3× этой величины, стратегия живёт на грани нуля.
2. **Меньше сделок, больше движение.** Скальп «на пару центов» оправдан только при очень низкой ставке и большом объёме.
3. **Смотрите нетто, а не брутто.** Во всех отчётах журнала деньги по умолчанию — нетто (подпись «нетто»). Раздел «Что-если → Комиссии» показывает, в каких ценовых диапазонах и при каком размере комиссии съедают ваши сделки.
4. **Сделки с проданным по рынку объёмом тоньше.** ECN-сбор за снятие ликвидности выше, чем ребейт за её добавление: лимитные выходы дешевле.

> **Практика:** в «Что-если» откройте вкладку «Комиссии», найдите свою комиссию за сделку и безубыток в центах. Сколько ваших выигрышных сделок за месяц были меньше этого безубытка?`;

const L3_LEVELS = `Внутри дня цена «помнит» несколько уровней, на которых крупные участники принимают решения. Три обязательных — **PDH, PDL и VWAP**.

## PDH и PDL — максимум и минимум предыдущего дня

- **PDH (previous day high)** — максимум вчерашней основной сессии.
- **PDL (previous day low)** — минимум вчерашней основной сессии.

Почему работают: над PDH стоят стопы шортистов и ордера на пробой, под PDL — стопы лонгистов. Поэтому у этих уровней либо **пробой с ускорением**, либо **ложный пробой и возврат** («swipe»).

Как торговать:
1. **Пробой и удержание:** цена прошла PDH, откатила к нему и удержала (уровень стал поддержкой) → лонг от ретеста, стоп под уровень, цель — следующий уровень или 2R.
2. **Ложный пробой:** цена прошла PDH, но быстро вернулась под него на объёме → шорт после возврата, стоп за экстремум ложного пробоя.

Отмечайте уровни **до открытия** — в плане дня. Уровни, нарисованные после движения, всегда «работают».

## VWAP — средневзвешенная по объёму цена

VWAP — средняя цена, по которой прошёл весь объём дня. Это «справедливая цена» для институционалов: исполнение лучше VWAP — хорошее исполнение.

Практические правила:
- **Цена выше VWAP и VWAP растёт** — в приоритете лонги от откатов к VWAP.
- **Цена ниже VWAP и VWAP падает** — в приоритете шорты от отскоков к VWAP.
- **Цена «пилит» VWAP** — тренда нет, размер меньше или не торгуем.
- Первые 5–15 минут VWAP нестабилен: по нему ещё мало объёма.

## Конфлюэнс

Сильнее всего зоны, где совпадают несколько уровней: PDH рядом с премаркет-максимумом, VWAP рядом с PDL. Один уровень — повод смотреть, два-три — повод входить.

> **Чек-лист плана дня:** для каждого тикера из списка — PDH, PDL, премаркет high/low, где сейчас VWAP относительно вчерашнего закрытия, ключевые новости. Без этого вход не планируется.`;

const L4_EXECUTION = `Хорошая идея с плохим исполнением — убыточная сделка. Исполнение — это навык, который тренируется отдельно.

## Вход: только по триггеру

Сценарий описывается заранее: **уровень + условие + стоп + цель**. Пример: «Лонг AMD при удержании PDH $162.40 после ретеста, стоп $162.15 (под минимум ретеста), цель $163.20 (премаркет-хай), R ≈ 3.2».

Триггер — конкретное событие на графике (закрытие минутной свечи над уровнем, обновление хая после ретеста), а не «кажется, пошло».

Типы ордеров:
- **Лимитный** — дешевле (ребейт ECN, меньше проскальзывание), но можно не получить исполнение.
- **Рыночный / маркетбл-лимит** — гарантирует вход, но платите спред и сбор за снятие ликвидности. Используйте на пробоях, где важна скорость.

## Стоп: техническое место, а не сумма

Стоп ставится туда, где **идея сломана** (за уровень, за экстремум ретеста), и уже потом из него считается размер. Не наоборот.

- Стоп отправляется **сразу после входа** (или bracket-ордером).
- Стоп можно двигать **только в сторону уменьшения риска**.

## Выход: план частями

Простая и рабочая схема:
1. **⅓–½ позиции на 1R–1.5R** или на первом уровне.
2. Стоп остатка в **безубыток** (с учётом комиссий — на пару центов в плюс).
3. Остаток — к следующему уровню или по трейлингу (за минимумы 1–2-минутных свечей / под VWAP).

## Частые ошибки исполнения

| Ошибка | Чем лечится |
|---|---|
| Вход до триггера («догоню на пробое») | Писать триггер в план и ждать закрытия свечи |
| Погоня за ценой после пропущенного входа | Правило: пропустил — ждём ретест или следующий сетап |
| Перенос стопа дальше | Стоп — только ближе; иначе выход |
| Выход в первую же откатную свечу | Частичный выход по плану, остаток по трейлингу |
| Добор в минус | Запрещено правилами деска |

> **Практика:** в «Реплее» откройте три свои последние сделки и отметьте, где был триггер по плану и где вы реально вошли. Разница в центах × количество акций — ваша «цена исполнения».`;

const L5_PSYCH = `Большинство сливов депозита на деске — не из-за плохих сетапов, а из-за **2–3 эмоциональных сделок после убытка**.

## Что такое тильт

Тильт — состояние, когда решения принимаются, чтобы **вернуть деньги или доказать рынку**, а не по плану. Признаки:
- сделки чаще обычного сразу после убытка (реванш в течение 5–10 минут);
- рост размера после серии минусов («отыграюсь одной сделкой»);
- вход без сетапа из плана, «потому что движется»;
- перенос стопа и пересиживание убытка.

Раздел «Поведение» в журнале автоматически находит такие паттерны по вашим сделкам: реванш, мартингейл (рост размера после убытка), овертрейдинг, пересиживание убытков. Смотрите его раз в неделю вместе с куратором.

## Правила-предохранители

1. **Правило двух стопов:** два убытка подряд → 15 минут без торговли, встать из-за стола.
2. **Дневной лимит** — абсолютный. Достиг — закрыл платформу.
3. **Размер не растёт внутри дня после убытков.** Растёт только по итогам недель — через масштабирование тира.
4. **Лучшая сделка дня — не повод для эйфории.** После крупного плюса первая следующая сделка — половинным размером.
5. **Утренний чек-ин:** сон, самочувствие, внешний стресс. Плохое состояние → меньше размер или пропуск первой сессии.

## Работа с убытком

Убыток по стопу в сетапе из плана — **это нормальная сделка**, а не ошибка. Ошибка — это нарушение плана, даже если сделка закрылась в плюс. В журнале разделяйте: «результат» и «соблюдение правил».

Вопросы после серии убытков:
- Были ли эти сделки в плане?
- Соответствовал ли размер правилам?
- Что я чувствовал перед входом (страх упустить, злость, скука)?

> **Практика:** найдите в «Поведении» свой худший день за месяц. Восстановите хронологию: какая сделка запустила серию и что вы почувствовали перед следующей.`;

const L6_JOURNAL = `Журнал — главный инструмент роста. Без него вы не знаете своё преимущество, а куратор не может вам помочь.

## Перед открытием: план дня

В «Плане дня» до 9:30 по Нью-Йорку:
- **Рынок:** фьючерсы, ключевые новости и отчёты дня, события в календаре.
- **Список тикеров** (3–5, не 20): для каждого — катализатор, уровни (PDH/PDL/премаркет), сценарий лонг/шорт с триггером и стопом.
- **Лимиты на день:** риск на сделку, дневной лимит, максимальное число сделок.
- **Фокус дня:** одна вещь, над которой работаете («не входить до триггера»).

## Во время дня

Записывайте коротко, сразу после выхода: сетап из плейбука, почему вход, эмоция (1 слово), соблюдён ли план. Сделки из PropReports подтягиваются автоматически — ваша задача добавить **трейдерский слой**: сетап, теги, заметку, скриншот.

## После закрытия: разбор дня

1. **Цифры (нетто):** P&L, число сделок, комиссии, % комиссий от брутто.
2. **Соблюдение плана:** сколько сделок были в плане, сколько — импульсивные.
3. **Лучшая и худшая сделка** — по исполнению, а не по деньгам.
4. **Один вывод и одно действие** на завтра.
5. **Закрыть день** — разбор уходит куратору в очередь, он оставит комментарий.

## Еженедельно

- Раздел «Разбор недели»: самооценка, цели, статистика по сетапам.
- Какие сетапы дают положительное ожидание **нетто**, а какие кормят клиринг.
- Что убрать: худший сетап / худшее время дня / худший ценовой диапазон.

> **Цель журнала** — через 2–3 месяца ответить цифрами на вопросы: «в каком сетапе, в какое время и на каком размере я зарабатываю?» и «что я делаю, когда теряю?».`;

export const DEMO_PROGRAM: SeedProgram = {
  slug: DEMO_PROGRAM_SLUG,
  title: "Основы проп-трейдинга WS",
  description: "Базовый курс для новых трейдеров деска: риск и R, размер позиции и комиссии, уровни PDH/PDL/VWAP, исполнение, психология и журнал. 6 уроков, 2 теста, 2 практических задания на ваших сделках.",
  level: "Стажёр",
  stage: "trainee",
  modules: [
    {
      key: "m1",
      title: "Риск, размер и комиссии",
      description: "Считаем риск в R, размер позиции от стопа и реальную цену комиссий per-share.",
      items: [
        { kind: "lesson", key: "l-risk", title: "Риск и R: единица измерения трейдера", summary: "Что такое 1R, как переводить результат в R и считать ожидание.", durationMin: 12, body: L1_RISK },
        { kind: "lesson", key: "l-size", title: "Размер позиции и комиссии per-share", summary: "Размер от стопа, безубыток в центах и почему у Орифа комиссии съели 93% брутто.", durationMin: 15, body: L2_SIZE },
        {
          kind: "quiz", key: "q-risk", title: "Тест: риск, R и комиссии", description: "Посчитайте R, размер и безубыток. Проходной балл — 80%, три попытки.", passPct: 80, maxAttempts: 3,
          questions: [
            { id: "r1", kind: "numeric", prompt: "Лонг 400 акций по $25.00, стоп $24.75, выход $25.60. Комиссии не учитываем. Сколько R заработано?", answer: 2.4, tolerance: 0.05, tolerancePct: false, unit: "R", points: 1, explanation: "Риск на акцию $0.25, прибыль на акцию $0.60 → 0.60 / 0.25 = 2.4R (в долларах: +$240 при 1R = $100)." },
            { id: "r2", kind: "numeric", prompt: "Риск на сделку $150. Вход $8.40, стоп $8.10. Сколько акций можно взять (без округления до лота)?", answer: 500, tolerance: 0, tolerancePct: false, unit: "акций", points: 1, explanation: "$150 / ($8.40 − $8.10) = $150 / $0.30 = 500 акций." },
            { id: "r3", kind: "numeric", prompt: "Комиссия за круг (вход + выход) — $6 при позиции 1 000 акций. Каков безубыток в центах на акцию?", answer: 0.6, tolerance: 0.01, tolerancePct: false, unit: "цента", points: 1, explanation: "$6 / 1 000 = $0.006 = 0.6 цента. Выигрыш меньше 0.6 цента на акцию — это убыток нетто." },
            { id: "r4", kind: "single", prompt: "Брутто +$932, комиссии $868. Какой вывод правильный?", options: [{ id: "a", text: "Стратегия прибыльная, всё в порядке" }, { id: "b", text: "Средний выигрыш слишком мал относительно комиссий: нужно больше движение на сделку и меньше сделок" }, { id: "c", text: "Нужно увеличить количество сделок, чтобы отбить комиссии" }, { id: "d", text: "Комиссии не важны, важен win rate" }], correct: ["b"], points: 1, explanation: "Комиссии ≈ 93% брутто: результат почти полностью уходит в клиринг. Больше сделок только ухудшит ситуацию." },
            { id: "r5", kind: "multiple", prompt: "Что из перечисленного — правила риска деска? (выберите все верные)", options: [{ id: "a", text: "Стоп определяется до входа" }, { id: "b", text: "Убыточную позицию можно усреднить, если уверен" }, { id: "c", text: "Дневной лимит убытка — жёсткий" }, { id: "d", text: "Размер считается из риска и расстояния до стопа" }], correct: ["a", "c", "d"], partial: true, points: 2, explanation: "Усреднение убыточной позиции запрещено. Остальное — базовые правила." },
            { id: "r6", kind: "numeric", prompt: "WR 40%, средний выигрыш 2R, средний убыток 1R. Каково ожидание на сделку в R?", answer: 0.2, tolerance: 0.01, tolerancePct: false, unit: "R", points: 1, explanation: "0.4 × 2 − 0.6 × 1 = 0.8 − 0.6 = +0.2R." },
          ],
        },
        {
          kind: "assignment", key: "a-trades", title: "Задание: разбор 3 своих сделок по сетапу", minTrades: 3, passPct: 70,
          body: `Выберите **3 свои сделки по одному сетапу** из плейбука (например, «пробой PDH» или «отбой от VWAP») и привяжите их к сдаче.

Для каждой сделки напишите:
1. **План:** уровень, триггер, стоп, цель. Был ли сетап в плане дня?
2. **R и нетто:** риск в $, результат в R, сколько ушло в комиссии.
3. **Исполнение:** где был триггер и где вы вошли; где вышли и почему.
4. **Оценка:** соблюдён ли план (да/нет) и одно конкретное улучшение.

В конце — общий вывод: даёт ли этот сетап у вас положительное ожидание **нетто**?`,
          rubric: [
            { key: "plan", label: "План и сетап описаны", maxPoints: 3, description: "Уровень, триггер, стоп, цель для каждой сделки" },
            { key: "math", label: "R и нетто посчитаны верно", maxPoints: 3, description: "Риск, R, комиссии — без ошибок" },
            { key: "exec", label: "Анализ исполнения", maxPoints: 2, description: "Разница между планом и фактом найдена" },
            { key: "insight", label: "Вывод и действие", maxPoints: 2, description: "Конкретное улучшение, а не «быть внимательнее»" },
          ],
        },
      ],
    },
    {
      key: "m2",
      title: "Уровни и исполнение",
      description: "PDH, PDL, VWAP и как превращать идею в чёткий вход и выход.",
      items: [
        { kind: "lesson", key: "l-levels", title: "Уровни дня: PDH, PDL и VWAP", summary: "Почему цена реагирует на вчерашние экстремумы и VWAP и как от них торговать.", durationMin: 14, body: L3_LEVELS, setupNames: ["PDH", "PDL", "VWAP", "пробой", "ложный пробой"] },
        { kind: "lesson", key: "l-exec", title: "Исполнение: вход, стоп и выход", summary: "Триггер, тип ордера, технический стоп, частичный выход и типичные ошибки.", durationMin: 12, body: L4_EXECUTION },
      ],
    },
    {
      key: "m3",
      title: "Психология и журнал",
      description: "Как не слить день после убытка и как вести журнал, чтобы он давал рост.",
      items: [
        { kind: "lesson", key: "l-psych", title: "Психология: тильт и правила-предохранители", summary: "Признаки тильта, правило двух стопов и работа с серией убытков.", durationMin: 10, body: L5_PSYCH },
        { kind: "lesson", key: "l-journal", title: "Журнал дня: план, записи, разбор", summary: "Что писать до открытия, во время дня и после закрытия.", durationMin: 10, body: L6_JOURNAL },
        {
          kind: "quiz", key: "q-psych", title: "Тест: уровни, исполнение и психология", description: "Проверка по модулям 2–3. Проходной балл — 75%.", passPct: 75, maxAttempts: null,
          questions: [
            { id: "p1", kind: "single", prompt: "Цена пробила PDH, откатила к нему и удержала уровень. Где логичный стоп для лонга?", options: [{ id: "a", text: "Фиксированные $0.50 от входа" }, { id: "b", text: "Под минимум ретеста / под уровень PDH" }, { id: "c", text: "Под VWAP, где бы он ни был" }, { id: "d", text: "Без стопа, выход по ощущениям" }], correct: ["b"], points: 1, explanation: "Стоп — там, где идея сломана: возврат под уровень после ретеста." },
            { id: "p2", kind: "single", prompt: "Цена ниже VWAP, VWAP снижается. Какие сделки в приоритете?", options: [{ id: "a", text: "Шорты от отскоков к VWAP" }, { id: "b", text: "Лонги на каждом минимуме" }, { id: "c", text: "Любые, VWAP не важен" }], correct: ["a"], points: 1 },
            { id: "p3", kind: "multiple", prompt: "Какие признаки тильта? (выберите все)", options: [{ id: "a", text: "Новая сделка через 2 минуты после стопа без сетапа" }, { id: "b", text: "Увеличение размера после двух убытков" }, { id: "c", text: "Пауза 15 минут после двух стопов" }, { id: "d", text: "Перенос стопа дальше от входа" }], correct: ["a", "b", "d"], partial: true, points: 2, explanation: "Пауза после двух стопов — это предохранитель, а не тильт." },
            { id: "p4", kind: "single", prompt: "Сделка вне плана закрылась в плюс. Как её оценить в журнале?", options: [{ id: "a", text: "Хорошая сделка — результат положительный" }, { id: "b", text: "Нарушение плана, несмотря на результат" }, { id: "c", text: "Не записывать — плюс же" }], correct: ["b"], points: 1, explanation: "Оцениваем соблюдение процесса отдельно от результата." },
            { id: "p5", kind: "numeric", prompt: "Вход 1 000 акций по $5.00. Треть позиции закрыли на +$0.30, остаток (≈667 акций) вышел в безубыток. Сколько долларов брутто заработано? (округлите до целого)", answer: 100, tolerance: 1, tolerancePct: false, unit: "$", points: 1, explanation: "≈333 акции × $0.30 ≈ $100; остаток в ноль." },
          ],
        },
        {
          kind: "assignment", key: "a-plan", title: "Задание: загрузи план на день", minTrades: 0, passPct: 70,
          body: `Подготовьте **план торгового дня** до открытия (9:30 по Нью-Йорку) и сдайте его: текстом и/или ссылкой на документ / скриншот разметки.

План должен содержать:
- **Рынок:** фьючерсы, ключевые новости и события дня.
- **3–5 тикеров** с катализатором; для каждого — PDH, PDL, премаркет high/low, сценарий (лонг/шорт), триггер, стоп и цель.
- **Лимиты:** риск на сделку в $, дневной лимит, максимум сделок.
- **Фокус дня:** одна поведенческая цель.

После закрытия дня допишите в эту же сдачу (или новой) короткий итог: какие сценарии отработали, были ли сделки вне плана. Можно привязать сделки дня.`,
          rubric: [
            { key: "market", label: "Контекст рынка", maxPoints: 2 },
            { key: "tickers", label: "Тикеры: уровни и сценарии с триггером/стопом", maxPoints: 4 },
            { key: "limits", label: "Лимиты риска", maxPoints: 2 },
            { key: "focus", label: "Фокус дня и итог", maxPoints: 2 },
          ],
        },
      ],
    },
  ],
};
