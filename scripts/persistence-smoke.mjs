#!/usr/bin/env node
/**
 * Persistence smoke (docs/persistence/AUDIT.md): every section's write must survive a page reload AND an API restart,
 * and the UI must remember its context (tab, person, open item…) across a reload. Not part of `pnpm run checks`.
 *
 * WRITES TEST ROWS (marked "[smoke <run id>]"): run it only against a TEST database, never the desk's real one.
 *
 *   # 1. a test API (own DB, JOBS_ENABLED=false) and a vite pointing at it, then:
 *   node scripts/persistence-smoke.mjs --api http://127.0.0.1:8190 --web http://127.0.0.1:24710 \
 *        --seed-local postgresql://postgres:postgres@localhost:5432/edge_tracker_persist --jwt-secret <the test API's JWT_SECRET>
 *   #    → phase "write": every write, then a fresh read of each (= a reload); ids go to the state file.
 *   # 2. restart the test API, then:
 *   node scripts/persistence-smoke.mjs --phase verify …same flags…   # every write read back after the restart
 *   # 3. UI context + drafts in headless Chrome:
 *   node scripts/persistence-smoke.mjs --phase ui …same flags…
 *
 * Tokens: SMOKE_TOKEN_TRADER / SMOKE_TOKEN_ADMIN (+ SMOKE_TRADER_NAME / SMOKE_ADMIN_NAME), or `--seed-local <db url>`
 * with `--jwt-secret` (localhost only): creates the users `smoke_trader` / `smoke_admin` (no password, cannot sign in)
 * and mints short-lived tokens the way the API signs them. It never calls /api/auth/login.
 * Flags: --state <file> (default: OS temp), --desk-config (also round-trips desk settings: the scaling rule list),
 *        --chrome <path>, --only <case,case>.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// ─── args ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const API = (opt("api", "http://127.0.0.1:8190") ?? "").replace(/\/$/, "");
const WEB = (opt("web", "http://127.0.0.1:24710") ?? "").replace(/\/$/, "");
const PHASE = opt("phase", "write");
const STATE = opt("state", path.join(os.tmpdir(), "persistence-smoke-state.json"));
const ONLY = opt("only") ? new Set(opt("only").split(",")) : null;
const CHROME = opt("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── identities ───────────────────────────────────────────────────────────────

const b64u = (b) => Buffer.from(b).toString("base64url");
function mintJwt(secret, payload, ttlSec = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64u(JSON.stringify({ ...payload, iat: now, exp: now + ttlSec }));
  const sig = crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

async function seedLocal(dbUrl, secret) {
  const host = new URL(dbUrl).hostname.replace(/^\[|\]$/g, "");
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error(`--seed-local refuses a non-local database (${host})`);
  if (!secret) throw new Error("--seed-local needs --jwt-secret (the test API's JWT_SECRET)");
  const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "package.json"));
  const pg = require("pg");
  const c = new pg.Client({ connectionString: dbUrl });
  await c.connect();
  const out = {};
  try {
    for (const [key, name, role] of [["trader", "smoke_trader", "trader"], ["admin", "smoke_admin", "admin"]]) {
      const { rows } = await c.query(
        `INSERT INTO users (name, role) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET role = EXCLUDED.role RETURNING id, token_version`,
        [name, role],
      );
      const { id, token_version: tv } = rows[0];
      out[key] = { name, role, token: mintJwt(secret, { sub: id, name, role, tv: tv ?? 0, sid: crypto.randomUUID() }) };
    }
  } finally {
    await c.end();
  }
  return out;
}

async function identities() {
  const db = opt("seed-local");
  if (db) return seedLocal(db, opt("jwt-secret"));
  const t = process.env.SMOKE_TOKEN_TRADER;
  const a = process.env.SMOKE_TOKEN_ADMIN;
  if (!t || !a) throw new Error("set SMOKE_TOKEN_TRADER / SMOKE_TOKEN_ADMIN or pass --seed-local <db> --jwt-secret <s>");
  return {
    trader: { name: process.env.SMOKE_TRADER_NAME ?? "smoke_trader", role: "trader", token: t },
    admin: { name: process.env.SMOKE_ADMIN_NAME ?? "smoke_admin", role: "admin", token: a },
  };
}

// ─── http ─────────────────────────────────────────────────────────────────────

async function call(who, method, url, body, { raw = false, expect } = {}) {
  const headers = { Authorization: `Bearer ${who.token}`, "X-Lang": "en" };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(`${API}${url}`, { method, headers, body: payload });
  if (raw) return res;
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  const want = expect ?? [200, 201, 204];
  if (!want.includes(res.status)) throw new Error(`${method} ${url} → ${res.status} ${typeof json === "string" ? json.slice(0, 200) : JSON.stringify(json).slice(0, 300)}`);
  return json;
}
const get = (who, url) => call(who, "GET", url);
const contains = (v, marker) => JSON.stringify(v ?? null).includes(marker);
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

function nyDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
/** ISO week "YYYY-Www" of a NY date. */
function isoWeek(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const y = d.getUTCFullYear();
  const w = 1 + Math.floor((d.getTime() - Date.UTC(y, 0, 1)) / 86400000 / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}

/** A 0.1 s silent 8 kHz mono WAV. */
function tinyWav() {
  const n = 800;
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  return b;
}

// ─── API round-trip cases: write() returns what verify() needs ───────────────

const TODAY = nyDate();
const WEEK = isoWeek(TODAY);

/** @type {{ name: string, desk?: boolean, write: (ctx) => Promise<object>, verify: (ctx, s: object) => Promise<void> }[]} */
const CASES = [
  {
    name: "settings.prefs",
    async write({ trader, mark }) {
      await call(trader, "PUT", "/api/users/me/settings", { prefs: { "smoke.a": mark, "smoke.b": 1 } });
      await call(trader, "PUT", "/api/users/me/settings", { prefs: { "smoke.b": null, "smoke.c": [mark] } });
      return {};
    },
    async verify({ trader, mark }) {
      const s = await get(trader, "/api/users/me/settings");
      const p = s?.settings?.prefs ?? {};
      assert(p["smoke.a"] === mark && Array.isArray(p["smoke.c"]) && !("smoke.b" in p), `prefs per-key merge lost: ${JSON.stringify(p).slice(0, 200)}`);
    },
  },
  {
    name: "journal.day",
    async write({ trader, mark }) {
      await call(trader, "PUT", `/api/journal/days/${TODAY}`, { plan: `plan ${mark}`, well: "w", mistakes: "", lessons: `lesson ${mark}`, mood: 3, discipline: 4, followedPlan: true, tags: [] });
      return {};
    },
    async verify({ trader, mark }) {
      const d = await get(trader, `/api/journal/days/${TODAY}`);
      assert(contains(d, `plan ${mark}`) && contains(d, `lesson ${mark}`), "journal day text lost");
    },
  },
  {
    name: "game-plan.my",
    async write({ trader, mark }) {
      await call(trader, "PUT", `/api/game-plan/my/${TODAY}`, { marketView: `view ${mark}`, focus: `focus ${mark}`, focusRules: ["a", "c"], status: "draft" });
      return {};
    },
    async verify({ trader, mark }) {
      const d = await get(trader, `/api/game-plan/my?date=${TODAY}`);
      assert(contains(d, `view ${mark}`) && contains(d, `focus ${mark}`), "personal plan text lost");
      assert(contains(d, '"focusRules":["a","c"]'), "personal plan focus rules lost");
    },
  },
  {
    name: "game-plan.template",
    async write({ trader, mark }) {
      const t = await call(trader, "POST", "/api/game-plan/templates", { name: `tpl ${mark}`.slice(0, 80), kind: "personal", doc: { marketView: `tv ${mark}`, focusRules: ["b"] } });
      return { id: t.id };
    },
    async verify({ trader, mark }, s) {
      const list = await get(trader, "/api/game-plan/templates");
      const arr = Array.isArray(list) ? list : list?.templates ?? [];
      const t = arr.find((x) => x.id === s.id);
      assert(t && contains(t.doc, `tv ${mark}`), "plan template lost");
      assert(contains(t.doc, '"focusRules":["b"]'), "plan template focus rules stripped");
    },
  },
  {
    name: "author-notes",
    async write({ trader, mark }) {
      // The section is behind the desk switch nav.authorNotes (off → 404): then there is nothing to round-trip.
      const r = await call(trader, "PUT", "/api/author-notes", { raw_text: `note ${mark}\n\nsecond paragraph`, note_date: TODAY, mood: "calm" }, { expect: [200, 404] });
      return r?.code === "NOT_FOUND" ? null : {};
    },
    async verify({ trader, mark }) {
      assert(contains(await get(trader, `/api/author-notes?date=${TODAY}`), `note ${mark}`), "author note lost");
    },
  },
  {
    name: "watchlist",
    async write({ trader, mark, runId }) {
      const ticker = `ZS${mark.slice(-3).toUpperCase().replace(/[^A-Z]/g, "Q")}`.slice(0, 5);
      const shot = `https://example.com/smoke-${runId}.png`;
      const r = await call(trader, "POST", "/api/watchlist", { ticker, notes: `wl ${mark}`, screenshotUrl: shot }, { expect: [200, 201, 409] });
      const id = r?.id ?? r?.existingId ?? r?.details?.id;
      if (id) await call(trader, "PATCH", `/api/watchlist/${id}`, { notes: `wl ${mark}`, screenshotUrl: shot });
      return { id };
    },
    async verify({ trader, mark, runId }) {
      const list = await get(trader, "/api/watchlist");
      assert(contains(list, `wl ${mark}`), "watchlist note lost");
      assert(contains(list, `https://example.com/smoke-${runId}.png`), "watchlist screenshot dropped");
    },
  },
  {
    name: "trade-ideas",
    async write({ trader, mark }) {
      const r = await call(trader, "POST", "/api/trade-ideas", { ticker: "SMKE", side: "long", thesis: `idea ${mark}`, horizon: "swing", validUntil: TODAY });
      // The author edits their own idea; the form always sends the author back.
      await call(trader, "PATCH", `/api/trade-ideas/${r.id}`, { trader: trader.name, thesis: `idea edited ${mark}`, horizon: "overnight" });
      return { id: r.id };
    },
    async verify({ trader, mark }, s) {
      const d = await get(trader, `/api/trade-ideas/${s.id}`);
      assert(contains(d, `idea edited ${mark}`), "trade idea author edit lost");
      assert(contains(d, '"horizon":"overnight"'), "trade idea horizon lost");
    },
  },
  {
    name: "playbook",
    async write({ trader, mark }) {
      const r = await call(trader, "POST", "/api/playbook", { name: `Smoke setup ${mark}`, notes: `pb ${mark}`, space: "personal" });
      await call(trader, "PATCH", `/api/playbook/${r.id}`, { notes: `pb edited ${mark}` });
      return { id: r.id };
    },
    async verify({ trader, mark }) {
      assert(contains(await get(trader, "/api/playbook"), `pb edited ${mark}`), "playbook edit lost");
    },
  },
  {
    name: "discussions",
    async write({ trader, mark }) {
      const r = await call(trader, "POST", "/api/discussions", { topic: `topic ${mark}`, notes: `body ${mark}` });
      return { id: r.id };
    },
    async verify({ trader, mark }, s) {
      assert(contains(await get(trader, `/api/discussions/${s.id}`), `body ${mark}`), "discussion lost");
    },
  },
  {
    name: "events",
    async write({ trader, mark }) {
      const r = await call(trader, "POST", "/api/events", { date: TODAY, ticker: "SMKE", eventType: "news", headline: `ev ${mark}`, force: true });
      return { id: r.id };
    },
    async verify({ trader, mark }, s) {
      assert(contains(await get(trader, `/api/events/${s.id}`), `ev ${mark}`), "event lost");
    },
  },
  {
    name: "dailyfeed",
    async write({ admin, mark }) {
      const r = await call(admin, "POST", "/api/dailyfeed", { date: TODAY, notes: `feed ${mark}`, marketTheme: "smoke" });
      return { id: r.id };
    },
    async verify({ admin, mark }, s) {
      assert(contains(await get(admin, `/api/dailyfeed/${s.id}`), `feed ${mark}`), "feed post lost");
    },
  },
  {
    name: "voice-notes",
    async write({ trader }) {
      const fd = new FormData();
      fd.append("audio", new Blob([tinyWav()], { type: "audio/wav" }), "smoke.wav");
      fd.append("userId", trader.name);
      fd.append("tradeId", "999999999");
      fd.append("durationSec", "1");
      const r = await call(trader, "POST", "/api/voice-notes", fd);
      return { id: r.id };
    },
    async verify({ trader }, s) {
      const list = await get(trader, `/api/voice-notes?userId=${encodeURIComponent(trader.name)}&tradeId=999999999`);
      assert(Array.isArray(list) && list.some((n) => n.id === s.id), "voice note row lost");
      const res = await call(trader, "GET", `/api/voice-notes/${s.id}/audio`, undefined, { raw: true });
      assert(res.ok && (await res.arrayBuffer()).byteLength > 44, `voice note audio lost (${res.status})`);
    },
  },
  {
    name: "weekly-review.self",
    async write({ trader, mark }) {
      await call(trader, "PUT", "/api/weekly-review/self", { week: WEEK, well: `well ${mark}`, badly: "b", focus: `focus ${mark}`, lessons: "l" });
      return {};
    },
    async verify({ trader, mark }) {
      assert(contains(await get(trader, `/api/weekly-review?week=${WEEK}`), `well ${mark}`), "weekly self-review lost");
    },
  },
  {
    name: "curator.notes",
    async write({ admin, trader, mark }) {
      const r = await call(admin, "POST", "/api/curator/notes", { trader: trader.name, body: `cn ${mark}`, kind: "note" });
      return { id: r.id };
    },
    async verify({ admin, trader, mark }) {
      assert(contains(await get(admin, `/api/curator/notes?trader=${encodeURIComponent(trader.name)}`), `cn ${mark}`), "curator note lost");
    },
  },
  {
    name: "emotional-state",
    async write({ trader, mark }) {
      await call(trader, "POST", "/api/emotional-state", { userId: trader.name, date: TODAY, freeText: `morning ${mark}`, focused: true });
      // A flags-only edit (the coach card) keeps the morning text; a second quick save is the same row.
      await call(trader, "POST", "/api/emotional-state", { userId: trader.name, date: TODAY, focused: false, sleepWell: true });
      return {};
    },
    async verify({ trader, mark }) {
      const d = await get(trader, `/api/emotional-state/by-date?userId=${encodeURIComponent(trader.name)}&date=${TODAY}`);
      assert(contains(d, `morning ${mark}`), "check-in text wiped by a flags-only save");
      assert(contains(d, '"sleepWell":true'), "check-in flag edit lost");
    },
  },
  {
    name: "themes.view",
    async write({ trader }) {
      await call(trader, "PUT", "/api/themes/view", { columns: ["today", "premarket"] });
      await call(trader, "PUT", "/api/themes/view", { sort: { col: "today", dir: "asc" } });
      return {};
    },
    async verify({ trader }) {
      const b = await get(trader, "/api/themes");
      assert(contains(b, '"columns":["premarket","today"]') && contains(b, '"dir":"asc"'), "themes view: one change undid another");
    },
  },
  {
    name: "playbook.seed-rename",
    desk: true,
    async write({ admin, mark }) {
      const list = await get(admin, "/api/playbook");
      const rows = (Array.isArray(list) ? list : list?.items ?? list?.setups ?? []).filter((r) => r && r.id && !r.trader && typeof r.name === "string" && !r.name.includes("[smoke"));
      const seed = rows.sort((a, b) => a.id - b.id)[0];
      if (!seed) return null;
      await call(admin, "PATCH", `/api/playbook/${seed.id}`, { name: `renamed ${mark}` });
      return { id: seed.id, original: seed.name };
    },
    async verify({ admin, mark }, s) {
      const list = JSON.stringify(await get(admin, "/api/playbook"));
      assert(list.includes(`renamed ${mark}`), "renamed setup lost its new name");
      assert(!list.includes(JSON.stringify(s.original)), "a renamed seeded setup came back under its old name after a restart");
    },
  },
  {
    name: "scaling.rules",
    desk: true,
    async write({ admin }) {
      const cfg = await get(admin, "/api/scaling/config");
      const r = await call(admin, "PUT", "/api/scaling/rules", [{ kind: "promote", metric: "discipline", op: ">=", value: 8, unit: "abs", windowDays: 20, enabled: true }]);
      return { before: (cfg?.rules ?? []).length, after: (r?.rules ?? []).length };
    },
    async verify({ admin }) {
      const cfg = await get(admin, "/api/scaling/config");
      const rules = cfg?.rules ?? [];
      assert(rules.length === 1, `scaling rules re-seeded after restart (${rules.length} rules)`);
      assert(rules[0].value === 8, `scaling discipline threshold read back as ${rules[0].value}, saved 8`);
    },
  },
];

async function runApi(ids, phase) {
  const state = phase === "write" ? { runId: crypto.randomBytes(3).toString("hex"), cases: {} } : JSON.parse(fs.readFileSync(STATE, "utf8"));
  const mark = `[smoke ${state.runId}]`;
  const ctx = { ...ids, mark, runId: state.runId };
  let failed = 0;
  for (const c of CASES) {
    if (ONLY && !ONLY.has(c.name)) continue;
    if (c.desk && !flag("desk-config")) continue;
    try {
      if (phase === "write") state.cases[c.name] = await c.write(ctx);
      const s = state.cases[c.name];
      if (!s) { console.log(`  skip  ${c.name} (${phase === "write" ? "section switched off on this desk" : "not written in this state file"})`); continue; }
      await c.verify(ctx, s);
      console.log(`  ok    ${c.name}${phase === "write" ? " (write → fresh read)" : " (after restart)"}`);
    } catch (e) {
      failed++;
      console.log(`  FAIL  ${c.name}: ${e.message}`);
    }
  }
  if (phase === "write") fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  return failed;
}

// ─── UI: context memory across a reload (headless Chrome over CDP, no deps) ──

async function withChrome(fn) {
  const port = 9300 + Math.floor(Math.random() * 600);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "persist-smoke-"));
  const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--window-size=1440,900", "about:blank"], { stdio: "ignore" });
  let ws;
  try {
    let targets;
    for (let k = 0; k < 100 && !targets; k++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); } }
    ws = new WebSocket(targets.find((x) => x.type === "page").webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r));
    let id = 0;
    const pending = new Map();
    const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    });
    const ev = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }))?.result?.value;
    await send("Page.enable");
    await send("Runtime.enable");
    const go = async (url, wait = 4500) => { await send("Page.navigate", { url }); await sleep(wait); };
    const reload = async (wait = 4500) => { await send("Page.reload", {}); await sleep(wait); };
    return await fn({ send, ev, go, reload });
  } finally {
    try { ws?.close(); } catch { /* closed */ }
    proc.kill();
    await sleep(600);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* chrome still exiting */ }
  }
}

