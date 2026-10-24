import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { MotionConfig } from "framer-motion";
import { RouteErrorBoundary } from "@/components/shell/route-error-boundary";
import { Switch, Route, Redirect, Router as WouterRouter, useLocation, useSearch } from "wouter";
import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { toast } from "@/hooks/use-toast";
import { humanizeApiError, isAuthError, retryDelay, shouldRetryQuery } from "@/lib/api/errors";
import { STALE } from "@/lib/api/keys";
import { PageFallback } from "@/components/shell/page-fallback";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { AppearanceProvider } from "@/contexts/appearance-context";
import { BASE } from "@/lib/api";
import { routeTitle } from "@/components/shell/nav";
import { blockedSectionOf, navFeatureOn } from "@/components/shell/nav-model";
import { ROUTE_LOADERS, preloadCommonRoutes } from "@/components/shell/route-loaders";
import { I18nProvider, i18nReady } from "@/i18n";
import { LocaleSync } from "@/i18n/locale-sync";
import { shellI18n } from "@/i18n/ns/shell";
import { UsageRouteTracker } from "@/components/shared/usage-tracker";
import { WelcomeIntro } from "@/components/shell/welcome-intro";
import { LockController } from "@/components/lock/lock-controller";
import { lockStore, useLockState } from "@/lib/lock/lock-store";
import { UnlockReveal } from "@/components/unlock-reveal";
import { bgMotionAllowed } from "@/components/appearance/scenes/motion";
import { useAppearance } from "@/contexts/appearance-context";

// Every section is its own chunk; see shell/route-loaders.ts. The dashboard too (DEV-11: it pulled the equity chart,
// the daily cards and the quest strip into the entry chunk, which the login screen and every other page also paid for);
// a signed-in session starts its download at once (see AppContent), so the landing page doesn't wait for a click.
const loadDashboard = () => import("@/pages/dashboard").then(async (m) => { await i18nReady(); return m; });
const Dashboard = lazy(loadDashboard);
const L = ROUTE_LOADERS;
const Trades = lazy(L["/trades"]);
const Events = lazy(L["/events"]);
const Research = lazy(L["/research"]);
const DailyFeed = lazy(L["/dailyfeed"]);
const Discussions = lazy(L["/discussions"]);
const Analytics = lazy(L["/analytics"]);
const Settings = lazy(L["/settings"]);
const Watchlist = lazy(L["/watchlist"]);
const Playbook = lazy(L["/playbook"]);
const TradeIdeas = lazy(L["/trade-ideas"]);
const TradeIdeaStats = lazy(L["/trade-idea-stats"]);
const Calculator = lazy(L["/calculator"]);
const ActivityPage = lazy(L["/activity"]);
const ErrorTracker = lazy(L["/rules"]);
const Indicators = lazy(L["/indicators"]);
const Big7 = lazy(L["/big7"]);
const Ratings = lazy(L["/ratings"]);
const AnalystActions = lazy(L["/analyst-actions"]);
const Stats = lazy(L["/stats"]);
const Journal = lazy(L["/journal"]);
const TopResults = lazy(L["/top-results"]);
const Admin = lazy(L["/admin"]);
const Curator = lazy(L["/curator"]);
const AuthorNotes = lazy(L["/author-notes"]);
const JuniorNotes = lazy(L["/junior-notes"]);
const Offerings = lazy(L["/offerings"]);
const Themes = lazy(L["/themes"]);
const RiskDesk = lazy(L["/risk"]);
const GamePlan = lazy(L["/game-plan"]);
const Integrations = lazy(L["/integrations"]);
const Scaling = lazy(L["/scaling"]);
const WeeklyReview = lazy(L["/weekly-review"]);
const Notifications = lazy(L["/notifications"]);
const Simulator = lazy(L["/simulator"]);
const Trainer = lazy(L["/trainer"]);
const WhatIf = lazy(L["/what-if"]);
const Behavior = lazy(L["/behavior"]);
const DayReport = lazy(L["/day-report"]);
const MyReview = lazy(L["/my-review"]);
const Benchmark = lazy(L["/benchmark"]);
const OfficeStats = lazy(L["/office"]);
const Ask = lazy(L["/ask"]);
const ChartLab = lazy(L["/chart-lab"]);
const DeskDay = lazy(L["/desk-day"]);
const AcademyPath = lazy(L["/academy/path"]);
const AcademyChallenges = lazy(L["/academy/challenges"]);
const AcademyMy = lazy(L["/academy/my"]);
const AcademyMentor = lazy(L["/academy/mentor"]);
const AcademyCohorts = lazy(L["/academy/cohorts"]);
const AcademyLearn = lazy(L["/academy/learn"]);
const AcademyLesson = lazy(L["/academy/lesson"]);
const AcademyContentAdmin = lazy(L["/academy/content-admin"]);
// Signed-out screen and the 404 page: own chunks too (a signed-in visit never needs the login form).
const NotFound = lazy(() => import("@/pages/not-found").then(async (m) => { await i18nReady(); return m; }));
const LoginPage = lazy(() => import("@/pages/login").then(async (m) => { await i18nReady(); return m; }));
// Screen lock «Заблокировать»: rendered INSTEAD of the routes while locked (components/lock-screen.tsx); preloaded when idle.
const loadLockScreen = () => import("@/components/lock-screen").then(async (m) => { await i18nReady(); return m; });
const LockScreen = lazy(loadLockScreen);
// «Раздел закрыт для вашей ступени» (desk setting access.sections): own chunk, only a closed URL ever loads it.
const SectionBlocked = lazy(() => import("@/pages/section-blocked").then(async (m) => { await i18nReady(); return m; }));

