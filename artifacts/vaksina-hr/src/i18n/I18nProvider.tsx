import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_LOCALE, LANG_STORAGE_KEY, type Locale, type Messages } from "./types";
import { uz } from "./locales/uz";
import { ru } from "./locales/ru";
import { pagesUz } from "./locales/pages-uz";
import { pagesRu } from "./locales/pages-ru";

export type { Locale } from "./types";
export { DEFAULT_LOCALE, LANG_STORAGE_KEY };

const CATALOG: Record<Locale, Messages> = {
  uz: { ...uz, ...pagesUz },
  ru: { ...ru, ...pagesRu },
};

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, fallback?: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLocale(): Locale {
  try {
    const raw = localStorage.getItem(LANG_STORAGE_KEY);
    if (raw === "uz" || raw === "ru") return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() =>
    typeof window === "undefined" ? DEFAULT_LOCALE : readStoredLocale(),
  );

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "ru" ? "ru" : "uz";
  }, [locale]);

  const t = useCallback(
    (key: string, fallback?: string) => {
      const table = CATALOG[locale] || uz;
      return table[key] ?? CATALOG.uz[key] ?? fallback ?? key;
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}

/** Path → translation key for sidebar items */
export const NAV_PATH_KEYS: Record<string, string> = {
  "/dashboard": "nav.dashboard",
  "/vazifalar": "nav.tasks",
  "/vazifalar/tahlil": "nav.taskAnalytics",
  "/eslatmalar": "nav.reminders",
  "/chat": "nav.chat",
  "/tashkiliy-tuzilma": "nav.org",
  "/requests": "nav.requests",
  "/vacancies": "nav.vacancies",
  "/candidates": "nav.candidates",
  "/interviews": "nav.interviews",
  "/employees": "nav.employees",
  "/davomat": "nav.davomatReport",
  "/davomat-face": "nav.davomat",
  "/davomat/analytics": "nav.davomatAnalytics",
  "/smena-filial": "nav.smena",
  "/checklist-holati": "nav.checklistStatus",
  "/pharmacy-network": "nav.pharmacy",
  "/admin/holat": "nav.holat",
  "/ehtiyoj": "nav.ehtiyoj",
  "/internships": "nav.internships",
  "/oylik": "nav.oylik",
  "/hisobkitob": "nav.hisobkitob",
  "/reyting": "nav.reyting",
  "/reviziya": "nav.reviziya",
  "/it": "nav.it",
  "/texnik": "nav.texnik",
  "/admin/users": "nav.users",
  "/admin/departments": "nav.departments",
  "/admin/kirish-videolar": "nav.kirishVideos",
  "/admin/faces": "nav.faces",
  "/kirish": "nav.kirish",
  "/checklist": "nav.checklist",
  "/notifications": "nav.notifications",
};

export function navLabelForPath(path: string, t: (key: string, fallback?: string) => string, fallbackName?: string) {
  const key = NAV_PATH_KEYS[path];
  if (key) return t(key, fallbackName);
  return fallbackName || path;
}
