import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hasFullPlatformAccess, isHrRole } from "./roles";

export type LetterKind = "late" | "absent";
export type LetterStatus = "pending" | "confirmed" | "signed";
export type ReviewStatus = "approved" | "cancelled";

export type LetterStage = { n: number; label: string };

export type LetterContent = {
  letterNo: string;
  kind: LetterKind;
  kindLabel: string;
  addressee: string[];
  sender: { position: string; fullName: string; fromLine: string; branch: string; phone: string };
  title: string;
  subtitle: string;
  final: boolean;
  intro: string;
  facts: string;
  reason: string | null;
  commitment: string;
  finalConsent: string | null;
  closing: string[];
  stages: LetterStage[];
  stage: number;
  nextStep: string;
  penalty: string;
  amountText: string | null;
  footer: { date: string; signer: string; signedAt: string | null };
  verifyUrl: string | null;
  status: LetterStatus;
};

export const FINAL_STRIKE = 6;
export const REASON_MIN = 40;
export const REASON_MAX = 800;
export const REASON_MIN_WORDS = 6;

/** Bosqichlar — PDF va oylik sahifasi bilan bir xil */
export const LETTER_STAGES: Array<LetterStage & { penalty: string; detail: string }> = [
  { n: 1, label: "Ogohlantirish", penalty: "Jarimasiz", detail: "Rasmiy ogohlantirish va tushuntirish xati" },
  { n: 2, label: "Kunlikning 30%", penalty: "−30% kunlik", detail: "1 kunlik ish haqining 30% jarima" },
  { n: 3, label: "Kunlikning 30%", penalty: "−30% kunlik", detail: "Yana 1 kunlik ish haqining 30% jarima" },
  { n: 4, label: "Kunlikning 100%", penalty: "−100% kunlik", detail: "1 kunlik ish haqining 100% jarima" },
  { n: 5, label: "Oylikning 50% · blok", penalty: "−50% oylik", detail: "Oylikning 50% jarima va o‘sha kuni platforma bloki" },
  {
    n: 6,
    label: "Oxirgi ogohlantirish",
    penalty: "−50% oylik",
    detail: "Yana oylikning 50% jarima, oxirgi tushuntirish xati va ishdan bo‘shatishga rozilik",
  },
];

/** Bosqich rangi (tailwind sinflari): ko‘k → sariq → to‘q sariq → qizil → to‘q qizil */
export function stageTone(n: number) {
  if (n <= 1) return { solid: "bg-blue-600 text-white", soft: "bg-blue-50 text-blue-800 border-blue-200", text: "text-blue-700", ring: "ring-blue-400" };
  if (n <= 3) return { solid: "bg-amber-500 text-white", soft: "bg-amber-50 text-amber-800 border-amber-200", text: "text-amber-700", ring: "ring-amber-400" };
  if (n === 4) return { solid: "bg-orange-600 text-white", soft: "bg-orange-50 text-orange-800 border-orange-200", text: "text-orange-700", ring: "ring-orange-400" };
  if (n === 5) return { solid: "bg-red-600 text-white", soft: "bg-red-50 text-red-800 border-red-200", text: "text-red-700", ring: "ring-red-400" };
  return { solid: "bg-rose-900 text-white", soft: "bg-rose-50 text-rose-900 border-rose-300", text: "text-rose-800", ring: "ring-rose-500" };
}

function tashkentMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
}

/** Joriy oydagi eng yuqori (bekor qilinmagan) bosqich; 0 — qoidabuzarlik yo‘q */
export function currentStage(items: Array<Pick<ExplanationLetter, "month" | "strikeN" | "reviewStatus">>, month = tashkentMonth()) {
  return items
    .filter((l) => l.month === month && l.reviewStatus !== "cancelled")
    .reduce((m, l) => Math.max(m, Math.min(l.strikeN, FINAL_STRIKE)), 0);
}

