import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";

export type Theme = "dark" | "dim" | "sepia" | "light";

const THEMES: Theme[] = ["dark", "dim", "sepia", "light"];
const THEME_LABELS: Record<Theme, string> = {
  dark: "Тёмная",
  dim: "Сумеречная",
  sepia: "Тёплая",
  light: "Светлая",
};

interface ThemeContextType {
  theme: Theme;
  cycleTheme: () => void;
  toggleTheme: () => void;
  themeLabel: string;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  cycleTheme: () => {},
  toggleTheme: () => {},
  themeLabel: "Тёмная",
});

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const LS_KEY = "ws_lexx_theme";

function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.classList.remove("dark", "dim", "sepia");
  if (t === "dark") { root.classList.add("dark"); }
  else if (t === "dim") { root.classList.add("dark", "dim"); }
  else if (t === "sepia") { root.classList.add("sepia"); }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem(LS_KEY) as Theme | null;
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
    if (found?.theme && THEMES.includes(found.theme as Theme)) {
      const serverTheme = found.theme as Theme;
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
    <ThemeContext.Provider value={{ theme, cycleTheme, toggleTheme: cycleTheme, themeLabel: THEME_LABELS[theme] }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
