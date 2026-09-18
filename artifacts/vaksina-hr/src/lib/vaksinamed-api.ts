export type LogistikaSection = "dashboard" | "boshqaruv" | "live" | "davomat" | "panel";

export const LOGISTIKA_SECTIONS: Array<{
  id: LogistikaSection;
  title: string;
  path: string;
  vmPath: "/" | "/fuel" | "/live" | "/attendance" | "/admin";
}> = [
  { id: "dashboard", title: "Dashboard / VHK", path: "/logistika/dashboard", vmPath: "/" },
  { id: "boshqaruv", title: "Boshqaruv", path: "/logistika/boshqaruv", vmPath: "/fuel" },
  { id: "live", title: "Live", path: "/logistika/live", vmPath: "/live" },
  { id: "davomat", title: "GPS Davomat", path: "/logistika/davomat", vmPath: "/attendance" },
  { id: "panel", title: "Panel", path: "/logistika/panel", vmPath: "/admin" },
];

export function sectionFromParam(raw?: string | null): LogistikaSection {
  const s = String(raw || "dashboard").toLowerCase();
  if (s === "vhk" || s === "dashboard" || s === "") return "dashboard";
  if (s === "fuel" || s === "boshqaruv") return "boshqaruv";
  if (s === "live") return "live";
  if (s === "davomat" || s === "attendance") return "davomat";
  if (s === "panel" || s === "admin") return "panel";
  return "dashboard";
}

export function vmPathForSection(section: LogistikaSection): string {
  return LOGISTIKA_SECTIONS.find((x) => x.id === section)?.vmPath || "/";
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      (body as { error?: string }).error || `Xato ${res.status}`,
    ) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = (body as { code?: string }).code;
    throw err;
  }
  return body as T;
}

export async function fetchVaksinamedStatus() {
  return api<{
    ok: boolean;
    configured: boolean;
    allowed: boolean;
    host: string | null;
    healthOk: boolean | null;
    version: number | null;
  }>("/api/integrations/vaksinamed/status");
}

export async function requestVaksinamedSso(path: string, embed = true) {
  return api<{
    ok: boolean;
    enterUrl: string;
    path: string;
    embed: boolean;
    expiresInSec: number;
  }>("/api/integrations/vaksinamed/sso", {
    method: "POST",
    body: JSON.stringify({ path, embed }),
  });
}

export async function fetchVaksinamedFleet(date?: string) {
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  return api<{
    ok: boolean;
    date: string;
    totals?: {
      cars: number;
      withGps: number;
      ok: number;
      diqqat: number;
      muammo: number;
    };
  }>(`/api/integrations/vaksinamed/fleet${qs}`);
}
