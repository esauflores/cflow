import { useQueryClient } from "@tanstack/react-query";
import { Check, Lock, LogOut, Pencil, Trash2, X } from "lucide-react";
import { motion } from "motion/react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "@web/components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@web/components/ui/card.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog.tsx";
import { Input } from "@web/components/ui/input.tsx";
import { Label } from "@web/components/ui/label.tsx";
import { api, type Category, type CategoryType, setToken, useCategories, useGuest, useStatus } from "@web/lib/api.ts";
import { chooseLanguage, LANGUAGE_NAMES, type Language, t, useWantedLanguage } from "@web/lib/i18n.ts";
import { CATEGORY_PALETTE, cn, setTheme, type ThemeChoice, useTheme } from "@web/lib/utils.ts";

// Labels in English, translated when shown.
const SECTIONS = [
  { id: "preferences", label: "Preferences" },
  { id: "categories", label: "Categories" },
  { id: "security", label: "Security" },
] as const;

const THEME_LABELS: Record<ThemeChoice, () => string> = {
  system: () => t("System"),
  light: () => t("Light"),
  dark: () => t("Dark"),
};

/** Matches the API: "Other" takes the transactions of deleted categories, so it stays. */
const FALLBACK_CATEGORY = "Other";

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function Settings() {
  const [active, select] = useActiveSection();
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[11rem_1fr] md:items-start">
      <div className="md:sticky md:top-8">
        <p className="mb-3 hidden text-sm text-muted-foreground md:block">
          {t("Manage your categories, preferences and account security.")}
        </p>
        <nav className="flex gap-1 overflow-x-auto md:flex-col" aria-label={t("Settings sections")}>
          {SECTIONS.map(({ id, label }) => (
            <a
              key={id}
              href={`#${id}`}
              onClick={(event) => {
                event.preventDefault();
                select(id);
                document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className={cn(
                "relative rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:bg-muted/60 focus-visible:text-foreground",
                active === id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {active === id && (
                <motion.span
                  layoutId="settings-active"
                  className="absolute inset-0 -z-10 rounded-lg bg-muted ring-1 ring-border"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              {t(label)}
            </a>
          ))}
        </nav>
      </div>
      {/* Some room after the last section, so the lower sections can scroll up nearer the top. */}
      <div className="isolate grid grid-cols-1 gap-6 pb-16 md:pb-40">
        <Preferences />
        <Categories />
        <Security />
      </div>
    </div>
  );
}

/**
 * The section at the reference line, for the sub-navigation highlight, and `select` for a click. A
 * clicked section stays highlighted until the user scrolls themselves: on a page too short to bring it
 * to the top, the scroll position alone would keep pointing at the last section.
 */
function useActiveSection(): [string, (id: string) => void] {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const clicked = useRef<string | null>(null);
  useEffect(() => {
    let frame = 0;

    const update = () => {
      frame = 0;
      if (clicked.current) return;
      // At the bottom the last section may never reach the line; pick it anyway. Only on a page that
      // scrolls: one that fits the window (e.g. while categories are still loading) is "at the bottom" too.
      const { scrollHeight } = document.documentElement;
      const atBottom = scrollHeight > window.innerHeight + 2 && window.innerHeight + window.scrollY >= scrollHeight - 2;
      if (atBottom) {
        setActive(SECTIONS[SECTIONS.length - 1].id);
        return;
      }
      // A section is active once its top has passed just under the top padding —
      // the same offset a clicked section lands at (`scroll-mt-8`), so the
      // highlight follows the section actually at the top of the viewport.
      const line = 40;
      let current: string = SECTIONS[0].id;
      for (const { id } of SECTIONS) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= line) current = id;
      }
      setActive((prev) => (prev === current ? prev : current));
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    // The user's own scrolling (not the smooth scroll a click starts) hands the highlight back.
    const release = () => {
      clicked.current = null;
      onScroll();
    };
    const userScroll = ["wheel", "touchmove", "keydown"] as const;

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    for (const type of userScroll) window.addEventListener(type, release, { passive: true });
    // Content growing (categories arriving, a row added) moves the sections without any scroll event.
    const observer = new ResizeObserver(onScroll);
    observer.observe(document.body);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      for (const type of userScroll) window.removeEventListener(type, release);
      observer.disconnect();
    };
  }, []);
  const select = (id: string) => {
    clicked.current = id;
    setActive(id);
  };
  return [active, select];
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-8">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Message({ error, success }: { error: string | null; success?: string | null }) {
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (success) return <p className="text-sm text-income">{success}</p>;
  return null;
}

function Preferences() {
  const { choice } = useTheme();
  const status = useStatus();
  return (
    <Section id="preferences" title={t("Preferences")}>
      <div className="grid gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">{t("Theme")}</div>
            <div className="text-sm text-muted-foreground">{t("Match your system or pick one.")}</div>
          </div>
          <div className="flex gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label={t("Theme")}>
            {(["system", "light", "dark"] as ThemeChoice[]).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={choice === option}
                onClick={() => setTheme(option)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-medium outline-none transition-colors focus-visible:bg-background/60 focus-visible:text-foreground",
                  choice === option
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {THEME_LABELS[option]()}
              </button>
            ))}
          </div>
        </div>
        {status.data?.plugins.includes("i18n") && <LanguageChoice />}
      </div>
    </Section>
  );
}

/** This browser's language, offered by the i18n plugin. It follows the browser until one is picked. */
function LanguageChoice() {
  const language = useWantedLanguage();
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <div className="text-sm font-medium">{t("Language")}</div>
        <div className="text-sm text-muted-foreground">{t("Follows your browser until you pick one.")}</div>
      </div>
      <div className="flex gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label={t("Language")}>
        {(Object.keys(LANGUAGE_NAMES) as Language[]).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={language === option}
            onClick={() => chooseLanguage(option)}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium outline-none transition-colors focus-visible:bg-background/60 focus-visible:text-foreground",
              language === option
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {LANGUAGE_NAMES[option]}
          </button>
        ))}
      </div>
    </div>
  );
}

