import { displayBranchName, stripGpsSuffix } from "./geo-location";

export type BranchDedupeRow = {
  id: number;
  fullName: string;
  location: string | null;
  userId?: number | null;
  employmentStatus?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  reportsToId?: number | null;
};

const INACTIVE = new Set(["dismissed", "closed"]);

/** Bir xil filial uchun kalit — GPS suffix va bo‘sh «Filial» nomlari hisobga olinadi */
export function branchDedupeKey(location: string | null | undefined, fullName: string | null | undefined): string {
  const fromLoc = (displayBranchName(location) || stripGpsSuffix(location) || "").trim();
  const generic = !fromLoc || /^filial$/i.test(fromLoc) || fromLoc.length < 2;
  const base = generic ? String(fullName || fromLoc || "").trim() : fromLoc;
  return base
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[«»"']/g, "")
    .trim();
}

function statusScore(status: string | null | undefined): number {
  switch (status) {
    case "working":
    case "new":
      return 100;
    case "no_manager":
    case "need_hire":
    case "searching":
      return 80;
    case "on_leave":
      return 50;
    case "dismissed":
    case "closed":
      return 0;
    default:
      return 40;
  }
}

function branchScore(row: BranchDedupeRow): number {
  let s = statusScore(row.employmentStatus);
  if (row.userId != null) s += 25;
  if (
    row.latitude != null &&
    row.longitude != null &&
    Number.isFinite(row.latitude) &&
    Number.isFinite(row.longitude)
  ) {
    s += 10;
  }
  // Eskiroq ID odatda asl filial kartasi
  s += Math.max(0, 5 - Math.min(5, row.id / 10_000));
  return s;
}

export function isActiveBranchStatus(status: string | null | undefined): boolean {
  return !INACTIVE.has(String(status || "working"));
}

/**
 * Faol filiallar — dismissed/closed chiqariladi, bir xil nomdagi dublikatdan eng yaxshisi qoladi.
 */
export function dedupeActiveBranches<T extends BranchDedupeRow>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    if (!isActiveBranchStatus(row.employmentStatus)) continue;
    const key = branchDedupeKey(row.location, row.fullName);
    if (!key) continue;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, row);
      continue;
    }
    const a = branchScore(row);
    const b = branchScore(prev);
    if (a > b || (a === b && row.id < prev.id)) best.set(key, row);
  }
  return [...best.values()];
}

/** GPS bo‘lgan faol filiallar (davomat QR) */
export function dedupeBranchesWithGps<T extends BranchDedupeRow>(rows: T[]): T[] {
  return dedupeActiveBranches(rows).filter(
    (m) =>
      m.latitude != null &&
      m.longitude != null &&
      Number.isFinite(m.latitude) &&
      Number.isFinite(m.longitude),
  );
}