export function fmtSum(n: number) {
  return `${Math.round(n).toLocaleString("ru-RU").replace(/\u00a0/g, " ")} so‘m`;
}

/** Xodim yozgan sababda nima yetishmaydi — server bilan bir xil qoidalar */
export function reasonProblem(text: string): string | null {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length < REASON_MIN) return `Kamida ${REASON_MIN} belgi yozing`;
  if (t.length > REASON_MAX) return `Matn ${REASON_MAX} belgidan oshmasin`;
  const words = t.split(" ").filter((w) => /\p{L}{2,}/u.test(w));
  if (words.length < REASON_MIN_WORDS) return `Kamida ${REASON_MIN_WORDS} so‘zdan iborat gap yozing`;
  if (new Set(words.map((w) => w.toLocaleLowerCase("uz"))).size < Math.ceil(words.length / 2)) return "Bir xil so‘zlarni takrorlamang";
  if (/(.)\1{5,}/u.test(t)) return "Matnda ma’nosiz belgilar bor";
  return null;
}

export function reasonWords(text: string) {
  return text.trim().split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w)).length;
}

export type ExplanationLetter = {
  id: number;
  userId: number;
  month: string;
  eventDate: string;
  kind: LetterKind;
  strikeN: number;
  fullName: string;
  position: string;
  branch: string;
  shift: string;
  planStart: string | null;
  planEnd: string | null;
  checkIn: string | null;
  lateMinutes: number | null;
  amount: number;
  phone: string | null;
  status: LetterStatus;
  reasonCode: string | null;
  reasonText: string | null;
  letterNo: string;
  verifyToken: string | null;
  confirmedAt: string | null;
  signedAt: string | null;
  hasSignature: boolean;
  hasQr: boolean;
  isTest?: boolean;
  reviewStatus?: ReviewStatus | null;
  reviewNote?: string | null;
  reviewedByName?: string | null;
  reviewedAt?: string | null;
  finalConsentAt?: string | null;
  createdAt: string;
  content: LetterContent;
  signaturePng?: string | null;
  qrPng?: string | null;
};

export type LetterSettings = { headerLines: string[]; companyName: string };

export type LetterVerify = {
  valid: boolean;
  status?: LetterStatus;
  letterNo?: string;
  fullName?: string;
  position?: string;
  branch?: string;
  eventDate?: string;
  kind?: LetterKind;
  strikeN?: number;
  lateMinutes?: number | null;
  signedAt?: string | null;
  isTest?: boolean;
  final?: boolean;
  reviewStatus?: ReviewStatus | null;
  /** imzolangan — PDF ochiq token orqali yuklanadi */
  pdf?: boolean;
  error?: string;
};

export type LettersList = {
  month: string;
  months: string[];
  items: ExplanationLetter[];
  totals: { all: number; signed: number; waiting: number };
};

export type LetterUserOption = { id: number; fullName: string; role: string; branch: string | null };

export function canManageLetters(role?: string | null) {
  return hasFullPlatformAccess(role) || isHrRole(role);
}

/** QR havolasi — foydalanuvchi ochgan domen bilan, server proksisiga bog‘liq emas */
export function letterVerifyUrl(token: string) {
  return `${window.location.origin}/tx/${token}`;
}

export function letterVerifyPdfUrl(token: string, download = false) {
  return `/api/explanation-letters/verify/${encodeURIComponent(token)}/pdf${download ? "?download=1" : ""}`;
}

async function readError(res: Response, fallback: string) {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error || fallback);
}

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!res.ok) throw await readError(res, fallback);
  return res.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res, fallback);
  return res.json() as Promise<T>;
}

export function useMyLetters(enabled = true) {
  return useQuery({
    queryKey: ["explanation-letters", "my"],
    enabled,
    refetchInterval: 120_000,
    queryFn: () =>
      getJson<{ items: ExplanationLetter[]; pending: number; enabled?: boolean }>("/api/explanation-letters/my", "Tushuntirish xatlari yuklanmadi"),
  });
}