function Categories() {
  const categories = useCategories();
  const guest = useGuest();
  const [deleting, setDeleting] = useState<Category | null>(null);
  return (
    <Section
      id="categories"
      title={t("Categories")}
      description={t('Rename or delete categories. Deleting one moves its transactions to "{other}".', {
        other: t(FALLBACK_CATEGORY),
      })}
    >
      {categories.isError && <Message error={categories.error.message} />}
      <div className="grid gap-6 md:grid-cols-2 md:gap-0 md:divide-x">
        {(["EXPENSE", "INCOME"] as const).map((type) => (
          <CategoryColumn
            key={type}
            type={type}
            categories={(categories.data ?? []).filter((c) => c.type === type)}
            onDelete={setDeleting}
            readOnly={guest}
          />
        ))}
      </div>
      <DeleteCategoryDialog category={deleting} onClose={() => setDeleting(null)} />
    </Section>
  );
}

function CategoryColumn({
  type,
  categories,
  onDelete,
  readOnly,
}: {
  type: CategoryType;
  categories: Category[];
  onDelete: (category: Category) => void;
  readOnly: boolean;
}) {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Alphabetical, with the fallback last.
  const sorted = [...categories].sort(
    (a, b) =>
      Number(a.name === FALLBACK_CATEGORY) - Number(b.name === FALLBACK_CATEGORY) || t(a.name).localeCompare(t(b.name)),
  );
  const label = type === "EXPENSE" ? t("Expense") : t("Income");
  const placeholder = type === "EXPENSE" ? t("New expense category") : t("New income category");

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.categories.create({ name: name.trim(), type });
      setName("");
      await client.invalidateQueries({ queryKey: ["categories"] });
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <div className="grid content-start gap-3 md:px-4 md:first:pl-0 md:last:pr-0">
      <div className="flex items-center justify-between text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
        <span className="tabular-nums">{categories.length}</span>
      </div>
      <ul className="grid">
        {sorted.map((category) => (
          <li key={category.id}>
            <CategoryRow category={category} onDelete={() => onDelete(category)} readOnly={readOnly} />
          </li>
        ))}
      </ul>
      {!readOnly && (
        <form onSubmit={add} className="flex gap-2">
          <Input
            placeholder={placeholder}
            aria-label={placeholder}
            maxLength={50}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            required
          />
          <Button type="submit" variant="outline">
            {t("Add")}
          </Button>
        </form>
      )}
      <Message error={error} />
    </div>
  );
}

