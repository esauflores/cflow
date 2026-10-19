import { ArrowDown, ArrowUp, Check, Loader2, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { DatePicker } from "@web/components/DatePicker.tsx";
import { Button } from "@web/components/ui/button.tsx";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@web/components/ui/dialog.tsx";
import { Input } from "@web/components/ui/input.tsx";
import { Label } from "@web/components/ui/label.tsx";
import { api, type CategoryType, type Transaction, useCategories, useInvalidateLedger } from "@web/lib/api.ts";
import { t } from "@web/lib/i18n.ts";
import { cn, dayBefore, today } from "@web/lib/utils.ts";

/** Categories shown before "More…": two rows of four. */
const VISIBLE_CATEGORIES = 8;
/** How long the save button shows its check before the dialog closes. */
const SAVED_MS = 300;
/** How long "Confirm delete" waits for the second click. */
const CONFIRM_MS = 3000;

/** Colours for the selected type: orange for money out, blue for money in. */
const TONE = {
  EXPENSE: { text: "text-spending", chip: "border-spending bg-spending/10 text-spending" },
  INCOME: { text: "text-income", chip: "border-income bg-income/10 text-income" },
} as const;

/**
 * Adds a transaction, or edits and deletes `transaction` when given. The
 * amount is entered as a positive number; the expense/income switch signs it.
 */
export function TransactionDialog({
  transaction,
  open,
  onOpenChange,
}: {
  transaction?: Transaction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-md" aria-describedby={undefined}>
        {/* Keyed so each opening starts from the transaction's current values. */}
        {open && (
          <TransactionForm
            key={transaction?.id ?? "new"}
            transaction={transaction}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TransactionForm({ transaction, onDone }: { transaction?: Transaction; onDone: () => void }) {
  const categories = useCategories();
  const invalidate = useInvalidateLedger();
  const [type, setType] = useState<CategoryType>(transaction?.type ?? "EXPENSE");
  const [amount, setAmount] = useState(transaction ? String(Math.abs(transaction.amount)) : "");
  const [title, setTitle] = useState(transaction?.title ?? "");
  const [date, setDate] = useState(transaction?.date ?? today());
  const [categoryId, setCategoryId] = useState<string | null>(transaction?.category?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "pending" | "saved">("idle");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const tone = TONE[type];
  const todayValue = today();
  const yesterday = dayBefore(todayValue);
  const formRef = useRef<HTMLFormElement>(null);

  // Start on that type's "Other" until a category is chosen. Editing keeps the transaction's own category.
  useEffect(() => {
    if (categoryId !== null) return;
    const fallback = (categories.data ?? []).find((c) => c.type === type && c.name === "Other");
    if (fallback) setCategoryId(fallback.id);
  }, [categories.data, type, categoryId]);

  // Enter saves from anywhere in the dialog; focused controls keep Enter for themselves.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("textarea, button, a")) return;
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = setTimeout(() => setConfirmingDelete(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirmingDelete]);

  function switchType(next: CategoryType) {
    setType(next);
    setCategoryId(null);
    setShowAllCategories(false);
  }

  // Most used first. With more than eight, show seven plus a "More…" chip; the selected one always stays visible.
  const ofType = (categories.data ?? [])
    .filter((c) => c.type === type)
    .sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name));
  const collapsed = !showAllCategories && ofType.length > VISIBLE_CATEGORIES;
  let visibleCategories = collapsed ? ofType.slice(0, VISIBLE_CATEGORIES - 1) : ofType;
  if (collapsed && categoryId && !visibleCategories.some((c) => c.id === categoryId)) {
    visibleCategories = [...visibleCategories.slice(0, -1), ofType.find((c) => c.id === categoryId)!];
  }

  /** Runs the request, briefly shows a check when saving, then closes; on failure shows the error. */
  async function run(action: () => Promise<unknown>, showSaved = true) {
    setStatus("pending");
    setError(null);
    try {
      await action();
      await invalidate();
      if (showSaved) {
        setStatus("saved");
        await new Promise((resolve) => setTimeout(resolve, SAVED_MS));
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("idle");
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (status !== "idle") return;
    const value = Number(amount);
    if (!(value > 0)) {
      setError(t("Enter an amount above 0"));
      return;
    }
    if (!categoryId) {
      setError(t("Choose a category"));
      return;
    }
    const input = {
      title,
      amount: type === "EXPENSE" ? -value : value,
      date,
      categoryId,
    };
    void run(() => (transaction ? api.transactions.update(transaction.id, input) : api.transactions.create(input)));
  }

  const saveLabel = transaction ? t("Save") : type === "EXPENSE" ? t("Add expense") : t("Add income");

  return (
    <form ref={formRef} onSubmit={submit} className="grid">
      <div className="grid gap-6 p-6">
        <DialogTitle>{transaction ? t("Edit transaction") : t("New transaction")}</DialogTitle>

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label={t("Type")}>
          {(["EXPENSE", "INCOME"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={type === option}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => switchType(option)}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-colors outline-none focus-visible:bg-background/60 focus-visible:text-foreground",
                type === option
                  ? cn("bg-background shadow-sm", TONE[option].text)
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="flex items-center gap-1.5">
                {option === "EXPENSE" ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />}
                {option === "EXPENSE" ? t("Expense") : t("Income")}
              </span>
            </button>
          ))}
        </div>

        <div className="grid justify-items-center gap-1">
          <Label htmlFor="amount" className="text-xs font-normal text-muted-foreground">
            {t("Amount")}
          </Label>
          <div className={cn("flex items-baseline gap-1 border-b-2 border-current px-2", tone.text)}>
            <span className="text-2xl font-semibold">{type === "EXPENSE" ? "−$" : "+$"}</span>
            <input
              id="amount"
              // Text, not number: a number input accepts "-", "+" and "e". The sign comes from Expense/Income.
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              className={cn(
                "field-sizing-content min-w-[4ch] bg-transparent font-semibold tabular-nums text-foreground outline-none placeholder:text-muted-foreground/50",
                // Shrink long amounts so the largest, 99999999.99, still fits the dialog.
                amount.length > 8 ? "text-4xl" : "text-5xl",
              )}
              value={amount}
              onChange={(e) => {
                // Up to eight digits, then at most one point and two decimals; the API has the same limit.
                if (/^\d{0,8}(\.\d{0,2})?$/.test(e.target.value)) setAmount(e.target.value);
              }}
              required
              autoFocus
            />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="title">{t("What was it for?")}</Label>
          <Input
            id="title"
            maxLength={50}
            placeholder={type === "EXPENSE" ? t("e.g. Groceries at the market") : t("e.g. October salary")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t("Category")}</span>
            <Link
              to="/settings"
              onClick={onDone}
              className="rounded-sm text-xs font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline"
            >
              {t("Manage")}
            </Link>
          </div>
          <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={t("Category")}>
            {visibleCategories.map((c) => (
              <Chip
                key={c.id}
                selected={categoryId === c.id}
                selectedClass={tone.chip}
                onClick={() => {
                  setCategoryId(c.id);
                  setError(null);
                }}
              >
                {t(c.name)}
              </Chip>
            ))}
            {collapsed && (
              <button
                type="button"
                onClick={() => setShowAllCategories(true)}
                className="h-9 rounded-lg border border-dashed px-2 text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:border-ring"
              >
                {t("More…")}
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-2">
          <span className="text-sm font-medium">{t("Date")}</span>
          <div className="flex gap-2">
            <Chip selected={date === todayValue} selectedClass={tone.chip} onClick={() => setDate(todayValue)}>
              {t("Today")}
            </Chip>
            <Chip selected={date === yesterday} selectedClass={tone.chip} onClick={() => setDate(yesterday)}>
              {t("Yesterday")}
            </Chip>
            <DatePicker
              id="date"
              value={date}
              onChange={setDate}
              max={todayValue}
              className={cn("h-9 flex-1 justify-center", date !== todayValue && date !== yesterday && tone.chip)}
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t bg-muted/40 px-6 py-4">
        {transaction ? (
          <Button
            type="button"
            variant="destructive"
            disabled={status !== "idle"}
            onClick={() =>
              confirmingDelete
                ? void run(() => api.transactions.delete(transaction.id), false)
                : setConfirmingDelete(true)
            }
          >
            <Trash2 />
            <SwapLabel id={confirmingDelete ? "confirm" : "delete"}>
              {confirmingDelete ? t("Confirm delete") : t("Delete")}
            </SwapLabel>
          </Button>
        ) : (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {t("Press")} <kbd className="rounded border bg-muted px-1 font-sans">Enter</kbd> {t("to save")}
          </span>
        )}
        <DialogClose asChild>
          <Button type="button" variant="outline" className="ml-auto">
            {t("Cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" className="min-w-28" disabled={status !== "idle"}>
          <SwapLabel id={status}>
            {status === "pending" ? <Loader2 className="animate-spin" /> : status === "saved" ? <Check /> : saveLabel}
          </SwapLabel>
        </Button>
      </div>
    </form>
  );
}

/** A toggle button used for categories and quick dates. */
function Chip({
  selected,
  selectedClass,
  onClick,
  children,
}: {
  selected: boolean;
  selectedClass: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "h-9 truncate rounded-lg border px-2 text-sm font-medium transition-colors outline-none focus-visible:border-ring",
        selected ? selectedClass : "border-border bg-background hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

/** Slides a button's label when it changes. */
function SwapLabel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={id}
        className="inline-flex items-center"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.15 }}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
}
