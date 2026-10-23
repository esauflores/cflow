import { useSyncExternalStore } from "react";

// Translation. Text is written in English and passed through `t()`, which looks it up in the
// messages the i18n plugin serves for the current language and falls back to the English text, so
// without the plugin (or in English) everything reads as written.
//
// The language is each browser's: the one the user picked in Settings, or else the browser's own.
// The current language and its messages are also kept in the browser, so a reload doesn't flash
// English while the messages load.

export type Language = "en" | "es";

/** Each language's name, written in that language. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: "English", es: "Español" };

/** Dates and numbers. US Spanish writes USD as "$1,234.50" like English; most Spanish locales write "USD". */
const LOCALES: Record<Language, string> = { en: "en-US", es: "es-US" };

interface State {
  language: Language;
  messages: Record<string, string>;
}

const KEY = "cflow.i18n";
const CHOICE_KEY = "cflow.language";
const EVENT = "cflow:i18n";
const ENGLISH: State = { language: "en", messages: {} };

function load(): State {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<State> | null;
    if (saved && (saved.language === "en" || saved.language === "es")) {
      return { language: saved.language, messages: saved.messages ?? {} };
    }
  } catch {
    // Unreadable or unavailable storage: English.
  }
  return ENGLISH;
}

let state = load();
document.documentElement.lang = state.language;

/** `text` in the current language; `{name}` placeholders are filled from `vars`. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const translated = state.messages[text] ?? text;
  return vars ? translated.replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match)) : translated;
}

/** The BCP 47 locale for formatting dates and numbers in the current language. */
export function locale(): string {
  return LOCALES[state.language];
}

/** Switches the language; every component re-renders through `useLanguage`. */
export function setLanguage(language: Language, messages: Record<string, string> = {}): void {
  if (language === state.language && JSON.stringify(messages) === JSON.stringify(state.messages)) return;
  state = { language, messages };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Not remembered when storage is unavailable.
  }
  document.documentElement.lang = language;
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

/** The current language; components that key on it re-render when it changes. */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribe, () => state.language);
}

const isLanguage = (value: unknown): value is Language => value === "en" || value === "es";

/** The language this browser wants: the user's pick, or else the browser's own (Spanish for `es-*`). */
function wantedLanguage(): Language {
  try {
    const choice = localStorage.getItem(CHOICE_KEY);
    if (isLanguage(choice)) return choice;
  } catch {
    // No saved pick.
  }
  return navigator.languages?.[0]?.toLowerCase().startsWith("es") ? "es" : "en";
}

/** Remembers the user's pick for this browser; the app then loads that language. */
export function chooseLanguage(language: Language): void {
  try {
    localStorage.setItem(CHOICE_KEY, language);
  } catch {
    // Not remembered when storage is unavailable.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The language this browser wants, which may still be loading. */
export function useWantedLanguage(): Language {
  return useSyncExternalStore(subscribe, wantedLanguage);
}
