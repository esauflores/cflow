import { keepPreviousData, QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

import { type Language, setLanguage, t, useWantedLanguage } from "@web/lib/i18n.ts";

// The API client, its response types, the session token and the shared queries.

export type CategoryType = "INCOME" | "EXPENSE";

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  /** Six-digit hex colour, e.g. "#3b82f6". */
  color: string;
  /** How many transactions use it. */
  usage: number;
}

export interface Transaction {
  id: string;
  title: string;
  /** Negative is money out. */
  amount: number;
  type: CategoryType;
  currency: string;
  date: string;
  category: Category;
  createdAt: string;
}

export interface TransactionInput {
  title: string;
  amount: number;
  date: string;
  categoryId: string;
}

export interface TransactionFilter {
  query?: string;
  type?: CategoryType;
  categoryId?: string;
  page?: number;
  /** Rows per page. Default 20. */
  size?: number;
}

export interface Page<T> {
  content: T[];
  page: { size: number; number: number; totalElements: number; totalPages: number };
}

interface MonthTotals {
  /** `YYYY-MM`. */
  month: string;
  income: number;
  /** Money out, as a positive number. */
  spending: number;
}

export interface CategorySpending {
  id: string;
  name: string;
  amount: number;
  /** Percent of the month's spending. */
  share: number;
}

export interface Summary {
  /** `YYYY-MM`. */
  month: string;
  /** The balance at the end of the month. */
  balance: number;
  current: MonthTotals;
  previous: MonthTotals;
  /** January to December of the month's year. */
  months: MonthTotals[];
  /** The month's spending by category, largest first. */
  categories: CategorySpending[];
}

export interface ServerStatus {
  bootstrapped: boolean;
  demoMode: boolean;
  /** Enabled plugins, by name. */
  plugins: string[];
}

export interface LanguageMessages {
  language: Language;
  /** English text → translation; empty for English. */
  messages: Record<string, string>;
}

export interface Session {
  token: string;
  expiresAt: string;
  /** A guest session may only read. */
  guest: boolean;
}

// Session token, kept in localStorage so a reload stays logged in.

const TOKEN_KEY = "cflow.token";
const GUEST_KEY = "cflow.guest";

/** @internal Exported for tests. */
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Whether the current session is a read-only guest. */
function getGuest(): boolean {
  try {
    return localStorage.getItem(GUEST_KEY) === "1";
  } catch {
    return false;
  }
}

export function setGuest(guest: boolean): void {
  try {
    if (guest) localStorage.setItem(GUEST_KEY, "1");
    else localStorage.removeItem(GUEST_KEY);
  } catch {
    // Storage can be unavailable (private mode); the flag then lasts until reload.
  }
  window.dispatchEvent(new Event("cflow:session"));
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(GUEST_KEY);
    }
  } catch {
    // Storage can be unavailable (private mode); the session then lasts until reload.
  }
  window.dispatchEvent(new Event("cflow:session"));
}

