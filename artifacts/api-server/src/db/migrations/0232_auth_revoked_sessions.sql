-- Wave 1: (1) per-session sign-out table (item 1.10); (2) lesson 2 without a real trader's name and money (item 1.6).
-- Per-session sign-out (wave 1, item 1.10; lib/security/sessions.ts, routes/auth.ts).
-- «Выйти» in the menu signs out only the current device: its session id (JWT claim `sid`, or a hash of a token issued
-- before this migration) is recorded here and authMiddleware rejects it. «Выйти на других устройствах» in the settings
-- keeps using users.token_version. Rows are never deleted; a row past expires_at is inert (the token has expired).

CREATE TABLE IF NOT EXISTS auth_revoked_sessions (
  sid text PRIMARY KEY CHECK (char_length(sid) BETWEEN 1 AND 64),
  user_id integer NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_revoked_sessions_user_idx ON auth_revoked_sessions (user_id, revoked_at DESC);

-- Lesson «Размер позиции и комиссии per-share» (seed_key l-size, lib/academySeedCourse.ts) named a desk trader and
-- showed his gross / fees / net (audit team.md P1; wave 1, item 1.6). The lesson keeps its id; its body, summary and
-- the matching quiz question get the generic example of the seed. Only rows that still carry the old text change.
DO $mig$
BEGIN
  IF to_regclass('public.academy_lessons') IS NOT NULL THEN
    UPDATE academy_lessons SET body_md = $l2$Размер позиции не выбирают «на глаз» — его **вычисляют из риска**.

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

## Пример: 93% брутто ушло в комиссии

Условный внутридневной трейдер за 10 месяцев сделал 900 сделок:

| Показатель | Значение |
|---|---|
| Брутто P&L | +$900 |
| Комиссии и сборы | −$840 |
| **Нетто P&L** | **+$60** |
| Комиссии / брутто | **≈ 93%** |
| Средняя комиссия за сделку | ≈ $0.93 |

Win rate около 51% — то есть «угадывать» направление трейдер умеет. Но средний выигрыш на сделку настолько мал, что почти весь результат забирает клиринг. Это не проблема входа — это проблема **размера движения, на котором трейдер выходит**, и **частоты сделок**.

### Что из этого следует

1. **Считайте безубыток в центах:** комиссия за круг ÷ количество акций. Если ваш средний выигрыш меньше 2–3× этой величины, стратегия живёт на грани нуля.
2. **Меньше сделок, больше движение.** Скальп «на пару центов» оправдан только при очень низкой ставке и большом объёме.
3. **Смотрите нетто, а не брутто.** Во всех отчётах журнала деньги по умолчанию — нетто (подпись «нетто»). Раздел «Что-если → Комиссии» показывает, в каких ценовых диапазонах и при каком размере комиссии съедают ваши сделки.
4. **Сделки с проданным по рынку объёмом тоньше.** ECN-сбор за снятие ликвидности выше, чем ребейт за её добавление: лимитные выходы дешевле.

> **Практика:** в «Что-если» откройте вкладку «Комиссии», найдите свою комиссию за сделку и безубыток в центах. Сколько ваших выигрышных сделок за месяц были меньше этого безубытка?$l2$, updated_at = now()
     WHERE seed_key = 'l-size' AND body_md LIKE '%Ориф%';
    UPDATE academy_lessons SET summary = 'Размер от стопа, безубыток в центах и как комиссии съедают до 93% брутто.', updated_at = now()
     WHERE seed_key = 'l-size' AND summary LIKE '%Ориф%';
  END IF;
  IF to_regclass('public.academy_quizzes') IS NOT NULL THEN
    UPDATE academy_quizzes
       SET questions = replace(questions::text, 'Брутто +$932, комиссии $868.', 'Брутто +$900, комиссии $840.')::jsonb, updated_at = now()
     WHERE seed_key = 'q-risk' AND questions::text LIKE '%Брутто +$932, комиссии $868.%';
  END IF;
END
$mig$;
