import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { BASE } from "@/lib/api";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { AUTH_EXPIRED_EVENT } from "@/lib/install-fetch-auth";
import { toast } from "@/hooks/use-toast";
import { canWith, defaultPermissions, type Capability, type PermissionsMe, type Target } from "@/lib/permissions";

export type UserRole = "trader" | "curator" | "admin" | "guest";

export interface UserSession {
  role: UserRole;
  traderName: string | null;
  token?: string | null;
}

// Public shape of GET /api/users (no password/hash ever reaches the client; moderation
// fields bannedAt/bannedReason only for staff).
export type DbUser = {
  id: number;
  name: string;
  role: string;
  active: boolean;
  theme: string;
  banned?: boolean;
  bannedAt?: string | null;
  bannedReason?: string | null;
  createdAt: string;
};

interface AuthContextType {
  user: UserSession | null;
  /** Resolves to null on success, otherwise the reason the login failed. */
  loginAsTrader: (name: string, password: string) => Promise<LoginError | null>;
  /** Asks the API for a read-only guest token (12h). Resolves to null on success. */
  loginAsGuest: () => Promise<LoginError | null>;
  logout: () => void;
  isAuthenticated: boolean;
  canEdit: boolean;
  isCurator: boolean;
  isAdmin: boolean;
  isBanned: boolean;
  dbUsers: DbUser[];
  refreshUsers: () => void;
  /**
   * Effective capabilities from GET /api/permissions/me (desk overrides applied). While the request is in
   * flight — or when it fails — this is the role's default set, so gates render immediately.
   */
  permissions: PermissionsMe;
  /** True once /api/permissions/me answered for the current session. */
  permissionsLoaded: boolean;
  /** UI gate: may I exercise `cap` (optionally on `target.trader`'s data)? The API re-checks every request. */
  can: (cap: Capability, target?: Target | null) => boolean;
  refreshPermissions: () => void;
}

export type LoginError = "invalid" | "rate_limited" | "network" | "banned";

const AuthContext = createContext<AuthContextType | null>(null);

const STORAGE_KEY = "ws_lexx_session";
const TOKEN_KEY = "ws_lexx_token";

const FALLBACK_TRADERS: DbUser[] = [
  { id: 1, name: "Закир", role: "trader", active: true, theme: "default", createdAt: "" },
  { id: 2, name: "Антон", role: "curator", active: true, theme: "default", createdAt: "" },
  { id: 3, name: "Артур", role: "trader", active: true, theme: "default", createdAt: "" },
  { id: 4, name: "Рахматулло", role: "trader", active: true, theme: "default", createdAt: "" },
  { id: 5, name: "Умид", role: "trader", active: true, theme: "default", createdAt: "" },
  { id: 6, name: "Максат", role: "trader", active: true, theme: "default", createdAt: "" },
  { id: 7, name: "Тимур", role: "curator", active: true, theme: "default", createdAt: "" },
  { id: 8, name: "Ориф", role: "curator", active: true, theme: "default", createdAt: "" },
];

function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage blocked */ }
}

