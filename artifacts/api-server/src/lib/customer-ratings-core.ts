/**
 * Mijoz baholashi — DB-siz pure helpers (unit test uchun).
 */
import { hasFullPlatformAccess, isHrRole, isDirectorRole } from "./roles.ts";
import {
  resolveSlotsForDay,
  activePunchSlotsAt,
  type WorkSlotRow,
} from "./work-slots.ts";
import type { ShiftDefinition, ShiftKey } from "./attendance-engine.ts";

export const SERVICE_QUALITY = ["alo", "yaxshi", "qoniqarli", "yomon", "juda_yomon"] as const;
export const DEMEANOR = ["xushmuomala", "yaxshi", "oddiy", "qopol", "juda_qopol"] as const;

export type ServiceQuality = (typeof SERVICE_QUALITY)[number];
export type Demeanor = (typeof DEMEANOR)[number];

export function canManageCustomerRatings(role?: string | null): boolean {
  const r = String(role || "").toLowerCase();
  return hasFullPlatformAccess(r) || isHrRole(r) || isDirectorRole(r) || r === "admin";
}

export function canViewCustomerRatings(role?: string | null): boolean {
  const r = String(role || "").toLowerCase();
  return canManageCustomerRatings(r) || r === "mudir" || r === "koordinator" || r === "regional_menejer";
}

/** Mijoz baholari reytingi (podium) — mudir/farmasevt/stajyor ham */
export function canViewCustomerLeaderboard(role?: string | null): boolean {
  const r = String(role || "").toLowerCase();
  return (
    canViewCustomerRatings(r) ||
    r === "farmasevt" ||
    r === "stajyor" ||
    r === "stajor"
  );
}

export function canSeeCustomerIdentity(role?: string | null): boolean {
  return canManageCustomerRatings(role);
}

export type LeaderboardTitleKey = "best" | "responsible" | "trusted" | null;

/** Ovozlar bo‘yicha unvon (faqat top-3) */
export function leaderboardTitleForRank(rank: number): LeaderboardTitleKey {
  if (rank === 1) return "best";
  if (rank === 2) return "responsible";
  if (rank === 3) return "trusted";
  return null;
}

/**
 * Reyting tartibi: o‘rtacha yulduz ↓, keyin ovoz soni ↓, keyin ism.
 * Faqat kamida 1 ta mijoz bahosi bo‘lganlar.
 */
export function sortLeaderboardRows<T extends { avg: number; count: number; name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (b.avg !== a.avg) return b.avg - a.avg;
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name, "uz");
  });
}

export function normalizePhone(raw: string): string {
  let d = String(raw || "").replace(/\D+/g, "");
  if (d.startsWith("998") && d.length >= 12) d = d.slice(-9);
  else if (d.length > 9) d = d.slice(-9);
  return d.length === 9 ? `998${d}` : d;
}

/** Mijoz bahosi: faqat +998 9X… mobil */
export function isValidUzMobilePhone(raw: string): boolean {
  const n = normalizePhone(raw);
  return /^9989\d{8}$/.test(n);
}

/**
 * Pure: filial + smena oynasi (tungi/overnight: kecha ish kuni ham tekshiriladi).
 * Boshqa filial slotlari va oynadan tashqari smenalar chiqarilmaydi.
 */
export function pickOnDutyShiftForEmployee(opts: {
  branchId: number;
  slots: WorkSlotRow[];
  today: string;
  yesterday: string;
  nowMs: number;
  defs: Record<ShiftKey, ShiftDefinition>;
  /** Slot filial id mos kelmasa ham, xodim shu dorixonaga biriktirilgan bo‘lsa — faol smenani olish */
  relaxBranchMatch?: boolean;
}): { shiftKey: string; workDate: string } | null {
  const { branchId, slots, today, yesterday, nowMs, defs, relaxBranchMatch } = opts;
  if (!slots.length) return null;
  for (const workDate of [today, yesterday]) {
    const day = resolveSlotsForDay(workDate, slots);
    const allActive = activePunchSlotsAt(workDate, day, nowMs, defs, "in");
    let active = allActive.filter((s) => s.branchId === branchId);
    // Ba’zi slotlar boshqa branch_id bilan yozilgan — xodim allaqachon filial bo‘yicha filtrl proq
    if (!active.length && relaxBranchMatch) active = allActive;
    const running = active.filter((s) => nowMs >= s.startMs && nowMs <= s.endMs);
    const pick = running[0] || active[0];
    if (!pick) continue;
    return { shiftKey: String(pick.shiftKey), workDate };
  }
  return null;
}
