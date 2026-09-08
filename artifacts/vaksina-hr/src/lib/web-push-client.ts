/** Brauzer Web Push — Chrome / Safari PWA (Telegramdan mustaqil) */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function isWebPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return reg;
  } catch {
    return null;
  }
}

export async function enableWebPush(): Promise<{ ok: boolean; error?: string; devices?: number }> {
  if (!isWebPushSupported()) {
    return {
      ok: false,
      error:
        "Bu brauzer Web Pushni qo‘llab-quvvatlamaydi. iOS’da Safari orqali Home Screen’ga qo‘shing (iOS 16.4+).",
    };
  }
  if (!window.isSecureContext && location.hostname !== "localhost") {
    return {
      ok: false,
      error: "Web Push faqat HTTPS (yoki localhost) da ishlaydi. Production domen orqali oching.",
    };
  }

  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    return { ok: false, error: "Bildirishnoma ruxsati berilmadi." };
  }

  const reg = await registerPushServiceWorker();
  if (!reg) return { ok: false, error: "Service Worker ro‘yxatdan o‘tmadi." };

  const keyRes = await fetch("/api/push/vapid-public-key", { credentials: "include" });
  if (!keyRes.ok) return { ok: false, error: "VAPID kalit olinmadi." };
  const { publicKey } = (await keyRes.json()) as { publicKey: string };

  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));

  const json = sub.toJSON();
  const save = await fetch("/api/push/subscribe", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
    }),
  });
  if (!save.ok) {
    const err = (await save.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: err.error || "Obuna saqlanmadi" };
  }
  const data = (await save.json()) as { devices?: number };
  return { ok: true, devices: data.devices };
}

export async function getLocalPushState(): Promise<{
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
}> {
  if (!isWebPushSupported()) {
    return { supported: false, permission: "unsupported", subscribed: false };
  }
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return {
    supported: true,
    permission: Notification.permission,
    subscribed: Boolean(sub),
  };
}
