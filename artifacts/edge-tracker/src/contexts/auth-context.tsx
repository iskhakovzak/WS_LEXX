import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

export type UserRole = "trader" | "guest";

export interface UserSession {
  role: UserRole;
  traderName: string | null;
}

export type DbUser = {
  id: number;
  name: string;
  password: string;
  role: string;
  active: boolean;
  theme: string;
  createdAt: string;
};

interface AuthContextType {
  user: UserSession | null;
  loginAsTrader: (name: string, password: string) => boolean;
  loginAsGuest: () => void;
  logout: () => void;
  isAuthenticated: boolean;
  canEdit: boolean;
  isCurator: boolean;
  dbUsers: DbUser[];
  refreshUsers: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const STORAGE_KEY = "ws_lexx_session";
const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

const FALLBACK_TRADERS: DbUser[] = [
  { id: 1, name: "Закир", password: "0101", role: "trader", active: true, createdAt: "" },
  { id: 2, name: "Антон", password: "61725", role: "curator", active: true, createdAt: "" },
  { id: 3, name: "Артур", password: "93547", role: "trader", active: true, createdAt: "" },
  { id: 4, name: "Рахматулло", password: "5555", role: "trader", active: true, createdAt: "" },
  { id: 5, name: "Умид", password: "15964", role: "trader", active: true, createdAt: "" },
  { id: 6, name: "Максат", password: "82374", role: "trader", active: true, createdAt: "" },
  { id: 7, name: "Тимур", password: "39156", role: "curator", active: true, createdAt: "" },
  { id: 8, name: "Ариф", password: "07770", role: "curator", active: true, createdAt: "" },
];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  });

  const [dbUsers, setDbUsers] = useState<DbUser[]>(FALLBACK_TRADERS);

  const fetchUsers = useCallback(() => {
    fetch(`${BASE}/api/users`)
      .then((r) => r.json())
      .then((data: DbUser[]) => {
        if (Array.isArray(data) && data.length > 0) setDbUsers(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  useEffect(() => {
    if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    else localStorage.removeItem(STORAGE_KEY);
  }, [user]);

  const loginAsTrader = useCallback((name: string, password: string): boolean => {
    const found = dbUsers.find((u) => u.name === name && u.active);
    if (!found || found.password !== password) return false;
    setUser({ role: "trader", traderName: name });
    return true;
  }, [dbUsers]);

  const loginAsGuest = useCallback(() => {
    setUser({ role: "guest", traderName: null });
  }, []);

  const logout = useCallback(() => { setUser(null); }, []);

  const curators = dbUsers.filter((u) => u.role === "curator").map((u) => u.name);

  return (
    <AuthContext.Provider
      value={{
        user,
        loginAsTrader,
        loginAsGuest,
        logout,
        isAuthenticated: user !== null,
        canEdit: user?.role === "trader",
        isCurator: user?.role === "trader" && !!user.traderName && curators.includes(user.traderName),
        dbUsers,
        refreshUsers: fetchUsers,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}

export function WriteOnly({ children }: { children: React.ReactNode }) {
  const { canEdit } = useAuth();
  if (!canEdit) return null;
  return <>{children}</>;
}
