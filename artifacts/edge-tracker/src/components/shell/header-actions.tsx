/** Header right-side controls: theme toggle, notifications bell (popover) and the user menu. */
import React from "react";
import { useLocation } from "wouter";
import { CloudMoon, LogOut, Moon, Settings, Sun, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { useTheme, type Theme } from "@/contexts/theme-context";
import { NotificationBell as NotificationBellImpl } from "@/components/notifications/notification-bell";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const THEME_ICONS: Record<Theme, React.ElementType> = { dark: Moon, dim: CloudMoon, light: Sun };

const ROLE_LABEL: Record<string, string> = { trader: "Трейдер", curator: "Куратор", admin: "Администратор", guest: "Гость" };

const iconBtn =
  "chip relative grid h-10 w-10 shrink-0 place-items-center focus-visible:ring-2 focus-visible:ring-ring";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, cycleTheme, themeLabel, themes, themeLabels } = useTheme();
  const next = themes[(themes.indexOf(theme) + 1) % themes.length];
  const Icon = THEME_ICONS[theme];
  return (
    <button
      type="button"
      onClick={cycleTheme}
      className={cn(iconBtn, className)}
      title={`Тема: ${themeLabel} → ${themeLabels[next]}`}
      aria-label={`Сменить тему: сейчас ${themeLabel}, следующая ${themeLabels[next]}`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

/**
 * Bell with unread badge + popover (components/notifications/notification-bell.tsx).
 * `traderName` is accepted for backwards compatibility with the layout; identity comes from the auth context.
 */
export function NotificationBell(_props: { traderName?: string; className?: string }) {
  return <NotificationBellImpl className={_props.className} />;
}

export function UserMenu() {
  const { user, logout } = useAuth();
  const { theme, setTheme, themes, themeLabels } = useTheme();
  const [, navigate] = useLocation();
  const name = user && user.role !== "guest" ? (user.traderName ?? "Пользователь") : "Гость";
  const role = ROLE_LABEL[user?.role ?? "guest"] ?? user?.role ?? "";
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn(iconBtn, "font-semibold text-foreground")} aria-label={`Меню пользователя: ${name}`}>
          <span aria-hidden="true" className="text-sm">{initial}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-60">
        <DropdownMenuLabel className="flex items-center gap-3 py-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
            <User className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">{name}</span>
            <span className="block text-xs font-normal text-muted-foreground">{role}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Тема</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          {themes.map((t) => {
            const Icon = THEME_ICONS[t];
            return (
              <DropdownMenuRadioItem key={t} value={t} className="gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {themeLabels[t]}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/settings")} className="gap-2">
          <Settings className="h-4 w-4" aria-hidden="true" />
          Настройки
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={logout} className="gap-2 text-destructive focus:text-destructive">
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
