import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import type { VerifiedTier } from "@/lib/roles";

export type EmployeeTitle = "faol" | "ishonchli" | "professional" | "premium" | "rivojlanish";

/** Yuqoridan pastga: eng yuqori unvon birinchi. */
export const EMPLOYEE_TITLE_ORDER: EmployeeTitle[] = ["premium", "professional", "ishonchli", "faol", "rivojlanish"];

export type TitleMeta = {
  label: string;
  name: string;
  tagline: string;
  description: string;
  criteria: string[];
  /** warning — ogohlantirish (salbiy) belgisi */
  tone: "positive" | "warning";
  /** Matn / chegara rangi (UI kartalari uchun) */
  accent: string;
  soft: string;
};

export const TITLE_META: Record<EmployeeTitle, TitleMeta> = {
  premium: {
    label: "PREMIUM",
    name: "Premium xodim",
    tagline: "Kompaniyaning faxri",
    description:
      "Xodimlar uchun eng yuqori unvon. Alohida xizmatlari, uzoq muddatli a’lo natijalari va kompaniyaga sadoqati uchun beriladi.",
    criteria: ["Alohida xizmatlar va yutuqlar", "Uzoq muddat davomida a’lo natija", "Kompaniyaga sadoqat va namunali xulq"],
    tone: "positive",
    accent: "#C8102E",
    soft: "#FFF1F2",
  },
  professional: {
    label: "PROFESSIONAL",
    name: "Professional",
    tagline: "O‘z ishining ustasi",
    description:
      "Sohasini chuqur biladi, doimo yuqori natija ko‘rsatadi va hamkasblariga namuna hamda maslahatchi bo‘ladi.",
    criteria: ["Yuqori va barqaror natija", "Chuqur kasbiy bilim", "Hamkasblarini o‘rgatadi va yo‘naltiradi"],
    tone: "positive",
    accent: "#B7791F",
    soft: "#FFFBEB",
  },
  ishonchli: {
    label: "ISHONCHLI",
    name: "Ishonchli xodim",
    tagline: "Tayansa bo‘ladigan inson",
    description:
      "Berilgan vazifani nazoratsiz, sifatli va to‘liq bajaradi. Rahbariyat unga muhim ishlarni bemalol ishonib topshiradi.",
    criteria: ["Mas’uliyatli va halol", "Va’dasining ustidan chiqadi", "Tartib va maxfiylikka rioya qiladi"],
    tone: "positive",
    accent: "#7C3AED",
    soft: "#F5F3FF",
  },
  faol: {
    label: "FAOL",
    name: "Faol xodim",
    tagline: "Har kuni harakatda",
    description:
      "Ishga o‘z vaqtida keladi, topshiriqlarni kechiktirmasdan bajaradi va jamoa ishida faol qatnashadi.",
    criteria: ["Intizomli davomat", "Topshiriqlarni o‘z vaqtida bajaradi", "Tashabbus ko‘rsatadi"],
    tone: "positive",
    accent: "#1D6FE8",
    soft: "#EFF6FF",
  },
  rivojlanish: {
    label: "MAS’ULIYATSIZ",
    name: "Mas’uliyatsiz xodim",
    tagline: "Ogohlantirish belgisi",
    description:
      "Xodim o‘z vazifasiga mas’uliyatsiz yondashmoqda: topshiriqlarni kechiktiradi, intizomni buzadi. Belgi ogohlantirish sifatida beriladi va xulq tuzalgach olib tashlanadi.",
    criteria: ["Topshiriqlarni kechiktiradi yoki bajarmaydi", "Intizom va davomatni buzadi", "Ogohlantirishlarga e’tibor bermaydi"],
    tone: "warning",
    accent: "#9F1239",
    soft: "#FFE4E6",
  },
};

export const PRO_DESCRIPTION =
  "Kompaniyani boshqaradigan va jamoaga yo‘l ko‘rsatadigan rahbarlar belgisi. Uning egasi qarorlar uchun javob beradi va xodimlarga namuna bo‘ladi.";

export const PRO_CRITERIA = [
  "Rahbarlik lavozimidagi tasdiqlangan shaxs",
  "Qarorlar va natija uchun javobgar",
  "Jamoaga yo‘l-yo‘riq va namuna",
];

export const PRO_META: Record<VerifiedTier, { name: string; group: string; accent: string; soft: string }> = {
  founder: { name: "PRO · Asoschi", group: "Asoschi", accent: "#B45309", soft: "#FFFBEB" },
  director: { name: "PRO · Rahbariyat", group: "Direktor va yordamchisi", accent: "#6D28D9", soft: "#F5F3FF" },
  hr: { name: "PRO · HR rahbariyati", group: "HR direktor / menejer", accent: "#047857", soft: "#ECFDF5" },
  lead: { name: "PRO · Bo‘lim boshlig‘i", group: "Bo‘lim boshliqlari", accent: "#4338CA", soft: "#EEF2FF" },
  master: { name: "PRO · Xodim", group: "PRO xodimlar", accent: "#A16207", soft: "#FEF9C3" },
};

