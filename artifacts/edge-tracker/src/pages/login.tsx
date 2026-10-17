import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useReducedMotion, motion } from "framer-motion";
import { useAuth, type LoginError } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Pill } from "@/components/ds";
import { cn } from "@/lib/utils";
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Search, ArrowUpFromLine, UserRound, Undo2 } from "lucide-react";

const LAST_TRADER_KEY = "ws_lexx_last_trader";
const LOCKOUT_KEY = "ws_lexx_login_lockout_until";
const LOCKOUT_MS = 15 * 60 * 1000; // matches the server login limiter window

function readLS(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeLS(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage blocked */ }
}

const LOGIN_ERROR_TEXT: Record<LoginError, string> = {
  invalid: "Неверный пароль — проверьте раскладку и попробуйте ещё раз",
  rate_limited: "Слишком много попыток входа. Вход временно заблокирован",
  network: "Сервер недоступен — проверьте соединение и повторите",
  banned: "Доступ заблокирован. Обратитесь к куратору",
  guest_disabled: "Гостевой вход на этом сервере отключён — войдите под своим именем",
};

/* ---------- US market session clock (New York) ---------- */

type Session = { label: string; tone: "up" | "warn" | "purple" | "neutral" };

function nyParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const h = Number(get("hour")) % 24;
  return { weekday: get("weekday"), h, m: Number(get("minute")), s: Number(get("second")) };
}

function sessionOf(weekday: string, h: number, m: number): Session {
  if (weekday === "Sat" || weekday === "Sun") return { label: "Выходной", tone: "neutral" };
  const t = h * 60 + m;
  if (t >= 4 * 60 && t < 9 * 60 + 30) return { label: "Премаркет", tone: "warn" };
  if (t >= 9 * 60 + 30 && t < 16 * 60) return { label: "Основная сессия", tone: "up" };
  if (t >= 16 * 60 && t < 20 * 60) return { label: "Постмаркет", tone: "purple" };
  return { label: "Рынок закрыт", tone: "neutral" };
}

function MarketClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);
  const { weekday, h, m, s } = nyParts(now);
  const session = sessionOf(weekday, h, m);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <div className="glass-field inline-flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
      <span className="font-medium text-foreground">NY {pad(h)}:{pad(m)}:{pad(s)}</span>
      <span aria-hidden="true">·</span>
      <Pill tone={session.tone} dot className="px-1.5 py-0 text-2xs">{session.label}</Pill>
    </div>
  );
}

/* ---------- helpers ---------- */

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

// Deterministic per-name chart colour so avatars stay recognisable between visits.
function avatarTone(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `--chart-${(h % 5) + 1}`;
}

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const v = avatarTone(name);
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-full text-xs font-semibold"
      style={{
        width: size,
        height: size,
        background: `hsl(var(${v}) / 0.18)`,
        color: `hsl(var(${v}))`,
        boxShadow: `inset 0 0 0 1px hsl(var(${v}) / 0.35)`,
      }}
    >
      {initials(name)}
    </span>
  );
}

const ROLE_LABEL: Record<string, string> = { curator: "Куратор", admin: "Админ", trader: "Трейдер" };

/* ---------- page ---------- */

