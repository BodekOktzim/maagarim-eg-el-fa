import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import GitHubPagesHome from "./pages/GitHubPagesHome";
import Home from "@/pages/Home";
import Admin from "@/pages/Admin";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  const isAdminRoute = window.location.pathname === "/admin" || window.location.pathname.endsWith("/admin") || new URLSearchParams(window.location.search).get("admin") === "1";
  if (isAdminRoute) {
    return <ErrorBoundary><Admin /></ErrorBoundary>;
  }
  if (!__GITHUB_PAGES_DEMO__ && (window.location.pathname === "/search" || window.location.pathname === "/search/")) {
    return <ErrorBoundary><GitHubPagesHome /></ErrorBoundary>;
  }
  if (__GITHUB_PAGES_DEMO__) {
    if (window.location.pathname !== "/maagarim-eg-el-fa/" && window.location.pathname !== "/maagarim-eg-el-fa") {
      return <ErrorBoundary><GitHubPagesHome /></ErrorBoundary>;
    }
    window.location.replace("https://maagarim-web-search-api.onrender.com/search");
    return <div dir="rtl" className="flex min-h-screen items-center justify-center bg-[#100b17] text-white">מעביר לחיפוש המאובטח…</div>;
  }

  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