/** Tagline / izoh / mezonlar — rahbar PRO’laridan farqli bo‘lgan turlar uchun. */
export const PRO_TIER_TEXT: Partial<Record<VerifiedTier, { tagline: string; description: string; criteria: string[] }>> = {
  founder: {
    tagline: "Kompaniya asoschisi",
    description:
      "Kompaniyani noldan qurgan va uning yo‘nalishini belgilaydigan shaxs. Kompaniyaning maqsadi, qadriyatlari va kelajagi uchun asosiy mas’uliyat unda.",
    criteria: ["Kompaniyaning asoschisi", "Strategiya va yo‘nalishni belgilaydi", "Eng yuqori darajadagi tasdiq"],
  },
  director: {
    tagline: "Kompaniya rahbariyati",
    description:
      "Kompaniyaning kundalik ishini boshqaradigan rahbar. Bo‘limlar ishini muvofiqlashtiradi, muhim qarorlarni qabul qiladi va umumiy natija uchun javob beradi.",
    criteria: ["Direktor yoki uning yordamchisi", "Muhim qarorlarni qabul qiladi", "Barcha bo‘limlar ishini muvofiqlashtiradi"],
  },
  hr: {
    tagline: "Xodimlar bilan ishlash rahbari",
    description:
      "Kompaniyaning eng katta boyligi — xodimlar uchun mas’ul rahbar. Ishga qabul, moslashuv, intizom va jamoaning rivoji uning nazoratida.",
    criteria: ["HR direktor yoki HR menejer", "Ishga qabul va kadrlar uchun mas’ul", "Jamoa intizomi va rivojini kuzatadi"],
  },
  lead: {
    tagline: "Bo‘lim rahbari",
    description:
      "O‘z bo‘limini boshqaradigan va uning natijasi uchun javob beradigan rahbar. Vazifalarni taqsimlaydi, xodimlarni yo‘naltiradi va bo‘limni rivojlantiradi.",
    criteria: ["Bo‘lim boshlig‘i lavozimida", "Bo‘lim natijasi uchun javobgar", "Xodimlarini yo‘naltiradi va o‘stiradi"],
  },
  master: {
    tagline: "Barcha ishda ustasi · kompaniya faxri",
    description:
      "Xodimlar uchun eng oliy PRO belgisi. Har qanday vazifani a’lo darajada bajaradigan, ishining haqiqiy ustasi bo‘lgan va jamoaga ilhom beradigan xodimga beriladi.",
    criteria: [
      "Har qanday ishni mukammal bajaradi",
      "Natijasi doimo yuqori va barqaror",
      "Hamkasblariga ustoz va namuna",
      "Kompaniyaning faxri sifatida tan olingan",
    ],
  },
};

export function isEmployeeTitle(v: unknown): v is EmployeeTitle {
  return typeof v === "string" && (EMPLOYEE_TITLE_ORDER as string[]).includes(v);
}

export const PRO_TIER_ORDER: VerifiedTier[] = ["founder", "director", "hr", "lead", "master"];

export function isProTier(v: unknown): v is VerifiedTier {
  return typeof v === "string" && (PRO_TIER_ORDER as string[]).includes(v);
}

export type TitleMapEntry = { title: string | null; proHidden: boolean; proTier?: string | null };
export type TitleMap = Record<number, TitleMapEntry>;

export type TitleAdminPerson = {
  userId: number;
  fullName: string;
  role: string;
  status: string;
  departmentId: number | null;
  departmentName: string | null;
  isLeader: boolean;
  title: string | null;
  note: string | null;
  proHidden: boolean;
  proNote: string | null;
  proTier: string | null;
  assignedAt: string | null;
  assignedByName: string | null;
};

export type TitleHistoryRow = {
  id: number;
  userId: number;
  action: "assign" | "remove" | "pro_hide" | "pro_show" | "pro_grant" | "pro_revoke" | string;
  title: string | null;
  prevTitle: string | null;
  note: string | null;
  actorName: string | null;
  createdAt: string;
  fullName: string | null;
  role: string | null;
};

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    ...init,
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body?.error || `Xatolik (${res.status})`);
  return body as T;
}

export const USER_TITLES_MAP_KEY = ["user-titles-map"] as const;
export const USER_TITLES_ADMIN_KEY = ["user-titles-admin"] as const;
export const USER_TITLES_HISTORY_KEY = ["user-titles-history"] as const;

export function fetchTitleMap(): Promise<TitleMap> {
  return apiJson<{ titles: TitleMap }>("/titles/map").then((r) => r.titles ?? {});
}

export function fetchTitleAdmin(): Promise<TitleAdminPerson[]> {
  return apiJson<{ people: TitleAdminPerson[] }>("/titles/admin").then((r) => r.people ?? []);
}

export function fetchTitleHistory(): Promise<TitleHistoryRow[]> {
  return apiJson<{ history: TitleHistoryRow[] }>("/titles/history").then((r) => r.history ?? []);
}

export function saveUserTitle(userId: number, title: EmployeeTitle | null, note?: string) {
  return apiJson<{ ok: boolean }>(`/titles/${userId}`, {
    method: "PUT",
    body: JSON.stringify({ title, note: note ?? "" }),
  });
}

export function saveProHidden(userId: number, hidden: boolean, note?: string) {
  return apiJson<{ ok: boolean }>(`/titles/${userId}/pro`, {
    method: "PUT",
    body: JSON.stringify({ hidden, note: note ?? "" }),
  });
}

export function saveProTier(userId: number, tier: VerifiedTier | null, note?: string) {
  return apiJson<{ ok: boolean }>(`/titles/${userId}/pro-tier`, {
    method: "PUT",
    body: JSON.stringify({ tier, note: note ?? "" }),
  });
}

/** Barcha belgilar bitta keshdan o‘qiydi — har bir belgi alohida so‘rov yubormaydi. */
export function useTitleMap(): TitleMap {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: USER_TITLES_MAP_KEY,
    queryFn: fetchTitleMap,
    enabled: !!user,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });
  return q.data ?? EMPTY_MAP;
}

const EMPTY_MAP: TitleMap = {};
