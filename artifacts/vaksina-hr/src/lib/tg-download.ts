/**
 * Telegram Mini App vs oddiy brauzer — fayl yuklash.
 * Mini Appda: bot chatga yuboradi.
 * Webda: klassik blob download.
 */

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        platform?: string;
        version?: string;
      };
    };
  }
}

export function isTelegramMiniApp(): boolean {
  if (typeof window === "undefined") return false;
  const wa = window.Telegram?.WebApp;
  if (wa?.initData && wa.initData.trim().length > 0) return true;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get("tg") === "1") return true;
  } catch {
    /* ignore */
  }
  return false;
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function sendBlobToTelegram(blob: Blob, filename: string): Promise<void> {
  const res = await fetch("/api/telegram/send-file", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": blob.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(filename),
    },
    body: blob,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (body as { error?: string }).error || `Telegramga yuborilmadi (${res.status})`,
    );
  }
}

export type DeliverFileResult = { via: "telegram" | "browser" };

/**
 * Faylni yetkazish: Telegram Mini App → bot, aks holda brauzer download.
 */
export async function deliverFile(
  blob: Blob,
  filename: string,
): Promise<DeliverFileResult> {
  const name = String(filename || "fayl").trim() || "fayl";
  if (!blob?.size) throw new Error("Fayl bo‘sh");

  if (isTelegramMiniApp()) {
    await sendBlobToTelegram(blob, name);
    return { via: "telegram" };
  }

  triggerBrowserDownload(blob, name);
  return { via: "browser" };
}

/** URL (masalan /api/uploads/...) dan olib yetkazish */
export async function deliverFileFromUrl(
  url: string,
  fallbackName = "fayl",
): Promise<DeliverFileResult> {
  const href =
    url.startsWith("/api/uploads/") && !/[?&]download=1/.test(url)
      ? url.includes("?")
        ? `${url}&download=1`
        : `${url}?download=1`
      : url;

  const res = await fetch(href, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error || `Fayl olinmadi (${res.status})`,
    );
  }
  const blob = await res.blob();
  if (!blob.size) throw new Error("Fayl bo‘sh");

  const cd = res.headers.get("Content-Disposition") || "";
  const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
  let filename = fallbackName;
  if (match) {
    try {
      filename = decodeURIComponent((match[1] || match[2] || "").trim()) || fallbackName;
    } catch {
      filename = (match[1] || match[2] || fallbackName).trim();
    }
  }

  return deliverFile(blob, filename);
}
