import { lazy, type ComponentType } from "react";

type Loader = () => Promise<unknown>;

const loaders = new Map<string, Loader>();
const started = new Set<string>();

/** `lazy()` bilan bir xil, lekin sahifa kodini oldindan yuklab qo‘yish uchun yo‘lini ro‘yxatga oladi. */
export function lazyPage<T extends ComponentType<any>>(
  paths: string | string[],
  load: () => Promise<{ default: T }>,
) {
  for (const p of Array.isArray(paths) ? paths : [paths]) loaders.set(p, load);
  return lazy(load);
}

function findKey(path: string): string | null {
  const clean = path.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  if (loaders.has(clean)) return clean;
  let best: string | null = null;
  for (const key of loaders.keys()) {
    if (clean.startsWith(key + "/") && (!best || key.length > best.length)) best = key;
  }
  return best;
}

/** Sahifa JS bo‘lagini fonda yuklaydi (bosilganda darhol ochilishi uchun). */
export function prefetchRoute(path: string): void {
  const key = findKey(path);
  if (!key || started.has(key)) return;
  started.add(key);
  loaders
    .get(key)!()
    .catch(() => started.delete(key));
}

function slowNetwork(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!c && (c.saveData === true || /(^|-)2g$/.test(c.effectiveType ?? ""));
}

const idle = (cb: () => void) =>
  typeof window.requestIdleCallback === "function"
    ? window.requestIdleCallback(cb, { timeout: 2000 })
    : window.setTimeout(cb, 200);

/** Menyudagi bo‘limlarni brauzer bo‘sh paytida birma-bir oldindan yuklaydi. */
export function prefetchRoutesWhenIdle(paths: string[]): () => void {
  if (typeof window === "undefined" || slowNetwork()) return () => {};
  const queue = paths.filter((p) => {
    const key = findKey(p);
    return key && !started.has(key);
  });
  let stopped = false;
  const next = (): void => {
    if (stopped) return;
    const p = queue.shift();
    if (!p) return;
    const key = findKey(p);
    if (!key || started.has(key)) {
      idle(next);
      return;
    }
    started.add(key);
    loaders
      .get(key)!()
      .catch(() => started.delete(key))
      .finally(() => idle(next));
  };
  const timer = window.setTimeout(() => idle(next), 1500);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}
