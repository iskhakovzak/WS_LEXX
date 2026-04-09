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
  AlertTriangle, Sun, Moon, Compass, Radar, Trophy
} from "lucide-react";
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

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const displayName = user?.role === "trader" ? user.traderName : "Guest";

  return (
    <SidebarProvider>
      <div className="min-h-screen w-full flex text-sm text-foreground bg-background">
        <Sidebar className="border-r border-border bg-card">
          <SidebarHeader className="border-b border-border p-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
              <h2 className="text-primary font-bold text-lg font-mono tracking-tight">WS_LEXX</h2>
            </div>
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                <div className="w-5 h-5 bg-primary/15 border border-primary/30 flex items-center justify-center">
                  <User className="h-3 w-3 text-primary" />
                </div>
                <span className="text-foreground/80">{displayName}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-primary"
                  onClick={toggleTheme}
                  title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
                >
                  {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={logout}
                  title="Logout"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </SidebarHeader>
          <SidebarContent>
            {navGroups.map((group) => (
              <SidebarGroup key={group.label}>
                <SidebarGroupLabel className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 px-4 py-1.5">
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
                            className={`text-foreground/70 hover:bg-muted hover:text-foreground font-mono transition-colors rounded-none h-9 ${
                              isActive ? "bg-primary/10 text-primary border-l-2 border-l-primary" : "border-l-2 border-l-transparent"
                            }`}
                          >
                            <Link href={item.href} className="flex items-center gap-3">
                              <item.icon className={`h-4 w-4 ${isActive ? "text-primary" : ""}`} />
                              <span className="text-xs">{item.name}</span>
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
        </Sidebar>
        <main className="flex-1 overflow-auto flex flex-col relative">
          <div className="flex h-12 items-center justify-between border-b border-border bg-card/80 backdrop-blur-sm px-4 shrink-0 sticky top-0 z-30">
            <div className="flex items-center gap-3 lg:hidden">
              <SidebarTrigger className="text-foreground hover:text-primary transition-colors" />
              <h1 className="font-bold text-primary font-mono text-sm tracking-tight">WS_LEXX</h1>
            </div>
            <div className="hidden lg:block" />
            <GlobalSearch />
          </div>
          <div className="flex-1 overflow-auto p-4 md:p-6 pb-20">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
