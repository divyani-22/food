import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { trpc } from "@/lib/trpc";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { RouteA11y } from "./components/RouteA11y";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import TermsOfService from "./pages/TermsOfService";
import About from "./pages/About";
import Dashboard from "./pages/Dashboard";
import Scanner from "./pages/Scanner";
import Profile from "./pages/Profile";
import ScanResult from "./pages/ScanResult";
import History from "./pages/History";
import Chat from "./pages/Chat";
import ProduceScanner from "./pages/ProduceScanner";
import FridgeTracker from "./pages/FridgeTracker";
import OpenFoodFactsExplorer from "./pages/OpenFoodFactsExplorer";
import BatchQC from "./pages/BatchQC";
import ReceiptImport from "./pages/ReceiptImport";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/dashboard"} component={Dashboard} />
      <Route path={"/scanner"} component={Scanner} />
      <Route path={"/produce"} component={ProduceScanner} />
      <Route path={"/fridge"} component={FridgeTracker} />
      <Route path={"/expiry"} component={FridgeTracker} />
      <Route path={"/qc"} component={BatchQC} />
      <Route path={"/receipt"} component={ReceiptImport} />
      <Route path={"/openfoodfacts"} component={OpenFoodFactsExplorer} />
      <Route path={"/barcode"} component={OpenFoodFactsExplorer} />
      <Route path={"/profile"} component={Profile} />
      <Route path={"/scan/:id"} component={ScanResult} />
      <Route path={"/history"} component={History} />
      <Route path={"/chat"} component={Chat} />
      <Route path={"/privacy"} component={PrivacyPolicy} />
      <Route path={"/terms"} component={TermsOfService} />
      <Route path={"/about"} component={About} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

/**
 * When a different person becomes the signed-in user in this tab (sign out then sign in as someone else, or a login in
 * another tab), drop every cached query and remount the pages, so nothing from the previous user stays on screen or in
 * a component's state. The first load and a sign out followed by the same person signing in again are left alone.
 */
function SessionBoundary({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const lastUserId = useRef<number | null>(null);
  const [epoch, setEpoch] = useState(0);
  const userId = me.data?.id ?? null;

  useEffect(() => {
    if (userId === null) return;
    if (lastUserId.current !== null && lastUserId.current !== userId) {
      queryClient.clear();
      utils.auth.me.setData(undefined, me.data ?? null);
      setEpoch((e) => e + 1);
    }
    lastUserId.current = userId;
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div key={epoch} className="contents">{children}</div>;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <RouteA11y />
          <Toaster />
          <SessionBoundary>
            <Router />
          </SessionBoundary>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