const queryClient = new QueryClient({
  // Any mutation without its own onError gets one toast in the UI language (lib/api/errors). 401s are
  // skipped here: the auth context already shows «Сессия истекла» and returns to the login screen.
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.options.onError || isAuthError(error)) return;
      toast({ title: shellI18n.t("app.actionFailed"), description: humanizeApiError(error), variant: "destructive" });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: STALE.default,
      gcTime: 300_000,
      refetchOnWindowFocus: false,
      // Network / 5xx: up to 2 retries with backoff; a 401/403/404/422 answer will not change on retry.
      retry: shouldRetryQuery,
      retryDelay,
    },
    mutations: {
      retry: false,
    },
  },
});


const APP_NAME = "WS_Desk";

/** Keeps the tab title in sync with the current section, and moves focus to the new page for keyboard/SR users. */
function RouteTitle() {
  const [location] = useLocation();
  const search = useSearch();
  const first = useRef(true);
  // Re-run on a language switch too (and when a namespace chunk arrives): `lang` changes the title text.
  const { lang } = shellI18n.useT();
  useEffect(() => {
    const section = routeTitle(location, search);
    document.title = `${section ?? shellI18n.t("titles.notFound")} · ${APP_NAME}`;
  }, [location, search, lang]);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    // After client-side navigation, put focus at the top of the new content (not on the old link).
    const main = document.getElementById("main-content");
    if (main && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
    main?.scrollTo?.({ top: 0 });
  }, [location]);
  return null;
}

/** «Сводка автора» is behind the desk switch nav.authorNotes (Волна 2 п. 2.15, default off): off → the 404 page. */
function AuthorNotesRoute() {
  const { permissions, permissionsLoaded } = useAuth();
  if (!permissionsLoaded) return <PageFallback />;
  return navFeatureOn("authorNotes", permissions.nav) ? <AuthorNotes /> : <NotFound />;
}

function Router() {
  const [location] = useLocation();
  // Route guard: a section closed for the viewer's ladder stage (GET /api/permissions/me → nav.blocked; staff never).
  const { permissions } = useAuth();
  const closed = blockedSectionOf(location, permissions.nav);
  // Trades used to ship in the main bundle; warm its chunk once the first screen is idle so the most common
  // next click stays instant.
  useEffect(() => preloadCommonRoutes(["/trades"]), []);
  return (
    <Layout>
      <RouteTitle />
      <UsageRouteTracker />
      <RouteErrorBoundary resetKey={location}>
      <Suspense fallback={<PageFallback />}>
        {closed ? <SectionBlocked section={closed} /> : (
        <Switch>
          <Route path="/" component={Dashboard} />
          {/* Signed in already (the login screen renders outside the router): a typed / bookmarked /login goes home. */}
          <Route path="/login"><Redirect to="/" replace /></Route>
          <Route path="/trades" component={Trades} />
          <Route path="/journal" component={Journal} />
          <Route path="/top-results" component={TopResults} />
          <Route path="/events" component={Events} />
          <Route path="/research" component={Research} />
          <Route path="/dailyfeed" component={DailyFeed} />
          <Route path="/discussions" component={Discussions} />
          <Route path="/analytics" component={Analytics} />
          <Route path="/stats" component={Stats} />
          <Route path="/watchlist" component={Watchlist} />
          <Route path="/playbook" component={Playbook} />
          <Route path="/trade-ideas" component={TradeIdeas} />
          <Route path="/trade-idea-stats" component={TradeIdeaStats} />
          <Route path="/calculator" component={Calculator} />
          <Route path="/activity" component={ActivityPage} />
          <Route path="/rules" component={ErrorTracker} />
          <Route path="/error-tracker" component={ErrorTracker} />
          <Route path="/indicators" component={Indicators} />
          <Route path="/big7" component={Big7} />
          <Route path="/ratings" component={Ratings} />
          <Route path="/analyst-actions" component={AnalystActions} />
          <Route path="/settings" component={Settings} />
          <Route path="/admin" component={Admin} />
          <Route path="/curator" component={Curator} />
          <Route path="/author-notes" component={AuthorNotesRoute} />
          <Route path="/junior-notes" component={JuniorNotes} />
          <Route path="/offerings" component={Offerings} />
          <Route path="/themes" component={Themes} />
          <Route path="/risk" component={RiskDesk} />
          <Route path="/game-plan" component={GamePlan} />
          <Route path="/integrations" component={Integrations} />
          <Route path="/scaling" component={Scaling} />
          <Route path="/weekly-review" component={WeeklyReview} />
          <Route path="/my-review" component={MyReview} />
          <Route path="/notifications" component={Notifications} />
          <Route path="/simulator" component={Simulator} />
          <Route path="/trainer" component={Trainer} />
          <Route path="/what-if" component={WhatIf} />
          <Route path="/behavior" component={Behavior} />
          <Route path="/day-report" component={DayReport} />
          <Route path="/benchmark" component={Benchmark} />
          <Route path="/office" component={OfficeStats} />
          <Route path="/ask" component={Ask} />
          <Route path="/chart-lab" component={ChartLab} />
          <Route path="/desk-day" component={DeskDay} />
          <Route path="/academy/path" component={AcademyPath} />
          <Route path="/academy/challenges" component={AcademyChallenges} />
          <Route path="/academy/my" component={AcademyMy} />
          <Route path="/academy/mentor" component={AcademyMentor} />
          <Route path="/academy/cohorts" component={AcademyCohorts} />
          <Route path="/academy/learn" component={AcademyLearn} />
          <Route path="/academy/lesson" component={AcademyLesson} />
          <Route path="/academy/content-admin" component={AcademyContentAdmin} />
          <Route component={NotFound} />
        </Switch>
        )}
      </Suspense>
      </RouteErrorBoundary>
    </Layout>
  );
}