/** Pages whose tabs must come back after a reload (role=tab). */
const TAB_ROUTES = ["/ratings", "/rules", "/risk", "/scaling", "/academy/cohorts", "/academy/path", "/integrations", "/journal", "/game-plan", "/office", "/offerings", "/notifications", "/analytics", "/stats", "/curator", "/admin", "/settings", "/trade-ideas", "/discussions", "/events", "/academy/learn",
  "/watchlist", "/big7", "/indicators", "/themes", "/analyst-actions", "/trade-idea-stats", "/playbook", "/behavior", "/benchmark",
  "/chart-lab", "/desk-day", "/academy/challenges", "/academy/mentor", "/dailyfeed", "/day-report", "/my-review", "/weekly-review",
  "/research", "/what-if", "/top-results", "/coach", "/trades", "/people", "/profile"];

/** Links whose params must survive a reload (the page must not strip them). */
const PARAM_ROUTES = [
  ["/stats", { horizon: "intraday" }],
  ["/events", { view: "week" }],
  ["/trade-ideas", { stage: "active", hz: "swing" }],
  ["/discussions", { q: "smoke" }],
  ["/risk", { view: "desk" }],
  ["/academy/path", { view: "funnel" }],
  ["/admin", { what: "settings.update" }],
  ["/offerings", { when: "next" }],
];