function CategoryRow({
  category,
  onDelete,
  readOnly,
}: {
  category: Category;
  onDelete: () => void;
  readOnly: boolean;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(category.color);
  const [error, setError] = useState<string | null>(null);
  const fallback = category.name === FALLBACK_CATEGORY;
  // Default categories are stored in English and shown translated; editing starts from what is shown.
  const shown = t(category.name);

  async function save(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    const renamed = trimmed !== shown;
    if (!renamed && color === category.color) return setEditing(false);
    try {
      await api.categories.update(category.id, { name: renamed ? trimmed : category.name, color });
      await Promise.all([
        client.invalidateQueries({ queryKey: ["categories"] }),
        client.invalidateQueries({ queryKey: ["transactions"] }),
      ]);
      setEditing(false);
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (editing) {
    return (
      <form onSubmit={save} className="grid gap-2 py-2">
        <div className="flex items-center gap-1">
          <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <Input
            aria-label={t("Rename {name}", { name: shown })}
            className="h-8"
            maxLength={50}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
            autoFocus
            required
          />
          <Button type="submit" variant="ghost" size="icon-sm" aria-label={t("Save category")}>
            <Check />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("Cancel")}
            onClick={() => setEditing(false)}
          >
            <X />
          </Button>
        </div>
        <div
          className="flex flex-wrap gap-1.5 px-1"
          role="radiogroup"
          aria-label={t("Colour for {name}", { name: shown })}
        >
          {CATEGORY_PALETTE.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={color === option}
              aria-label={t("Colour {color}", { color: option })}
              onClick={() => setColor(option)}
              className={cn(
                "size-5 rounded-full ring-offset-2 ring-offset-background transition-shadow",
                color === option && "ring-2 ring-foreground",
              )}
              style={{ backgroundColor: option }}
            />
          ))}
        </div>
        <Message error={error} />
      </form>
    );
  }

  return (
    <div className="group flex h-10 items-center gap-2 rounded-md px-2 hover:bg-muted/50">
      <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ backgroundColor: category.color }} />
      <span className="flex-1 truncate text-sm">{shown}</span>
      {fallback ? (
        <span className="flex size-7 items-center justify-center text-muted-foreground" title={t("Always kept")}>
          <Lock className="size-3.5" aria-label={t("Always kept")} />
        </span>
      ) : readOnly ? null : (
        <div className="flex opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Rename {name}", { name: shown })}
            onClick={() => {
              setName(shown);
              setColor(category.color);
              setEditing(true);
            }}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="hover:text-destructive"
            aria-label={t("Delete {name}", { name: shown })}
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </div>
      )}
    </div>
  );
}

function DeleteCategoryDialog({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!category) return;
    setBusy(true);
    setError(null);
    try {
      await api.categories.delete(category.id);
      await Promise.all(
        ["categories", "transactions", "summary"].map((key) => client.invalidateQueries({ queryKey: [key] })),
      );
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const count = category?.usage ?? 0;
  return (
    <Dialog open={category !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("Delete {name}?", { name: category ? t(category.name) : "" })}</DialogTitle>
          <DialogDescription>
            {count === 0
              ? t("No transactions use it.")
              : count === 1
                ? t('Its 1 transaction moves to "{other}".', { other: t(FALLBACK_CATEGORY) })
                : t('Its {count} transactions move to "{other}".', { count, other: t(FALLBACK_CATEGORY) })}
          </DialogDescription>
        </DialogHeader>
        <Message error={error} />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t("Cancel")}</Button>
          </DialogClose>
          <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
            {t("Delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Security() {
  const guest = useGuest();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      await api.auth.changePassword(current, next);
      setCurrent("");
      setNext("");
      setSuccess(t("Password changed. Other sessions were logged out."));
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function logout() {
    await api.auth.logout().catch(() => undefined);
    setToken(null);
  }

  return (
    <Section id="security" title={t("Security")} description={t("One server password protects this CFlow.")}>
      <div className="grid gap-6">
        {!guest && (
          <form onSubmit={submit} className="grid max-w-sm gap-4">
            <div className="grid gap-2">
              <Label htmlFor="current-password">{t("Current password")}</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-password">{t("New password")}</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
              />
            </div>
            <Message error={error} success={success} />
            <Button type="submit" className="justify-self-start">
              {t("Change password")}
            </Button>
          </form>
        )}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-6">
          <div>
            <div className="text-sm font-medium">{t("Log out")}</div>
            <div className="text-sm text-muted-foreground">{t("End this session on this device.")}</div>
          </div>
          <Button variant="outline" onClick={() => void logout()}>
            <LogOut /> {t("Log out")}
          </Button>
        </div>
      </div>
    </Section>
  );
}
