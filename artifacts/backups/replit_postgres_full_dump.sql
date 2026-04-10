--
-- PostgreSQL database dump
--

\restrict MxeJXQcOt0r9RHr3ZqoauQg05CxWzlP0Ifg8uvwddjvGtB6glyOaHqB8xPvx7k7

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_log (
    id integer NOT NULL,
    action text NOT NULL,
    section text NOT NULL,
    entity_id text,
    entity_title text,
    trader text,
    details text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: activity_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activity_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activity_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activity_log_id_seq OWNED BY public.activity_log.id;


--
-- Name: big7_catalysts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.big7_catalysts (
    id integer NOT NULL,
    ticker text NOT NULL,
    date text NOT NULL,
    type text NOT NULL,
    description text,
    impact text DEFAULT 'medium'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: big7_catalysts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.big7_catalysts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: big7_catalysts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.big7_catalysts_id_seq OWNED BY public.big7_catalysts.id;


--
-- Name: big7_levels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.big7_levels (
    id integer NOT NULL,
    ticker text NOT NULL,
    label text NOT NULL,
    price numeric(12,4) NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: big7_levels_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.big7_levels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: big7_levels_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.big7_levels_id_seq OWNED BY public.big7_levels.id;


--
-- Name: comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comments (
    id integer NOT NULL,
    discussion_id integer NOT NULL,
    trader text,
    text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: comments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.comments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.comments_id_seq OWNED BY public.comments.id;


--
-- Name: daily_feed; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_feed (
    id integer NOT NULL,
    date text NOT NULL,
    what_works_now text,
    what_doesnt_work text,
    best_tickers text,
    market_theme text,
    notes text,
    tags text,
    screenshot_url text,
    screenshot_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: daily_feed_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.daily_feed_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: daily_feed_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.daily_feed_id_seq OWNED BY public.daily_feed.id;


--
-- Name: discussions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discussions (
    id integer NOT NULL,
    topic text NOT NULL,
    type text,
    trader text,
    notes text,
    tags text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: discussions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.discussions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: discussions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.discussions_id_seq OWNED BY public.discussions.id;


--
-- Name: market_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_events (
    id integer NOT NULL,
    ticker text NOT NULL,
    date text NOT NULL,
    event_type text NOT NULL,
    headline text NOT NULL,
    reaction text,
    percent_move numeric(8,2),
    volume text,
    summary text,
    screenshot_url text,
    screenshot_notes text,
    tags text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: market_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.market_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: market_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.market_events_id_seq OWNED BY public.market_events.id;


--
-- Name: playbook; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.playbook (
    id integer NOT NULL,
    name text NOT NULL,
    setup_type text,
    conditions text,
    checklist text,
    notes text,
    confidence_level integer,
    screenshot_url text,
    screenshot_notes text,
    tags text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    folder text,
    source_type text,
    source_id integer,
    deleted_at timestamp with time zone,
    parent_id integer
);


--
-- Name: playbook_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.playbook_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: playbook_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.playbook_id_seq OWNED BY public.playbook.id;


--
-- Name: playbook_trade_ideas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.playbook_trade_ideas (
    id integer NOT NULL,
    playbook_entry_id integer NOT NULL,
    ticker text NOT NULL,
    side text,
    entry_zone text,
    target text,
    stop text,
    status text DEFAULT 'watching'::text,
    notes text,
    date text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: playbook_trade_ideas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.playbook_trade_ideas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: playbook_trade_ideas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.playbook_trade_ideas_id_seq OWNED BY public.playbook_trade_ideas.id;


--
-- Name: research; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research (
    id integer NOT NULL,
    pattern_name text NOT NULL,
    ticker text,
    context text,
    market_condition text,
    what_worked text,
    what_failed text,
    repeat_count integer DEFAULT 1,
    confidence_level integer DEFAULT 50,
    screenshot_url text,
    screenshot_notes text,
    tags text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: research_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.research_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: research_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.research_id_seq OWNED BY public.research.id;


--
-- Name: trade_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trade_reactions (
    id integer NOT NULL,
    trade_id integer NOT NULL,
    trader text NOT NULL,
    reaction_type text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: trade_reactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trade_reactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trade_reactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trade_reactions_id_seq OWNED BY public.trade_reactions.id;


--
-- Name: trade_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trade_reviews (
    id integer NOT NULL,
    trade_id integer NOT NULL,
    curator text NOT NULL,
    comment text NOT NULL,
    rating text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: trade_reviews_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trade_reviews_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trade_reviews_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trade_reviews_id_seq OWNED BY public.trade_reviews.id;


--
-- Name: trader_ratings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trader_ratings (
    id integer NOT NULL,
    trader text NOT NULL,
    curator text NOT NULL,
    week text NOT NULL,
    discipline integer DEFAULT 5,
    risk_management integer DEFAULT 5,
    execution integer DEFAULT 5,
    journaling integer DEFAULT 5,
    improvement integer DEFAULT 5,
    overall integer DEFAULT 5,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: trader_ratings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trader_ratings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trader_ratings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trader_ratings_id_seq OWNED BY public.trader_ratings.id;


--
-- Name: trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trades (
    id integer NOT NULL,
    ticker text NOT NULL,
    date text NOT NULL,
    setup text,
    side text,
    event_type text,
    entry numeric(12,4),
    exit numeric(12,4),
    stop numeric(12,4),
    result text NOT NULL,
    pnl numeric(12,2),
    r_multiple numeric(8,2),
    hold_time text,
    slippage numeric(8,2),
    market_cap text,
    "float" text,
    relative_volume numeric(8,2),
    session text,
    screenshot_url text,
    notes text,
    what_worked text,
    what_failed text,
    conclusion text,
    trader text,
    tags text,
    event_id integer,
    pattern_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    screenshot_notes text,
    deleted_at timestamp with time zone,
    playbook_id integer
);


--
-- Name: trades_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trades_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trades_id_seq OWNED BY public.trades.id;


--
-- Name: trading_errors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trading_errors (
    id integer NOT NULL,
    trader text NOT NULL,
    error_type text NOT NULL,
    description text NOT NULL,
    ticker text,
    trade_id integer,
    severity text DEFAULT 'medium'::text NOT NULL,
    lesson text,
    resolved text DEFAULT 'no'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: trading_errors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trading_errors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trading_errors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trading_errors_id_seq OWNED BY public.trading_errors.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    name text NOT NULL,
    password text NOT NULL,
    role text DEFAULT 'trader'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: watchlist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.watchlist (
    id integer NOT NULL,
    ticker text NOT NULL,
    catalyst text,
    target_price numeric(12,4),
    stop_price numeric(12,4),
    status text DEFAULT 'watching'::text NOT NULL,
    notes text,
    sector text,
    tags text,
    screenshot_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: watchlist_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.watchlist_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: watchlist_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.watchlist_id_seq OWNED BY public.watchlist.id;


--
-- Name: activity_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log ALTER COLUMN id SET DEFAULT nextval('public.activity_log_id_seq'::regclass);


--
-- Name: big7_catalysts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.big7_catalysts ALTER COLUMN id SET DEFAULT nextval('public.big7_catalysts_id_seq'::regclass);


--
-- Name: big7_levels id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.big7_levels ALTER COLUMN id SET DEFAULT nextval('public.big7_levels_id_seq'::regclass);


--
-- Name: comments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments ALTER COLUMN id SET DEFAULT nextval('public.comments_id_seq'::regclass);


--
-- Name: daily_feed id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_feed ALTER COLUMN id SET DEFAULT nextval('public.daily_feed_id_seq'::regclass);


--
-- Name: discussions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussions ALTER COLUMN id SET DEFAULT nextval('public.discussions_id_seq'::regclass);


--
-- Name: market_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_events ALTER COLUMN id SET DEFAULT nextval('public.market_events_id_seq'::regclass);


--
-- Name: playbook id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbook ALTER COLUMN id SET DEFAULT nextval('public.playbook_id_seq'::regclass);


--
-- Name: playbook_trade_ideas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbook_trade_ideas ALTER COLUMN id SET DEFAULT nextval('public.playbook_trade_ideas_id_seq'::regclass);


--
-- Name: research id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research ALTER COLUMN id SET DEFAULT nextval('public.research_id_seq'::regclass);


--
-- Name: trade_reactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_reactions ALTER COLUMN id SET DEFAULT nextval('public.trade_reactions_id_seq'::regclass);


--
-- Name: trade_reviews id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_reviews ALTER COLUMN id SET DEFAULT nextval('public.trade_reviews_id_seq'::regclass);


--
-- Name: trader_ratings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trader_ratings ALTER COLUMN id SET DEFAULT nextval('public.trader_ratings_id_seq'::regclass);


--
-- Name: trades id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades ALTER COLUMN id SET DEFAULT nextval('public.trades_id_seq'::regclass);


--
-- Name: trading_errors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trading_errors ALTER COLUMN id SET DEFAULT nextval('public.trading_errors_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: watchlist id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlist ALTER COLUMN id SET DEFAULT nextval('public.watchlist_id_seq'::regclass);


--
-- Data for Name: activity_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.activity_log (id, action, section, entity_id, entity_title, trader, details, created_at) FROM stdin;
1	deleted	trades	21	TEST	Test	\N	2026-04-09 10:02:20.130894+00
2	created	trades	42	NVDA	SMB_Example	Long win $3130.00	2026-04-09 10:44:42.66638+00
3	created	trades	43	META	SMB_Example	Long win $3200.00	2026-04-09 10:44:43.118715+00
4	created	trades	44	SMCI	SMB_Example	Long win $9600.00	2026-04-09 10:44:43.647879+00
5	created	trades	45	AMD	SMB_Example	Short win $830.00	2026-04-09 10:44:44.146689+00
6	created	trades	46	RDDT	SMB_Example	Long win $1230.00	2026-04-09 10:44:44.622547+00
7	created	trades	47	SMCI	SMB_Example	Long win $7100.00	2026-04-09 10:44:45.134029+00
8	created	trades	48	TSLA	SMB_Example	Long win $1300.00	2026-04-09 10:44:45.641077+00
9	created	trades	49	CRWD	SMB_Example	Long win $2900.00	2026-04-09 10:44:46.157649+00
10	created	trades	50	GME	SMB_Example	Short win $1650.00	2026-04-09 10:44:46.671151+00
11	created	trades	51	SHOP	SMB_Example	Long win $930.00	2026-04-09 10:44:47.173309+00
12	created	trades	52	NVDA	SMB_Example	Long win $6500.00	2026-04-09 10:44:47.700275+00
13	created	trades	53	ROKU	SMB_Example	Short win $750.00	2026-04-09 10:45:12.957941+00
14	created	trades	54	NVDA	SMB_Example	Long win $6500.00	2026-04-09 10:45:13.110988+00
\.


--
-- Data for Name: big7_catalysts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.big7_catalysts (id, ticker, date, type, description, impact, created_at) FROM stdin;
\.


--
-- Data for Name: big7_levels; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.big7_levels (id, ticker, label, price, notes, created_at) FROM stdin;
1	TEST	Test Level	100.5000	round-trip test	2026-04-09 10:24:44.458287+00
\.


--
-- Data for Name: comments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.comments (id, discussion_id, trader, text, created_at) FROM stdin;
\.


--
-- Data for Name: daily_feed; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.daily_feed (id, date, what_works_now, what_doesnt_work, best_tickers, market_theme, notes, tags, screenshot_url, screenshot_notes, created_at, deleted_at) FROM stdin;
1	2026-04-06	Gap and go setups, earnings movers, long bias	Shorting mega caps, fading weakness	NVDA, TSLA, AMD, MSTR	Post-earnings strength, momentum continuation	Earnings season in full swing, strong leadership sector stocks	\N	\N	\N	2026-04-09 09:05:03.750237+00	\N
2	2026-04-05	VWAP reclaims, support bounces	Breaking support, new lows	TSLA, PLTR, XLF	Mixed but leaning bullish	Fed speakers tomorrow, avoid surprises	\N	\N	\N	2026-04-09 09:05:03.750237+00	\N
3	2026-04-04	Short bias on gaps, fade resistance	Chasing green candles	AMD, COIN, RIOT	Bearish turn, CPI concerns	Macro headwinds affecting tech sector	\N	\N	\N	2026-04-09 09:05:03.750237+00	\N
4	2026-04-03	Range trading, support/resistance plays	Large breakouts, gap strategy	SPY, QQQ, DXY	Consolidation after losses	Market absorbed yesterday moves, tight ranges	\N	\N	\N	2026-04-09 09:05:03.750237+00	\N
5	2026-04-07	\N	\N	UNH, CVS, HUM, CNC, MOH	Healthcare	Акции крупных медицинских страховщиков — UnitedHealth, Humana и CVS Health — выросли на 6–10% в ходе предпродовой сессии после того, как CMS объявила о повышении выплат по программе Medicare Advantage на 2,48% в 2027 году. Это показатель оказался лучше ожиданий рынка, особенно на фоне того, что в начале года предложенная надбавка в 0,99% уже обвалила акции UnitedHealth почти на 20% за один день.	Reversal, Gap Up, Breakout, News, Sector Move, Relative Strength, Wide Spread, High Volatility, News Risk, Market Weak	https://www.tradingview.com/x/Kx08uyL8/\nhttps://www.tradingview.com/x/RoAZqVUP/\nhttps://www.tradingview.com/x/YlaCWNQE/\nhttps://www.tradingview.com/x/83k2rYJq/\nhttps://www.tradingview.com/x/aq07OYla/	["UNH, Принт по гепу, рисовки в маркет превратились","CVS, Принт против гепа.","HUM, Принт против гепа.","CNC, Принт flat.","MOH, Принт против гепа."]	2026-04-09 10:24:44.437668+00	\N
6	2026-04-06	Gap and go setups, earnings movers, long bias	Shorting mega caps, fading weakness	NVDA, TSLA, AMD, MSTR	Post-earnings strength, momentum continuation	Earnings season in full swing, strong leadership sector stocks	\N	\N	\N	2026-04-09 10:24:44.437668+00	\N
7	2026-04-05	VWAP reclaims, support bounces	Breaking support, new lows	TSLA, PLTR, XLF	Mixed but leaning bullish	Fed speakers tomorrow, avoid surprises	\N	\N	\N	2026-04-09 10:24:44.437668+00	\N
8	2026-04-04	Short bias on gaps, fade resistance	Chasing green candles	AMD, COIN, RIOT	Bearish turn, CPI concerns	Macro headwinds affecting tech sector	\N	\N	\N	2026-04-09 10:24:44.437668+00	\N
9	2026-04-03	Range trading, support/resistance plays	Large breakouts, gap strategy	SPY, QQQ, DXY	Consolidation after losses	Market absorbed yesterday moves, tight ranges	\N	\N	\N	2026-04-09 10:24:44.437668+00	\N
\.


--
-- Data for Name: discussions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.discussions (id, topic, type, trader, notes, tags, created_at, deleted_at) FROM stdin;
1	Best Scalping Setups for Low Float Stocks	strategy	Закир	What are your go-to scalp setups? Been working on sub-minute entries on 1-5M floats with high RVOL. Thinking about risk management - do you scale in or all-in?	scalping, low-float	2026-04-09 09:05:03.755506+00	\N
2	Earnings Gap and Go Strategy	setup	Антон	Discussing the classic gap and go setup. Looking at historical data, what time frame do these usually consolidate in? Pre-market moves vs open moves?	earnings, gap-up	2026-04-09 09:05:03.755506+00	\N
3	VWAP Trading Techniques	analysis	Артур	Let's break down different VWAP approaches. I use VWAP as support/resistance but curious about other traders' methods. Anyone use VWAP crosses?	vwap, technical	2026-04-09 09:05:03.755506+00	\N
4	Fade Trading and HOD Failures	strategy	Рахматулло	How do you identify which fades work? I see a lot of HOD failures that turn into runners. Any specific criteria you use to filter?	fade, short	2026-04-09 09:05:03.755506+00	\N
5	Risk Management in Day Trading	risk	Умид	Most important rule - always know your exit before entry. Position sizing formula: 2% per trade max. Fixed dollar stops beat percent stops always.	risk-management	2026-04-09 09:05:03.755506+00	\N
6	Best Scalping Setups for Low Float Stocks	strategy	Закир	What are your go-to scalp setups? Been working on sub-minute entries on 1-5M floats with high RVOL. Thinking about risk management - do you scale in or all-in?	scalping, low-float	2026-04-09 10:24:44.441769+00	\N
7	Earnings Gap and Go Strategy	setup	Антон	Discussing the classic gap and go setup. Looking at historical data, what time frame do these usually consolidate in? Pre-market moves vs open moves?	earnings, gap-up	2026-04-09 10:24:44.441769+00	\N
8	VWAP Trading Techniques	analysis	Артур	Let's break down different VWAP approaches. I use VWAP as support/resistance but curious about other traders' methods. Anyone use VWAP crosses?	vwap, technical	2026-04-09 10:24:44.441769+00	\N
9	Fade Trading and HOD Failures	strategy	Рахматулло	How do you identify which fades work? I see a lot of HOD failures that turn into runners. Any specific criteria you use to filter?	fade, short	2026-04-09 10:24:44.441769+00	\N
10	Risk Management in Day Trading	risk	Умид	Most important rule - always know your exit before entry. Position sizing formula: 2% per trade max. Fixed dollar stops beat percent stops always.	risk-management	2026-04-09 10:24:44.441769+00	\N
\.


--
-- Data for Name: market_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.market_events (id, ticker, date, event_type, headline, reaction, percent_move, volume, summary, screenshot_url, screenshot_notes, tags, created_at, deleted_at) FROM stdin;
1	NVDA	2026-04-06	Earnings	NVIDIA Q4 Earnings Beat Expectations	Bullish	3.50	85M	Strong guidance pushes stock higher	\N	\N	\N	2026-04-09 09:05:03.739512+00	\N
2	TSLA	2026-04-05	News	Tesla Announces New Gigafactory Location	Mixed	1.20	42M	Market uncertain about capital spend	\N	\N	\N	2026-04-09 09:05:03.739512+00	\N
3	AMD	2026-04-04	Economic	Fed Signals Possible Rate Cuts	Bullish	2.10	120M	Tech sector rallies on softer rates outlook	\N	\N	\N	2026-04-09 09:05:03.739512+00	\N
4	SOFI	2026-04-02	Economic	Prime Broker Increases Margin Requirements	Bearish	-1.80	65M	Retail traders forced to reduce positions	\N	\N	\N	2026-04-09 09:05:03.739512+00	\N
5	TMHC	2026-04-07	dwg	Downgrade TMHC от Seaport Global	gap_down	-2.30	1.5 M	Аналитик\nSeaport Global\nКеннет Зенер понизил рейтинг\nTaylor Morrison Home (NYSE: TMHC) с Buy (покупать) до Sell (продавать) и снизил целевую цену с $85 до $49.	\N	\N	\N	2026-04-09 10:24:44.42925+00	\N
6	KBH	2026-04-07	dwg	Downgrade KBH от Seaport Global	gap_down	-2.30	1 M	Аналитик\nSeaport Global\nКеннет Зенер понизил рейтинг\nKB Home (NYSE: KBH) с Buy (покупать) до Sell (продавать) и снизил целевую цену с $65 до $43.	\N	\N	\N	2026-04-09 10:24:44.42925+00	\N
7	AVGO	2026-04-07	news	Партнерство с GOOGLE.	gap_up	4.00	32.3	Broadcom заключила долгосрочное соглашение с\nGoogle по разработке и поставке AI-чипов до 2031 года.\n\nСоглашение предусматривает создание и поставку будущих поколений кастомных чипов для искусственного интеллекта.\n\nТакже заключено отдельное соглашение с\nAnthropic:\n\nBroadcom будет обеспечивать около 3.5 гигаватт вычислительной мощности, начиная с 2027 года.\n\nКомпания раскрыла информацию об этих сделках в отчёте, поданном в\nSEC, где описаны расширенные долгосрочные партнёрства в сфере ИИ.\n\nКомментарий: На премаркете было ложное пробитие хая премаркета. Потом вернулась в канал проторговки афтермаркета. Не показывала силу либо слабость на премаркете. В конце премаркета она вышла из канала проторговки афтермаркета , ретест и отросла. До 200 ma она не дошла на премаркете и афтемаркете. Цена открылась, спайк наверх, пробила 200 ma и вернулась. Несколько раз тестила 200 ma. В итоге начала падать и торговаться ниже опена. В 11:10 начала ходить за рынком росла. В итоге пробила 200 ma и вернулась. Кружится вокруг своей 200 ma.	\N	\N	\N	2026-04-09 10:24:44.42925+00	\N
8	TSLA	2026-04-05	News	Tesla Announces New Gigafactory Location	Mixed	1.20	42M	Market uncertain about capital spend	\N	\N	\N	2026-04-09 10:24:44.42925+00	\N
9	NVDA	2026-04-06	Earnings	NVIDIA Q4 Earnings Beat Expectations	Bullish	3.50	85M	Strong guidance pushes stock higher	\N	\N	\N	2026-04-09 10:24:44.42925+00	\N
10	AMD	2026-04-04	Economic	Fed Signals Possible Rate Cuts	Bullish	2.10	120M	Tech sector rallies on softer rates outlook	\N	\N	\N	2026-04-09 10:24:44.42925+00	\N
11	SOFI	2026-04-02	Economic	Prime Broker Increases Margin Requirements	Bearish	-1.80	65M	Retail traders forced to reduce positions	\N	\N	\N	2026-04-09 10:24:44.42925+00	\N
\.


--
-- Data for Name: playbook; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.playbook (id, name, setup_type, conditions, checklist, notes, confidence_level, screenshot_url, screenshot_notes, tags, created_at, folder, source_type, source_id, deleted_at, parent_id) FROM stdin;
1	Healthcare (2026-04-07)	\N	Рыночная тема: Healthcare	\N	Акции крупных медицинских страховщиков — UnitedHealth, Humana и CVS Health — выросли на 6–10% в ходе предпродовой сессии после того, как CMS объявила о повышении выплат по программе Medicare Advantage на 2,48% в 2027 году. Это показатель оказался лучше ожиданий рынка, особенно на фоне того, что в начале года предложенная надбавка в 0,99% уже обвалила акции UnitedHealth почти на 20% за один день.\nТикеры: UNH, CVS, HUM, CNC, MOH	\N	https://www.tradingview.com/x/Kx08uyL8/\nhttps://www.tradingview.com/x/RoAZqVUP/\nhttps://www.tradingview.com/x/YlaCWNQE/\nhttps://www.tradingview.com/x/83k2rYJq/\nhttps://www.tradingview.com/x/aq07OYla/	["UNH, Принт по гепу, рисовки в маркет превратились","CVS, Принт против гепа.","HUM, Принт против гепа.","CNC, Принт flat.","MOH, Принт против гепа."]	Reversal, Gap Up, Breakout, News, Sector Move, Relative Strength, Wide Spread, High Volatility, News Risk, Market Weak	2026-04-09 10:24:44.454187+00	Sector Move	dailyfeed	17	\N	\N
2	Trade Review Checklist	Другой	Выполнять для КАЖДОГО трейда, win или loss\nЗаполнять в течение 30 минут после закрытия позиции\nЧестная оценка — никакого hindsight bias	- Был ли это мой setup из плейбука?\n- Дождался ли я confirmation?\n- Правильный ли был sizing?\n- Стоп был определён до входа?\n- Следовал ли я своему стопу?\n- Был ли entry timing оптимальным?\n- Достаточно ли я держал winner?\n- Не передержал ли я loser?\n- Что я сделал бы по-другому?\n- Какой урок вынес?	Без review нет improvement. Каждый трейд — это data point.\n\nSMB требует от всех трейдеров вести journal и review. Без этого невозможно идентифицировать edge.\n\nPlayback method: в конце дня пересмотри каждый трейд на charts. Отметь entry/exit/stop. Оцени 1-10.\n\nЕженедельный review: top 3 best trades, top 3 worst trades, паттерны ошибок.	100	\N	\N	review, process, discipline, must-do	2026-04-09 10:24:44.454187+00	Risk Management	\N	\N	\N	\N
3	Position Sizing Framework	Другой	Применять ко ВСЕМ сетапам без исключений\nМаксимальный риск на трейд: 1% от счёта\nA+ setups: полный размер (1%)\nB setups: 50-75% от полного размера\nC setups: 25-50% или пропуск	- Account risk per trade: MAX 1%\n- A+ setup: full size\n- B setup: 50-75% size\n- C setup: 25-50% size\n- Daily loss limit: 3% of account\n- Weekly loss limit: 5% of account\n- Stop ALWAYS defined BEFORE entry\n- No averaging down on losers	SMB Capital Risk Management:\n\n1. Новичок (<6 мес): 0.25% risk per trade, max 3 trades/day\n2. Developing (6-12 мес): 0.5% risk per trade, max 5 trades/day\n3. Experienced (>1 год с profit): 1% risk per trade, no daily limit\n\nGolden rule: если проиграл 3 трейда подряд — стоп на день. Не пытайся отбить.\n\nPosition sizing formula: Shares = (Account * Risk%) / (Entry - Stop)	95	\N	\N	risk, sizing, rules, critical	2026-04-09 10:24:44.454187+00	Risk Management	\N	\N	\N	\N
4	CPI Morning Gap — Trend Day Trade	Другой	CPI data release 8:30 AM ET\nSignificant deviation from expectations (>0.2%)\nSPY gaps >0.5% on the data\nBond yields move sharply in same direction\nFirst 15-мин range clean (not choppy)	- CPI deviation from consensus >0.2%\n- SPY gap >0.5%\n- Bond yields (TNX) confirming direction\n- VIX expansion\n- First 15-min candle establishes direction\n- Entry: with trend after first pullback\n- Stop: opposite side of first 15-min range\n- Target: 2-3x first hour range (trend day potential)	CPI days часто становятся trend days — одно направление весь день.\n\nЕсли CPI горячий (выше ожиданий) — sell the open, short rallies.\nЕсли CPI мягкий (ниже ожиданий) — buy pullbacks.\n\nTrend day characteristics: closes near HOD/LOD, TICK persistent, breadth one-sided.\n\nBest stocks for CPI plays: rate-sensitive (banks, REITs, tech growth).	73	\N	\N	cpi, macro, trend-day, morning	2026-04-09 10:24:44.454187+00	Macro / Event Plays	\N	\N	\N	\N
5	FOMC Fade — Post-Decision Reversal	Другой	FOMC decision day в 2:00 PM ET\nInitial move >1% на SPY в первые 15 минут после решения\nMove driven by algo/knee-jerk reaction\nPowell press conference начинается в 2:30 PM\nReversal signs: volume spike + exhaustion candle	- FOMC decision released at 2:00 PM ET\n- Initial move >1% on SPY\n- Wait for exhaustion (15-30 min after decision)\n- Powell presser reversal typical at 2:30-3:00 PM\n- Entry: reversal candle after initial move\n- Stop: beyond the extreme of initial move\n- Target: full retrace of FOMC initial move	FOMC fade — один из самых statistically reliable сетапов. Initial reaction часто reversed полностью к close.\n\nStatistics: ~60% FOMC days reverse the initial move. Powell press conference creates the second volatility wave.\n\nРиск: иногда initial move продолжается (hawkish surprise). Размер позиции = 50% от обычного.\n\nSMB правило: не торговать первые 15 минут после FOMC. Ждать clarity.	70	\N	\N	fomc, macro, fade, event-driven	2026-04-09 10:24:44.454187+00	Macro / Event Plays	\N	\N	\N	\N
6	IPO Day 1 — Opening Range Breakout	IPO Day Trade	Новый IPO первый день торгов\nОткрылся выше IPO price с premium >20%\nFirst 15 min range establishes\nInstitutional demand visible (large prints on tape)\nSector hot (tech, AI, biotech catalysts)	- IPO price vs open price: premium >20%\n- First 15-min range: tight (<5% of price)\n- Volume first 15 min: massive (>5M shares)\n- Large block prints on tape\n- No lockup expiry imminent\n- Entry: break above 15-min high\n- Stop: below 15-min low or VWAP\n- Target: 2x opening range height	IPO Day 1 — unique setup потому что нет технических уровней. Всё определяется supply/demand.\n\nПравила:\n1. Торговать только IPO с strong demand (oversubscribed)\n2. Ждать первый 15-мин range — никогда не покупать на open\n3. Size small — IPO volatile\n4. Быть готовым к wide stops\n\nRecent examples: ARM Holdings, Instacart, Reddit IPO days.	68	\N	\N	ipo, day-1, opening-range, high-vol	2026-04-09 10:24:44.454187+00	IPO / SPO Plays	\N	\N	\N	\N
7	Range Break — Consolidation Squeeze	Breakout	Акция торгуется в tight range >30 минут\nRange сужается (squeeze) — Bollinger Bands narrowing\nVolume declining в range\nАкция near HOD или at significant level\nCatalyst present (upcoming event, sector move)	- Range <2% for >30 min\n- Volume declining in range\n- ATR squeeze visible\n- Stock near HOD or key daily level\n- Clear direction bias (above/below VWAP)\n- Entry: break of range with volume >2x range average\n- Stop: opposite side of range\n- Target: range width x 2 extension	Compression leads to expansion. Длительная консолидация создаёт energy для big move.\n\nЧасто работает в midday (11-1 PM) когда утренний momentum затухает и формируется новый range.\n\nRisk management: если breakout immediately fails (1 candle), это false breakout — выходить немедленно. Real breakouts не дают re-entry ниже breakout level.	72	\N	\N	breakout, squeeze, range, patience	2026-04-09 10:24:44.454187+00	Breakout Patterns	\N	\N	\N	\N
8	Flag Pattern Breakout	Breakout	Strong initial move (pole) >5% с high volume\nConsolidation 15-45 min с declining volume (flag)\nFlag retraces <38.2% of pole\nVWAP ниже flag — supportive\nMarket (SPY) stable или bullish	- Pole move >5% on volume\n- Consolidation (flag) 3-8 candles on 5-min\n- Volume declining during flag\n- Flag <38.2% retrace of pole\n- Break above flag high on volume surge\n- Entry: break of flag high\n- Stop: below flag low\n- Target: measured move (pole length from breakout)	Классический continuation pattern. Один из самых чистых сетапов в day trading.\n\nFlag должен быть tight — если широкий (>50% retrace), это уже не flag а reversal.\n\nLook for: tight candles, declining volume in flag, clean break with volume. Measured move target обычно достигается в 65% случаев.\n\nSMB traders ищут 2-3 flag patterns per day в leading stocks.	82	\N	\N	breakout, flag, continuation, clean	2026-04-09 10:24:44.454187+00	Breakout Patterns	\N	\N	\N	\N
9	Weak Open Short — Gap Up Fail	Earnings Gap Down Short	Акция gap up >5% но open weak — первый 5-мин бар red\nVWAP immediately turns down\nVolume heavy on sell side\nКаталист не достаточно сильный для sustained move\nSector/market weak	- Gap up >5% but opens weak\n- First 5-min candle: bearish (close < open)\n- VWAP slope negative from open\n- Heavy selling volume first 5 min\n- No strong fundamental catalyst\n- Entry: break below first 5-min low\n- Stop: above first 5-min high or VWAP\n- Target: gap fill (yesterday close)	Gap up fail — когда рынок отвергает gap. Часто на weak catalysts: minor upgrades, sector sympathy plays, pre-market pump.\n\nСамый надёжный short intraday. Win rate ~60%.\n\nНе путать с earnings gap ups — те часто имеют real buying и recover. Gap up fails работают на слабых catalyst.	74	\N	\N	short, gap-fail, morning, reliable	2026-04-09 10:24:44.454187+00	Short Setups	\N	\N	\N	\N
10	Parabolic Short — Blow-Off Top	Reversal	Акция выросла >30% за 1-2 дня без fundamental catalyst\nПоследняя волна роста — вертикальная (parabolic)\nVolume climax — огромный volume на top\nFirst red candle с high volume после parabolic move\nSSR не активен (или есть shares to short)	- Move >30% in 1-2 days\n- No real catalyst (just momentum/social media)\n- Volume climax bar at top\n- First lower high on 5-min chart\n- Spread widening at top\n- Entry: break below first consolidation after climax\n- Stop: above HOD (tight)\n- Target: 50% retrace of the move or VWAP	High risk / high reward. Самый опасный но и самый прибыльный short setup.\n\nПравила SMB для parabolic shorts:\n1. Никогда не шортить на пути вверх — только после confirmation top\n2. Size small — максимум 50% обычного размера\n3. Стоп жёсткий — HOD +$0.25\n4. Не шортить low float (<5M) parabolics — могут squeeze бесконечно\n\nПримеры: GME, AMC blow-offs, random small cap pumps.	65	\N	\N	short, parabolic, high-risk, blow-off	2026-04-09 10:24:44.454187+00	Short Setups	\N	\N	\N	\N
11	Red to Green Move	Reversal	Акция открылась red (ниже yesterday close)\nНет negative catalyst — продажа на общем рынке или sector rotation\nНачинает recovery с volume build\nReclaims yesterday close (red to green)\nStrong relative strength vs SPY	- No company-specific bad news\n- Pre-market selling was sector/market-wide\n- Recovery on increasing volume\n- Break above yesterday close\n- Relative strength vs SPY positive\n- Entry: first pullback after R2G move\n- Stop: below the red-to-green level\n- Target: prior day high or VWAP from prior day	Red to Green — сигнал институционального buying. Кто-то считает цену attractive и набирает позицию.\n\nСамые сильные R2G moves происходят в первый час торгов. Если R2G происходит после 11 AM — менее надёжно.\n\nTrack: крупные tech names (AAPL, MSFT, GOOGL) часто показывают R2G в дни market weakness.	77	\N	\N	reversal, red-to-green, relative-strength	2026-04-09 10:24:44.454187+00	Intraday Momentum	\N	\N	\N	\N
12	VWAP Reclaim — Mean Reversion Long	Reversal	Акция упала ниже VWAP утром на weak selling (low volume)\nНачинает формировать higher lows ниже VWAP\nVolume pick up на reclaim candle\nОбщий рынок (SPY) стабилен или растёт\nАкция имеет дневной uptrend (выше 20 SMA daily)	- Stock pulled back to/below VWAP on declining volume\n- Higher lows forming (ascending triangle pattern)\n- Volume increase on reclaim candle\n- SPY not tanking\n- Daily trend is up (above 20 SMA)\n- Entry: break above VWAP with volume\n- Stop: below last higher low\n- Target: HOD retest	Mean reversion к VWAP — один из самых reliable сетапов. Работает когда selling exhaustion очевиден (volume dry up below VWAP).\n\nЛучше всего работает 10:30-11:30 AM ET после утренней волатильности.\n\nНе торговать если акция имеет negative catalyst (earnings miss, downgrade). Только для технических pullback.	80	\N	\N	vwap, mean-reversion, long, reliable	2026-04-09 10:24:44.454187+00	Intraday Momentum	\N	\N	\N	\N
13	Opening Drive — Momentum Ignition	Intraday Momentum	Гэп >3% с каталистом (news, upgrade, sector move)\nPremarket volume >200K\nBid-ask tight (<0.05 для stocks >$20)\nLevel 2 показывает стэковый bid\nFirst 1-min candle closes near high с volume >50K	- Clear catalyst identified\n- Gap >3% with volume\n- First 1-min candle: bullish close\n- VWAP slope positive\n- No immediate overhead resistance ($0.50)\n- Entry: break of 1-min high\n- Stop: below 1-min low or VWAP\n- Target: next whole dollar / premarket high	Самый быстрый setup — первые 5-15 минут торгов. Вход на break первой 1-мин свечи с volume confirmation. Всё решается за 2-5 минут.\n\nОшибка новичков: входить в открытие без подтверждения первой свечи. Пропускайте если первая свеча — doji или bearish.\n\nWin rate ~55%, но R:R обычно 3:1+. Один из хлебных сетапов SMB.	75	\N	\N	momentum, opening, speed, A-setup	2026-04-09 10:24:44.454187+00	Intraday Momentum	\N	\N	\N	\N
14	Earnings Winner — Day 2 Continuation	Second Day Play	Day 1: сильный earnings gap up с close near HOD\nDay 2 gap up или flat open above Day 1 close\nОбъём Day 1 был >3x 20-day average volume\nНет распродажи premarket Day 2\nSector momentum positive	- Day 1 closed >80% от range\n- Day 1 volume >3x average\n- Day 2 premarket: not fading below Day 1 close\n- Opening range first 5 min: above VWAP\n- Catalyst still fresh — upgrades/coverage\n- Entry: hold of Day 1 close or VWAP\n- Stop: below Day 1 close\n- Target: 1.5x Day 1 range extension	SMB classic Day 2 play. Самые сильные earnings movers продолжают движение на Day 2 из-за institutional buying, short covering, и upgrades overnight.\n\nКлюч — Day 1 close должен быть near HOD (закрытие силы). Если Day 1 закрылся с длинной верхней тенью, Day 2 обычно слабый.\n\nTrack: NVDA, META, AMZN post-earnings Day 2 moves.	78	\N	\N	earnings, continuation, day-2, momentum	2026-04-09 10:24:44.454187+00	Earnings Plays	\N	\N	\N	\N
15	Earnings Gap Down — Short the Failed Bounce	Earnings Gap Down Short	Gap down >7% на miss по EPS или guidance cut\nОбъём premarket >300K\nСтруктура: opening drive down → bounce attempt → fail at resistance\nResistance: VWAP, prior close, declining 9 EMA\nSector weak или нейтральный	- EPS miss или guidance cut\n- Gap down >7%\n- Bounce to VWAP or 38.2% retrace fails\n- Lower highs формируются на bounce\n- Volume fade на bounce\n- No major support nearby ($1-2 range)\n- Risk: above VWAP or bounce high\n- Target: LOD retest or extension	Ждём failed bounce к VWAP после утреннего sell-off. Вход short на rejection от VWAP или declining 9 EMA. Стоп выше VWAP. Тейк — retest LOD и ниже.\n\nОсторожно с акциями <$10 и с очень высоким short interest — могут сквизнуть.\n\nПримеры: SNAP earnings, ZM earnings drops, PYPL guidance cuts.	82	\N	\N	earnings, gap-down, short, reversal	2026-04-09 10:24:44.454187+00	Earnings Plays	\N	\N	\N	\N
16	Earnings Gap Up — First Pullback Long	Earnings Gap Up	Gap up >5% на отчётности с beat по EPS и revenue\nОбъём premarket >500K shares\nКлючевые уровни: вчерашний high, pre-market high, whole/half dollars\nКатализатор чистый — guidance raised или beat >10%\nНет значимого сопротивления в первые $2-3 от открытия	- EPS beat >5%\n- Revenue beat >3%\n- Guidance raised или не снижен\n- Premarket volume >500K\n- Gap >5% от close\n- Float <100M (идеально <30M)\n- Нет earnings peer в тот же день\n- Risk/Reward минимум 3:1\n- Стоп под VWAP или low первого 5-мин бара	SMB Capital core setup. Ждём первый откат к VWAP или rising 9 EMA на 1-мин после opening drive. Вход на hold VWAP с тейком на новый HOD. Ключ — скорость recovery после pullback. Если recovery медленная (>3 мин), пропускаем.\n\nЛучшие дни: вторник-четверг. Избегать в дни FOMC/CPI.\n\nTrades to study: CELH earnings Aug 2023, SMCI earnings Jan 2024, ONON earnings multiple.	90	\N	\N	earnings, gap-up, momentum, A+	2026-04-09 10:24:44.454187+00	Earnings Plays	\N	\N	\N	\N
17	Red to Green Move	Reversal	Акция открылась red (ниже yesterday close)\nНет negative catalyst — продажа на общем рынке или sector rotation\nНачинает recovery с volume build\nReclaims yesterday close (red to green)\nStrong relative strength vs SPY	- No company-specific bad news\n- Pre-market selling was sector/market-wide\n- Recovery on increasing volume\n- Break above yesterday close\n- Relative strength vs SPY positive\n- Entry: first pullback after R2G move\n- Stop: below the red-to-green level\n- Target: prior day high or VWAP from prior day	Red to Green — сигнал институционального buying. Кто-то считает цену attractive и набирает позицию.\n\nСамые сильные R2G moves происходят в первый час торгов. Если R2G происходит после 11 AM — менее надёжно.\n\nTrack: крупные tech names (AAPL, MSFT, GOOGL) часто показывают R2G в дни market weakness.	77	\N	\N	reversal, red-to-green, relative-strength	2026-04-09 10:24:44.454187+00	Intraday Momentum	\N	\N	\N	\N
18	VWAP Reclaim — Mean Reversion Long	Reversal	Акция упала ниже VWAP утром на weak selling (low volume)\nНачинает формировать higher lows ниже VWAP\nVolume pick up на reclaim candle\nОбщий рынок (SPY) стабилен или растёт\nАкция имеет дневной uptrend (выше 20 SMA daily)	- Stock pulled back to/below VWAP on declining volume\n- Higher lows forming (ascending triangle pattern)\n- Volume increase on reclaim candle\n- SPY not tanking\n- Daily trend is up (above 20 SMA)\n- Entry: break above VWAP with volume\n- Stop: below last higher low\n- Target: HOD retest	Mean reversion к VWAP — один из самых reliable сетапов. Работает когда selling exhaustion очевиден (volume dry up below VWAP).\n\nЛучше всего работает 10:30-11:30 AM ET после утренней волатильности.\n\nНе торговать если акция имеет negative catalyst (earnings miss, downgrade). Только для технических pullback.	80	\N	\N	vwap, mean-reversion, long, reliable	2026-04-09 10:24:44.454187+00	Intraday Momentum	\N	\N	\N	\N
19	Opening Drive — Momentum Ignition	Intraday Momentum	Гэп >3% с каталистом (news, upgrade, sector move)\nPremarket volume >200K\nBid-ask tight (<0.05 для stocks >$20)\nLevel 2 показывает стэковый bid\nFirst 1-min candle closes near high с volume >50K	- Clear catalyst identified\n- Gap >3% with volume\n- First 1-min candle: bullish close\n- VWAP slope positive\n- No immediate overhead resistance ($0.50)\n- Entry: break of 1-min high\n- Stop: below 1-min low or VWAP\n- Target: next whole dollar / premarket high	Самый быстрый setup — первые 5-15 минут торгов. Вход на break первой 1-мин свечи с volume confirmation. Всё решается за 2-5 минут.\n\nОшибка новичков: входить в открытие без подтверждения первой свечи. Пропускайте если первая свеча — doji или bearish.\n\nWin rate ~55%, но R:R обычно 3:1+. Один из хлебных сетапов SMB.	75	\N	\N	momentum, opening, speed, A-setup	2026-04-09 10:24:44.454187+00	Intraday Momentum	\N	\N	\N	\N
20	Earnings Winner — Day 2 Continuation	Second Day Play	Day 1: сильный earnings gap up с close near HOD\nDay 2 gap up или flat open above Day 1 close\nОбъём Day 1 был >3x 20-day average volume\nНет распродажи premarket Day 2\nSector momentum positive	- Day 1 closed >80% от range\n- Day 1 volume >3x average\n- Day 2 premarket: not fading below Day 1 close\n- Opening range first 5 min: above VWAP\n- Catalyst still fresh — upgrades/coverage\n- Entry: hold of Day 1 close or VWAP\n- Stop: below Day 1 close\n- Target: 1.5x Day 1 range extension	SMB classic Day 2 play. Самые сильные earnings movers продолжают движение на Day 2 из-за institutional buying, short covering, и upgrades overnight.\n\nКлюч — Day 1 close должен быть near HOD (закрытие силы). Если Day 1 закрылся с длинной верхней тенью, Day 2 обычно слабый.\n\nTrack: NVDA, META, AMZN post-earnings Day 2 moves.	78	\N	\N	earnings, continuation, day-2, momentum	2026-04-09 10:24:44.454187+00	Earnings Plays	\N	\N	\N	\N
21	Earnings Gap Down — Short the Failed Bounce	Earnings Gap Down Short	Gap down >7% на miss по EPS или guidance cut\nОбъём premarket >300K\nСтруктура: opening drive down → bounce attempt → fail at resistance\nResistance: VWAP, prior close, declining 9 EMA\nSector weak или нейтральный	- EPS miss или guidance cut\n- Gap down >7%\n- Bounce to VWAP or 38.2% retrace fails\n- Lower highs формируются на bounce\n- Volume fade на bounce\n- No major support nearby ($1-2 range)\n- Risk: above VWAP or bounce high\n- Target: LOD retest or extension	Ждём failed bounce к VWAP после утреннего sell-off. Вход short на rejection от VWAP или declining 9 EMA. Стоп выше VWAP. Тейк — retest LOD и ниже.\n\nОсторожно с акциями <$10 и с очень высоким short interest — могут сквизнуть.\n\nПримеры: SNAP earnings, ZM earnings drops, PYPL guidance cuts.	82	\N	\N	earnings, gap-down, short, reversal	2026-04-09 10:24:44.454187+00	Earnings Plays	\N	\N	\N	\N
22	Earnings Gap Up — First Pullback Long	Earnings Gap Up	Gap up >5% на отчётности с beat по EPS и revenue\nОбъём premarket >500K shares\nКлючевые уровни: вчерашний high, pre-market high, whole/half dollars\nКатализатор чистый — guidance raised или beat >10%\nНет значимого сопротивления в первые $2-3 от открытия	- EPS beat >5%\n- Revenue beat >3%\n- Guidance raised или не снижен\n- Premarket volume >500K\n- Gap >5% от close\n- Float <100M (идеально <30M)\n- Нет earnings peer в тот же день\n- Risk/Reward минимум 3:1\n- Стоп под VWAP или low первого 5-мин бара	SMB Capital core setup. Ждём первый откат к VWAP или rising 9 EMA на 1-мин после opening drive. Вход на hold VWAP с тейком на новый HOD. Ключ — скорость recovery после pullback. Если recovery медленная (>3 мин), пропускаем.\n\nЛучшие дни: вторник-четверг. Избегать в дни FOMC/CPI.\n\nTrades to study: CELH earnings Aug 2023, SMCI earnings Jan 2024, ONON earnings multiple.	90	\N	\N	earnings, gap-up, momentum, A+	2026-04-09 10:24:44.454187+00	Earnings Plays	\N	\N	\N	\N
23	VWAP Support Bounce	Support	Stock consolidates at VWAP, RVOL 1.5+, clean candle bounce	VWAP touched, entry on close above VWAP, resistance plotted	Works in trending markets - Morning preferred	7	\N	\N	\N	2026-04-09 10:24:44.454187+00	\N	\N	\N	\N	\N
24	Low Float Runner	Runner	Float under 3M, gap up 5%+, RVOL 2+, sustained momentum	Let winner run with trailing stop, partials at 5% and 10%	High risk/reward - Manage size carefully, micro caps	5	\N	\N	\N	2026-04-09 10:24:44.454187+00	\N	\N	\N	\N	\N
25	HOD Failure Short	Short	Gap up then fails at HOD, 2M+ premarket float	Resistance at HOD confirmed, short entry near resistance	Avoid on strong earnings names - Tech exception	7	\N	\N	\N	2026-04-09 10:24:44.454187+00	\N	\N	\N	\N	\N
26	Scalping 1-Min Bounce	Scalp	Stock with sub-5M float, RVOL 3+, support level confirmed	1-min entry, 0.05-0.15 target, stop 0.10 below	Quick execution critical, needs tight spreads	6	\N	\N	\N	2026-04-09 10:24:44.454187+00	\N	\N	\N	\N	\N
27	Earnings Gap and Go	Gap	Stock gaps 3%+ after earnings, strong guidance, premarket volume 2M+	Check float size, RVOL at entry, first resistance identified	Best performance on tech earnings - Mega cap bias	8	\N	\N	\N	2026-04-09 10:24:44.454187+00	\N	\N	\N	\N	\N
29	ATM Offering Play — Short	Другой	1. Акция сильно выросла на катализаторе (гэп +5-20%)\n2. Компания объявляет ATM / below-market вторичное размещение\n3. Цена предложения ниже текущей рыночной цены\n4. Small/micro-cap — не голубые фишки\n5. Float небольшой (до 50-100M)	- Акция выросла на катализаторе перед оферингом?\n- Известна ли цена оферинга (offering price)?\n- Акция торгуется ВЫШЕ offering price?\n- Float маленький?\n- Объём выше нормы?\n- Нет защиты (lockup, buyback) от падения?	СУТЬ: Компания делает dilutive offering чтобы привлечь деньги — это размывает акционеров. Рынок продаёт. Шортим от текущей цены к offering price.\n\nЛУЧШИЙ ВХОД: Сразу после объявления на высоком объёме. Цель — offering price. Стоп — выше pre-announcement high.\n\nSMB Capital учит: лучшие оферинг-плеи это когда акция торгуется на 20-50% выше offering price. Большая разница = больше потенциал падения.	80	\N	\N	SMB Capital, Offering, Short, Dilution, ATM	2026-04-09 19:57:44.533356+00	SMB Capital — Offering Plays	\N	\N	\N	\N
31	Gap and Go — Earnings Momentum	Earnings Gap Up	1. Акция гэпает +5% и выше на отчёте о прибылях\n2. EPS и Revenue BEAT — не только один показатель\n3. Pre-market объём > 300k акций\n4. Гэп держится первые 5-15 минут после открытия\n5. Акция торгуется ВЫШЕ pre-market high на открытии	- EPS beat?\n- Revenue beat?\n- Guidance raised или maintained?\n- Pre-market объём > 300k?\n- Акция в uptrend до отчёта?\n- Нет dilution / вторичного размещения?\n- Гэп выше ключевого уровня resistance?	СУТЬ SMB Capital Gap and Go: Сильный гэп на earnings = институциональный спрос. Ждём первых 5 минут. Если акция держится выше открытия = лонг на первом откате к VWAP или к 5-minute high.\n\nЛУЧШИЙ СЦЕНАРИЙ: Акция делает новый high после первой консолидации.\nХУДШИЙ СЦЕНАРИЙ: Гэп закрывается в первые 30 минут — выходим.	75	\N	\N	SMB Capital, Gap, Earnings, Long, Momentum	2026-04-09 19:57:44.886682+00	SMB Capital — Gap Plays	\N	\N	\N	\N
32	IPO Day Trade — First Day Play	IPO Day Trade	1. Первый день торгов акции после IPO\n2. Акция открылась выше IPO price (bullish open)\n3. Высокий интерес: pre-IPO hype, известные андеррайтеры\n4. Float маленький (до 20M акций в обороте в первый день)\n5. Lockup до 180 дней — инсайдеры не могут продавать	- Известные андеррайтеры (Goldman, Morgan Stanley)?\n- Хороший sector (tech, biotech, fintech)?\n- Акция открылась выше IPO price?\n- Float первого дня маленький?\n- Нет сразу медведей — акция держится?\n- Есть ли хайп в соцсетях / медиа?	SMB Capital IPO Day Trading: В первый день IPO — огромный потенциал движения потому что нет исторических уровней поддержки/сопротивления.\n\nСТРАТЕГИЯ: Покупать при первом откате к открытию или к VWAP первого дня. Не гнаться за ценой на открытии.\n\nВАЖНО: IPO plays очень волатильны — размер позиции уменьшить в 2 раза от обычного.	60	\N	\N	SMB Capital, IPO, Long, First Day, Momentum	2026-04-09 19:57:45.065503+00	SMB Capital — IPO Plays	\N	\N	\N	\N
33	Second Day Play — Momentum Continuation	Second Day Play	1. Вчера была сильная дневная свечка с объёмом (день 1)\n2. Pre-market гэп или удержание вчерашних gains\n3. Объём Day 2 pre-market > 50% от Day 1 объёма\n4. Акция удерживается выше вчерашнего close в pre-market\n5. Нет новых негативных новостей	- Day 1 был с strong volume и close в топе дня?\n- Pre-market Day 2 держит уровень?\n- Отсутствие негативных новостей?\n- Сектор всё ещё bullish?\n- Relative strength к SPY?	SMB Capital Second Day Play: Акции с сильным первым днём часто продолжают движение на второй день — особенно если overnight держат уровни.\n\nЛУЧШИЙ ВХОД: Открытие > вчерашний High или первый откат к VWAP на Day 2.\nЦЕЛЬ: Расширение на 0.5-2R от вчерашнего range.\n\nРИСКИ: Если открытие слабое или гэп вниз — сетап отменяется.	70	\N	\N	SMB Capital, Second Day, Momentum, Long, Continuation	2026-04-09 19:57:45.271694+00	SMB Capital — Gap Plays	\N	\N	\N	\N
34	VWAP Trend Trade — Intraday	Intraday Momentum	1. Акция в чётком intraday тренде (выше или ниже VWAP)\n2. Откат к VWAP на низком объёме\n3. На VWAP появляется покупательная активность (bid stacking / tape reading)\n4. Относительная сила к SPY сохраняется\n5. Первый час торгов — лучшее время	- Есть ли чёткий intraday тренд выше VWAP?\n- Откат на низком объёме (признак нет продавцов)?\n- Tape показывает покупателей на VWAP?\n- SPY не против вас (trend alignment)?\n- Уровень VWAP совпадает с другим ключевым уровнем (pre-market high, round number)?	СУТЬ: VWAP — самый важный intraday уровень. Институции торгуют через VWAP. Акция выше VWAP = bullish bias, ниже = bearish.\n\nСТРАТЕГИЯ SMB: Ждём отката к VWAP, видим что продавцов нет (low volume, bid holding), входим с tight стопом ниже VWAP.\n\nЦЕЛЬ: Новый intraday high (или low для шорта). R/R минимум 2:1.\n\nBest time: 9:45-11:30 AM ET и 2:00-3:30 PM ET.	75	\N	\N	SMB Capital, VWAP, Intraday, Momentum, Long, Short	2026-04-09 20:04:02.791032+00	SMB Capital — Intraday Setups	\N	\N	\N	\N
35	Parabolic Short — Extended Stock	Reversal	1. Акция выросла на 30-100%+ за 1-3 дня без паузы\n2. RSI > 80, акция сильно расширена от VWAP и MA\n3. Нет нового катализатора — рост только на моментуме\n4. Объём начинает иссякать на новых хаях (volume dry up)\n5. Акция делает «throwover» — резкий spike выше предыдущего high	- Акция выросла >30% за последние 1-3 дня?\n- Объём на последних свечках снижается?\n- Нет нового катализатора поддерживающего рост?\n- Pre-market: акция уже расширена от VWAP?\n- Borrows доступны для шорта?\n- Risk/Reward позволяет tight stop?	СУТЬ: Parabolic moves не могут продолжаться вечно. Когда моментум-трейдеры фиксируют прибыль — вертикального покупателя нет, акция падает быстро.\n\nSMB Capital учит: НЕ шортить параболик на пике — нужна CONFIRMATION. Ждём:\n1. Failed new high (lower high)\n2. Strong red candle с объёмом\n3. Пробой key intraday support\n\nСТОП: Выше недавнего high. ЦЕЛЬ: VWAP, или -20-30% от пика.	65	\N	\N	SMB Capital, Short, Parabolic, Reversal, Extended	2026-04-09 20:04:02.924691+00	SMB Capital — Short Setups	\N	\N	\N	\N
36	Opening Range Breakout (ORB)	Breakout	1. Первые 5 или 15 минут торгов формируют чёткий range (high и low)\n2. Сильный pre-market катализатор (earnings, news)\n3. Pre-market объём высокий\n4. SPY нейтральный или в том же направлении\n5. Breakout с объёмом выше OR high (или ниже OR low для шорта)	- Есть ли чёткий катализатор для движения?\n- Pre-market объём выше среднего?\n- Opening range сформировался (5 или 15 минут)?\n- Breakout из OR идёт с объёмом 150%+ от OR average?\n- SPY не против движения?\n- R/R минимум 2:1 к ближайшему resistance?	СУТЬ: Первые минуты торгов — борьба быков и медведей. OR high/low = ключевые уровни. Пробой с объёмом = институциональное участие.\n\nSMB Capital: 5-minute ORB лучше для быстрых движений. 15-minute ORB — более надёжный, меньше фальстартов.\n\nЛУЧШИЙ СЦЕНАРИЙ: Пробой OR + ретест как поддержки + продолжение.\nПЛОХОЙ СЦЕНАРИЙ: Пробой без объёма = bull/bear trap.	72	\N	\N	SMB Capital, ORB, Opening Range, Breakout, Intraday	2026-04-09 20:04:03.0743+00	SMB Capital — Intraday Setups	\N	\N	\N	\N
37	Low Float Momentum — Float Rotation	Intraday Momentum	1. Float акции < 10M акций\n2. Сильный катализатор (FDA, partnership, contract)\n3. Pre-market рост > 50%\n4. Акция делает несколько «rotations» (up-down-up) за день\n5. Объём за день превышает float в 2-5x раз	- Float < 10M акций?\n- Катализатор серьёзный (не просто PR)?\n- Pre-market объём > 1M акций?\n- Цена акции $2-$20 (лучший диапазон для float rotation)?\n- Акция уже сделала первую rotation вниз от high?\n- VWAP держится как поддержка на pullback?	СУТЬ: Маленький float = большие движения. Когда volume превышает float в несколько раз, акция «ротируется» — делает несколько волн вверх-вниз.\n\nSMB Capital: Float rotation plays лучше торговать НЕ на первой волне (слишком опасно), а на ВТОРОЙ или ТРЕТЬЕЙ rotation — когда паттерн подтверждён.\n\nВХОД: Откат к VWAP или 9-MA на первом pullback после initial spike.\nОПАСНОСТЬ: Очень волатильно. Размер позиции уменьшить в 2-3 раза.	60	\N	\N	SMB Capital, Low Float, Momentum, Rotation, Intraday	2026-04-09 20:04:03.2242+00	SMB Capital — Intraday Setups	\N	\N	\N	\N
38	Failed Follow Through — Bear Flag Short	Reversal	1. Акция гэпает вверх на новостях\n2. Первые 15-30 минут: акция НЕ может сделать новый high\n3. Образуется bear flag / consolidation под opening high\n4. Объём падает на флаге (healthy consolidation)\n5. Пробой нижней границы флага с объёмом	- Гэп вверх на катализаторе?\n- Акция НЕ делает новый high первые 30 минут?\n- Bear flag с уменьшающимся объёмом формируется?\n- Пробой вниз с объёмом?\n- Пробой ниже VWAP?\n- Нет сильных buyers на поддержке?	СУТЬ: Gap up + нет follow through = слабость. Продавцы используют гэп для выхода. Паттерн «failed gap» = шортовый сигнал.\n\nSMB Capital: Это один из самых надёжных intraday short setups. Работает потому что те кто купили на гэпе фиксируют убытки когда видят что продолжения нет.\n\nВХОД: Пробой нижней границы bear flag. СТОП: Выше flag high. ЦЕЛЬ: Gap fill (уровень вчерашнего close).	73	\N	\N	SMB Capital, Short, Bear Flag, Failed Gap, Reversal	2026-04-09 20:04:03.39077+00	SMB Capital — Short Setups	\N	\N	\N	\N
39	Short Squeeze Play	Intraday Momentum	1. Акция с высоким short interest (> 20% float)\n2. Свежий позитивный катализатор\n3. Акция начинает двигаться против шортистов\n4. Объём аномально высокий\n5. Borrows становятся дефицитными (hard to borrow)	- Short interest > 20% float?\n- Есть ли реальный катализатор (не только хайп)?\n- Акция пробивает ключевые resistance уровни?\n- Объём кратно превышает средний?\n- Finviz/Ortex показывает рост short interest?\n- Days to cover > 3?	СУТЬ: Когда шортисты вынуждены откупать позиции — создаётся каскадный эффект роста. Squeeze может быть очень резким (+50-200%).\n\nSMB Capital предупреждает: Short squeeze — ОЧЕНЬ опасная стратегия для следования. Squeeze может закончиться в любой момент.\n\nЛУЧШАЯ СТРАТЕГИЯ: Торговать short squeeze LONG — на первых признаках что шортисты откупают. НЕ шортить в squeeze.\n\nВЫХОД: Как только объём падает или акция не делает new high.	55	\N	\N	SMB Capital, Short Squeeze, Long, High Short Interest, Momentum	2026-04-09 20:04:03.525985+00	SMB Capital — Momentum Setups	\N	\N	\N	\N
40	Sympathy Play — Sector Follower	Intraday Momentum	1. Акция-лидер (leader) сектора делает большое движение\n2. Родственная акция (sympathy) начинает двигаться в том же направлении\n3. Sympathy акция имеет меньший float или более низкую капитализацию\n4. Sympathy акция отстаёт от leader — есть потенциал догнать\n5. Схожий бизнес или прямая конкуренция с leader	- Leader движется на реальном катализаторе?\n- Sympathy акция связана с leader (same sector, competitor)?\n- Sympathy акция ещё не сделала эквивалентного движения?\n- Float sympathy акции меньше или сопоставим?\n- Объём sympathy растёт?\n- Нет негативных специфических новостей для sympathy?	СУТЬ: Когда один игрок в секторе получает хорошие новости — весь сектор может вырасти. Sympathy play = торговля «последователями».\n\nSMB Capital пример: NVDA отчитывается лучше ожиданий → AMD, INTC, MU могут вырасти на sympathy.\n\nЛУЧШИЙ МОМЕНТ: Первые 30-60 минут после движения лидера.\nРИСК: Sympathy может не двинуться если рынок не хочет.\n\nПОИСК: Scanners — находим топ моверов в секторе за день.	60	\N	\N	SMB Capital, Sympathy, Sector, Momentum, Long	2026-04-09 20:04:03.667698+00	SMB Capital — Momentum Setups	\N	\N	\N	\N
41	Halt & Resume Play	Другой	1. Акция получает regulatory halt (H1, T1, T12) или circuit breaker halt на позитивных новостях\n2. Halt происходит когда акция движется вверх\n3. После resume акция часто продолжает движение в ту же сторону\n4. Объём после resume должен быть высокий\n5. Bid-ask spread нормализуется в течение 1-2 минут	- Тип halта (regulatory = более предсказуем, чем circuit breaker)?\n- Новости были позитивными до halта?\n- Какой bid появился сразу после resume?\n- Объём на resume высокий?\n- Spread нормальный после первых 30 секунд?\n- Нет ли SEC/FINRA news (красный флаг для reverse)?\n- Акция держит bid после первой минуты resume?	СУТЬ: Регуляторный halt = пауза для обработки важных новостей. После resume рынок решает направление. Если halt был на UP move → resume чаще продолжает вверх.\n\nSMB Capital: Это один из немногих setups где можно держать позицию через хаотичное открытие. Главное — знать тип halта и ждать bid стабилизации.\n\nВАЖНО: Никогда не торгуй reverse-split halts — там обычно ловушка.\n\nВРЕМЯ ДЕРЖАНИЯ: 5-30 минут после resume. Не overnight.	65	\N	\N	SMB Capital, Halt, Resume, Catalyst, Intraday	2026-04-09 20:07:23.62071+00	SMB Capital — Intraday Setups	\N	\N	\N	\N
42	Anchored VWAP — Earnings / IPO Level	Breakout	1. Строим VWAP от даты события (earnings, IPO, offering)\n2. Anchored VWAP действует как ключевой S/R уровень\n3. Для лонга: акция держится выше A-VWAP от earnings\n4. Откат к A-VWAP на низком объёме = точка входа\n5. Работает на 1D и intraday таймфреймах	- Anchored VWAP привязан к значимому событию (earnings, IPO, gap day)?\n- Акция уважает A-VWAP (отскакивала раньше от него)?\n- Текущий откат к A-VWAP на сниженном объёме?\n- Есть ли конфлюенция (MA, horizontal level, daily VWAP)?\n- Market bias в том же направлении?	СУТЬ: Обычный VWAP сбрасывается каждый день. Anchored VWAP (A-VWAP) начинается от конкретного события и показывает среднюю цену с того момента.\n\nSMB Capital активно использует A-VWAP особенно для:\n- Post-earnings plays: A-VWAP от дня отчёта = ключевая поддержка\n- IPO plays: A-VWAP от первого дня торгов = level to watch\n- Post-offering: A-VWAP от offering date\n\nИНСТРУМЕНТЫ: TradingView → Anchored VWAP tool (нажать Ctrl+Click на дату).	70	\N	\N	SMB Capital, Anchored VWAP, Post-Earnings, IPO, Support	2026-04-09 20:07:23.757112+00	SMB Capital — Intraday Setups	\N	\N	\N	\N
43	9 EMA Daily — Swing Entry на Trend	Breakout	1. Акция в чётком uptrend на дневном графике\n2. Каждый откат останавливается на 9 EMA (exponential MA)\n3. Текущий откат к 9 EMA на снижающемся объёме\n4. Дневная свечка на 9 EMA = bullish (hammer, doji, engulfing)\n5. SPY в uptrend или нейтральный	- Акция выше 9 EMA на дневном графике?\n- 9 EMA направлена вверх?\n- Объём на откате к 9 EMA ниже среднего?\n- Дневная свечка на EMA показывает bullish reversal?\n- Нет надвигающегося негативного катализатора?\n- Earnings не на этой неделе?\n- R/R минимум 3:1?	СУТЬ: SMB Capital (Bella) активно использует 9 EMA на дневном графике как ключевой уровень для swing trades. Сильные акции «уважают» 9 EMA на откатах.\n\nПАРАМЕТРЫ: EMA(9) на Daily timeframe.\n\nВХОД: Покупка на закрытии дня когда цена касается 9 EMA с bullish candle.\nАЛЬТЕРНАТИВА: Вход внутри дня когда цена тестирует 9 EMA уровень.\nСТОП: Ниже 9 EMA или ниже дневного low свечки входа.\nЦЕЛЬ: Предыдущий high или расширение тренда.	74	\N	\N	SMB Capital, 9 EMA, Daily, Swing, Trend, Bella	2026-04-09 20:07:23.894573+00	SMB Capital — Swing Setups	\N	\N	\N	\N
44	Dead Cat Bounce — Short the Recovery	Reversal	1. Акция упала на -20-50%+ за 1-2 дня на плохих новостях\n2. После большого падения идёт техническое восстановление (bounce 10-30%)\n3. Bounce происходит на снижающемся объёме\n4. Акция не может пробить ключевые resistance (VWAP, 9 EMA, pre-drop levels)\n5. Fundamentals по-прежнему плохие — нет реального fix	- Падение было на реальном негативном катализаторе (не просто технический)?\n- Bounce происходит без нового позитива?\n- Объём на bounce ниже объёма на падении?\n- Акция останавливается у чёткого resistance?\n- Short borrows доступны?\n- Нет buyback / insider buying announcement?	СУТЬ: После катастрофического падения always-a-bounce. Это паника-sellers фиксируют прибыль + short covering. Но fundamentals не изменились → новые продавцы используют bounce для выхода → акция продолжает падать.\n\nSMB Capital: Ключевое — НЕ шортить на дне. Ждать bounce и шортить когда momentum восстановления иссякает.\n\nЛУЧШИЙ ВХОД: Bounce тестирует VWAP снизу и отскакивает обратно вниз.\nЦЕЛЬ: Предыдущий low или ниже. СТОП: Выше высшей точки bounce.	68	\N	\N	SMB Capital, Dead Cat Bounce, Short, Reversal, Post-Crash	2026-04-09 20:07:24.046639+00	SMB Capital — Short Setups	\N	\N	\N	\N
45	High of Day Break — Momentum Ignition	Breakout	1. Акция консолидировалась ниже High of Day (HOD) 15-60+ минут\n2. Объём во время консолидации снижается (нет продавцов)\n3. Пробой HOD с объёмом 150%+ выше среднего\n4. Акция должна быть «in play» (новость, earnings, catalyst)\n5. Пробой происходит в первые 2 часа торгов или в power hour	- Акция «in play» (есть катализатор)?\n- HOD чёткий и не менялся 15+ минут?\n- Объём консолидации ниже утреннего?\n- Пробой идёт с сильным объёмом?\n- Bid держится после пробоя (не немедленный разворот)?\n- SPY нейтральный или bullish?\n- Нет major resistance сразу над HOD?	СУТЬ: Акции «in play» часто делают несколько HOD breaks за день. Каждый пробой = новая волна покупателей (momentum chasers + алго).\n\nSMB Capital: HOD break — один из самых чистых setups. Правило: если акция делает HOD break с объёмом в первый раз за день = высокая вероятность продолжения.\n\nВХОД: На пробое HOD (market order или limit на пробое).\nСТОП: Ниже HOD (если вернулся обратно = failed break).\nЦЕЛЬ: Measured move (range × 1.0-1.5) или следующий resistance.	73	\N	\N	SMB Capital, HOD, High of Day, Breakout, Momentum, In Play	2026-04-09 20:07:24.196517+00	SMB Capital — Intraday Setups	\N	\N	\N	\N
46	News Fade — Sell/Short the News	Reversal	1. Акция выросла в ожидании события (earnings, FDA, deal)\n2. Событие происходит — результат «хороший но не отличный»\n3. Акция сначала делает spike вверх на новости, потом разворачивается\n4. Объём на развороте превышает объём на spike\n5. «Buy the rumor, sell the news» паттерн — акция уже «priced in»	- Акция выросла 20-50%+ до события в ожидании?\n- Результат хороший, но рынок не удовлетворён?\n- Начальный spike вверх на новости слабый?\n- Разворот с высоким объёмом?\n- Крупные игроки используют spike для выхода (tape: heavy selling)?\n- HOD не делает новых highs после первого spike?	СУТЬ: «Buy the rumor, sell the news» — классика. Когда ожидания уже в цене, даже хорошие новости не дают нового импульса. Смарт-мани продаёт retail которые покупают на новости.\n\nSMB Capital: News fade работает лучше всего когда:\n1. Акция уже выросла 30%+ до события\n2. Guidance не raised агрессивно\n3. Первые 15 минут после новости — слабость\n\nВАРИАНТЫ: Earnings fade, FDA approval fade, M&A announcement fade.	66	\N	\N	SMB Capital, News Fade, Sell the News, Reversal, Earnings	2026-04-09 20:07:24.353244+00	SMB Capital — Reversal Setups	\N	\N	\N	\N
47	In Play Stock Framework — Отбор акций	Другой	Акция считается "In Play" если:\n1. Выходит отчёт о прибылях (earnings)\n2. FDA approval/rejection\n3. M&A объявление (поглощение, слияние)\n4. Крупный контракт/партнёрство\n5. Offering / secondary\n6. Short squeeze потенциал\n7. Sympathy к другой In Play акции	- Есть ли конкретный dateable catalyst сегодня?\n- Объём выше среднего в pre-market?\n- Акция уже двигалась реагируя на catalyst?\n- Достаточно ли ликвидности для вашего размера позиции?\n- Bid-ask spread разумный?\n- Float подходящий для ожидаемого движения?\n- Есть ли другие «In Play» акции в том же секторе сегодня?	СУТЬ: SMB Capital строит всю торговлю вокруг концепции «In Play». Торговать нужно только акции у которых есть конкретный ПРИЧИНА двигаться сегодня.\n\nNEVER trade random stocks — только In Play.\n\nСКАНЕРЫ для поиска In Play акций:\n- Trade Ideas: Gap Up/Down scanner\n- Finviz News scanner\n- StockTwits trending\n- Pre-market movers (>5% с объёмом)\n\nSMB Правило: Если не можешь объяснить за 10 секунд ПОЧЕМУ эта акция In Play — не торгуй её.	90	\N	\N	SMB Capital, In Play, Framework, Stock Selection, Catalyst	2026-04-09 20:07:24.51032+00	SMB Capital — Frameworks	\N	\N	\N	\N
48	Power Hour Momentum — 3:00–4:00 PM	Intraday Momentum	1. Время: 3:00–4:00 PM ET (последний час торгов)\n2. Акция была «In Play» весь день и сохранила силу/слабость\n3. Институциональные ордера активны в конце дня (rebalancing)\n4. Акция пробивает ключевой уровень (VWAP, HOD, LOD) в 3:00-3:15\n5. Объём начинает расти после 3:00 PM	- Акция была In Play с утра?\n- Базовый bias (bullish/bearish) сохраняется к 3 PM?\n- Объём растёт после 3:00 PM?\n- Пробой уровня происходит в начале power hour?\n- SPY в том же направлении в power hour?\n- Нет крупного overnight риска (earnings, FDA after close)?	СУТЬ: Последний час торгов = power hour. Институции закрывают/открывают позиции перед закрытием. Mutual funds rebalancing. Это создаёт сильные направленные движения.\n\nSMB Capital: Power hour лучше всего работает когда:\n1. Акция была сильной весь день (не случайное движение)\n2. Объём accelerates после 3:00 PM\n3. Есть чёткий уровень для пробоя\n\nОПАСНОСТЬ: Не держать через закрытие если есть overnight catalyst риск (earnings after hours).	68	\N	\N	SMB Capital, Power Hour, 3PM, Momentum, End of Day	2026-04-09 20:07:24.668305+00	SMB Capital — Intraday Setups	\N	\N	\N	\N
30	Pricing Play — Long Bounce	Reversal	1. Компания уже прайсировала (pricing complete) вторичное размещение\n2. Акция упала к уровню offering price\n3. На offering price появляется покупательный спрос (support)\n4. Объём растёт когда цена держится у offering price\n5. Underwriters поддерживают цену (greenshoe/stabilization)	- Оферинг уже прайсирован (не объявлен — именно закрыт)?\n- Акция находится около offering price (±1-2%)?\n- Есть ли покупательный спрос на offering price?\n- Underwriters известные (Goldman, JPM, MS)?\n- Нет ли негативного катализатора после прайсинга?	СУТЬ: После того как оферинг прайсирован, андеррайтеры часто поддерживают цену на уровне offering price (stabilization / greenshoe option). Это создаёт временный floor.\n\nЛОНГ от offering price с tight стопом. Цель — возврат к pre-offering уровням или движение +3-8%.\n\nSMB Capital: это контр-трейд против offering play. Работает только если offering price держится как поддержка.	65	\N	\N	SMB Capital, Offering, Long, Pricing, Bounce, Reversal	2026-04-09 19:57:44.713492+00	SMB Capital — Offering Plays	\N	\N	\N	\N
28	ATM Offering Play (Short)	Другой	1. Акция сильно выросла на новостях/катализаторе (гэп +5-20%)\n2. Компания объявляет ATM (at-the-money) вторичное размещение (dilutive offering)\n3. Цена предложения находится НИЖЕ текущей цены акции\n4. Объём объявления выше среднего\n5. Компания маленькая/micro-cap — не голубая фишка	- Акция выросла на катализаторе перед объявлением оферинга?\n- Цена оферинга (offering price) известна или можно оценить?\n- Акция торгуется ВЫШЕ offering price?\n- Float маленький (лучше до 50M)?\n- Объём выше нормы?\n- Нет инсайдерских покупок / нет защиты от шорта?	Классическая стратегия SMB Capital. Компании делают оферинги чтобы привлечь капитал — это размывает акционеров. Рынок реагирует продажей. Шортим от текущей цены до уровня offering price или ниже.\n\nВАЖНО: Работает на маленьких компаниях. На больших (SPY 500) — рискованно. Лучшие входы — сразу после объявления на мощном объёме.	80	\N	\N	SMB Capital, Offering, Short, Dilution	2026-04-09 19:56:54.089025+00	SMB Capital — Offering Plays	\N	\N	2026-04-09 19:58:13.021+00	\N
\.


--
-- Data for Name: playbook_trade_ideas; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.playbook_trade_ideas (id, playbook_entry_id, ticker, side, entry_zone, target, stop, status, notes, date, created_at) FROM stdin;
\.


--
-- Data for Name: research; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.research (id, pattern_name, ticker, context, market_condition, what_worked, what_failed, repeat_count, confidence_level, screenshot_url, screenshot_notes, tags, created_at, deleted_at) FROM stdin;
1	Earnings Gap and Go - NVDA	NVDA	Post earnings gap continuation with strong volume	Bullish trend	Large gap above open, sustained momentum	Took profits too early	5	8	\N	\N	\N	2026-04-09 09:05:03.745421+00	\N
2	VWAP Reclaim - TSLA	TSLA	Stock bounces from VWAP support	Consolidation	Patient entry at VWAP, good risk reward	False bounces	3	7	\N	\N	\N	2026-04-09 09:05:03.745421+00	\N
3	Fade into Resistance - AMD	AMD	Shorting into overbought conditions	Bearish trend	Recognized resistance rejection	Lack of follow-through	2	6	\N	\N	\N	2026-04-09 09:05:03.745421+00	\N
4	Scalping Low Float - SOFI	SOFI	Quick micro moves on sub-5M float stocks	Volatile	Fast entries and exits, tight stops	Spread risk on scalps	8	6	\N	\N	\N	2026-04-09 09:05:03.745421+00	\N
5	Earnings Gap and Go - NVDA	NVDA	Post earnings gap continuation with strong volume	Bullish trend	Large gap above open, sustained momentum	Took profits too early	5	8	\N	\N	\N	2026-04-09 10:24:44.433727+00	\N
6	VWAP Reclaim - TSLA	TSLA	Stock bounces from VWAP support	Consolidation	Patient entry at VWAP, good risk reward	False bounces	3	7	\N	\N	\N	2026-04-09 10:24:44.433727+00	\N
7	Fade into Resistance - AMD	AMD	Shorting into overbought conditions	Bearish trend	Recognized resistance rejection	Lack of follow-through	2	6	\N	\N	\N	2026-04-09 10:24:44.433727+00	\N
8	Scalping Low Float - SOFI	SOFI	Quick micro moves on sub-5M float stocks	Volatile	Fast entries and exits, tight stops	Spread risk on scalps	8	6	\N	\N	\N	2026-04-09 10:24:44.433727+00	\N
\.


--
-- Data for Name: trade_reactions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.trade_reactions (id, trade_id, trader, reaction_type, created_at) FROM stdin;
\.


--
-- Data for Name: trade_reviews; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.trade_reviews (id, trade_id, curator, comment, rating, created_at) FROM stdin;
\.


--
-- Data for Name: trader_ratings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.trader_ratings (id, trader, curator, week, discipline, risk_management, execution, journaling, improvement, overall, comment, created_at) FROM stdin;
1	Закир	Антон	2026-04-07	7	6	8	5	7	7	Хорошая неделя, нужно улучшить журналирование	2026-04-09 22:25:47.475971+00
\.


--
-- Data for Name: trades; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.trades (id, ticker, date, setup, side, event_type, entry, exit, stop, result, pnl, r_multiple, hold_time, slippage, market_cap, "float", relative_volume, session, screenshot_url, notes, what_worked, what_failed, conclusion, trader, tags, event_id, pattern_id, created_at, screenshot_notes, deleted_at, playbook_id) FROM stdin;
1	NVDA	2026-04-06	Earnings Gap and Go	Long	earnings	142.5000	145.2000	140.0000	win	270.00	2.70	45min	0.10	Mega Cap	High	1.20	premarket	\N	Strong momentum after earnings beat	Entry near support, managed risk	Took profit too early	Good risk management	Закир	earnings, gap-up	\N	\N	2026-04-09 09:05:03.733616+00	\N	\N	\N
2	TSLA	2026-04-05	VWAP Reclaim	Long	momentum	180.3000	182.8000	178.5000	win	250.00	2.50	90min	0.15	Mega Cap	Medium	1.80	regular	\N	VWAP bounce played well	Patient entry at VWAP	Exited on breakeven	Smooth trade	Антон	vwap, momentum	\N	\N	2026-04-09 09:05:03.733616+00	\N	\N	\N
3	AMD	2026-04-04	Intraday Fade	Short	momentum	145.5000	143.2000	147.0000	win	230.00	2.30	60min	0.20	Large Cap	Medium	1.50	regular	\N	Sold into strength	Recognized overbought	Chased exit	Nice fade trade	Артур	fade, short	\N	\N	2026-04-09 09:05:03.733616+00	\N	\N	\N
4	MSTR	2026-04-03	HOD Failure	Short	momentum	385.0000	381.5000	388.0000	loss	-250.00	-2.50	30min	0.50	Small Cap	Medium	2.20	regular	\N	HOD rejection setup	Good setup identification	Slippage on exit	Learn from slippage	Рахматулло	hod-failure, short	\N	\N	2026-04-09 09:05:03.733616+00	\N	\N	\N
5	SOFI	2026-04-02	Scalping	Long	momentum	7.8500	7.9200	7.8000	win	70.00	2.33	5min	0.05	Micro Cap	High	3.00	regular	\N	Quick scalp on support bounce	Fast entries and exits	Size too small	Need more size	Умид	scalp, quick	\N	\N	2026-04-09 09:05:03.733616+00	\N	\N	\N
6	PLTR	2026-04-01	Chasing Entry	Long	momentum	32.1000	31.0000	33.5000	loss	-140.00	-1.40	25min	0.30	Large Cap	Low	0.80	regular	\N	Chased after momentum	Recognized mistake quickly	Over-aggressive entry	Avoid chasing	Максат	chase, mistake	\N	\N	2026-04-09 09:05:03.733616+00	\N	\N	\N
7	XLF	2026-03-31	Trading Low RVOL Set	Long	macro	42.2000	42.9500	41.5000	win	75.00	1.50	120min	0.10	Sector	Low	0.60	regular	\N	Low volume but clean setup	Patient on low volume	Limited liquidity	Good discipline	Тимур	low-rvol, macro	\N	\N	2026-04-09 09:05:03.733616+00	\N	\N	\N
8	AAPL	2026-03-30	Opening Range Breakout	Long	momentum	178.5000	181.2000	177.0000	win	270.00	1.80	35min	0.08	Mega Cap	High	1.40	regular	\N	Clean breakout above opening range	Waited for confirmation	Could have held longer	ORB works on mega caps	Закир	orb, breakout	\N	\N	2026-04-09 09:05:03.733616+00	\N	\N	\N
9	META	2026-03-29	Earnings Gap Down Short	Short	earnings	520.0000	512.5000	525.0000	win	750.00	1.50	20min	0.25	Mega Cap	High	2.10	premarket	\N	Weak guidance drove gap down	Short into first bounce	Covered too early	Earnings gaps down are reliable shorts	Антон	earnings, gap-down, short	\N	\N	2026-04-09 09:05:03.733616+00	\N	\N	\N
10	COIN	2026-03-28	Second Day Play	Long	momentum	132.4000	138.9000	130.0000	win	650.00	2.71	180min	0.15	Large Cap	Medium	2.50	regular	\N	Follow through from day 1 runner	Waited for pullback entry	Nothing major	Second day plays can be powerful	Артур	second-day, runner	\N	\N	2026-04-09 09:05:03.733616+00	\N	\N	\N
11	RIOT	2026-03-27	Breakout Failure	Short	momentum	17.8000	18.5000	18.2000	loss	-350.00	-1.75	15min	0.10	Small Cap	Low	3.50	regular	\N	Tried to short failed breakout but it reclaimed	Spotted the pattern	BTC spike caused squeeze	Dont short crypto names against BTC trend	Рахматулло	breakout-fail, crypto	\N	\N	2026-04-09 09:05:03.733616+00	\N	\N	\N
12	SPY	2026-03-26	Gap Fill Long	Long	macro	512.3000	514.8000	511.0000	win	250.00	1.92	60min	0.05	Index	High	1.10	regular	\N	Gap fill setup on SPY after overnight weakness	Patient fill level entry	Small size	Gap fills on indices are high probability	Умид	gap-fill, index	\N	\N	2026-04-09 09:05:03.733616+00	\N	\N	\N
13	SMCI	2026-03-25	Parabolic Short	Short	momentum	890.0000	865.0000	910.0000	win	2500.00	1.25	45min	1.50	Large Cap	Low	4.20	regular	\N	Parabolic move into resistance, shorted the crack	Waited for the turn confirmation	High slippage on entry	Parabolic shorts need patience	Максат	parabolic, short	\N	\N	2026-04-09 09:05:03.733616+00	\N	\N	\N
14	AVGO	2026-03-24	Earnings Drift	Long	earnings	148.2000	152.0000	146.0000	win	380.00	1.73	240min	0.12	Mega Cap	High	1.60	regular	\N	Post-earnings drift continuation	Bought the pullback after gap	Exited before close	Earnings drift is real on quality names	Тимур	earnings, drift	\N	\N	2026-04-09 09:05:03.733616+00	\N	\N	\N
15	MSFT	2026-03-23	Range Breakout	Long	momentum	415.0000	418.5000	413.0000	win	350.00	1.75	55min	0.10	Mega Cap	High	1.30	regular	\N	Multi-day range breakout with volume	Clean level, good volume	Should have added on confirmation	Range breakouts on mega caps are clean	Закир	range, breakout	\N	\N	2026-04-09 09:05:03.733616+00	\N	\N	\N
16	BABA	2026-03-22	Reversal Long	Long	news	88.5000	85.2000	86.0000	loss	-330.00	-1.32	40min	0.20	Large Cap	High	2.00	regular	\N	Tried reversal on China news but follow through failed	Good level identification	News flow turned negative	Avoid reversal trades on ongoing news	Антон	reversal, china	\N	\N	2026-04-09 09:05:03.733616+00	\N	\N	\N
17	ROKU	2026-03-21	Intraday Momentum	Long	momentum	72.3000	75.8000	71.0000	win	350.00	2.69	90min	0.08	Mid Cap	Medium	2.80	regular	\N	Strong intraday momentum with sector rotation	Added on pullback, good R:R	Initial entry was late	Momentum with sector support is powerful	Артур	momentum, sector	\N	\N	2026-04-09 09:05:03.733616+00	\N	\N	\N
18	DIS	2026-03-20	Earnings Gap and Go	Long	earnings	118.4000	121.0000	117.0000	win	260.00	1.86	30min	0.10	Large Cap	High	2.20	premarket	\N	Strong earnings beat with Disney+ subscriber growth	Pre-market entry, held through open	Took partial too soon	Earnings gap and go reliable on large caps	Рахматулло	earnings, gap-up	\N	\N	2026-04-09 09:05:03.733616+00	\N	\N	\N
19	NFLX	2026-03-19	VWAP Rejection Short	Short	momentum	625.0000	619.5000	628.0000	win	550.00	1.83	50min	0.30	Mega Cap	High	1.70	regular	\N	Failed VWAP reclaim led to sharp selloff	Shorted the rejection candle	Could have held for full move	VWAP rejections are strong short signals	Умид	vwap, short	\N	\N	2026-04-09 09:05:03.733616+00	\N	\N	\N
20	GME	2026-03-18	Low Float Runner	Long	short_squeeze	28.5000	24.0000	26.0000	loss	-450.00	-1.80	10min	0.50	Mid Cap	Low	5.00	regular	\N	Tried to catch squeeze but halted and dumped	Spotted the setup early	Halt risk not managed	Low float runners carry halt risk	Максат	squeeze, halt-risk	\N	\N	2026-04-09 09:05:03.733616+00	\N	\N	\N
21	TEST	2026-01-01	Test	Long	\N	\N	\N	\N	win	100.00	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	Test	test	\N	\N	2026-04-09 10:02:02.12631+00	\N	2026-04-09 10:02:20.117+00	\N
22	NVDA	2026-04-06	Earnings Gap and Go	Long	earnings	142.5000	145.2000	140.0000	win	270.00	2.70	45min	0.10	Mega Cap	High	1.20	premarket	\N	Strong momentum after earnings beat	Entry near support, managed risk	Took profit too early	Good risk management	Закир	earnings, gap-up	\N	\N	2026-04-09 10:24:44.420261+00	\N	\N	\N
23	TSLA	2026-04-05	VWAP Reclaim	Long	momentum	180.3000	182.8000	178.5000	win	250.00	2.50	90min	0.15	Mega Cap	Medium	1.80	regular	\N	VWAP bounce played well	Patient entry at VWAP	Exited on breakeven	Smooth trade	Антон	vwap, momentum	\N	\N	2026-04-09 10:24:44.420261+00	\N	\N	\N
24	AMD	2026-04-04	Intraday Fade	Short	momentum	145.5000	143.2000	147.0000	win	230.00	2.30	60min	0.20	Large Cap	Medium	1.50	regular	\N	Sold into strength	Recognized overbought	Chased exit	Nice fade trade	Артур	fade, short	\N	\N	2026-04-09 10:24:44.420261+00	\N	\N	\N
25	MSTR	2026-04-03	HOD Failure	Short	momentum	385.0000	381.5000	388.0000	loss	-250.00	-2.50	30min	0.50	Small Cap	Medium	2.20	regular	\N	HOD rejection setup	Good setup identification	Slippage on exit	Learn from slippage	Рахматулло	hod-failure, short	\N	\N	2026-04-09 10:24:44.420261+00	\N	\N	\N
26	SOFI	2026-04-02	Scalping	Long	momentum	7.8500	7.9200	7.8000	win	70.00	2.33	5min	0.05	Micro Cap	High	3.00	regular	\N	Quick scalp on support bounce	Fast entries and exits	Size too small	Need more size	Умид	scalp, quick	\N	\N	2026-04-09 10:24:44.420261+00	\N	\N	\N
27	PLTR	2026-04-01	Chasing Entry	Long	momentum	32.1000	31.0000	33.5000	loss	-140.00	-1.40	25min	0.30	Large Cap	Low	0.80	regular	\N	Chased after momentum	Recognized mistake quickly	Over-aggressive entry	Avoid chasing	Максат	chase, mistake	\N	\N	2026-04-09 10:24:44.420261+00	\N	\N	\N
28	XLF	2026-03-31	Trading Low RVOL Set	Long	macro	42.2000	42.9500	41.5000	win	75.00	1.50	120min	0.10	Sector	Low	0.60	regular	\N	Low volume but clean setup	Patient on low volume	Limited liquidity	Good discipline	Тимур	low-rvol, macro	\N	\N	2026-04-09 10:24:44.420261+00	\N	\N	\N
29	AAPL	2026-03-30	Opening Range Breakout	Long	momentum	178.5000	181.2000	177.0000	win	270.00	1.80	35min	0.08	Mega Cap	High	1.40	regular	\N	Clean breakout above opening range	Waited for confirmation	Could have held longer	ORB works on mega caps	Закир	orb, breakout	\N	\N	2026-04-09 10:24:44.420261+00	\N	\N	\N
30	META	2026-03-29	Earnings Gap Down Short	Short	earnings	520.0000	512.5000	525.0000	win	750.00	1.50	20min	0.25	Mega Cap	High	2.10	premarket	\N	Weak guidance drove gap down	Short into first bounce	Covered too early	Earnings gaps down are reliable shorts	Антон	earnings, gap-down, short	\N	\N	2026-04-09 10:24:44.420261+00	\N	\N	\N
31	COIN	2026-03-28	Second Day Play	Long	momentum	132.4000	138.9000	130.0000	win	650.00	2.71	180min	0.15	Large Cap	Medium	2.50	regular	\N	Follow through from day 1 runner	Waited for pullback entry	Nothing major	Second day plays can be powerful	Артур	second-day, runner	\N	\N	2026-04-09 10:24:44.420261+00	\N	\N	\N
32	RIOT	2026-03-27	Breakout Failure	Short	momentum	17.8000	18.5000	18.2000	loss	-350.00	-1.75	15min	0.10	Small Cap	Low	3.50	regular	\N	Tried to short failed breakout but it reclaimed	Spotted the pattern	BTC spike caused squeeze	Dont short crypto names against BTC trend	Рахматулло	breakout-fail, crypto	\N	\N	2026-04-09 10:24:44.420261+00	\N	\N	\N
33	SPY	2026-03-26	Gap Fill Long	Long	macro	512.3000	514.8000	511.0000	win	250.00	1.92	60min	0.05	Index	High	1.10	regular	\N	Gap fill setup on SPY after overnight weakness	Patient fill level entry	Small size	Gap fills on indices are high probability	Умид	gap-fill, index	\N	\N	2026-04-09 10:24:44.420261+00	\N	\N	\N
34	SMCI	2026-03-25	Parabolic Short	Short	momentum	890.0000	865.0000	910.0000	win	2500.00	1.25	45min	1.50	Large Cap	Low	4.20	regular	\N	Parabolic move into resistance, shorted the crack	Waited for the turn confirmation	High slippage on entry	Parabolic shorts need patience	Максат	parabolic, short	\N	\N	2026-04-09 10:24:44.420261+00	\N	\N	\N
35	AVGO	2026-03-24	Earnings Drift	Long	earnings	148.2000	152.0000	146.0000	win	380.00	1.73	240min	0.12	Mega Cap	High	1.60	regular	\N	Post-earnings drift continuation	Bought the pullback after gap	Exited before close	Earnings drift is real on quality names	Тимур	earnings, drift	\N	\N	2026-04-09 10:24:44.420261+00	\N	\N	\N
36	MSFT	2026-03-23	Range Breakout	Long	momentum	415.0000	418.5000	413.0000	win	350.00	1.75	55min	0.10	Mega Cap	High	1.30	regular	\N	Multi-day range breakout with volume	Clean level, good volume	Should have added on confirmation	Range breakouts on mega caps are clean	Закир	range, breakout	\N	\N	2026-04-09 10:24:44.420261+00	\N	\N	\N
37	BABA	2026-03-22	Reversal Long	Long	news	88.5000	85.2000	86.0000	loss	-330.00	-1.32	40min	0.20	Large Cap	High	2.00	regular	\N	Tried reversal on China news but follow through failed	Good level identification	News flow turned negative	Avoid reversal trades on ongoing news	Антон	reversal, china	\N	\N	2026-04-09 10:24:44.420261+00	\N	\N	\N
38	ROKU	2026-03-21	Intraday Momentum	Long	momentum	72.3000	75.8000	71.0000	win	350.00	2.69	90min	0.08	Mid Cap	Medium	2.80	regular	\N	Strong intraday momentum with sector rotation	Added on pullback, good R:R	Initial entry was late	Momentum with sector support is powerful	Артур	momentum, sector	\N	\N	2026-04-09 10:24:44.420261+00	\N	\N	\N
39	DIS	2026-03-20	Earnings Gap and Go	Long	earnings	118.4000	121.0000	117.0000	win	260.00	1.86	30min	0.10	Large Cap	High	2.20	premarket	\N	Strong earnings beat with Disney+ subscriber growth	Pre-market entry, held through open	Took partial too soon	Earnings gap and go reliable on large caps	Рахматулло	earnings, gap-up	\N	\N	2026-04-09 10:24:44.420261+00	\N	\N	\N
40	NFLX	2026-03-19	VWAP Rejection Short	Short	momentum	625.0000	619.5000	628.0000	win	550.00	1.83	50min	0.30	Mega Cap	High	1.70	regular	\N	Failed VWAP reclaim led to sharp selloff	Shorted the rejection candle	Could have held for full move	VWAP rejections are strong short signals	Умид	vwap, short	\N	\N	2026-04-09 10:24:44.420261+00	\N	\N	\N
41	GME	2026-03-18	Low Float Runner	Long	short_squeeze	28.5000	24.0000	26.0000	loss	-450.00	-1.80	10min	0.50	Mid Cap	Low	5.00	regular	\N	Tried to catch squeeze but halted and dumped	Spotted the setup early	Halt risk not managed	Low float runners carry halt risk	Максат	squeeze, halt-risk	\N	\N	2026-04-09 10:24:44.420261+00	\N	\N	\N
44	SMCI	2024-02-06	Earnings Gap Up	Long	earnings	624.0000	720.0000	598.0000	win	9600.00	3.70	3h	\N	Mid Cap	54M	8.50	regular	\N	SMCI pre-announced strong earnings. Massive gap up. Buy the first 15-min breakout above opening range. Target multiple of gap.	Low float, high RVOL, clean opening range breakout, momentum sustained all day		Low float earnings gap ups can run 3-5x the gap — size accordingly	SMB_Example	earnings,gap-up,low-float,high-rvol,smci	\N	\N	2026-04-09 10:44:43.632295+00	\N	\N	16
45	AMD	2024-10-30	Earnings Gap Down Short	Short	earnings	149.5000	141.2000	154.0000	win	830.00	1.80	90 min	\N	Large Cap	16.2B	3.80	regular	\N	AMD missed on data center revenue guidance. Gapped down -10% pre-market. Short the failed bounce — wait for price to rally toward VWAP, reject, then short the break of LOD.	Clear failed bounce at declining VWAP, sellers absorbed every rally	Covered too early — stock continued lower	Failed bounce short after earnings miss — high probability setup when broader market weak	SMB_Example	earnings,short,gap-down,failed-bounce,amd	\N	\N	2026-04-09 10:44:44.138278+00	\N	\N	15
46	RDDT	2024-03-22	Second Day Play	Long	other	59.5000	71.8000	55.0000	win	1230.00	2.70	full day	\N	Small Cap	95M	12.00	regular	\N	RDDT IPO day 1 was massive. Second day play — stock consolidates overnight, buy the open of day 2 above prior day HOD. Continuation of momentum.	Clean gap and go on day 2, low float, IPO hype continued, volume massive		IPO second day plays are high probability when day 1 closes at HOD with massive volume	SMB_Example	ipo,second-day,low-float,rddt	\N	\N	2026-04-09 10:44:44.616672+00	\N	\N	14
47	SMCI	2024-02-07	Second Day Play	Long	earnings	689.0000	760.0000	665.0000	win	7100.00	2.90	2h	\N	Mid Cap	54M	5.20	regular	\N	Day 2 of SMCI earnings move. Stock consolidated prior day gains in first 15 min then broke out again. Classic second day continuation.	Prior day closed at HOD, overnight consolidation tight, buyers still in control		When day 1 earnings gap closes at HOD, the second day often offers continuation	SMB_Example	second-day,earnings,continuation,smci	\N	\N	2026-04-09 10:44:45.127883+00	\N	\N	14
52	NVDA	2024-02-22	Opening Drive	Long	earnings	674.0000	739.0000	658.0000	win	6500.00	4.10	full day	\N	Large Cap	24.4B	6.80	regular	\N	NVDA massive earnings beat. Opening drive setup — gap up, first 5 min extremely strong, no significant pullback below VWAP all session. Hold with trailing stop.	Monster volume, trend day up, every dip bought, VWAP held as support all day		True trend days require holding through normal fluctuations — keep trailing stops loose on trend days	SMB_Example	opening-drive,trend-day,earnings,nvda,hold	\N	\N	2026-04-09 10:44:47.6957+00	\N	\N	\N
42	NVDA	2024-05-23	Earnings Gap Up	Long	earnings	894.5000	925.8000	882.0000	win	3130.00	2.50	45 min	\N	Large Cap	24.4B	3.20	regular	\N	NVDA reported monster Q1 beats. Gap up over prior highs into new ATH territory. First pullback to VWAP in first 30 min offered ideal entry with defined risk to HOD.	Clean earnings gap over major resistance, first pullback respected VWAP, volume confirming		Textbook SMB Earnings Gap Up — first red bar after gap held as entry signal	SMB_Example	earnings,gap-up,nvda,atl,vwap	\N	\N	2026-04-09 10:44:42.630995+00	\N	\N	16
43	META	2024-02-02	Earnings Gap Up	Long	earnings	471.0000	503.0000	460.0000	win	3200.00	2.90	2h 15min	\N	Large Cap	25.6B	4.10	regular	\N	META massive earnings beat. Gapped up 20%+ overnight. Opening drive setup — wait for first 5-min bar to close and buy the first pullback above VWAP.	Strong relative volume, clean tape, gap over all-time highs, buyers in control all day	Missed larger move by exiting too early	Primary entry on first 5-min consolidation above VWAP, trail stop under each higher low	SMB_Example	earnings,gap-up,meta,large-cap	\N	\N	2026-04-09 10:44:43.109846+00	\N	\N	16
48	TSLA	2024-07-23	VWAP Reclaim	Long	earnings	248.0000	261.0000	242.0000	win	1300.00	2.20	1h 30min	\N	Large Cap	3.2B	2.80	regular	\N	TSLA gapped up on earnings but sold off in first 30 min below VWAP. Waited for reclaim of VWAP with volume. Buy the reclaim, stop under VWAP.	Clean VWAP reclaim with volume surge, dip buyers stepped in strong		VWAP reclaim after gap up earnings selloff — buy when price closes back above VWAP with volume	SMB_Example	vwap,reclaim,earnings,tsla,mean-reversion	\N	\N	2026-04-09 10:44:45.634208+00	\N	\N	12
49	CRWD	2024-11-27	Red to Green Move	Long	earnings	364.0000	393.0000	358.0000	win	2900.00	4.80	2h	\N	Large Cap	248M	5.50	regular	\N	CRWD beat earnings but initially sold off (opened red). Classic red-to-green setup — when stock goes positive on the day after being red, buy the break of prior day close. Massive move.	Red to green with volume, market in uptrend, sector leader		Red-to-green on earnings day is one of the highest probability setups — institutional buying	SMB_Example	red-to-green,earnings,crwd,momentum	\N	\N	2026-04-09 10:44:46.153774+00	\N	\N	11
50	GME	2024-05-14	Parabolic Short	Short	other	48.5000	32.0000	55.0000	win	1650.00	2.50	3 days	\N	Small Cap	305M	25.00	regular	\N	GME went parabolic on Roaring Kitty tweet. Short when stock shows first signs of reversal — lower high, heavy volume exhaustion candle, break of prior swing low.	Clear blow-off top candle pattern, volume climax, stock lost key support levels	Required wide stop — not for small accounts	Parabolic shorts require patience — wait for confirmed reversal signal, not just being overbought	SMB_Example	parabolic,short,gme,blow-off-top,momentum-short	\N	\N	2026-04-09 10:44:46.662218+00	\N	\N	10
51	SHOP	2024-02-14	Flag Pattern Breakout	Long	earnings	89.2000	98.5000	85.5000	win	930.00	2.50	4h	\N	Large Cap	1.3B	3.40	regular	\N	SHOP earnings beat, gapped up, formed tight 30-min flag consolidation then broke out to new HOD. Classic bull flag on earnings.	Tight flag consolidation, clean breakout level, earnings catalyst		Bull flags on earnings gap-ups are high probability — buy the breakout, stop under flag low	SMB_Example	flag,breakout,earnings,shop	\N	\N	2026-04-09 10:44:47.16931+00	\N	\N	8
54	NVDA	2024-02-22	Opening Drive	Long	earnings	674.0000	739.0000	658.0000	win	6500.00	4.10	390 min	\N	Large Cap	24.4B	6.80	regular	\N	NVDA massive earnings beat. Opening drive setup — gap up, first 5 min extremely strong, no significant pullback below VWAP all session. Hold with trailing stop.	Monster volume, trend day up, every dip bought	\N	True trend days require holding through fluctuations — trail stops loosely	SMB_Example	opening-drive,trend-day,earnings,nvda	\N	\N	2026-04-09 10:45:13.102637+00	\N	\N	13
53	ROKU	2024-02-15	Weak Open Short	Short	earnings	78.5000	71.0000	83.0000	win	750.00	1.70	1h	\N	Mid Cap	138M	4.20	regular	\N	ROKU gapped up on earnings but immediately showed weakness. Short the gap fail — when earnings gap up fails to hold and trades back to prior close.	Failed gap hold, clear distribution	\N	When gap up stock cannot hold above prior close in first 30 min, it often reverses completely	SMB_Example	gap-fail,short,earnings,roku	\N	\N	2026-04-09 10:45:12.95208+00	\N	\N	9
\.


--
-- Data for Name: trading_errors; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.trading_errors (id, trader, error_type, description, ticker, trade_id, severity, lesson, resolved, created_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, name, password, role, active, created_at) FROM stdin;
1	Закир	0101	trader	t	2026-04-09 22:35:24.985479+00
2	Антон	61725	curator	t	2026-04-09 22:35:24.988092+00
3	Артур	93547	trader	t	2026-04-09 22:35:24.990778+00
4	Рахматулло	5555	trader	t	2026-04-09 22:35:24.993131+00
5	Умид	15964	trader	t	2026-04-09 22:35:24.995148+00
6	Максат	82374	trader	t	2026-04-09 22:35:24.997917+00
7	Тимур	39156	curator	t	2026-04-09 22:35:24.99996+00
8	Ариф	07770	curator	t	2026-04-09 22:35:25.002303+00
\.


--
-- Data for Name: watchlist; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.watchlist (id, ticker, catalyst, target_price, stop_price, status, notes, sector, tags, screenshot_url, created_at, deleted_at) FROM stdin;
1	MSTR	Bitcoin movement, May earnings	450.0000	370.0000	Active	Watch for BTC correlation and capitulation dips for entries	\N	\N	\N	2026-04-09 09:05:03.761312+00	\N
2	COIN	Crypto adoption news, macro developments	145.0000	120.0000	Active	Strong earnings surprise potential, SEC clarity	\N	\N	\N	2026-04-09 09:05:03.761312+00	\N
3	RIOT	Bitcoin miner performance, hash rate growth	18.5000	15.0000	Active	Setup for scalping on BTC moves, high RVOL	\N	\N	\N	2026-04-09 09:05:03.761312+00	\N
4	AVGO	AI server demand, earnings next month	155.0000	130.0000	Active	Semiconductor strength indicator, supply chain check	\N	\N	\N	2026-04-09 09:05:03.761312+00	\N
5	MSTR	Bitcoin movement, May earnings	450.0000	370.0000	Active	Watch for BTC correlation and capitulation dips for entries	\N	\N	\N	2026-04-09 10:24:44.446561+00	\N
6	COIN	Crypto adoption news, macro developments	145.0000	120.0000	Active	Strong earnings surprise potential, SEC clarity	\N	\N	\N	2026-04-09 10:24:44.446561+00	\N
7	RIOT	Bitcoin miner performance, hash rate growth	18.5000	15.0000	Active	Setup for scalping on BTC moves, high RVOL	\N	\N	\N	2026-04-09 10:24:44.446561+00	\N
8	AVGO	AI server demand, earnings next month	155.0000	130.0000	Active	Semiconductor strength indicator, supply chain check	\N	\N	\N	2026-04-09 10:24:44.446561+00	\N
\.


--
-- Name: activity_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.activity_log_id_seq', 14, true);


--
-- Name: big7_catalysts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.big7_catalysts_id_seq', 1, false);


--
-- Name: big7_levels_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.big7_levels_id_seq', 1, true);


--
-- Name: comments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.comments_id_seq', 1, false);


--
-- Name: daily_feed_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.daily_feed_id_seq', 9, true);


--
-- Name: discussions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.discussions_id_seq', 10, true);


--
-- Name: market_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.market_events_id_seq', 11, true);


--
-- Name: playbook_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.playbook_id_seq', 48, true);


--
-- Name: playbook_trade_ideas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.playbook_trade_ideas_id_seq', 1, false);


--
-- Name: research_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.research_id_seq', 8, true);


--
-- Name: trade_reactions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.trade_reactions_id_seq', 1, false);


--
-- Name: trade_reviews_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.trade_reviews_id_seq', 1, false);


--
-- Name: trader_ratings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.trader_ratings_id_seq', 1, true);


--
-- Name: trades_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.trades_id_seq', 54, true);


--
-- Name: trading_errors_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.trading_errors_id_seq', 1, false);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_id_seq', 8, true);


--
-- Name: watchlist_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.watchlist_id_seq', 8, true);


--
-- Name: activity_log activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);


--
-- Name: big7_catalysts big7_catalysts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.big7_catalysts
    ADD CONSTRAINT big7_catalysts_pkey PRIMARY KEY (id);


--
-- Name: big7_levels big7_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.big7_levels
    ADD CONSTRAINT big7_levels_pkey PRIMARY KEY (id);


--
-- Name: comments comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);


--
-- Name: daily_feed daily_feed_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_feed
    ADD CONSTRAINT daily_feed_pkey PRIMARY KEY (id);


--
-- Name: discussions discussions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussions
    ADD CONSTRAINT discussions_pkey PRIMARY KEY (id);


--
-- Name: market_events market_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_events
    ADD CONSTRAINT market_events_pkey PRIMARY KEY (id);


--
-- Name: playbook playbook_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbook
    ADD CONSTRAINT playbook_pkey PRIMARY KEY (id);


--
-- Name: playbook_trade_ideas playbook_trade_ideas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbook_trade_ideas
    ADD CONSTRAINT playbook_trade_ideas_pkey PRIMARY KEY (id);


--
-- Name: research research_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research
    ADD CONSTRAINT research_pkey PRIMARY KEY (id);


--
-- Name: trade_reactions trade_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_reactions
    ADD CONSTRAINT trade_reactions_pkey PRIMARY KEY (id);


--
-- Name: trade_reviews trade_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_reviews
    ADD CONSTRAINT trade_reviews_pkey PRIMARY KEY (id);


--
-- Name: trader_ratings trader_ratings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trader_ratings
    ADD CONSTRAINT trader_ratings_pkey PRIMARY KEY (id);


--
-- Name: trades trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_pkey PRIMARY KEY (id);


--
-- Name: trading_errors trading_errors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trading_errors
    ADD CONSTRAINT trading_errors_pkey PRIMARY KEY (id);


--
-- Name: users users_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_name_key UNIQUE (name);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: watchlist watchlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlist
    ADD CONSTRAINT watchlist_pkey PRIMARY KEY (id);


--
-- Name: activity_log_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activity_log_created_at_idx ON public.activity_log USING btree (created_at);


--
-- Name: activity_log_trader_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activity_log_trader_idx ON public.activity_log USING btree (trader);


--
-- Name: big7_catalysts_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX big7_catalysts_date_idx ON public.big7_catalysts USING btree (date);


--
-- Name: big7_catalysts_ticker_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX big7_catalysts_ticker_idx ON public.big7_catalysts USING btree (ticker);


--
-- Name: big7_levels_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX big7_levels_created_at_idx ON public.big7_levels USING btree (created_at);


--
-- Name: big7_levels_ticker_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX big7_levels_ticker_idx ON public.big7_levels USING btree (ticker);


--
-- Name: comments_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comments_created_at_idx ON public.comments USING btree (created_at);


--
-- Name: comments_discussion_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comments_discussion_id_idx ON public.comments USING btree (discussion_id);


--
-- Name: comments_trader_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comments_trader_idx ON public.comments USING btree (trader);


--
-- Name: daily_feed_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX daily_feed_created_at_idx ON public.daily_feed USING btree (created_at);


--
-- Name: daily_feed_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX daily_feed_date_idx ON public.daily_feed USING btree (date);


--
-- Name: discussions_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discussions_created_at_idx ON public.discussions USING btree (created_at);


--
-- Name: discussions_trader_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discussions_trader_idx ON public.discussions USING btree (trader);


--
-- Name: events_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_created_at_idx ON public.market_events USING btree (created_at);


--
-- Name: events_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_date_idx ON public.market_events USING btree (date);


--
-- Name: events_ticker_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_ticker_idx ON public.market_events USING btree (ticker);


--
-- Name: playbook_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX playbook_created_at_idx ON public.playbook USING btree (created_at);


--
-- Name: playbook_folder_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX playbook_folder_idx ON public.playbook USING btree (folder);


--
-- Name: research_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX research_created_at_idx ON public.research USING btree (created_at);


--
-- Name: research_ticker_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX research_ticker_idx ON public.research USING btree (ticker);


--
-- Name: trade_reactions_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trade_reactions_created_at_idx ON public.trade_reactions USING btree (created_at);


--
-- Name: trade_reactions_trade_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trade_reactions_trade_id_idx ON public.trade_reactions USING btree (trade_id);


--
-- Name: trade_reviews_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trade_reviews_created_at_idx ON public.trade_reviews USING btree (created_at);


--
-- Name: trade_reviews_trade_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trade_reviews_trade_id_idx ON public.trade_reviews USING btree (trade_id);


--
-- Name: trades_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trades_created_at_idx ON public.trades USING btree (created_at);


--
-- Name: trades_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trades_date_idx ON public.trades USING btree (date);


--
-- Name: trades_event_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trades_event_id_idx ON public.trades USING btree (event_id);


--
-- Name: trades_pattern_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trades_pattern_id_idx ON public.trades USING btree (pattern_id);


--
-- Name: trades_playbook_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trades_playbook_id_idx ON public.trades USING btree (playbook_id);


--
-- Name: trades_ticker_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trades_ticker_idx ON public.trades USING btree (ticker);


--
-- Name: trades_trader_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trades_trader_idx ON public.trades USING btree (trader);


--
-- Name: trading_errors_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trading_errors_created_at_idx ON public.trading_errors USING btree (created_at);


--
-- Name: trading_errors_trade_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trading_errors_trade_id_idx ON public.trading_errors USING btree (trade_id);


--
-- Name: trading_errors_trader_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trading_errors_trader_idx ON public.trading_errors USING btree (trader);


--
-- Name: watchlist_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX watchlist_created_at_idx ON public.watchlist USING btree (created_at);


--
-- Name: watchlist_ticker_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX watchlist_ticker_idx ON public.watchlist USING btree (ticker);


--
-- Name: comments comments_discussion_id_discussions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_discussion_id_discussions_id_fk FOREIGN KEY (discussion_id) REFERENCES public.discussions(id);


--
-- Name: playbook playbook_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbook
    ADD CONSTRAINT playbook_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.playbook(id);


--
-- Name: trade_reactions trade_reactions_trade_id_trades_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_reactions
    ADD CONSTRAINT trade_reactions_trade_id_trades_id_fk FOREIGN KEY (trade_id) REFERENCES public.trades(id);


--
-- Name: trade_reviews trade_reviews_trade_id_trades_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_reviews
    ADD CONSTRAINT trade_reviews_trade_id_trades_id_fk FOREIGN KEY (trade_id) REFERENCES public.trades(id);


--
-- Name: trades trades_event_id_market_events_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_event_id_market_events_id_fk FOREIGN KEY (event_id) REFERENCES public.market_events(id);


--
-- Name: trades trades_pattern_id_research_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_pattern_id_research_id_fk FOREIGN KEY (pattern_id) REFERENCES public.research(id);


--
-- Name: trading_errors trading_errors_trade_id_trades_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trading_errors
    ADD CONSTRAINT trading_errors_trade_id_trades_id_fk FOREIGN KEY (trade_id) REFERENCES public.trades(id);


--
-- PostgreSQL database dump complete
--

\unrestrict MxeJXQcOt0r9RHr3ZqoauQg05CxWzlP0Ifg8uvwddjvGtB6glyOaHqB8xPvx7k7

