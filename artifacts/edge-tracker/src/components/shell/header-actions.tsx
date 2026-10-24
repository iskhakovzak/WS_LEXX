/** Header right-side controls: language, the «Вид» (appearance) button, the screen lock, notifications bell (popover) and the user menu. */
import React from "react";
import { useLocation } from "wouter";
import { CloudMoon, Gem, LockKeyhole, LogOut, Moon, Palette, Settings, Sun, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { useTheme, type Theme } from "@/contexts/theme-context";
import { useAppearance } from "@/contexts/appearance-context";
import { appearanceI18n } from "@/i18n/ns/appearance";
import { NotificationBell as NotificationBellImpl } from "@/components/notifications/notification-bell";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { commonI18n } from "@/i18n/ns/common";
import { shellI18n } from "@/i18n/ns/shell";
import { personInitials, personName } from "@/i18n";
import { lockI18n } from "@/i18n/ns/lock";
import { LOCK_KEYS } from "@/lib/lock/lock-model";
import { requestLock } from "@/lib/lock/lock-store";

export { LanguageMenu } from "@/i18n/language-switcher";
import { LanguageMenuItems } from "@/i18n/language-switcher";
import { tierDisplay } from "@/components/shared/tier-labels";

export const THEME_ICONS: Record<Theme, React.ElementType> = { dark: Moon, dim: CloudMoon, platinum: Gem, light: Sun };

function roleLabel(role: string): string {
  const t = commonI18n.t;
  if (role === "trader") return t("roles.trader");
  if (role === "curator") return t("roles.curator");
  if (role === "admin") return t("roles.administrator");
  if (role === "guest") return t("roles.guest");
  return role;
}

const iconBtn =
  "chip relative grid h-10 w-10 shrink-0 place-items-center focus-visible:ring-2 focus-visible:ring-ring";

/** The theme button opens «Вид» (themes, colours, font, background, density); the icon shows the current theme. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, themeLabel } = useTheme();
  const { openAppearance } = useAppearance();
  const Icon = THEME_ICONS[theme];
  const { t } = appearanceI18n.useT();
  return (
    <button
      type="button"
      onClick={() => openAppearance("themes")}
      aria-haspopup="dialog"
      className={cn(iconBtn, className)}
      title={t("openTitle", { theme: themeLabel })}
      aria-label={t("openAria")}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

/** «Заблокировать»: the screensaver lock (components/lock-screen.tsx); also Ctrl+Alt+L, the user menu and the palette. */
export function LockButton({ className }: { className?: string }) {
  const { user } = useAuth();
  const { t } = lockI18n.useT();
  if (!user || user.role === "guest") return null;
  return (
    <button
      type="button"
      onClick={requestLock}
      className={cn(iconBtn, className)}
      title={t("buttonTitle", { keys: LOCK_KEYS.join("+") })}
      aria-label={t("button")}
      aria-keyshortcuts="Control+Alt+L"
      data-lock-button=""
    >
      <LockKeyhole className="h-4 w-4" aria-hidden="true" />
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
  const { user, logout, permissions } = useAuth();
  const { theme, setTheme, themes, themeLabels } = useTheme();
  const { openAppearance } = useAppearance();
  const { t: ta } = appearanceI18n.useT();
  const [, navigate] = useLocation();
  const { t } = commonI18n.useT();
  const { t: ts } = shellI18n.useT();
  const { t: tl } = lockI18n.useT();
  const member = user && user.role !== "guest" ? user.traderName ?? null : null;
  const name = member ? personName(member) : user && user.role !== "guest" ? t("roles.user") : t("roles.guest");
  // UMID-34: a trader is shown by their ladder level («Стажёр»), not the technical role «Трейдер».
  const role = user?.role === "trader" && permissions.tier ? tierDisplay(permissions.tier) : roleLabel(user?.role ?? "guest");
  const initial = member ? personInitials(member) : name.trim().charAt(0).toUpperCase() || "?";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" data-i18n-focus="user-menu" className={cn(iconBtn, "font-semibold text-foreground")} aria-label={ts("header.userMenuAria", { name })} title={name}>
          <span aria-hidden="true" className="text-sm">{initial}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-60">
        <DropdownMenuLabel className="flex items-center gap-3 py-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
            <User className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground" title={name}>{name}</span>
            <span className="block text-xs font-normal text-muted-foreground">{role}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("theme.label")}</DropdownMenuLabel>
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
        <DropdownMenuItem onSelect={() => openAppearance("themes")} className="gap-2">
          <Palette className="h-4 w-4" aria-hidden="true" />
          {ta("menuItem")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Language here too: on phones the header language button is hidden. */}
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground md:hidden">{t("language.label")}</DropdownMenuLabel>
        <div className="md:hidden">
          <LanguageMenuItems focus='[data-i18n-focus="user-menu"]' />
          <DropdownMenuSeparator />
        </div>
        <DropdownMenuItem onSelect={() => navigate("/settings")} className="gap-2">
          <Settings className="h-4 w-4" aria-hidden="true" />
          {t("actions.settings")}
        </DropdownMenuItem>
        {user && user.role !== "guest" && (
          <DropdownMenuItem onSelect={requestLock} className="gap-2">
            <LockKeyhole className="h-4 w-4" aria-hidden="true" />
            <span className="flex-1 whitespace-nowrap">{tl("button")}</span>
            <span className="whitespace-nowrap text-2xs tracking-wide text-muted-foreground">{LOCK_KEYS.join("+")}</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={logout} className="gap-2 text-destructive focus:text-destructive">
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {t("actions.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
