import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type DishCategory = "birinchi" | "ikkinchi" | "salat" | "garnir" | "non" | "ichimlik" | "shirinlik" | "boshqa";
export type Criterion = "taste" | "portion" | "temperature" | "cleanliness" | "service";

export const CATEGORY_LABEL: Record<DishCategory, string> = {
  birinchi: "1-taom",
  ikkinchi: "2-taom",
  salat: "Salat",
  garnir: "Garnir",
  non: "Non",
  ichimlik: "Ichimlik",
  shirinlik: "Shirinlik",
  boshqa: "Boshqa",
};

export const CATEGORY_EMOJI: Record<DishCategory, string> = {
  birinchi: "🥣",
  ikkinchi: "🍛",
  salat: "🥗",
  garnir: "🍚",
  non: "🫓",
  ichimlik: "🍵",
  shirinlik: "🍰",
  boshqa: "🍽",
};

export const DISH_SUGGESTIONS: Record<DishCategory, string[]> = {
  birinchi: ["Mastava", "Sho‘rva", "Mosh xo‘rda", "Chuchvara sho‘rva", "Lag‘mon sho‘rva", "Borsh", "Tovuq sho‘rva", "Kosa sho‘rva"],
  ikkinchi: ["Palov", "Manti", "Lag‘mon", "Dimlama", "Shavla", "Qovurma lag‘mon", "Kotlet", "Jarkop", "Norin", "Somsa"],
  salat: ["Achchiq-chuchuk", "Vinegret", "Sezar", "Olivye", "Karam salat", "Sabzi salat", "Bodring-pomidor"],
  garnir: ["Guruch", "Grechka", "Makaron", "Kartoshka pyure", "Qovurilgan kartoshka"],
  non: ["Tandir non", "Patir", "Obi non"],
  ichimlik: ["Ko‘k choy", "Qora choy", "Kompot", "Limonli choy", "Ayron"],
  shirinlik: ["Mevalar", "Pishiriq", "Halva", "Tort"],
  boshqa: [],
};

export const SCORE_EMOJI: Record<number, string> = { 1: "😣", 2: "😕", 3: "😐", 4: "🙂", 5: "😍" };

export const SCORE_LABEL: Record<number, string> = {
  1: "Juda yomon",
  2: "Yomon",
  3: "O‘rtacha",
  4: "Yaxshi",
  5: "A’lo",
};

export type MenuItem = { name: string; category: DishCategory };

export type AbetMenu = {
  day: string;
  items: MenuItem[];
  note: string | null;
  status: "draft" | "approved";
  createdByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  updatedAt: string;
};

export type AbetRating = {
  id: number;
  day: string;
  userId: number;
  overall: number;
  criteria: Partial<Record<Criterion, number>>;
  dishes: Record<string, number>;
  tags: string[];
  comment: string | null;
  source: "qr" | "app";
  createdAt: string;
  updatedAt: string;
};

export type RateWindow = {
  day: string;
  now: string;
  opensAt: string;
  closesAt: string;
  state: "before" | "open" | "closed";
  menuDeadline: string;
};

export type AbetToday = {
  window: RateWindow;
  menu: AbetMenu | null;
  myRating: AbetRating | null;
  canRate: boolean;
  canManageMenu: boolean;
  canViewAnalytics: boolean;
  categories: DishCategory[];
  criteria: Array<{ key: Criterion; label: string }>;
  tags: string[];
};

export type DayRatingRow = AbetRating & { fullName: string; role: string; department: string | null };

export type DayAnalytics = {
  day: string;
  menu: AbetMenu | null;
  eligible: number;
  responded: number;
  responseRate: number;
  average: number | null;
  distribution: Array<{ score: number; count: number }>;
  criteria: Array<{ key: Criterion; average: number | null; count: number }>;
  dishes: Array<{ name: string; category: DishCategory; average: number | null; count: number }>;
  tags: Array<{ tag: string; count: number }>;
  sources: { qr: number; app: number };
  byDepartment: Array<{ department: string; count: number; average: number }>;
  hourly: Array<{ hm: string; count: number }>;
  ratings: DayRatingRow[];
};