function subscribeToken(onChange: () => void) {
  window.addEventListener("cflow:session", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener("cflow:session", onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The session token, re-rendering on login, logout or expiry. */
export function useToken(): string | null {
  return useSyncExternalStore(subscribeToken, getToken);
}

/** Whether the session is a read-only guest, re-rendering on login or logout. */
export function useGuest(): boolean {
  return useSyncExternalStore(subscribeToken, getGuest);
}

// Requests.

/** A message from the API: English, plus the template and values when it holds any. */
interface ApiMessage {
  message: string;
  template?: string;
  params?: Record<string, string | number>;
}

/** @internal Exported for tests. */
export interface FieldError extends ApiMessage {
  field: string;
}

/**
 * The API's message in the current language: its template translated and filled, the values
 * translated too (a default category's name, "Other"), or the English text as sent.
 */
function translate({ message, template, params }: ApiMessage): string {
  if (!template) return t(message);
  const values = Object.fromEntries(Object.entries(params ?? {}).map(([key, value]) => [key, t(String(value))]));
  return t(template, values);
}

/**
 * A failed request, carrying the API's error code and per-field messages.
 * @internal Exported for tests.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: FieldError[];

  constructor(status: number, code: string, message: ApiMessage, fieldErrors: FieldError[] = []) {
    // The API answers in English; known messages are shown in the current language.
    super(fieldErrors.length > 0 ? fieldErrors.map(translate).join(". ") : translate(message));
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

/** Calls `/api<path>` and unwraps the response envelope's `data`. */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // The browser's own text ("Failed to fetch") says little and isn't translated.
    throw new ApiError(0, "NETWORK_ERROR", { message: "Couldn't reach the server" });
  }
  if (response.status === 204) return undefined as T;

  const envelope = (await response.json().catch(() => null)) as
    | (Partial<ApiMessage> & { data?: T; code?: string; errors?: FieldError[] })
    | null;
  if (!response.ok) {
    // An expired session anywhere sends the user back to the login screen.
    if (response.status === 401 && token && !path.startsWith("/auth/login")) setToken(null);
    throw new ApiError(
      response.status,
      envelope?.code ?? "UNKNOWN",
      envelope?.message
        ? { message: envelope.message, template: envelope.template, params: envelope.params }
        : {
            message: "Request failed ({status})",
            template: "Request failed ({status})",
            params: { status: response.status },
          },
      envelope?.errors ?? [],
    );
  }
  return envelope?.data as T;
}

function withQuery(path: string, query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export const api = {
  auth: {
    status: () => request<ServerStatus>("GET", "/auth/status"),
    bootstrap: (password: string) => request<Session>("POST", "/auth/bootstrap", { password }),
    login: (password: string) => request<Session>("POST", "/auth/login", { password }),
    guest: () => request<Session>("POST", "/auth/guest", {}),
    logout: () => request<void>("POST", "/auth/logout", {}),
    changePassword: (currentPassword: string, newPassword: string) =>
      request<null>("POST", "/auth/change-password", { currentPassword, newPassword }),
  },
  /** Only when the i18n plugin is enabled; public, so the login screen can use it. */
  i18n: {
    messages: (language: Language) => request<LanguageMessages>("GET", `/plugins/i18n/${language}`),
  },
  balance: () => request<{ balance: number }>("GET", "/balance"),
  summary: (month: string) => request<Summary>("GET", `/summary?month=${month}`),
  transactions: {
    list: (filter: TransactionFilter = {}) =>
      request<Page<Transaction>>("GET", withQuery("/transactions", { size: 20, ...filter })),
    create: (input: TransactionInput) => request<Transaction>("POST", "/transactions", input),
    update: (id: string, input: TransactionInput) => request<Transaction>("PUT", `/transactions/${id}`, input),
    delete: (id: string) => request<void>("DELETE", `/transactions/${id}`),
  },
  categories: {
    list: () => request<Category[]>("GET", "/categories"),
    create: (input: { name: string; type: CategoryType; color?: string }) =>
      request<Category>("POST", "/categories", input),
    update: (id: string, input: { name?: string; color?: string }) =>
      request<Category>("PATCH", `/categories/${id}`, input),
    /** Moves its transactions to that type's "Other". */
    delete: (id: string) => request<{ moved: number }>("DELETE", `/categories/${id}`),
  },
};

// Queries.

export function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });
}

export const useSummary = (month: string) =>
  useQuery({
    queryKey: ["summary", month],
    queryFn: () => api.summary(month),
    // Keep the previous month on screen while the next loads.
    placeholderData: keepPreviousData,
  });

export const useCategories = () => useQuery({ queryKey: ["categories"], queryFn: api.categories.list });

export const useTransactions = (filter: TransactionFilter) =>
  useQuery({
    queryKey: ["transactions", filter],
    queryFn: () => api.transactions.list(filter),
    // Keep the current page on screen while the next one loads, so paging doesn't flash empty.
    placeholderData: keepPreviousData,
  });

export const useStatus = () => useQuery({ queryKey: ["auth-status"], queryFn: api.auth.status });

/**
 * Loads the language this browser wants (its pick, or the browser's own) when the i18n plugin is
 * enabled, and English when it isn't. Runs from the login screen on, as the plugin's routes are public.
 */
export function useLanguageSync(): void {
  const status = useStatus();
  const enabled = status.data?.plugins.includes("i18n");
  const wanted = useWantedLanguage();
  const messages = useQuery({
    queryKey: ["i18n", wanted],
    queryFn: () => api.i18n.messages(wanted),
    enabled: enabled === true && wanted !== "en",
    staleTime: Infinity,
  });
  useEffect(() => {
    if (enabled === false || (enabled && wanted === "en")) setLanguage("en");
    else if (messages.data) setLanguage(messages.data.language, messages.data.messages);
  }, [enabled, wanted, messages.data]);
}

/** Refetches everything a transaction change affects. */
export function useInvalidateLedger() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["summary"] }),
      // Usage counts order the dialog's categories.
      client.invalidateQueries({ queryKey: ["categories"] }),
      client.invalidateQueries({ queryKey: ["transactions"] }),
    ]);
}
