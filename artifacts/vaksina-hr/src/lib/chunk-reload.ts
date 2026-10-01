const KEY = "vaksina-chunk-reload";

/** Eski yig‘im yangisidan keyin qolgan JS bo‘lagi topilmasa. */
export function isChunkLoadError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? `${err.name} ${err.message}`
      : typeof err === "string"
        ? err
        : "";
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Unable to preload CSS|dynamically imported module/i.test(
    msg,
  );
}

/**
 * Bir marta toza sahifa yuklaydi. Ikkinchi marta xato qolsa, cheksiz yangilanish bo‘lmaydi.
 * @returns true — sahifa yangilanmoqda
 */
export function reloadForFreshBuild(): boolean {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname;
  try {
    const raw = sessionStorage.getItem(KEY);
    const prev = raw ? (JSON.parse(raw) as { path?: string; at?: number }) : null;
    if (prev?.path === path && typeof prev.at === "number" && Date.now() - prev.at < 20_000) {
      return false;
    }
    sessionStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    /* sessionStorage yopiq bo‘lsa ham bir marta urinamiz */
  }
  const url = new URL(window.location.href);
  url.searchParams.set("_", String(Date.now()));
  window.location.replace(url.toString());
  return true;
}

export function installChunkReload(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadForFreshBuild();
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (!isChunkLoadError(event.reason)) return;
    event.preventDefault();
    reloadForFreshBuild();
  });
}
