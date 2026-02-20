import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider, ThemeToggle } from "@/components/theme-provider";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/hooks/use-auth";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import DashboardPage from "@/pages/dashboard";
import DocumentsPage from "@/pages/documents";
import UploadPage from "@/pages/upload";
import DocumentDetailPage from "@/pages/document-detail";
import AnalysisPage from "@/pages/analysis";
import DefensePage from "@/pages/defense";
import AdminPage from "@/pages/admin";
import PricingPage from "@/pages/pricing";
import TransactionsPage from "@/pages/transactions";

function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-2 p-2 border-b sticky top-0 z-50 bg-background">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <ThemeToggle />
          </header>
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function ProtectedPage({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <AuthenticatedLayout>
        {children}
      </AuthenticatedLayout>
    </ProtectedRoute>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/">
        {() => (
          <ProtectedPage>
            <DashboardPage />
          </ProtectedPage>
        )}
      </Route>
      <Route path="/documents">
        {() => (
          <ProtectedPage>
            <DocumentsPage />
          </ProtectedPage>
        )}
      </Route>
      <Route path="/upload">
        {() => (
          <ProtectedPage>
            <UploadPage />
          </ProtectedPage>
        )}
      </Route>
      <Route path="/documents/:id">
        {() => (
          <ProtectedPage>
            <DocumentDetailPage />
          </ProtectedPage>
        )}
      </Route>
      <Route path="/analysis/:documentId">
        {() => (
          <ProtectedPage>
            <AnalysisPage />
          </ProtectedPage>
        )}
      </Route>
      <Route path="/defense/:documentId">
        {() => (
          <ProtectedPage>
            <DefensePage />
          </ProtectedPage>
        )}
      </Route>
      <Route path="/admin">
        {() => (
          <ProtectedPage>
            <AdminPage />
          </ProtectedPage>
        )}
      </Route>
      <Route path="/pricing">
        {() => (
          <ProtectedPage>
            <PricingPage />
          </ProtectedPage>
        )}
      </Route>
      <Route path="/transactions">
        {() => (
          <ProtectedPage>
            <TransactionsPage />
          </ProtectedPage>
        )}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
