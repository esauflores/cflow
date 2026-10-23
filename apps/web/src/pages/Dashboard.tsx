import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";

import { BarChart, RingChart } from "@web/components/Charts.tsx";
import { Money, Percent } from "@web/components/Money.tsx";
import { TransactionDialog } from "@web/components/TransactionDialog.tsx";
import { Button } from "@web/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@web/components/ui/card.tsx";
import {
  type Category,
  type CategorySpending,
  type Summary,
  type Transaction,
  useCategories,
  useGuest,
  useSummary,
  useTransactions,
} from "@web/lib/api.ts";
import { locale, t } from "@web/lib/i18n.ts";
import { categoryColors, cn, formatMoney, greeting, percentChange } from "@web/lib/utils.ts";

// Formats in the current language, made when used so they follow a language change.
const format = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale(), { ...options, timeZone: "UTC" });
const monthLong = (date: Date) => format({ month: "long", year: "numeric" }).format(date);
const monthOnly = (date: Date) => format({ month: "long" }).format(date);
const shortDate = (date: Date) => format({ month: "short", day: "numeric" }).format(date);
/** "Jan" … "Dec", or "ene" … "dic". */
const monthNames = () =>
  Array.from({ length: 12 }, (_, i) =>
    format({ month: "short" })
      .format(new Date(Date.UTC(2000, i, 1)))
      .replace(".", ""),
  );

/** Cards grow in, all at once. They start smaller, never offset, so the page never outgrows the window. */
const stagger: Variants = { show: {} };
const rise: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  show: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 300, damping: 30 } },
};

/** Colours for the categories, shared by "Where it went" and the activity avatars. */
function useCategoryColor(): (id: string) => string {
  const categories = useCategories();
  return categoryColors(categories.data ?? []);
}

/** Green for positive, red for negative, neutral for zero. */
const signColor = (value: number) =>
  value > 0 ? "text-emerald-500" : value < 0 ? "text-destructive" : "text-foreground";

const asDate = (month: string) => new Date(`${month}-01T00:00:00Z`);

function shiftMonth(month: string, by: number): string {
  const date = asDate(month);
  date.setUTCMonth(date.getUTCMonth() + by);
  return date.toISOString().slice(0, 7);
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Home: one month at a time — its numbers, the year around it, where the money went and recent activity. */
export function Dashboard() {
  const thisMonth = currentMonth();
  const [month, setMonth] = useState(thisMonth);
  const [editing, setEditing] = useState<Transaction | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const summary = useSummary(month);
  const data = summary.data;
  const guest = useGuest();

  function openDialog(transaction?: Transaction) {
    if (guest) return;
    setEditing(transaction);
    setDialogOpen(true);
  }

  return (
    <motion.div className="grid grid-cols-1 gap-6" variants={stagger} initial="hidden" animate="show">
      <motion.div variants={rise} className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">{greeting()}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {month === thisMonth
              ? t("Here's where your money stands this month.")
              : t("Here's where your money stands in {month}.", { month: monthLong(asDate(month)) })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border bg-card">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("Previous month")}
              onClick={() => setMonth(shiftMonth(month, -1))}
            >
              <ChevronLeft />
            </Button>
            <span className="min-w-32 text-center text-sm font-medium tabular-nums">{monthLong(asDate(month))}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("Next month")}
              disabled={month >= thisMonth}
              onClick={() => setMonth(shiftMonth(month, 1))}
            >
              <ChevronRight />
            </Button>
          </div>
          {!guest && (
            <Button onClick={() => openDialog()}>
              <Plus /> {t("New transaction")}
            </Button>
          )}
        </div>
      </motion.div>

      {summary.isError && (
        <p role="alert" className="text-sm text-destructive">
          {summary.error.message}
        </p>
      )}

      <Stats data={data} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <motion.div variants={rise} className="lg:col-span-2">
          <IncomeVsSpending data={data} />
        </motion.div>
        <motion.div variants={rise}>
          <WhereItWent data={data} />
        </motion.div>
        <motion.div variants={rise} className="lg:col-span-2">
          <RecentActivity onOpen={openDialog} />
        </motion.div>
        <motion.div variants={rise}>
          <MonthRing data={data} />
        </motion.div>
      </div>

      <TransactionDialog transaction={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
    </motion.div>
  );
}

/** A change against last month: green when up, red when down. */
function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">{t("Nothing last month")}</span>;
  return (
    <span className="text-muted-foreground">
      <span className={signColor(value)}>
        {value > 0 ? "+" : ""}
        {value}%
      </span>{" "}
      {t("vs last month")}
    </span>
  );
}