async function runUi(ids) {
  let failed = 0;
  const report = (ok, name, why = "") => { if (!ok) failed++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${why ? `: ${why}` : ""}`); };
  await withChrome(async ({ ev, go, reload }) => {
    await go(`${WEB}/`, 2500);
    const who = ids.admin;
    await ev(`localStorage.setItem("ws_lexx_token", ${JSON.stringify(who.token)}); localStorage.setItem("ws_lexx_session", JSON.stringify({ role: ${JSON.stringify(who.role)}, traderName: ${JSON.stringify(who.name)} })); localStorage.setItem("ws_lexx_intro", "off"); 1`);

    for (const route of TAB_ROUTES) {
      await go(`${WEB}${route}`);
      const picked = await ev(`(() => {
        const tabs = [...document.querySelectorAll('[role=tab]')].filter((t) => t.offsetParent && !t.disabled);
        const next = tabs.find((t) => t.getAttribute('aria-selected') !== 'true');
        if (!next) return null;
        next.click();
        return next.textContent.trim();
      })()`);
      if (!picked) { console.log(`  skip  tabs ${route} (no second tab on this page for this account)`); continue; }
      await new Promise((r) => setTimeout(r, 800));
      await reload();
      const sel = await ev(`[...document.querySelectorAll('[role=tab][aria-selected=true]')].filter((t) => t.offsetParent).map((t) => t.textContent.trim())`);
      report(Array.isArray(sel) && sel.includes(picked), `tabs ${route}`, Array.isArray(sel) && sel.includes(picked) ? "" : `picked «${picked}», after reload «${(sel ?? []).join(" | ")}»`);
    }

    // Segmented controls (components/ds/segmented: role=group + aria-pressed): the first one on the page.
    const label = "(b) => b.textContent.replace(/[\\d\\s·.,%+−-]+/g, ' ').trim()";
    for (const route of TAB_ROUTES) {
      // /coach: the mentor's rhythm card opens on the part of the day (brief before the session, debrief after) by design.
      if (route === "/coach") continue;
      await go(`${WEB}${route}`);
      const picked = await ev(`(() => {
        const g = [...document.querySelectorAll('[role=group]')].find((x) => x.offsetParent && x.querySelectorAll(':scope > button[aria-pressed]').length > 1);
        const next = g && [...g.querySelectorAll(':scope > button[aria-pressed=false]')].find((b) => !b.disabled);
        if (!next) return null;
        next.click();
        return (${label})(next);
      })()`);
      if (!picked) continue;
      await sleep(800);
      await reload();
      const sel = await ev(`[...document.querySelectorAll('[role=group] > button[aria-pressed=true]')].filter((b) => b.offsetParent).map(${label})`);
      const ok = Array.isArray(sel) && sel.includes(picked);
      report(ok, `segmented ${route}`, ok ? "" : `picked «${picked}», after reload «${(sel ?? []).join(" | ")}»`);
    }

    for (const [route, params] of PARAM_ROUTES) {
      const qs = new URLSearchParams(params).toString();
      await go(`${WEB}${route}?${qs}`);
      await reload();
      const search = await ev("location.search");
      const kept = Object.entries(params).every(([k, v]) => new URLSearchParams(search).get(k) === v);
      report(kept, `params ${route}?${qs}`, kept ? "" : `after reload: ${search || "(none)"}`);
    }

    // A draft survives a reload: the first textarea of the own weekly review is the goal for next week.
    await go(`${WEB}/weekly-review?trader=${encodeURIComponent(who.name)}`);
    const typed = `draft [smoke ${Date.now()}]`;
    const ok = await ev(`(() => {
      const ta = [...document.querySelectorAll('textarea')].find((t) => t.offsetParent && !t.disabled && !t.readOnly);
      if (!ta) return false;
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      set.call(ta, ${JSON.stringify(typed)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    if (!ok) console.log("  skip  draft /weekly-review (no editable textarea for this account)");
    else {
      await new Promise((r) => setTimeout(r, 1200));
      await reload(5500);
      const back = await ev(`[...document.querySelectorAll('textarea')].some((t) => t.value.includes(${JSON.stringify(typed)}))`);
      report(!!back, "draft /weekly-review survives a reload");
    }
  });
  return failed;
}

// ─── main ─────────────────────────────────────────────────────────────────────

const ids = await identities();
console.log(`persistence smoke · phase ${PHASE} · api ${API}${PHASE === "ui" ? ` · web ${WEB}` : ""}`);
const failed = PHASE === "ui" ? await runUi(ids) : await runApi(ids, PHASE === "verify" ? "verify" : "write");
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
