import React from "react";
import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarHeader,
} from "@/components/ui/sidebar";
import {
  LineChart, LayoutDashboard, List, Activity, BookOpen, Clock,
  MessageSquare, Settings, Eye, BookMarked, Calculator, LogOut, User, Rss,
  AlertTriangle, Sun, Moon, CloudMoon, Coffee, Compass, Radar, Trophy, ChevronRight, Shield
} from "lucide-react";
import type { Theme } from "@/contexts/theme-context";
import { GlobalSearch } from "@/components/global-search";
import { useAuth } from "@/contexts/auth-context";
import { useTheme } from "@/contexts/theme-context";
import { Button } from "@/components/ui/button";

const navGroups = [
  {
    label: "Обзор",
    items: [
      { name: "Dashboard", href: "/", icon: LayoutDashboard },
      { name: "Analytics", href: "/analytics", icon: LineChart },
      { name: "Activity", href: "/activity", icon: Rss },
    ],
  },
  {
    label: "Торговля",
    items: [
      { name: "Trades", href: "/trades", icon: List },
      { name: "Watchlist", href: "/watchlist", icon: Eye },
      { name: "Playbook", href: "/playbook", icon: BookMarked },
      { name: "Calculator", href: "/calculator", icon: Calculator },
    ],
  },
  {
    label: "Аналитика",
    items: [
      { name: "Events", href: "/events", icon: Activity },
      { name: "Research", href: "/research", icon: BookOpen },
      { name: "Daily Feed", href: "/dailyfeed", icon: Clock },
      { name: "Big 7", href: "/big7", icon: Radar },
      { name: "Indicators", href: "/indicators", icon: Compass },
    ],
  },
  {
    label: "Команда",
    items: [
      { name: "Discussions", href: "/discussions", icon: MessageSquare },
      { name: "Ratings", href: "/ratings", icon: Trophy },
      { name: "Error Tracker", href: "/error-tracker", icon: AlertTriangle },
      { name: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

const THEME_ICONS: Record<Theme, React.ElementType> = {
  dark: Moon,
  dim: CloudMoon,
  sepia: Coffee,
  light: Sun,
};
const THEME_NEXT_LABEL: Record<Theme, string> = {
  dark: "Сумеречная (Dim)",
  dim: "Тёплая (Sepia)",
  sepia: "Светлая (Light)",
  light: "Тёмная (Dark)",
};

export function Layout({ children, onWarRoomToggle }: { children: React.ReactNode; onWarRoomToggle?: () => void }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { theme, cycleTheme, themeLabel } = useTheme();

  const displayName = user?.role === "trader" ? user.traderName : "Guest";

  return (
    <SidebarProvider>
      <div className="min-h-screen w-full flex text-sm text-foreground bg-background">
        <Sidebar className="border-r border-border/50 bg-sidebar">
          <SidebarHeader className="border-b border-border/50 p-4">
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <div className="w-2.5 h-2.5 bg-primary rounded-full" />
                <div className="absolute inset-0 w-2.5 h-2.5 bg-primary rounded-full animate-ping opacity-20" />
              </div>
              <h2 className="text-gradient font-black text-xl font-mono tracking-tighter">WS_LEXX</h2>
            </div>
            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <User className="h-3.5 w-3.5 text-primary" />
                </div>
                <div>
                  <span className="text-xs font-medium text-foreground block leading-tight">{displayName}</span>
                  <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">
                    {user?.role === "trader" ? "trader" : "guest"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/5 transition-all duration-200"
                  onClick={cycleTheme}
                  title={`${themeLabel} → ${THEME_NEXT_LABEL[theme]}`}
                >
                  {React.createElement(THEME_ICONS[theme], { className: "h-3.5 w-3.5" })}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-all duration-200"
                  onClick={logout}
                  title="Logout"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </SidebarHeader>
          <SidebarContent className="py-2">
            {navGroups.map((group) => (
              <SidebarGroup key={group.label} className="px-2">
                <SidebarGroupLabel className="text-[9px] font-mono font-semibold uppercase tracking-[0.2em] text-muted-foreground/50 px-3 py-2">
                  {group.label}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => {
                      const isActive = item.href === "/" ? location === "/" : location.startsWith(item.href);
                      return (
                        <SidebarMenuItem key={item.name}>
                          <SidebarMenuButton
                            asChild
                            isActive={isActive}
                            className={`group/nav font-mono transition-all duration-200 rounded-md h-9 mx-1 ${
                              isActive
                                ? "bg-primary/10 text-primary border border-primary/15 shadow-sm shadow-primary/5"
                                : "text-foreground/60 hover:bg-muted/50 hover:text-foreground border border-transparent"
                            }`}
                          >
                            <Link href={item.href} className="flex items-center gap-3 px-2.5">
                              <item.icon className={`h-4 w-4 transition-colors ${isActive ? "text-primary" : "text-muted-foreground group-hover/nav:text-foreground/80"}`} />
                              <span className="text-xs flex-1">{item.name}</span>
                              {isActive && <ChevronRight className="h-3 w-3 text-primary/50" />}
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>
          <div className="mt-auto border-t border-border/50 p-3">
            <div className="flex items-center gap-1.5 text-[9px] font-mono text-muted-foreground/40">
              <div className="w-1.5 h-1.5 bg-emerald-500/70 rounded-full" />
              <span>v2.0</span>
              <span className="mx-1">·</span>
              <span>PROP TRADING DESK</span>
            </div>
          </div>
        </Sidebar>
        <main className="flex-1 overflow-auto flex flex-col relative">
          <div className="flex h-14 items-center justify-between border-b border-border/50 bg-card/60 backdrop-blur-xl px-5 shrink-0 sticky top-0 z-30">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="text-foreground hover:text-primary transition-colors" />
              <h1 className="font-black text-gradient font-mono text-sm tracking-tighter lg:hidden">WS_LEXX</h1>
            </div>
            <GlobalSearch />
            {onWarRoomToggle && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onWarRoomToggle}
                className="h-8 px-2.5 text-orange-400 hover:text-orange-300 hover:bg-orange-500/10 border border-orange-500/20 hover:border-orange-500/40 transition-all duration-200 gap-1.5 font-mono text-xs"
                title="War Room"
              >
                <Shield className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">War Room</span>
              </Button>
            )}
          </div>
          <div className="flex-1 overflow-auto p-4 md:p-6 pb-20">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
