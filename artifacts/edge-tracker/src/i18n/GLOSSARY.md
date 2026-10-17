# WS_LEXX glossary — RU → EN → UZ

Every agent follows this table: the same Russian term gets the same English and Uzbek term everywhere (UI, server texts, Telegram). If you introduce a new domain term, add it to **your own section at the bottom** (don't edit the shared tables).

## Rules

- **RU** is the source. Keep the page's existing «ты/вы».
- **EN**: US English, concise product language, sentence case («Daily limit», not «Daily Limit»).
- **UZ**: Uzbek **Latin**, modern orthography, polite «siz». Letters `oʻ gʻ` use **U+02BB «ʻ»** (not `'`, not `‘`); the glottal stop uses **U+02BC «ʼ»** (`taʼlim`, `maʼlumot`, `eʼlon`). `sh ch ng` as digraphs. Short UI labels.
  - Nouns stay **singular after numbers**: «5 ta savdo», «3 kun», «10 daqiqa». So UZ plural entries usually have identical `one`/`other`. Use `ta` with countable objects (savdo, tiker, gʻoya, setap), not with units of time/measure (kun, soat, daqiqa, ball, dona).
  - Suffixes attach to placeholders without a space: `{date}dan`, `{date}gacha`, `«{name}»ni`.
  - Buttons: verbal noun in -sh/-ish («Saqlash», «Oʻchirish», «Bekor qilish»); states: past participle / -moqda («Saqlandi», «Yuklanmoqda…»).
- Never translate user content: names, setup names, notes, comments, idea texts, folder names, tags.
- Money and prices keep the trading format in every language: `$1,234.56`, `+0.21R`, prices with a dot. Counts and dates follow the UI language (`fmtCount`, `fmtDate`).

## Do not translate (identical in RU / EN / UZ)

| Category | Items |
|---|---|
| Market data | tickers, symbols, exchange codes (NASDAQ, NYSE, ARCA), prices, `$` amounts |
| Strategy / session codes | OPG, MOC, OPGtoDAY, Day, Overnight (as a code), AfterMarket, OPT, premarket labels that are codes |
| Metrics, abbreviations | P&L, R, R:R, MAE, MFE, WR, PF, EV, VWAP, ATR, SMA, EMA, RVOL, IV, float, short interest, gap, halt, SSR, ETF, IPO, SPAC, 8-K, S-1, 10-Q, CPI, FOMC, NFP, bid/ask, spread, A+ (setup grade) |
| Earnings | «earnings» may stay as is in EN/UZ («Earnings») |
| Long / Short | RU «Лонг / Шорт» · EN «Long / Short» · UZ «Long / Short» |
| Products / brands | WS_LEXX, PropReports, Telegram, Big 7, Chart Lab, WS Chart, Whisper |
| Units kept by convention | `R`, `%`, `$`, `bp` |

## People and roles

| RU | EN | UZ | Note |
|---|---|---|---|
| Трейдер | Trader | Treyder | role and tier |
| Куратор | Curator | Kurator | |
| Админ / Администратор | Admin / Administrator | Admin / Administrator | |
| Наставник / ментор | Mentor | Mentor | |
| Риск-менеджер | Risk manager | Risk-menejer | |
| Партнёр | Partner | Hamkor | office partners |
| Гость | Guest | Mehmon | guest mode |
| Пользователь | User | Foydalanuvchi | |
| Студент / ученик | Student | Talaba | academy |
| Подопечные (куратора) | Assigned traders | Biriktirilgan treyderlar | |
| Команда | Team | Jamoa | |
| Деск / трейдинг-деск | Desk / trading desk | Desk / treyding desk | |
| Проп-трейдинг | Prop trading | Prop-treyding | |
| Офис / удалённо | Office / remote | Ofis / masofaviy | |

## Tiers and academy ladder

| RU | EN | UZ | Note |
|---|---|---|---|
| Тир | Tier | Daraja | scaling tier |
| Без тира | No tier | Darajasiz | |
| Ступень | Stage | Bosqich | step on the trader path |
| Стажёр | Intern | Stajyor | |
| Джун | Junior | Junior | |
| Трейдер (ступень) | Trader | Treyder | |
| Сеньор | Senior | Senior | |
| Путь трейдера | Trader path | Treyder yoʻli | |
| Повышение / перевод | Promotion | Koʻtarilish | moving up a stage/tier |
| Критерии перевода | Promotion criteria | Koʻtarilish mezonlari | |
| Академия | Academy | Akademiya | |
| Обучение | Learning | Taʼlim | |
| Курс | Course | Kurs | |
| Урок | Lesson | Dars | |
| Тест | Quiz | Test | |
| Задание | Assignment | Topshiriq | |
| Экзамен | Exam | Imtihon | |
| Челлендж / испытание | Challenge | Sinov | |
| Когорта | Cohort | Guruh | |
| Занятие | Session (class) | Mashgʻulot | not «Сессия» (market) |
| Посещаемость | Attendance | Davomat | |
| ИПР (индивидуальный план развития) | IDP (development plan) | Shaxsiy rivojlanish rejasi | |
| Договорённости (1:1) | Agreements | Kelishuvlar | mentor 1:1 |
| Редактор курсов | Course editor | Kurs muharriri | |
| Балл | Point | Ball | «{count} ball» |

## Trading

| RU | EN | UZ | Note |
|---|---|---|---|
| Сделка / сделки | Trade / trades | Savdo / savdolar | «{count} ta savdo» |
| Позиция | Position | Pozitsiya | |
| В позиции | In position | Pozitsiyada | |
| Сторона | Side | Yoʻnalish | Long/Short |
| Тикер | Ticker | Tiker | |
| Сетап | Setup | Setap | |
| Без сетапа | No setup | Setapsiz | |
| Вход | Entry | Kirish | |
| Выход | Exit | Chiqish | |
| Частичный выход | Partial exit | Qisman chiqish | |
| Добор / усреднение | Add / scale in | Qoʻshimcha kirish | |
| Стоп | Stop | Stop | |
| Цель / тейк | Target | Maqsad | |
| Риск | Risk | Risk | |
| Размер (позиции) | Size (position size) | Oʻlcham (pozitsiya oʻlchami) | |
| Объём | Volume | Hajm | |
| Цена | Price | Narx | |
| Исполнение / филл | Fill | Ijro | |
| Комиссии | Fees | Komissiyalar | |
| Нетто / брутто | Net / gross | Sof / yalpi | «Net P&L» = «Sof P&L» |
| P&L нетто | Net P&L | Sof P&L | |
| Прибыль | Profit | Foyda | |
| Убыток | Loss | Zarar | |
| Плюс / минус (результат) | Win / loss | Foyda / zarar | trade result badge |
| В ноль / безубыток | Breakeven | Nolda | |
| Прибыльные / убыточные | Winners / losers | Foydali / zararli | |
| Винрейт | Win rate | Win rate | |
| Средний R / Ср. R | Avg R | Oʻrt. R | |
| Сумма R | Total R | Jami R | |
| Ожидание (матожидание) | Expectancy | Kutilma | |
| Просадка | Drawdown | Pasayish | |
| Макс. просадка | Max drawdown | Maks. pasayish | |
| Просадка от пика | Drawdown from peak | Choʻqqidan pasayish | |
| Кривая капитала | Equity curve | Kapital egri chizigʻi | |
| Капитал | Capital / equity | Kapital | |
| Счёт | Account | Hisob | broker account |
| Buying power | Buying power | Buying power | keep |
| Лимит | Limit | Limit | |
| Дневной / недельный лимит | Daily / weekly limit | Kunlik / haftalik limit | |
| Лимит не задан | No limit set | Limit belgilanmagan | |
| Макс. убыток | Max loss | Maks. zarar | |
| Удержание (время в сделке) | Hold time | Ushlab turish | |
| Горизонт | Horizon | Gorizont | |
| Интрадей / овернайт / свинг | Intraday / overnight / swing | Intraday / overnight / swing | horizon codes |
| Серия | Streak | Seriya | |
| Подряд | In a row | Ketma-ket | |
| Зелёный день | Green day | Yashil kun | |
| Торговый день | Trading day | Savdo kuni | |
| Уверенность | Confidence | Ishonch | |
| Качество сделки | Trade quality | Savdo sifati | |
| Оценка | Grade / score | Baho | |
| Стратегия | Strategy | Strategiya | |
| Уровень (ценовой) | Level | Sath | support/resistance |
| Поддержка / сопротивление | Support / resistance | Qoʻllab-quvvatlash / qarshilik | |
| Пробой | Breakout | Yorib oʻtish | |
| Отскок | Bounce | Qaytish | |
| Импульс | Momentum | Impuls | |
| Ликвидность | Liquidity | Likvidlik | |
| Волатильность | Volatility | Volatillik | |
| Свеча / график | Candle / chart | Sham / grafik | |
| Таймфрейм | Timeframe | Taymfreym | |
| Реплей | Replay | Replay | Chart Lab |
| Калькулятор | Calculator | Kalkulyator | |
| Опцион / страйк / греки | Option / strike / Greeks | Opsion / strayk / greklar | |

## Market and sessions

| RU | EN | UZ | Note |
|---|---|---|---|
| Рынок | Market | Bozor | |
| Премаркет | Premarket | Premarket | |
| Основная сессия | Regular session | Asosiy sessiya | |
| Постмаркет | After-hours | Postmarket | |
| Сессия | Session | Sessiya | market session |
| Открытие / закрытие | Open / close | Ochilish / yopilish | |
| Рынок закрыт | Market closed | Bozor yopiq | |
| Выходной биржи | Market holiday | Birja dam olish kuni | |
| Выходные | Weekend | Dam olish kunlari | |
| Катализатор | Catalyst | Katalizator | |
| Событие | Event | Voqea | calendar event |
| Отчётность | Earnings | Earnings | do not translate |
| Макро | Macro | Makro | |
| Сектор | Sector | Sektor | |
| Капитализация | Market cap | Kapitalizatsiya | |
| Вотчлист | Watchlist | Kuzatuv roʻyxati | |
| Размещение (оффер) | Offering | Joylashtirish | stock offering |
| Размытие | Dilution | Suyultirish | |
| Рейтинги аналитиков | Analyst ratings | Tahlilchilar reytingi | |
| Апгрейд / даунгрейд | Upgrade / downgrade | Upgrade / downgrade | keep |
| Индикаторы | Indicators | Indikatorlar | |
| Новости / лента | News / feed | Yangiliklar / lenta | |
| Тема дня | Theme of the day | Kun mavzusi | daily feed |
| В игре (in play) | In play | In play | keep |

## Review, discipline, psychology

| RU | EN | UZ | Note |
|---|---|---|---|
| Разбор | Review | Tahlil | |
| Разбор дня | Day review | Kun tahlili | |
| Отчёт | Report | Hisobot | |
| Отчёт недели | Weekly report | Haftalik hisobot | |
| План дня | Game plan | Kun rejasi | |
| План на завтра | Plan for tomorrow | Ertangi reja | |
| Дневник | Journal | Kundalik | the journal page |
| Журнал (сделок) | Journal (trade journal) | Jurnal | «Ask the journal» |
| Спроси журнал | Ask the journal | Jurnaldan soʻrang | |
| Плейбук | Playbook | Pleybuk | |
| Вариация сетапа | Setup variation | Setap varianti | |
| Чек-лист | Checklist | Chek-list | |
| Пре-трейд чек-лист | Pre-trade checklist | Savdodan oldingi chek-list | |
| Правило | Rule | Qoida | |
| Нарушение | Violation | Qoidabuzarlik | «{count} ta qoidabuzarlik» |
| Ошибка (торговая) | Mistake | Xato | trading mistake |
| Ошибка (системная) | Error | Xato | app error |
| Дисциплина | Discipline | Intizom | |
| Тильт | Tilt | Tilt | |
| Реванш-трейдинг | Revenge trading | Revenge trading | keep |
| Овертрейдинг | Overtrading | Overtrading | keep |
| Эмоции / состояние | Emotions / state | Hissiyot / holat | |
| Стресс | Stress | Stress | |
| Пауза (торговли) | Trading pause | Savdo pauzasi | |
| Блокировка торговли | Trading lock | Savdoni bloklash | |
| Сверка | Reconciliation | Solishtirish | broker vs journal |
| Бенчмарк | Benchmark | Benchmark | |
| Перцентиль / медиана / среднее | Percentile / median / average | Persentil / mediana / oʻrtacha | |
| Статистика | Statistics | Statistika | |
| Аналитика | Analytics | Analitika | |
| Симулятор (what-if) | Simulator | Simulyator | |
| Инсайт | Insight | Xulosa | |
| Сводка | Summary / notes | Sharh | «Сводка автора» = «Author’s notes» = «Muallif sharhi» |
| Идея (трейд-идея) | Idea (trade idea) | Gʻoya | |
| Обсуждение | Discussion | Muhokama | |
| Упоминание | Mention | Eslatish | @mention |
| Рейтинг | Rating | Reyting | |
| Топ-результаты | Top results | Eng yaxshi natijalar | |
| Активность | Activity | Faollik | |
| План масштабирования | Scaling plan | Masshtablash rejasi | |

## App and admin

| RU | EN | UZ | Note |
|---|---|---|---|
| Дашборд | Dashboard | Boshqaruv paneli | |
| Настройки | Settings | Sozlamalar | |
| Профиль | Profile | Profil | |
| Интеграции | Integrations | Integratsiyalar | |
| Админка | Admin panel | Admin panel | |
| Уведомления | Notifications | Bildirishnomalar | |
| Заметка | Note | Qayd | not «Eslatma» (= reminder) |
| Напоминание | Reminder | Eslatma | |
| Тег | Tag | Teg | |
| Папка | Folder | Papka | |
| Скриншот | Screenshot | Skrinshot | |
| Голосовая заметка | Voice note | Ovozli qayd | |
| Шаблон | Template | Shablon | |
| Черновик | Draft | Qoralama | |
| Архив | Archive | Arxiv | |
| Избранное | Favorites | Sevimlilar | |
| Жалоба | Report (complaint) | Shikoyat | moderation |
| Модерация | Moderation | Moderatsiya | |
| Блокировка (бан) | Ban | Bloklash | |
| Права / доступ | Permissions / access | Huquqlar / ruxsat | |
| Импорт / экспорт | Import / export | Import / eksport | |
| Брокер / выписка | Broker / statement | Broker / koʻchirma | |
| Тема (оформления) | Theme | Mavzu | dark «Toʻq», dim «Xira», light «Yorugʻ» |
| Язык интерфейса | Interface language | Interfeys tili | |
| Поиск | Search | Qidirish / qidiruv | button «Qidirish», noun «qidiruv» |
| Сессия (вход) | Session (sign-in) | Sessiya | «Session expired» |
| Вход / выход (аккаунт) | Sign in / sign out | Kirish / chiqish | |

## Navigation section names

Canonical names live in `i18n/locales/<lang>/shell.ts` → `nav.*` (use `shellI18n.t("nav.playbook")` when you link to a section; don't retranslate).

## Area sections (add your terms below)

<!-- ## <area> (agent name)
| RU | EN | UZ | Note |
|---|---|---|---| -->

## Simulator (SIMULATOR agent)
| RU | EN | UZ | Note |
|---|---|---|---|
| Симулятор (игра на графике) | Simulator | Simulyator | /simulator; the old «Что если» page moved to /what-if |
| Бар (свеча в игре) | Bar | Sham | «{count} sham» |
| Купи и держи | Buy and hold | Sotib ol va ushla | benchmark of a game |
| Вне позиции | Flat | Pozitsiyasiz | |
| Автоигра / авто | Autoplay / auto | Avtooʻyin / avto | |
| Лёгкий / средний / сложный | Easy / medium / hard | Oson / oʻrtacha / qiyin | game level |
| Таблица недели деска | Desk week | Desk haftasi | weekly leaderboard |