export function useMonthLetters(month: string, enabled: boolean) {
  return useQuery({
    queryKey: ["explanation-letters", "month", month],
    enabled,
    refetchInterval: 90_000,
    queryFn: () => getJson<LettersList>(`/api/explanation-letters?month=${encodeURIComponent(month)}`, "Tushuntirish xatlari yuklanmadi"),
  });
}

// ---------------------------------------------------------------- admin test

export function useTestLetters(enabled: boolean) {
  return useQuery({
    queryKey: ["explanation-letters", "test"],
    enabled,
    refetchInterval: 8_000,
    queryFn: () => getJson<{ items: ExplanationLetter[] }>("/api/explanation-letters/test", "Test xatlari yuklanmadi"),
  });
}

export function useLetterUserOptions(q: string, enabled: boolean) {
  return useQuery({
    queryKey: ["explanation-letters", "test-users", q],
    enabled,
    staleTime: 30_000,
    queryFn: () =>
      getJson<{ items: LetterUserOption[] }>(`/api/explanation-letters/test/users?q=${encodeURIComponent(q)}`, "Xodimlar yuklanmadi"),
  });
}

export function useLetterGate(userId: number | null) {
  return useQuery({
    queryKey: ["explanation-letters", "test-gate", userId],
    enabled: userId != null,
    refetchInterval: 8_000,
    queryFn: () =>
      getJson<{ blocked: boolean; block: { error: string; letterId: number; letterNo: string } | null }>(
        `/api/explanation-letters/test/gate?userId=${userId}`,
        "Tekshirib bo‘lmadi",
      ),
  });
}

export function useCreateTestLetter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: number; kind: LetterKind; strikeN: number; eventDate: string; lateMinutes: number | null }) =>
      postJson<ExplanationLetter>("/api/explanation-letters/test", v, "Test xati yaratilmadi"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["explanation-letters"], predicate: (q) => q.queryKey[1] !== "reasons" }),
  });
}

