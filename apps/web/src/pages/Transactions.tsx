import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Plus, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { TransactionDialog } from "@web/components/TransactionDialog.tsx";
import { Badge } from "@web/components/ui/badge.tsx";
import { Button } from "@web/components/ui/button.tsx";
import { Card, CardContent } from "@web/components/ui/card.tsx";
import { Input } from "@web/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@web/components/ui/select.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@web/components/ui/table.tsx";
import { type CategoryType, type Transaction, useCategories, useGuest, useTransactions } from "@web/lib/api.ts";
import { t } from "@web/lib/i18n.ts";
import { cn, formatDate, formatMoney } from "@web/lib/utils.ts";

type TypeFilter = "ALL" | CategoryType;

const PAGE_SIZES = [20, 50, 100];

/** The account's transactions, newest first. Click a row to edit it. */
export function Transactions() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<TypeFilter>("ALL");
  const [category, setCategory] = useState("ALL");
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(PAGE_SIZES[0]!);
  const [editing, setEditing] = useState<Transaction | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const categories = useCategories();
  const guest = useGuest();
  const list = useTransactions({
    query: query.trim() || undefined,
    type: type === "ALL" ? undefined : type,
    categoryId: category === "ALL" ? undefined : category,
    page,
    size,
  });
  const content = list.data?.content ?? [];
  const total = list.data?.page.totalElements ?? 0;
  const totalPages = list.data?.page.totalPages ?? 0;
  const filtered = query.trim() !== "" || type !== "ALL" || category !== "ALL";
  const categoryOptions = (categories.data ?? [])
    .filter((c) => type === "ALL" || c.type === type)
    .sort((a, b) => a.name.localeCompare(b.name));

  function goTo(next: number) {
    setPage(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openDialog(transaction?: Transaction) {
    // Guests may open the form for a new transaction, but not edit an existing one.
    if (guest && transaction) return;
    setEditing(transaction);
    setDialogOpen(true);
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-3xl font-semibold tracking-tight">{t("Transactions")}</h2>
        <Button onClick={() => openDialog()}>
          <Plus /> {t("Add")}
        </Button>
      </div>

      {list.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {list.error.message}
        </p>
      ) : (
        <Card className="gap-0 py-2">
          {/* Filters live with the table they affect. */}
          <div className="flex flex-wrap items-center gap-2 border-b px-4 pt-1 pb-3">
            <div className="relative w-full max-w-sm">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                className="pl-8"
                placeholder={t("Search")}
                aria-label={t("Search")}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </div>
            <Select
              value={type}
              onValueChange={(value) => {
                const next = value as TypeFilter;
                setType(next);
                setPage(0);
                // Drop a category that the new type no longer offers.
                const chosen = categories.data?.find((c) => c.id === category);
                if (next !== "ALL" && chosen && chosen.type !== next) setCategory("ALL");
              }}
            >
              <SelectTrigger className="w-32" aria-label={t("Type")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("All")}</SelectItem>
                <SelectItem value="EXPENSE">{t("Expenses")}</SelectItem>
                <SelectItem value="INCOME">{t("Income")}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={category}
              onValueChange={(value) => {
                setCategory(value);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-44" aria-label={t("Category")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("All categories")}</SelectItem>
                {(["EXPENSE", "INCOME"] as const).map((group) =>
                  type !== "ALL" && type !== group ? null : (
                    <SelectGroup key={group}>
                      <SelectLabel>{group === "EXPENSE" ? t("Expense") : t("Income")}</SelectLabel>
                      {categoryOptions
                        .filter((c) => c.type === group)
                        .map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {t(c.name)}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  ),
                )}
              </SelectContent>
            </Select>
            <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
              {t("Rows")}
              <Select
                value={String(size)}
                onValueChange={(value) => {
                  setSize(Number(value));
                  setPage(0);
                }}
              >
                <SelectTrigger size="sm" className="w-18" aria-label={t("Rows per page")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <CardContent className="px-2">
            {content.length === 0 ? (
              list.isPending ? null : (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  {filtered ? t("No matching transactions.") : t("No transactions yet.")}
                </p>
              )
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="hidden w-32 sm:table-cell">{t("Date")}</TableHead>
                    <TableHead>{t("Title")}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t("Category")}</TableHead>
                    <TableHead className="text-right">{t("Amount")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {content.map((tx) => (
                    <TableRow
                      key={tx.id}
                      tabIndex={0}
                      className="cursor-pointer odd:bg-muted/40 hover:bg-muted/80 focus-visible:bg-muted/80 focus-visible:outline-none"
                      onClick={() => openDialog(tx)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openDialog(tx);
                        }
                      }}
                    >
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {formatDate(tx.date)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {tx.title}
                        {/* On phones the date column is hidden; it shows under the title instead. */}
                        <div className="text-xs font-normal text-muted-foreground sm:hidden">{formatDate(tx.date)}</div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant="secondary">{t(tx.category.name)}</Badge>
                      </TableCell>
                      <TableCell className={cn("text-right font-medium tabular-nums", tx.amount > 0 && "text-income")}>
                        {tx.amount > 0 ? "+" : ""}
                        {formatMoney(tx.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>

          {/* Count and pager sit with the rows, at the bottom. */}
          {content.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 border-t px-4 pt-3 pb-1 text-sm text-muted-foreground sm:justify-start">
              <span className="tabular-nums">
                {t("{from}–{to} of {total}", { from: page * size + 1, to: Math.min((page + 1) * size, total), total })}
              </span>
              <Pagination page={page} totalPages={totalPages} onPage={goTo} />
            </div>
          )}
        </Card>
      )}

      <TransactionDialog transaction={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

/** Page numbers around the current one, with the first and last always shown. */
function pageItems(page: number, totalPages: number): (number | "gap")[] {
  const shown = new Set([0, totalPages - 1, page - 1, page, page + 1].filter((p) => p >= 0 && p < totalPages));
  const sorted = [...shown].sort((a, b) => a - b);
  return sorted.flatMap((p, i) => (i > 0 && p - sorted[i - 1]! > 1 ? ["gap" as const, p] : [p]));
}

function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  const last = totalPages - 1;
  return (
    <nav className="flex items-center gap-1 sm:ml-auto" aria-label={t("Pages")}>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={page === 0}
        onClick={() => onPage(0)}
        aria-label={t("First page")}
      >
        <ChevronsLeft />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
        aria-label={t("Previous page")}
      >
        <ChevronLeft />
      </Button>
      {/* Numbers glide to their new places as the window of pages shifts; one pill slides to the current page. */}
      <AnimatePresence mode="popLayout" initial={false}>
        {pageItems(page, totalPages).map((item, i, items) => (
          <motion.div
            // Gaps are keyed by side, so the one before the current page stays itself.
            key={item === "gap" ? (items.indexOf(page) > i ? "gap-start" : "gap-end") : item}
            layout
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: "spring", stiffness: 500, damping: 38 }}
            className="relative"
          >
            {item === "gap" ? (
              <span className="px-1">…</span>
            ) : (
              <>
                {item === page && (
                  <motion.span
                    layoutId="page-active"
                    className="absolute inset-0 rounded-md bg-muted ring-1 ring-border"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  />
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "relative min-w-8 tabular-nums hover:bg-transparent dark:hover:bg-transparent",
                    item === page ? "text-foreground" : "hover:text-foreground",
                  )}
                  aria-current={item === page ? "page" : undefined}
                  onClick={() => onPage(item)}
                >
                  {item + 1}
                </Button>
              </>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={page === last}
        onClick={() => onPage(page + 1)}
        aria-label={t("Next page")}
      >
        <ChevronRight />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={page === last}
        onClick={() => onPage(last)}
        aria-label={t("Last page")}
      >
        <ChevronsRight />
      </Button>
    </nav>
  );
}
