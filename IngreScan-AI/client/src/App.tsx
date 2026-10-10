import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
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

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/dashboard"} component={Dashboard} />
      <Route path={"/scanner"} component={Scanner} />
      <Route path={"/produce"} component={ProduceScanner} />
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

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
