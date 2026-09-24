/** Filial reviziya sikli — status, muddat, kamomad (so‘m, integer). */

export const SHORTAGE_HIGH_SOUM = 2_000_000;
export const TEZ_ORADA_DAYS = 14;

export const CYCLE_STATUSES = [
  "YANGI_OCHILGAN",
  "REJADAGIDEK",
  "TEZ_ORADA",
  "MUDDATI_OTGAN",
  "SIKL_OTKAZIB_YUBORILGAN",
  "REVIZIYA_JARAYONIDA",
  "REVIZIYA_YAKUNLANGAN",
] as const;

export type CycleStatus = (typeof CYCLE_STATUSES)[number];

export const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = {
  YANGI_OCHILGAN: "Yangi ochilgan",
  REJADAGIDEK: "Rejadagidek",
  TEZ_ORADA: "Tez orada",
  MUDDATI_OTGAN: "Muddati o‘tgan",
  SIKL_OTKAZIB_YUBORILGAN: "Sikl o‘tkazib yuborilgan",
  REVIZIYA_JARAYONIDA: "Reviziya jarayonida",
  REVIZIYA_YAKUNLANGAN: "Reviziya yakunlangan",
};

export const WORKFLOW_STATUSES = [
  "REQUESTED",
  "ASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const WORKFLOW_STATUS_LABEL: Record<WorkflowStatus, string> = {
  REQUESTED: "Ariza (kutilyapti)",
  ASSIGNED: "Biriktirilgan",
  ACCEPTED: "Qabul qilingan",
  IN_PROGRESS: "Jarayonda",
  COMPLETED: "Yakunlangan",
  CANCELLED: "Bekor qilingan",
};

export function tashkentYmd(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(d);
}

export function moneyInt(v: unknown, fallback = 0): number {
  if (typeof v === "bigint") return Number(v);
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/\s/g, "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

/** Kamomad bo‘yicha sikl oylari: ≥2mln → 3; >0 → 4; aks holda → 6 */
export function cycleMonthsFromShortage(shortageAmount: number): 3 | 4 | 6 {
  const s = moneyInt(shortageAmount);
  if (s >= SHORTAGE_HIGH_SOUM) return 3;
  if (s > 0) return 4;
  return 6;
}

export function computeRemainingAmount(shortageAmount: number, collectedAmount: number): number {
  return Math.max(0, moneyInt(shortageAmount) - moneyInt(collectedAmount));
}

/** YYYY-MM-DD + N oy (kalendar oy, kun cheklovi bilan) */
export function addMonthsYmd(ymd: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(Date.UTC(y, mo + months, 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function computeNextRevisionDate(lastRevisionDate: string, shortageAmount: number): {
  nextRevisionDate: string;
  cycleMonths: 3 | 4 | 6;
} {
  const cycleMonths = cycleMonthsFromShortage(shortageAmount);
  return {
    nextRevisionDate: addMonthsYmd(lastRevisionDate, cycleMonths),
    cycleMonths,
  };
}

export function effectiveNextRevisionDate(
  autoDate: string | null | undefined,
  overrideDate: string | null | undefined,
): string | null {
  if (overrideDate && /^\d{4}-\d{2}-\d{2}$/.test(overrideDate)) return overrideDate;
  if (autoDate && /^\d{4}-\d{2}-\d{2}$/.test(autoDate)) return autoDate;
  return null;
}

export function computeCycleStatus(opts: {
  hasCompletedRevision: boolean;
  nextRevisionDate: string | null;
  today?: string;
  cycleMonths?: number | null;
  workflowStatus?: string | null;
}): CycleStatus {
  const today = opts.today || tashkentYmd();
  const wf = opts.workflowStatus;

  if (wf === "IN_PROGRESS" || wf === "ACCEPTED" || wf === "ASSIGNED") return "REVIZIYA_JARAYONIDA";
  if (wf === "REQUESTED") return "TEZ_ORADA";
  if (wf === "COMPLETED") return "REVIZIYA_YAKUNLANGAN";

  if (!opts.hasCompletedRevision) return "YANGI_OCHILGAN";

  const next = opts.nextRevisionDate;
  if (!next) return "YANGI_OCHILGAN";

  const daysLeft = daysBetweenYmd(today, next);
  if (daysLeft < 0) {
    const months = opts.cycleMonths && opts.cycleMonths > 0 ? opts.cycleMonths : 6;
    const skipAfter = addMonthsYmd(next, months);
    if (today >= skipAfter) return "SIKL_OTKAZIB_YUBORILGAN";
    return "MUDDATI_OTGAN";
  }
  if (daysLeft <= TEZ_ORADA_DAYS) return "TEZ_ORADA";
  return "REJADAGIDEK";
}

export function formatDuration(minutes: number | null | undefined): string {
  const m = Math.max(0, Math.round(minutes || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h <= 0) return `${r} daqiqa`;
  return `${h} soat ${r} daqiqa`;
}
