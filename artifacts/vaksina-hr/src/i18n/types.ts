export type Locale = "uz" | "ru";

export const LOCALES: Locale[] = ["uz", "ru"];
export const DEFAULT_LOCALE: Locale = "uz";
export const LANG_STORAGE_KEY = "vaksina-lang";

export type Messages = Record<string, string>;
