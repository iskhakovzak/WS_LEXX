import { lazy, Suspense, useEffect, useRef } from "react";
import { RouteErrorBoundary } from "@/components/shell/route-error-boundary";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { toast } from "@/hooks/use-toast";
import { humanizeApiError, isAuthError, isClientError } from "@/lib/api-errors";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Trades from "@/pages/trades";
import Events from "@/pages/events";
import LoginPage from "@/pages/login";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { BASE } from "@/lib/api";
import { routeTitle } from "@/components/shell/nav";

const Research = lazy(() => import("@/pages/research"));
const DailyFeed = lazy(() => import("@/pages/dailyfeed"));
const Discussions = lazy(() => import("@/pages/discussions"));
const Analytics = lazy(() => import("@/pages/analytics"));
const Settings = lazy(() => import("@/pages/settings"));
const Watchlist = lazy(() => import("@/pages/watchlist"));
const Playbook = lazy(() => import("@/pages/playbook"));
const TradeIdeas = lazy(() => import("@/pages/trade-ideas"));
const TradeIdeaStats = lazy(() => import("@/pages/trade-idea-stats"));
const Calculator = lazy(() => import("@/pages/calculator"));
const ActivityPage = lazy(() => import("@/pages/activity"));
const ErrorTracker = lazy(() => import("@/pages/error-tracker"));
const Indicators = lazy(() => import("@/pages/indicators"));
const Big7 = lazy(() => import("@/pages/big7"));
const Ratings = lazy(() => import("@/pages/ratings"));
const AnalystActions = lazy(() => import("@/pages/analyst-actions"));
const Stats = lazy(() => import("@/pages/stats"));
const Journal = lazy(() => import("@/pages/journal"));
const TopResults = lazy(() => import("@/pages/top-results"));
const Admin = lazy(() => import("@/pages/admin"));
const Curator = lazy(() => import("@/pages/curator"));
const AuthorNotes = lazy(() => import("@/pages/author-notes"));
const JuniorNotes = lazy(() => import("@/pages/junior-notes"));
const Offerings = lazy(() => import("@/pages/offerings"));
const RiskDesk = lazy(() => import("@/pages/risk"));
const GamePlan = lazy(() => import("@/pages/game-plan"));
const Integrations = lazy(() => import("@/pages/integrations"));
const Scaling = lazy(() => import("@/pages/scaling"));
const WeeklyReview = lazy(() => import("@/pages/weekly-review"));
const Notifications = lazy(() => import("@/pages/notifications"));
const Simulator = lazy(() => import("@/pages/simulator"));
const Behavior = lazy(() => import("@/pages/behavior"));
const DayReport = lazy(() => import("@/pages/day-report"));
const Benchmark = lazy(() => import("@/pages/benchmark"));
const Ask = lazy(() => import("@/pages/ask"));
const ChartLab = lazy(() => import("@/pages/chart-lab"));
const AcademyPath = lazy(() => import("@/pages/academy/path"));
const AcademyChallenges = lazy(() => import("@/pages/academy/challenges"));
const AcademyMy = lazy(() => import("@/pages/academy/my"));
const AcademyMentor = lazy(() => import("@/pages/academy/mentor"));
const AcademyCohorts = lazy(() => import("@/pages/academy/cohorts"));
const AcademyLearn = lazy(() => import("@/pages/academy/learn"));
const AcademyLesson = lazy(() => import("@/pages/academy/lesson"));
const AcademyContentAdmin = lazy(() => import("@/pages/academy/content-admin"));

const queryClient = new QueryClient({
  // Any mutation without its own onError gets one Russian toast (lib/api-errors). 401s are
  // skipped here: the auth context already shows «Сессия истекла» and returns to the login screen.
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.options.onError || isAuthError(error)) return;
      toast({ title: "Не удалось выполнить", description: humanizeApiError(error), variant: "destructive" });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 300_000,
      refetchOnWindowFocus: false,
      // One retry for flaky network/5xx; a 401/403/404/422 answer will not change on retry.
      retry: (failureCount, error) => failureCount < 1 && !isClientError(error),
    },
    mutations: {
      retry: false,
    },
  },
});

// Mirrors the usual page shape (title, KPI row, content) so the swap to the real page doesn't jump.
const PageFallback = (
  <div role="status" aria-busy="true" className="space-y-6">
    <span className="sr-only">Загрузка страницы…</span>
    <div className="space-y-2">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-72 max-w-full" />
    </div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
    </div>
    <Skeleton className="h-64" />
  </div>
);

const APP_NAME = "WS_LEXX";

/** Keeps the tab title in sync with the current section, and moves focus to the new page for keyboard/SR users. */
function RouteTitle() {
  const [location] = useLocation();
  const first = useRef(true);
  useEffect(() => {
    const section = routeTitle(location);
    document.title = section ? `${section} · ${APP_NAME}` : `Страница не найдена · ${APP_NAME}`;
    if (first.current) { first.current = false; return; }
    // After client-side navigation, put focus at the top of the new content (not on the old link).
    const main = document.getElementById("main-content");
    if (main && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
    main?.scrollTo?.({ top: 0 });
  }, [location]);
  return null;
}

function Router() {
  const [location] = useLocation();
  return (
    <Layout>
      <RouteTitle />
      <RouteErrorBoundary resetKey={location}>
      <Suspense fallback={PageFallback}>
        <Switch>
          <Route path="/" component={Dashboard} />
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
          <Route path="/author-notes" component={AuthorNotes} />
          <Route path="/junior-notes" component={JuniorNotes} />
          <Route path="/offerings" component={Offerings} />
          <Route path="/risk" component={RiskDesk} />
          <Route path="/game-plan" component={GamePlan} />
          <Route path="/integrations" component={Integrations} />
          <Route path="/scaling" component={Scaling} />
          <Route path="/weekly-review" component={WeeklyReview} />
          <Route path="/notifications" component={Notifications} />
          <Route path="/simulator" component={Simulator} />
          <Route path="/behavior" component={Behavior} />
          <Route path="/day-report" component={DayReport} />
          <Route path="/benchmark" component={Benchmark} />
          <Route path="/ask" component={Ask} />
          <Route path="/chart-lab" component={ChartLab} />
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
      </Suspense>
      </RouteErrorBoundary>
    </Layout>
  );
}

function AppContent() {
  const { isAuthenticated } = useAuth();

  // Drop every cached response on logout / session expiry so the next user never sees the
  // previous user's data flash in before refetching.
  const wasAuthed = useRef(isAuthenticated);
  useEffect(() => {
    if (wasAuthed.current && !isAuthenticated) queryClient.clear();
    wasAuthed.current = isAuthenticated;
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    document.title = `Вход · ${APP_NAME}`;
    return <LoginPage />;
  }

  return (
    <WouterRouter base={BASE}>
      <Router />
    </WouterRouter>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <ThemeProvider>
            <AppContent />
          </ThemeProvider>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
