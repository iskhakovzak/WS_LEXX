import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { BASE } from "@/lib/api";

export type Theme = "dark" | "dim" | "light";

const THEMES: Theme[] = ["dark", "dim", "light"];
const THEME_LABELS: Record<Theme, string> = {
  dark: "Тёмная",
  dim: "Сумеречная",
  light: "Светлая",
};

interface ThemeContextType {
  theme: Theme;
  cycleTheme: () => void;
  toggleTheme: () => void;
  themeLabel: string;
  /** Pick a theme directly (persists locally and to the user profile). */
  setTheme: (t: Theme) => void;
  themes: readonly Theme[];
  themeLabels: Record<Theme, string>;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  cycleTheme: () => {},
  toggleTheme: () => {},
  themeLabel: "Тёмная",
  setTheme: () => {},
  themes: THEMES,
  themeLabels: THEME_LABELS,
});

const LS_KEY = "ws_lexx_theme";

function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.classList.remove("dark", "dim");
  if (t === "dark") { root.classList.add("dark"); }
  else if (t === "dim") { root.classList.add("dark", "dim"); }
  root.style.colorScheme = t === "light" ? "light" : "dark";
  // Keep the mobile browser chrome (status bar / address bar) in sync with the page background.
  requestAnimationFrame(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    if (!bg) return;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = bg;
  });
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw === "sepia") return "light";
      const saved = raw as Theme | null;
      return THEMES.includes(saved as Theme) ? (saved as Theme) : "dark";
    } catch { return "dark"; }
  });

  const auth = useAuth();
  const syncedUser = useRef<string | null>(null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const name = auth.user?.traderName ?? null;
    if (!name || name === syncedUser.current) return;
    syncedUser.current = name;
    const found = auth.dbUsers.find(u => u.name === name);
    const resolvedTheme = found?.theme === "sepia" ? "light" : found?.theme;
    if (resolvedTheme && THEMES.includes(resolvedTheme as Theme)) {
      const serverTheme = resolvedTheme as Theme;
      if (serverTheme !== theme) {
        setThemeState(serverTheme);
        try { localStorage.setItem(LS_KEY, serverTheme); } catch {}
      }
    }
  }, [auth.user?.traderName, auth.dbUsers]);

  function setTheme(next: Theme) {
    setThemeState(next);
    try { localStorage.setItem(LS_KEY, next); } catch {}
    const name = auth.user?.traderName;
    if (name) {
      fetch(`${BASE}/api/users/theme`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, theme: next }),
      }).catch(() => {});
    }
  }

  function cycleTheme() {
    const idx = THEMES.indexOf(theme);
    setTheme(THEMES[(idx + 1) % THEMES.length]);
  }

  return (
    <ThemeContext.Provider value={{ theme, cycleTheme, toggleTheme: cycleTheme, themeLabel: THEME_LABELS[theme], setTheme, themes: THEMES, themeLabels: THEME_LABELS }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