function StatCard({ label, children, footer }: { label: string; children: ReactNode; footer: ReactNode }) {
  return (
    <motion.div variants={rise}>
      {/* Two by two on phones: tighter padding and a smaller amount, so "$107,456.83" fits half the width. */}
      <Card className="h-full gap-2 [--card-spacing:--spacing(3)] sm:[--card-spacing:--spacing(4)]">
        <CardContent className="grid gap-1.5 sm:gap-2">
          <div className="text-xs font-medium sm:text-sm">{label}</div>
          <div className="text-lg font-semibold tracking-tight min-[400px]:text-xl sm:text-3xl">{children}</div>
          <div className="text-xs sm:text-sm">{footer}</div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function Stats({ data }: { data: Summary | undefined }) {
  const net = data ? data.current.income - data.current.spending : 0;
  const saved = data && data.current.income > 0 ? Math.round((net / data.current.income) * 1000) / 10 : null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-4">
      <StatCard
        label={t("Balance")}
        footer={
          data ? (
            // The previous month closed at this balance minus this month's net.
            <Change value={percentChange(data.balance, data.balance - net)} />
          ) : null
        }
      >
        {data ? (
          <Money amount={data.balance} countUp className={data.balance < 0 ? "text-destructive" : "text-emerald-500"} />
        ) : (
          "…"
        )}
      </StatCard>
      <StatCard
        label={t("Income")}
        footer={data ? <Change value={percentChange(data.current.income, data.previous.income)} /> : null}
      >
        {data ? <Money amount={data.current.income} countUp className="text-income" /> : "…"}
      </StatCard>
      <StatCard
        label={t("Spending")}
        footer={data ? <Change value={percentChange(data.current.spending, data.previous.spending)} /> : null}
      >
        {data ? <Money amount={data.current.spending} countUp className="text-spending" /> : "…"}
      </StatCard>
      <StatCard
        label={t("Net this month")}
        footer={
          saved === null ? (
            <span className="text-muted-foreground">{t("No income yet")}</span>
          ) : (
            <span className="text-muted-foreground">
              <span className={cn("font-medium", signColor(saved))}>{saved}%</span> {t("of income saved")}
            </span>
          )
        }
      >
        {data ? (
          <Money amount={net} signed countUp className={net < 0 ? "text-destructive" : "text-emerald-500"} />
        ) : (
          "…"
        )}
      </StatCard>
    </div>
  );
}

function IncomeVsSpending({ data }: { data: Summary | undefined }) {
  const names = monthNames();
  const selected = data ? names[Number(data.month.slice(5)) - 1]! : "";
  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <CardTitle>{t("Income vs spending")}</CardTitle>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <Legend color="bg-income">{t("Income")}</Legend>
            <Legend color="bg-spending">{t("Spending")}</Legend>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {/* Fills the card, so the chart lines up with the column beside it. */}
        <div className="relative min-h-56 flex-1">
          {data && (
            <BarChart
              // Remounted per year, so a new year's bars grow in; within a year only the highlight moves.
              key={data.month.slice(0, 4)}
              data={data.months.map((m, i) => ({ label: names[i]!, income: m.income, spending: m.spending }))}
              series={[
                { key: "income", label: t("Income"), color: "var(--income)" },
                { key: "spending", label: t("Spending"), color: "var(--spending)" },
              ]}
              selected={selected}
              format={formatMoney}
              className="absolute inset-0"
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Rows shown in "Where it went" before the rest are folded into "Other". */
const TOP_CATEGORIES = 5;
const REST_ID = "rest";

/**
 * Always five named rows plus "Other": the five largest, topped up with unspent expense categories in name
 * order ($0, 0%), then "Other" holding Other itself and everything past the five (possibly $0).
 */
function topCategories(spending: CategorySpending[], expenseCategories: Category[]): CategorySpending[] {
  const named = spending.filter((c) => c.name !== "Other");
  const top = named.slice(0, TOP_CATEGORIES);
  const unspent = expenseCategories
    .filter((c) => c.name !== "Other" && !named.some((s) => s.id === c.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ id: c.id, name: c.name, amount: 0, share: 0 }));
  const filled = [...top, ...unspent].slice(0, TOP_CATEGORIES);
  const rest = [...named.slice(TOP_CATEGORIES), ...spending.filter((c) => c.name === "Other")];
  const sum = (key: "amount" | "share") => Math.round(rest.reduce((total, c) => total + c[key], 0) * 100) / 100;
  return [...filled, { id: REST_ID, name: "Other", amount: sum("amount"), share: sum("share") }];
}

function WhereItWent({ data }: { data: Summary | undefined }) {
  const colorOf = useCategoryColor();
  const categories = useCategories();
  const rows = data
    ? topCategories(
        data.categories,
        (categories.data ?? []).filter((c) => c.type === "EXPENSE"),
      )
    : [];
  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t("Where it went")}</CardTitle>
        {data && (
          <span className="text-sm text-muted-foreground tabular-nums">{formatMoney(data.current.spending)}</span>
        )}
      </CardHeader>
      <CardContent>
        <ul className="relative grid gap-4">
          <AnimatePresence initial={false} mode="popLayout">
            {rows.map((c) => (
              <motion.li
                key={c.id}
                // Measured only when the order changes, not on every render: layout reads force a reflow.
                layout
                layoutDependency={rows.map((row) => row.id).join()}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 280, damping: 30 }}
                className="grid gap-1.5"
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: colorOf(c.id) }} />
                  <span className="flex-1 truncate">{t(c.name)}</span>
                  <span className="font-medium tabular-nums">{formatMoney(c.amount)}</span>
                  <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
                    {Math.round(c.share)}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  {/* Full width, scaled from the left: a transform the GPU moves, where animating width reflows. */}
                  <motion.div
                    className="h-full w-full rounded-full"
                    style={{ background: colorOf(c.id), originX: 0 }}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: c.share / 100 }}
                    transition={{ type: "spring", stiffness: 280, damping: 30 }}
                  />
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </CardContent>
    </Card>
  );
}