export default function LoginPage() {
  const { loginAsTrader, loginAsGuest, dbUsers } = useAuth();
  const reduceMotion = useReducedMotion();

  const users = useMemo(
    () => dbUsers.filter((u) => u.active).map((u) => ({ name: u.name, role: u.role })),
    [dbUsers],
  );

  const [selectedTrader, setSelectedTrader] = useState<string>(() => readLS(LAST_TRADER_KEY) ?? "");
  const [picking, setPicking] = useState<boolean>(() => !readLS(LAST_TRADER_KEY));
  const [query, setQuery] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<LoginError | null>(null);
  const [shake, setShake] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number>(() => Number(readLS(LOCKOUT_KEY) ?? 0) || 0);
  const [now, setNow] = useState(() => Date.now());
  const passwordRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // If the remembered trader no longer exists (renamed / deactivated) fall back to the picker.
  useEffect(() => {
    if (selectedTrader && users.length > 0 && !users.some((u) => u.name === selectedTrader)) {
      setSelectedTrader("");
      setPicking(true);
    }
  }, [users, selectedTrader]);

  // Lockout countdown after the server rate-limits us.
  const locked = lockedUntil > now;
  useEffect(() => {
    if (!locked) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [locked]);
  useEffect(() => {
    if (lockedUntil && !locked) {
      writeLS(LOCKOUT_KEY, null);
      setLockedUntil(0);
      if (error === "rate_limited") setError(null);
    }
  }, [locked, lockedUntil, error]);

  const remaining = Math.max(0, lockedUntil - now);
  const remainingText = `${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}`;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? users.filter((u) => u.name.toLowerCase().includes(q)) : users;
  }, [users, query]);

  const chooseTrader = useCallback((name: string) => {
    setSelectedTrader(name);
    setPicking(false);
    setError(null);
    setQuery("");
    requestAnimationFrame(() => passwordRef.current?.focus());
  }, []);

  function onListKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]") ?? []);
    if (items.length === 0) return;
    e.preventDefault();
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = idx;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "ArrowDown" || e.key === "ArrowRight") next = idx < 0 ? 0 : (idx + 1) % items.length;
    else next = idx < 0 ? items.length - 1 : (idx - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  function trackCaps(e: React.KeyboardEvent<HTMLInputElement>) {
    if (typeof e.getModifierState === "function") setCapsLock(e.getModifierState("CapsLock"));
  }

  async function handleTraderLogin(e?: React.FormEvent) {
    e?.preventDefault();
    if (!selectedTrader || !password || submitting || locked) return;
    setSubmitting(true);
    const err = await loginAsTrader(selectedTrader, password);
    setSubmitting(false);
    if (!err) {
      writeLS(LAST_TRADER_KEY, selectedTrader);
      return;
    }
    setError(err);
    if (err === "rate_limited") {
      const until = Date.now() + LOCKOUT_MS;
      writeLS(LOCKOUT_KEY, String(until));
      setLockedUntil(until);
      setNow(Date.now());
    }
    if (err === "invalid") setPassword("");
    if (!reduceMotion) {
      setShake(true);
      setTimeout(() => setShake(false), 450);
    }
    passwordRef.current?.focus();
  }

  const [guestBusy, setGuestBusy] = useState(false);
  async function handleGuest() {
    if (guestBusy || submitting) return;
    setGuestBusy(true);
    const err = await loginAsGuest();
    setGuestBusy(false);
    if (err) setError(err === "invalid" ? "network" : err);
  }

  const selectedUser = users.find((u) => u.name === selectedTrader);
  const canSubmit = !!selectedTrader && password.length > 0 && !submitting && !locked;

  return (
    <div className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-background px-4 py-10">
      {/* Ambient colour behind the glass */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0">
        <div className="absolute left-1/2 top-[-18%] h-[520px] w-[820px] max-w-[160vw] -translate-x-1/2 rounded-full bg-primary/15 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] h-[480px] w-[560px] max-w-[120vw] rounded-full bg-chart-2/10 blur-[110px]" />
        <div className="absolute bottom-[10%] left-[-12%] h-[360px] w-[420px] max-w-[100vw] rounded-full bg-chart-5/10 blur-[100px]" />
      </div>

      <motion.main
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
        className="relative z-raised flex w-full max-w-[400px] flex-col items-center gap-5"
      >
        <div
          className={cn(
            "glass-thick w-full rounded-3xl p-6 sm:p-7",
            shake && "animate-[shake_0.4s_ease-in-out]",
          )}
        >
          {/* Brand */}
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-primary-solid text-base font-bold tracking-tight text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_10px_30px_-10px_hsl(var(--primary)/0.7)]">
              WS
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">WS_LEXX</h1>
              <p className="mt-1 text-sm text-muted-foreground">Журнал проп-трейдинг деска</p>
            </div>
          </div>

          <form className="mt-6 flex flex-col gap-4" onSubmit={handleTraderLogin} noValidate>
            {/* Trader */}
            {!picking && selectedTrader ? (
              <div className="glass-field flex items-center gap-3 rounded-2xl py-2 pl-2 pr-2">
                <Avatar name={selectedTrader} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">{selectedTrader}</div>
                  <div className="text-xs text-muted-foreground">{ROLE_LABEL[selectedUser?.role ?? "trader"] ?? "Трейдер"}</div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => { setPicking(true); setError(null); }}
                  className="shrink-0 text-muted-foreground"
                >
                  <Undo2 aria-hidden="true" />
                  Сменить
                </Button>
              </div>
            ) : (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-xs text-muted-foreground">Кто входит?</legend>
                {users.length > 8 && (
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); if (filtered[0]) chooseTrader(filtered[0].name); }
                        if (e.key === "ArrowDown") { e.preventDefault(); listRef.current?.querySelector<HTMLButtonElement>("[role=radio]")?.focus(); }
                      }}
                      placeholder="Найти по имени"
                      aria-label="Найти трейдера"
                      className="h-10 pl-10"
                    />
                  </div>
                )}
                <div
                  ref={listRef}
                  role="radiogroup"
                  aria-label="Трейдер"
                  onKeyDown={onListKeyDown}
                  className="grid max-h-[248px] grid-cols-2 gap-2 overflow-y-auto p-0.5"
                >
                  {filtered.map((u, i) => {
                    const active = u.name === selectedTrader;
                    return (
                      <button
                        key={u.name}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        tabIndex={active || (!filtered.some((f) => f.name === selectedTrader) && i === 0) ? 0 : -1}
                        onClick={() => chooseTrader(u.name)}
                        className={cn(
                          "chip lift flex min-h-12 items-center gap-2.5 rounded-2xl px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active && "ring-2 ring-primary",
                        )}
                      >
                        <Avatar name={u.name} size={30} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-foreground">{u.name}</span>
                          {u.role !== "trader" && (
                            <span className="block text-2xs text-muted-foreground">{ROLE_LABEL[u.role] ?? u.role}</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                  {filtered.length === 0 && (
                    <p className="col-span-2 py-4 text-center text-sm text-muted-foreground">Никого не найдено</p>
                  )}
                </div>
              </fieldset>
            )}

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-password" className="text-xs text-muted-foreground">
                Пароль
              </label>
              <div className="relative">
                <Input
                  ref={passwordRef}
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={200}
                  value={password}
                  disabled={!selectedTrader || locked}
                  onChange={(e) => { setPassword(e.target.value); if (error && error !== "rate_limited") setError(null); }}
                  onKeyDown={trackCaps}
                  onKeyUp={trackCaps}
                  onBlur={() => setCapsLock(false)}
                  placeholder={selectedTrader ? "Введите пароль" : "Сначала выберите себя"}
                  aria-invalid={error === "invalid" || undefined}
                  aria-describedby={[error ? "login-error" : "", capsLock ? "login-caps" : ""].filter(Boolean).join(" ") || undefined}
                  className={cn(
                    "h-11 pr-12 text-base tracking-wide sm:text-sm",
                    error === "invalid" && "border-down/60 ring-2 ring-down/20",
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                  aria-pressed={showPassword}
                  className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                </button>
              </div>
              {capsLock && (
                <p id="login-caps" className="flex items-center gap-1.5 text-xs text-[hsl(var(--chart-3))]" role="status">
                  <ArrowUpFromLine className="h-3.5 w-3.5" aria-hidden="true" />
                  Включён Caps Lock
                </p>
              )}
            </div>

            {error && (
              <div
                id="login-error"
                role="alert"
                className="flex items-start gap-2 rounded-xl bg-down/10 px-3 py-2.5 text-sm text-down"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  {LOGIN_ERROR_TEXT[error]}
                  {error === "rate_limited" && locked && (
                    <span className="mt-0.5 block text-xs tabular-nums opacity-90">Повторить через {remainingText}</span>
                  )}
                </span>
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={!canSubmit}
              aria-busy={submitting}
              className="h-11 w-full text-sm"
            >
              {submitting ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Входим…
                </>
              ) : locked ? (
                <span className="tabular-nums">Заблокировано · {remainingText}</span>
              ) : (
                <>
                  Войти
                  <ArrowRight aria-hidden="true" />
                </>
              )}
            </Button>
            <p className="-mt-1 hidden items-center justify-center gap-1.5 text-xs text-muted-foreground sm:flex">
              <Kbd>Enter</Kbd> чтобы войти
            </p>
          </form>
        </div>

        <Button
          type="button"
          variant="ghost"
          onClick={handleGuest}
          disabled={guestBusy}
          aria-busy={guestBusy}
          className="text-muted-foreground"
        >
          {guestBusy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <UserRound aria-hidden="true" />}
          Войти как гость · только просмотр
        </Button>

        <MarketClock />
      </motion.main>
    </div>
  );
}
