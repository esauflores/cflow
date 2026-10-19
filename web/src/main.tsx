import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";

import { type RouteHandle, Shell } from "@web/components/Shell.tsx";
import { createQueryClient } from "@web/lib/api.ts";
import { useLanguage } from "@web/lib/i18n.ts";
import { Dashboard } from "@web/pages/Dashboard.tsx";
import { AuthGate } from "@web/pages/Login.tsx";
import { Settings } from "@web/pages/Settings.tsx";
import { Transactions } from "@web/pages/Transactions.tsx";

import "@web/index.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <Dashboard />, handle: { title: "Dashboard" } satisfies RouteHandle },
      { path: "transactions", element: <Transactions />, handle: { title: "Transactions" } satisfies RouteHandle },
      { path: "settings", element: <Settings />, handle: { title: "Settings" } satisfies RouteHandle },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

/** The app, rebuilt when the language changes so every label is looked up again. */
function App() {
  const language = useLanguage();
  return (
    <AuthGate key={language}>
      <RouterProvider router={router} />
    </AuthGate>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={createQueryClient()}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
