import { ArrowLeftRight, LayoutDashboard, LogOut, Settings } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { NavLink, useLocation, useMatches, useOutlet } from "react-router";

import { Logo } from "@web/components/Logo.tsx";
import { api, setToken } from "@web/lib/api.ts";
import { cn } from "@web/lib/utils.ts";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { to: "/settings", label: "Settings", icon: Settings },
];

/** Each route names its document title through `handle: { title }`. */
export interface RouteHandle {
  title: string;
}

function NavItem({ to, label, icon: Icon }: { to: string; label: string; icon: typeof Settings }) {
  return (
    <NavLink
      to={to}
      end
      title={label}
      className={({ isActive }) =>
        cn(
          "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:bg-accent/60",
          isActive ? "text-accent-foreground" : "text-foreground/80 hover:bg-accent/60",
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* One highlight that slides between links. */}
          {isActive && (
            <motion.span
              layoutId="nav-active"
              className="absolute inset-0 -z-10 rounded-lg bg-accent"
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
            />
          )}
          <Icon className="size-4" aria-hidden />
          {/* Icons only on phones, so every entry fits the top bar; the label stays for screen readers. */}
          <span className="sr-only md:not-sr-only">{label}</span>
        </>
      )}
    </NavLink>
  );
}

/** Sidebar and the current page, which fades in on navigation. */
export function Shell() {
  const location = useLocation();
  const outlet = useOutlet();
  const title = (useMatches().at(-1)?.handle as RouteHandle | undefined)?.title;

  // The tab is just the route's name; back to the app name when the shell unmounts.
  useEffect(() => {
    document.title = title ?? "CFlow";
    return () => {
      document.title = "CFlow";
    };
  }, [title]);

  async function logout() {
    await api.auth.logout().catch(() => undefined);
    setToken(null);
  }

  return (
    <div className="min-h-screen md:flex">
      <aside className="isolate flex items-center gap-2 border-b bg-sidebar p-3 md:sticky md:top-0 md:h-screen md:w-52 md:flex-col md:items-stretch md:gap-6 md:border-r md:border-b-0 md:py-5">
        <div className="hidden px-3 py-1 md:block">
          <div className="flex items-center gap-2">
            <Logo draw className="size-7" />
            <span className="text-lg font-semibold tracking-tight">CFlow</span>
          </div>
          <div className="mt-1 text-sm text-muted-foreground">Personal finance</div>
        </div>
        <nav className="flex flex-1 gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {NAV.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>
        <button
          type="button"
          onClick={() => void logout()}
          title="Log out"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium whitespace-nowrap text-foreground/80 outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent/60"
        >
          <LogOut className="size-4" aria-hidden />
          <span className="sr-only md:not-sr-only">Log out</span>
        </button>
      </aside>

      <div className="min-w-0 flex-1">
        <main className="relative mx-auto w-full max-w-6xl p-4 md:p-8">
          {/* No initial={false} here: it would also switch off the entrance animations of everything inside the page. */}
          {/* popLayout: the new page fades in while the old one fades out on top, instead of waiting for it. */}
          <AnimatePresence mode="popLayout">
            <motion.div
              key={location.pathname}
              // Opacity only: a translated page would briefly overflow the window and flash a scrollbar.
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12, ease: "easeOut" }}
            >
              {outlet}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