export function useDeleteTestLetters() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids?: number[]) => {
      const res = await fetch(`/api/explanation-letters/test${ids?.length ? `?ids=${ids.join(",")}` : ""}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw await readError(res, "O‘chirilmadi");
      return (await res.json()) as { deleted: number };
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["explanation-letters"], predicate: (q) => q.queryKey[1] !== "reasons" }),
  });
}

export function useLetter(id: number | null) {
  return useQuery({
    queryKey: ["explanation-letters", "one", id],
    enabled: id != null,
    queryFn: () => getJson<ExplanationLetter>(`/api/explanation-letters/${id}`, "Xat yuklanmadi"),
  });
}

export function useLetterSettings(enabled = true) {
  return useQuery({
    queryKey: ["explanation-letters", "settings"],
    enabled,
    staleTime: 60_000,
    queryFn: () => getJson<LetterSettings>("/api/explanation-letters/settings", "Sozlamalar yuklanmadi"),
  });
}

export function useSaveLetterSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: LetterSettings) => {
      const res = await fetch("/api/explanation-letters/settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      if (!res.ok) throw await readError(res, "Saqlanmadi");
      return (await res.json()) as LetterSettings;
    },
    onSuccess: (saved) => {
      qc.setQueryData(["explanation-letters", "settings"], saved);
      void qc.invalidateQueries({ queryKey: ["explanation-letters"] });
    },
  });
}

export function useLetterVerify(token: string) {
  return useQuery({
    queryKey: ["explanation-letters", "verify", token],
    enabled: !!token,
    retry: false,
    queryFn: async (): Promise<LetterVerify> => {
      const res = await fetch(`/api/explanation-letters/verify/${encodeURIComponent(token)}`, { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as LetterVerify | null;
      if (res.status === 404) return { valid: false, error: body?.error || "Hujjat topilmadi" };
      if (!res.ok || !body) throw new Error(body?.error || "Tekshirib bo‘lmadi");
      return body;
    },
  });
}

export type LetterLookup =
  | { found: true; by: "number" | "qr"; query: string; letter: ExplanationLetter }
  | { found: false; by: "number" | "qr"; query: string | null; deleted: boolean; issuedAt: string | null; isTest: boolean };

/** «abcd12345» → «ABCD-12345»; havola yoki boshqa matn o‘zgarmaydi */
export function formatLetterNoInput(raw: string) {
  const s = raw.toUpperCase();
  const m = /^([A-Z]{4})[\s-]?(\d{0,5})$/.exec(s.trim());
  return m ? (m[2] ? `${m[1]}-${m[2]}` : m[1]!) : s;
}

export function lookupLetter(q: string) {
  return getJson<LetterLookup>(`/api/explanation-letters/lookup?q=${encodeURIComponent(q)}`, "Tekshirib bo‘lmadi");
}

function useLetterMutation<V>(fn: (v: V) => Promise<ExplanationLetter>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (saved) => {
      qc.setQueryData(["explanation-letters", "one", saved.id], (prev: ExplanationLetter | undefined) => ({ ...prev, ...saved }));
      void qc.invalidateQueries({ queryKey: ["explanation-letters"], predicate: (q) => q.queryKey[1] !== "reasons" });
    },
  });
}

export function useConfirmLetter() {
  return useLetterMutation((v: { id: number; reasonText: string; finalConsent: boolean }) =>
    postJson<ExplanationLetter>(
      `/api/explanation-letters/${v.id}/confirm`,
      { reasonText: v.reasonText, finalConsent: v.finalConsent },
      "Tasdiqlanmadi",
    ),
  );
}

export type ReviewAction = "approve" | "cancel" | "reset";

export function useReviewLetter() {
  return useLetterMutation((v: { id: number; action: ReviewAction; note: string }) =>
    postJson<ExplanationLetter>(`/api/explanation-letters/${v.id}/review`, { action: v.action, note: v.note }, "Qaror saqlanmadi"),
  );
}

export function useSignLetter() {
  return useLetterMutation((v: { id: number; signature: string; qr: string | null }) =>
    postJson<ExplanationLetter>(`/api/explanation-letters/${v.id}/sign`, { signature: v.signature, qr: v.qr }, "Imzolanmadi"),
  );
}

async function downloadPdf(url: string, filename: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw await readError(res, "PDF yuklanmadi");
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 5_000);
}

const safeName = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 40);

export function downloadLetterPdf(l: Pick<ExplanationLetter, "id" | "fullName" | "eventDate">) {
  return downloadPdf(`/api/explanation-letters/${l.id}/pdf?download=1`, `Tushuntirish_xati_${safeName(l.fullName)}_${l.eventDate}.pdf`);
}

export function downloadVerifiedPdf(token: string, fullName: string, eventDate: string) {
  return downloadPdf(letterVerifyPdfUrl(token, true), `Tushuntirish_xati_${safeName(fullName)}_${eventDate}.pdf`);
}

/** `ids` berilsa — faqat shular; aks holda holat bo‘yicha (signed | waiting | all) */
export function downloadLettersBulk(opts: { month: string; status: "signed" | "waiting" | "all"; ids?: number[] }) {
  const qs = new URLSearchParams({ month: opts.month, status: opts.status });
  if (opts.ids?.length) qs.set("ids", opts.ids.join(","));
  return downloadPdf(`/api/explanation-letters/bulk.pdf?${qs}`, `Tushuntirish_xatlari_${opts.month === "all" ? "barchasi" : opts.month}.pdf`);
}

export function fmtLetterDate(ymd: string) {
  const [y, m, d] = ymd.split("-");
  return y && m && d ? `${d}.${m}.${y}` : ymd;
}

export function fmtLetterStamp(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