let _currentToken: string | null = null;
setAuthTokenGetter(() => _currentToken);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const tok = localStorage.getItem(TOKEN_KEY);
      if (tok) _currentToken = tok;
      if (saved) {
        const parsed = JSON.parse(saved) as UserSession;
        if (tok) parsed.token = tok;
        return parsed;
      }
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

  // Effective permissions for the signed-in session (role defaults until the API answers).
  const [permState, setPermState] = useState<{ token: string | null; me: PermissionsMe | null }>({ token: null, me: null });
  const [permVersion, setPermVersion] = useState(0);
  const refreshPermissions = useCallback(() => setPermVersion((v) => v + 1), []);
  const sessionToken = user?.token ?? null;
  useEffect(() => {
    if (!sessionToken) { setPermState({ token: null, me: null }); return; }
    let cancelled = false;
    fetch(`${BASE}/api/permissions/me`, { headers: { Authorization: `Bearer ${sessionToken}` } })
      .then((r) => (r.ok ? (r.json() as Promise<PermissionsMe>) : null))
      .then((me) => {
        if (cancelled) return;
        if (me && Array.isArray(me.capabilities)) setPermState({ token: sessionToken, me });
        else setPermState({ token: sessionToken, me: null });
      })
      .catch(() => { if (!cancelled) setPermState({ token: sessionToken, me: null }); });
    return () => { cancelled = true; };
  }, [sessionToken, permVersion]);

  // A stored token can expire or be revoked (logout elsewhere, password change, guest token >12h).
  // Every /api/* call now requires a token, so a dead token means every request 401s. Validate it
  // on start and whenever any API call reports a 401; one check at a time, and a session that was
  // already dropped is never dropped twice (no toast storms, no loops).
  useEffect(() => {
    let checking = false;
    const verify = async () => {
      if (checking || !_currentToken) return;
      checking = true;
      const tok = _currentToken;
      try {
        const r = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${tok}` } });
        if (r.status === 401 && _currentToken === tok) {
          _currentToken = null;
          writeToken(null);
          setUser(null);
          toast({ title: "Сессия истекла", description: "Войдите снова, чтобы продолжить работу." });
        }
      } catch {
        // network error — keep the session, the user may just be offline
      } finally {
        checking = false;
      }
    };
    verify();
    window.addEventListener(AUTH_EXPIRED_EVENT, verify);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, verify);
  }, []);

  // A session restored from localStorage without a token (old guest mode stored token: null)
  // can't talk to the API any more — send it back to the login screen.
  useEffect(() => {
    if (user && !user.token && !_currentToken) setUser(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (user) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ role: user.role, traderName: user.traderName }));
        if (user.token) {
          writeToken(user.token);
          _currentToken = user.token;
        }
      } else {
        localStorage.removeItem(STORAGE_KEY);
        writeToken(null);
        _currentToken = null;
      }
    } catch { /* storage blocked */ }
  }, [user]);

  const loginAsTrader = useCallback(async (name: string, password: string): Promise<LoginError | null> => {
    try {
      const r = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password }),
      });
      if (r.status === 429) return "rate_limited";
      if (r.status === 403) return "banned";
      if (!r.ok) return "invalid";
      const data = await r.json() as { token: string; user: { id: number; name: string; role: string } };
      _currentToken = data.token;
      // Persist synchronously so raw fetch() calls fired by the first authenticated render carry the token.
      writeToken(data.token);
      setUser({ role: (data.user.role as UserRole) ?? "trader", traderName: data.user.name, token: data.token });
      return null;
    } catch {
      return "network";
    }
  }, []);

  // Guest = a real (read-only, 12h) token from POST /api/auth/guest, stored exactly like a
  // member token, so every request is authenticated and the server can enforce "view only".
  const loginAsGuest = useCallback(async (): Promise<LoginError | null> => {
    try {
      const r = await fetch(`${BASE}/api/auth/guest`, { method: "POST", headers: { "Content-Type": "application/json" } });
      if (r.status === 429) return "rate_limited";
      if (!r.ok) return "invalid";
      const data = await r.json() as { token: string };
      if (!data?.token) return "invalid";
      _currentToken = data.token;
      writeToken(data.token);
      setUser({ role: "guest", traderName: null, token: data.token });
      return null;
    } catch {
      return "network";
    }
  }, []);

  const logout = useCallback(() => {
    const tok = _currentToken;
    if (tok) {
      fetch(`${BASE}/api/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      }).catch(() => {});
    }
    _currentToken = null;
    writeToken(null);
    setUser(null);
  }, []);

  const bannedNames = dbUsers.filter((u) => u.banned).map((u) => u.name);
  const me = (user?.role !== "guest" && user?.traderName) ? user.traderName : null;

  const permissionsLoaded = !!user && permState.token === sessionToken && permState.me !== null;
  const permissions: PermissionsMe = permissionsLoaded && permState.me ? permState.me : defaultPermissions(user?.role, me);
  const can = useCallback(
    (cap: Capability, target?: Target | null) => canWith(permissions, cap, target),
    [permissions],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loginAsTrader,
        loginAsGuest,
        logout,
        isAuthenticated: user !== null,
        canEdit: (user?.role === "trader" || user?.role === "admin" || user?.role === "curator") && !!me && !bannedNames.includes(me),
        isCurator: user?.role === "curator" || user?.role === "admin",
        isAdmin: user?.role === "admin",
        isBanned: !!me && bannedNames.includes(me),
        dbUsers,
        refreshUsers: fetchUsers,
        permissions,
        permissionsLoaded,
        can,
        refreshPermissions,
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
