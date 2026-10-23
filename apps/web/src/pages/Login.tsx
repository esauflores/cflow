import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { Logo } from "@web/components/Logo.tsx";
import { Button } from "@web/components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@web/components/ui/card.tsx";
import { Input } from "@web/components/ui/input.tsx";
import { Label } from "@web/components/ui/label.tsx";
import { api, setGuest, setToken, useLanguageSync, useToken } from "@web/lib/api.ts";
import { t } from "@web/lib/i18n.ts";

/**
 * Shows first-run setup or login until there is a session, then the app.
 * One server password protects the whole instance.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const token = useToken();
  const status = useQuery({ queryKey: ["auth-status"], queryFn: api.auth.status, enabled: !token });
  // `/demo` enters with a guest session when the server is a demo (DEMO_MODE=true), without a login.
  const demo = window.location.pathname.replace(/\/+$/, "") === "/demo";
  const demoStarted = useRef(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  // From the login screen on: the browser's language, or the one picked in Settings.
  useLanguageSync();

  // The login screen lives at /login; keep the URL there whenever there is no session.
  useEffect(() => {
    if (token || demo) return;
    if (window.location.pathname !== "/login") window.history.replaceState({}, "", "/login");
  }, [token, demo]);

  useEffect(() => {
    if (!demo || token || !status.data?.demoMode || demoStarted.current) return;
    demoStarted.current = true;
    let cancelled = false;
    api.auth
      .guest()
      .then((session) => {
        if (cancelled) return;
        setToken(session.token);
        setGuest(session.guest);
      })
      .catch((err: unknown) => {
        if (!cancelled) setDemoError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [demo, token, status.data?.demoMode]);

  if (token) return children;
  // One screen for "checking the server" and the form, so the logo mounts (and draws) once instead of
  // starting over when the status arrives; it glides up as the form appears.
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <motion.div layout transition={{ type: "spring", stiffness: 500, damping: 40 }}>
        <Logo draw className="size-7" />
      </motion.div>
      {status.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {status.error.message}
        </p>
      ) : demo && status.data && !status.data.demoMode ? (
        <div className="grid justify-items-center gap-2 text-center">
          <p className="text-sm text-muted-foreground">{t("The demo is not available on this server.")}</p>
          <a href="/login" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            {t("Go to sign in")}
          </a>
        </div>
      ) : demo && status.data ? (
        demoError ? (
          <p role="alert" className="text-sm text-destructive">
            {demoError}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t("Entering the demo…")}</p>
        )
      ) : status.data ? (
        <PasswordForm setup={!status.data.bootstrapped} demoMode={status.data.demoMode} />
      ) : null}
    </main>
  );
}

function PasswordForm({ setup, demoMode }: { setup: boolean; demoMode: boolean }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (setup && password !== confirm) {
      setError(t("Passwords do not match"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = setup ? await api.auth.bootstrap(password) : await api.auth.login(password);
      setToken(session.token);
      setGuest(session.guest);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function enterAsGuest() {
    setBusy(true);
    setError(null);
    try {
      const session = await api.auth.guest();
      setToken(session.token);
      setGuest(session.guest);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <motion.div
        className="w-full max-w-sm"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
      >
        <Card>
          <CardHeader>
            <CardTitle>{setup ? t("Set up CFlow") : t("Welcome back")}</CardTitle>
            <CardDescription>
              {setup
                ? t("Choose the password that protects this server.")
                : t("Enter the server password to continue.")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="password">{t("Password")}</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={setup ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={setup ? 8 : 1}
                  required
                  autoFocus
                />
              </div>
              {setup && (
                <div className="grid gap-2">
                  <Label htmlFor="confirm">{t("Confirm password")}</Label>
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                  />
                </div>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={busy}>
                {setup ? t("Create server password") : t("Log in")}
              </Button>
              {demoMode && !setup && (
                <Button type="button" variant="outline" disabled={busy} onClick={() => void enterAsGuest()}>
                  {t("Enter as guest")}
                </Button>
              )}
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </>
  );
}
