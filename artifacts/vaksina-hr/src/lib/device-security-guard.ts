/** Global fetch: DEVICE_NOT_AUTHORIZED / SESSION_REVOKED → ogohlantirish */
let hooked = false;

export function installDeviceSecurityFetchGuard() {
  if (typeof window === "undefined" || hooked) return;
  hooked = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init);
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/api/")) return res;
      if (res.status !== 403 && res.status !== 401) return res;
      const clone = res.clone();
      const body = (await clone.json().catch(() => null)) as { code?: string; message?: string; error?: string } | null;
      const code = body?.code;
      if (code === "DEVICE_NOT_AUTHORIZED" || code === "DEVICE_PENDING" || code === "SESSION_REVOKED") {
        const msg =
          body?.message ||
          body?.error ||
          (code === "SESSION_REVOKED"
            ? "Sessiya tugatilgan. Qayta kiring."
            : "Ushbu qurilmadan foydalanishga ruxsat berilmagan.");
        window.dispatchEvent(
          new CustomEvent("vaksina-device-security", { detail: { code, message: msg } }),
        );
      }
    } catch {
      /* ignore */
    }
    return res;
  };
}