function AppContent() {
  const { isAuthenticated, user } = useAuth();
  const lock = useLockState();
  // Locked: the routes unmount (no page, number or poll stays alive underneath) and the query cache is dropped; the
  // unlock re-mounts the same URL and refetches. The server refuses this token meanwhile (423 SESSION_LOCKED).
  const locked = isAuthenticated && lock.locked && user?.role !== "guest";
  useEffect(() => {
    if (locked) queryClient.clear();
  }, [locked]);
  // Locked → unlocked, or signed out → signed in: the site opens through an iris from where the check / the «Войти»
  // button was (components/unlock-reveal.tsx).
  const { appearance } = useAppearance();
  const [revealing, setRevealing] = useState(false);
  const wasLocked = useRef(locked);
  const wasSignedIn = useRef(isAuthenticated);
  useEffect(() => {
    if (isAuthenticated && ((wasLocked.current && !locked) || !wasSignedIn.current)) setRevealing(true);
    wasLocked.current = locked;
    wasSignedIn.current = isAuthenticated;
  }, [locked, isAuthenticated]);
  const endReveal = useCallback(() => setRevealing(false), []);
  // Signed out (menu, 5 wrong codes, an expired session): the lock belonged to that session.
  useEffect(() => {
    if (!isAuthenticated && (lock.locked || lock.signedOut)) lockStore.reset();
  }, [isAuthenticated, lock.locked, lock.signedOut]);

  // Drop every cached response on logout / session expiry so the next user never sees the
  // previous user's data flash in before refetching.
  const wasAuthed = useRef(isAuthenticated);
  useEffect(() => {
    if (wasAuthed.current && !isAuthenticated) queryClient.clear();
    wasAuthed.current = isAuthenticated;
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) void loadDashboard().catch(() => undefined);
    if (!isAuthenticated) return;
    const id = window.setTimeout(() => void loadLockScreen().catch(() => undefined), 5_000);
    return () => window.clearTimeout(id);
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    document.title = `${shellI18n.t("titles.login")} · ${APP_NAME}`;
    return (
      <Suspense fallback={null}>
        <LoginPage />
      </Suspense>
    );
  }

  return (
    <>
      {locked ? (
        <Suspense fallback={<div aria-hidden="true" className="fixed inset-0 z-tooltip bg-black" />}>
          <LockScreen />
        </Suspense>
      ) : (
        <WouterRouter base={BASE}>
          <Router />
        </WouterRouter>
      )}
      {revealing && !locked && <UnlockReveal motion={bgMotionAllowed(appearance.bg.motion)} onDone={endReveal} />}
      <LockController />
    </>
  );
}

/** Notifications never show over the lock screen. */
function AppToaster() {
  const { locked } = useLockState();
  return locked ? null : <Toaster />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* framer-motion follows the OS «reduce motion» setting everywhere (transforms/layout off, opacity kept). */}
      <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <AuthProvider>
          <ThemeProvider>
          {/* «Вид»: personal look (accent, money colours, font, background, density) as CSS variables on <html>. */}
          <AppearanceProvider>
            <LocaleSync />
            {/* Opening «Добро пожаловать, трейдер» / «Доброе утро, …» overlay; the app renders underneath meanwhile. */}
            <WelcomeIntro />
            {/* Re-mounts the app on a language switch (query cache, auth and theme survive; see i18n/README.md). */}
            <I18nProvider>
              {/* Last line of defence: a crash in the shell itself (header, sidebar) shows a retry instead of a blank page. */}
              <RouteErrorBoundary resetKey="app">
                <AppContent />
              </RouteErrorBoundary>
            </I18nProvider>
          </AppearanceProvider>
          </ThemeProvider>
        </AuthProvider>
        <AppToaster />
      </TooltipProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}

export default App;
