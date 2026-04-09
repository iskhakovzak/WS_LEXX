import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Trades from "@/pages/trades";
import Events from "@/pages/events";
import Research from "@/pages/research";
import DailyFeed from "@/pages/dailyfeed";
import Discussions from "@/pages/discussions";
import Analytics from "@/pages/analytics";
import Settings from "@/pages/settings";
import Watchlist from "@/pages/watchlist";
import Playbook from "@/pages/playbook";
import Calculator from "@/pages/calculator";
import ActivityPage from "@/pages/activity";
import ErrorTracker from "@/pages/error-tracker";
import Indicators from "@/pages/indicators";
import Big7 from "@/pages/big7";
import Ratings from "@/pages/ratings";
import LoginPage from "@/pages/login";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import { ThemeProvider } from "@/contexts/theme-context";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/trades" component={Trades} />
        <Route path="/events" component={Events} />
        <Route path="/research" component={Research} />
        <Route path="/dailyfeed" component={DailyFeed} />
        <Route path="/discussions" component={Discussions} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/watchlist" component={Watchlist} />
        <Route path="/playbook" component={Playbook} />
        <Route path="/calculator" component={Calculator} />
        <Route path="/activity" component={ActivityPage} />
        <Route path="/error-tracker" component={ErrorTracker} />
        <Route path="/indicators" component={Indicators} />
        <Route path="/big7" component={Big7} />
        <Route path="/ratings" component={Ratings} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function AppContent() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Router />
    </WouterRouter>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <AuthProvider>
            <AppContent />
          </AuthProvider>
        </ThemeProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