function RecentActivity({ onOpen }: { onOpen: (transaction: Transaction) => void }) {
  const recent = useTransactions({});
  const colorOf = useCategoryColor();
  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t("Recent activity")}</CardTitle>
        <Link
          to="/transactions"
          className="rounded-sm text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline"
        >
          {t("See all")}
        </Link>
      </CardHeader>
      <CardContent>
        {recent.data?.content.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("No transactions yet.")}</p>
        )}
        {/* popLayout takes the row that drops off out of the flow at once, so the card never grows. */}
        {/* Widened by the rows' padding, so a focused or hovered row's background reaches past the text. */}
        <ul className="relative -mx-2 divide-y overflow-hidden">
          <AnimatePresence initial={false} mode="popLayout">
            {recent.data?.content.slice(0, 5).map((tx) => (
              <motion.li
                key={tx.id}
                layout
                layoutDependency={recent.data?.content
                  .slice(0, 5)
                  .map((row) => row.id)
                  .join()}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
              >
                <button
                  type="button"
                  onClick={() => onOpen(tx)}
                  className="group flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/80"
                >
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold transition-transform group-hover:scale-105"
                    style={{
                      color: colorOf(tx.category.id),
                      background: `color-mix(in oklab, ${colorOf(tx.category.id)} 15%, transparent)`,
                    }}
                    aria-hidden
                  >
                    {t(tx.category.name).charAt(0)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{tx.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t(tx.category.name)} · {shortDate(new Date(`${tx.date}T00:00:00Z`))}
                    </span>
                  </span>
                  <Money amount={tx.amount} signed className={cn("font-semibold", tx.amount > 0 && "text-income")} />
                  <ChevronRight
                    className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Spent (inner ring) and kept (outer ring), both measured against income. Spending past the income fills the
 * inner ring and is called out; nothing was kept then.
 */
function MonthRing({ data }: { data: Summary | undefined }) {
  const income = data?.current.income ?? 0;
  const spent = data?.current.spending ?? 0;
  const kept = Math.max(income - spent, 0);
  const over = Math.max(spent - income, 0);
  const saved = income > 0 ? Math.round((kept / income) * 100) : null;
  // Ring 0 is the innermost. With no income, any spending fills the ring.
  const scale = income > 0 ? income : Math.max(spent, 1);
  const rings = [
    { label: t("Spent"), value: Math.min(spent, scale), max: scale, color: "var(--spending)" },
    { label: t("Kept"), value: kept, max: scale, color: "#22c55e" },
  ];
  const change = data ? percentChange(spent, data.previous.spending) : null;
  const top = data?.categories[0];

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{t("This month")}</CardTitle>
      </CardHeader>
      {/* Fills the card: the ring sits centred in the spare height, the insight at the bottom. */}
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="flex flex-1 items-center gap-5">
          <div className="relative">
            <RingChart rings={rings} size={128} strokeWidth={9} gap={4} />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className={cn("text-xl font-semibold tabular-nums", over > 0 && "text-destructive")}>
                {saved === null ? "—" : <Percent value={saved} />}
              </span>
              <span className="text-xs text-muted-foreground">{t("saved")}</span>
            </div>
          </div>
          <div className="grid gap-2 text-sm">
            <Legend color="bg-[#22c55e]">
              {t("Kept")} <span className="font-semibold tabular-nums">{formatMoney(kept)}</span>
            </Legend>
            <Legend color="bg-spending">
              {t("Spent")} <span className="font-semibold tabular-nums">{formatMoney(spent)}</span>
            </Legend>
            <span className="text-xs text-muted-foreground">
              {t("of {amount} income", { amount: formatMoney(income) })}
            </span>
            {over > 0 && (
              <span className="text-xs text-destructive">
                {t("{amount} over income", { amount: formatMoney(over) })}
              </span>
            )}
          </div>
        </div>
        {data && (change !== null || top) && (
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            {/* One sentence per line. */}
            {change !== null && (
              <span className="block">
                {t("You're spending")}{" "}
                <span className={change > 0 ? "text-destructive" : "text-emerald-500"}>
                  {Math.abs(change)}% {change > 0 ? t("more") : t("less")}
                </span>{" "}
                {t("than {month}.", { month: monthOnly(asDate(data.previous.month)) })}
              </span>
            )}
            {top && (
              <span className="block">
                <span className="text-foreground">{t(top.name)}</span> {t("is your biggest category.")}
              </span>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Legend({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("size-2 rounded-full", color)} /> {children}
    </span>
  );
}
