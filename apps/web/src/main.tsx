import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";

import { type RouteHandle, Shell } from "@web/components/Shell.tsx";
import { createQueryClient } from "@web/lib/api.ts";
import { useLanguage } from "@web/lib/i18n.ts";
import { Dashboard } from "@web/pages/Dashboard.tsx";
import { AuthGate } from "@web/pages/Login.tsx";
import { Settings } from "@web/pages/Settings.tsx";
import { Transactions } from "@web/pages/Transactions.tsx";

import "@web/styles/global.css";

const container = document.getElementById("root");
if (!container) throw new Error('Missing <div id="root"> in web/index.html');

const router = createBrowserRouter([
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <Dashboard />, handle: { title: "Dashboard" } satisfies RouteHandle },
      // `/demo` has already opened a guest session by the time the router mounts; show the dashboard.
      { path: "demo", element: <Navigate to="/" replace /> },
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

/**
 * In dev, Bun reruns this file when it changes: the root is kept in `import.meta.hot.data`, so the app renders into the
 * same root instead of mounting React twice. In production `import.meta.hot` is undefined.
 */
let root: Root;
if (import.meta.hot) root = import.meta.hot.data.root ??= createRoot(container);
else root = createRoot(container);

root.render(
  <StrictMode>
    <QueryClientProvider client={createQueryClient()}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
