/**
 * Telegram Mini App yordamchilari — kamera / native QR.
 */

export type TgWebApp = NonNullable<NonNullable<Window["Telegram"]>["WebApp"]>;

export function getTelegramWebApp(): TgWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

export function isTelegramWebApp(): boolean {
  return Boolean(getTelegramWebApp());
}

/** Telegram WebView — getUserMedia sekinroq / timeout katta kerak */
export function isTelegramCameraHost(): boolean {
  const wa = getTelegramWebApp();
  if (!wa) return false;
  const p = String(wa.platform || "").toLowerCase();
  return p === "android" || p === "ios" || p === "android_x" || p.length > 0;
}

/**
 * Native Telegram QR skaner (Bot API 6.4+).
 * Muvaffaqiyatda QR matnini qaytaradi; qo‘llab-quvvatlanmasa null.
 */
export function scanQrWithTelegramNative(text = "QR kodni ramkaga oling"): Promise<string | null> {
  const wa = getTelegramWebApp() as TgWebApp & {
    showScanQrPopup?: (
      params: { text?: string },
      callback?: (data: string) => boolean | void,
    ) => void;
    closeScanQrPopup?: () => void;
    isVersionAtLeast?: (v: string) => boolean;
  } | null;
  if (!wa?.showScanQrPopup) return Promise.resolve(null);
  if (typeof wa.isVersionAtLeast === "function" && !wa.isVersionAtLeast("6.4")) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      try {
        wa.closeScanQrPopup?.();
      } catch {
        /* ignore */
      }
      resolve(value);
    };

    try {
      wa.showScanQrPopup({ text }, (data) => {
        const raw = String(data || "").trim();
        if (!raw) return false;
        finish(raw);
        return true;
      });
    } catch {
      finish(null);
      return;
    }

    // Foydalanuvchi yopsa — event bo‘lmasligi mumkin; 2 daqiqadan keyin tozalash
    window.setTimeout(() => finish(null), 120_000);
  });
}