export type RangeAnalytics = {
  from: string;
  to: string;
  eligible: number;
  days: Array<{ day: string; responded: number; average: number | null; approved: boolean; items: string[] }>;
  totalResponses: number;
  average: number | null;
  topDishes: Array<{ name: string; average: number; count: number; days: number }>;
  bottomDishes: Array<{ name: string; average: number; count: number; days: number }>;
};

export type RatingPayload = {
  overall: number;
  criteria: Partial<Record<Criterion, number>>;
  dishes: Record<string, number>;
  tags: string[];
  comment: string;
  qr?: string | null;
  day: string;
};

async function readError(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error || fallback);
}

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!res.ok) throw await readError(res, fallback);
  return res.json() as Promise<T>;
}

async function sendJson<T>(method: "POST" | "PUT", url: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res, fallback);
  return res.json() as Promise<T>;
}

export function useAbetToday() {
  return useQuery({
    queryKey: ["abet", "today"],
    queryFn: () => getJson<AbetToday>("/api/abet/today", "Abet ma’lumoti yuklanmadi"),
    refetchInterval: 60_000,
  });
}

export function useRateAbet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: RatingPayload) => sendJson<{ ok: true; rating: AbetRating }>("POST", "/api/abet/rate", p, "Baho saqlanmadi"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["abet"] }),
  });
}

export function checkAbetQr(qr: string) {
  return sendJson<{ valid: boolean }>("POST", "/api/abet/qr/check", { qr }, "QR tekshirilmadi");
}

export function useAbetMenus(enabled: boolean) {
  return useQuery({
    queryKey: ["abet", "menus"],
    enabled,
    queryFn: () => getJson<{ today: string; items: AbetMenu[] }>("/api/abet/menus", "Menyular yuklanmadi"),
  });
}

export function useSaveAbetMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { day: string; items: MenuItem[]; note: string }) =>
      sendJson<{ menu: AbetMenu }>("PUT", `/api/abet/menu/${v.day}`, { items: v.items, note: v.note }, "Menyu saqlanmadi"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["abet"] }),
  });
}

export function useApproveAbetMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (day: string) =>
      sendJson<{ menu: AbetMenu; notified: number | null }>("POST", `/api/abet/menu/${day}/approve`, {}, "Menyu tasdiqlanmadi"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["abet"] }),
  });
}

export function useAbetDayAnalytics(day: string, enabled: boolean) {
  return useQuery({
    queryKey: ["abet", "analytics", "day", day],
    enabled,
    refetchInterval: 60_000,
    queryFn: () => getJson<DayAnalytics>(`/api/abet/analytics/day?day=${day}`, "Tahlil yuklanmadi"),
  });
}

export function useAbetRangeAnalytics(from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: ["abet", "analytics", "range", from, to],
    enabled,
    queryFn: () => getJson<RangeAnalytics>(`/api/abet/analytics/range?from=${from}&to=${to}`, "Tahlil yuklanmadi"),
  });
}

export function useAbetQr(enabled: boolean) {
  return useQuery({
    queryKey: ["abet", "qr"],
    enabled,
    queryFn: () => getJson<{ token: string; url: string }>("/api/abet/qr", "QR yuklanmadi"),
  });
}

export function useRotateAbetQr() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sendJson<{ token: string; url: string }>("POST", "/api/abet/qr/rotate", {}, "QR yangilanmadi"),
    onSuccess: (v) => qc.setQueryData(["abet", "qr"], v),
  });
}

export async function downloadAbetExcel(from: string, to: string) {
  const res = await fetch(`/api/abet/export?from=${from}&to=${to}`, { credentials: "include" });
  if (!res.ok) throw await readError(res, "Excel yuklanmadi");
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = href;
  a.download = from === to ? `abet_${from}.xlsx` : `abet_${from}_${to}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 5_000);
}

export function tashkentToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

export function shiftDay(ymd: string, delta: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];

export function fmtDay(ymd: string, withWeekday = true): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  const base = `${d.getUTCDate()}-${MONTHS[d.getUTCMonth()]}`;
  return withWeekday ? `${base}, ${WEEKDAYS[d.getUTCDay()]}` : base;
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" });
}

export function scoreTone(v: number | null | undefined): string {
  if (v == null) return "text-slate-400";
  if (v >= 4.5) return "text-emerald-600";
  if (v >= 3.5) return "text-lime-600";
  if (v >= 2.5) return "text-amber-600";
  return "text-red-600";
}
