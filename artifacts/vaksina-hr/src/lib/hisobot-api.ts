import { useQuery } from "@tanstack/react-query";
import { isVacancyPlaceholder } from "./vacancy-slot";

export type HisobotEmployeeRow = {
  employeeId: number;
  fullName: string;
  accountName?: string | null;
  position?: string;
  phone: string | null;
  login: string | null;
  roleKey: "mudir" | "farmasevt" | "stajyor" | "other";
  roleLabel: string;
  branch: string;
  shiftKey: string;
  shiftDisplay: string;
  presentDays: number;
  onTimeDays?: number;
  lateDays?: number;
  absentDays: number;
  presentRate: number;
  presentDates: string[];
  onTimeDates?: string[];
  lateDates?: string[];
  absentDates: string[];
};

export type HisobotBranchBlock = {
  branch: string;
  mudir: HisobotEmployeeRow | null;
  mudirMissing?: boolean;
  pharmacists: HisobotEmployeeRow[];
  interns: HisobotEmployeeRow[];
  others: HisobotEmployeeRow[];
  staffCount: number;
};

export type CoordinatorHisobot = {
  generatedAt: string;
  from: string;
  to: string;
  dayCount: number;
  coordinator: {
    employeeId: number;
    fullName: string;
    phone: string | null;
    login: string | null;
  };
  summary: {
    branchCount: number;
    mudirCount: number;
    pharmacistCount: number;
    internCount: number;
    staffTotal: number;
    avgPresentRate: number;
    noShowCount: number;
  };
  branches: HisobotBranchBlock[];
  employees: HisobotEmployeeRow[];
  noShows: HisobotEmployeeRow[];
  self?: HisobotEmployeeRow | null;
};

export async function fetchCoordinatorHisobot(opts: {
  coordinatorId: number;
  from: string;
  to: string;
}): Promise<CoordinatorHisobot> {
  const qs = new URLSearchParams({
    coordinatorId: String(opts.coordinatorId),
    from: opts.from,
    to: opts.to,
  });
  const res = await fetch(`/api/holat/coordinator-report?${qs}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    let msg = "Hisobot yuklanmadi";
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

export function useCoordinatorHisobot(
  coordinatorId: number | null,
  from: string,
  to: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ["holat-coordinator-report", coordinatorId, from, to],
    queryFn: () =>
      fetchCoordinatorHisobot({
        coordinatorId: coordinatorId!,
        from,
        to,
      }),
    enabled: enabled && coordinatorId != null && coordinatorId > 0 && Boolean(from) && Boolean(to),
    staleTime: 20_000,
  });
}

export const HISOBOT_SHIFTS = [
  { key: "all", label: "Barcha smenalar" },
  { key: "1", label: "1-smena" },
  { key: "2", label: "2-smena" },
  { key: "3", label: "3-smena" },
  { key: "12", label: "1+2" },
  { key: "23", label: "2+3" },
  { key: "office", label: "Asosiy ofis" },
] as const;

export type HisobotShiftKey = (typeof HISOBOT_SHIFTS)[number]["key"] | "other";

export function hisobotShiftKey(e: Pick<HisobotEmployeeRow, "shiftKey" | "shiftDisplay">): string {
  if (e.shiftKey && e.shiftKey !== "other") return e.shiftKey;
  const compact = String(e.shiftDisplay || "").toLowerCase().replace(/\s+/g, "");
  if (compact.includes("1+2") || compact.includes("1-2")) return "12";
  if (compact.includes("2+3") || compact.includes("2-3")) return "23";
  if (compact.includes("ofis")) return "office";
  if (compact.includes("3-smena") || compact === "3smena") return "3";
  if (compact.includes("2-smena") || compact === "2smena") return "2";
  if (compact.includes("1-smena") || compact === "1smena") return "1";
  return e.shiftKey || "other";
}

export function hisobotShiftLabel(key: string): string {
  return HISOBOT_SHIFTS.find((s) => s.key === key)?.label || (key === "other" ? "Boshqa" : key);
}

export const HISOBOT_STATUSES = [
  { key: "missed", label: "Kelmaganlar" },
  { key: "came", label: "Kelganlar" },
  { key: "late", label: "Kechikkanlar" },
] as const;

export type HisobotStatusKey = (typeof HISOBOT_STATUSES)[number]["key"];

export function hisobotLateDays(e: HisobotEmployeeRow): number {
  return e.lateDays ?? 0;
}

export function hisobotOnTimeDays(e: HisobotEmployeeRow): number {
  return e.onTimeDays ?? Math.max(0, e.presentDays - hisobotLateDays(e));
}

/** Hisob ismi yozuvdan farq qilsa, odamning o‘zi birinchi qatorda turadi. */
/** Ism o‘rnida filial nomi va hech qanday hisob yo‘q — bu odam emas. */
export function isBranchShellRow(e: HisobotEmployeeRow): boolean {
  const name = (e.fullName || "").trim().toLowerCase();
  const branch = (e.branch || "").trim().toLowerCase();
  if (!name || !branch || name !== branch) return false;
  return !(e.phone || "").trim() && !(e.login || "").trim() && !(e.accountName || "").trim();
}

export function hisobotIdentity(e: HisobotEmployeeRow): {
  name: string;
  alias: string;
  phone: string;
  login: string;
  position: string;
} {
  const stored = (e.fullName || "").trim();
  const account = (e.accountName || "").trim();
  const differs = Boolean(account) && account.localeCompare(stored, "uz", { sensitivity: "accent" }) !== 0;
  return {
    name: differs ? account : stored || account || "—",
    alias: differs ? stored : "",
    phone: (e.phone || "").trim(),
    login: (e.login || "").trim(),
    position: (e.position || "").trim() || e.roleLabel,
  };
}

export function matchesHisobotStatus(e: HisobotEmployeeRow, statuses: HisobotStatusKey[]): boolean {
  if (!statuses.length) return true;
  const late = hisobotLateDays(e) > 0;
  const came = e.presentDays > 0;
  const missed = e.presentDays === 0;
  return (
    (statuses.includes("missed") && missed) ||
    (statuses.includes("came") && came) ||
    (statuses.includes("late") && late)
  );
}

export function hisobotStatusTitle(statuses: HisobotStatusKey[]): string {
  if (statuses.length >= HISOBOT_STATUSES.length) return "Davomat hisoboti";
  return HISOBOT_STATUSES.filter((s) => statuses.includes(s.key))
    .map((s) => s.label)
    .join(" · ");
}

const ROLE_ORDER = ["mudir", "farmasevt", "stajyor", "other"] as const;

export type HisobotSlice = {
  employees: HisobotEmployeeRow[];
  branches: HisobotBranchBlock[];
  noShows: HisobotEmployeeRow[];
  came: number;
  missed: number;
  byRole: Array<{ key: string; label: string; total: number; came: number; late: number; missed: number }>;
  byShift: Array<{ key: string; label: string; total: number; came: number; late: number; missed: number }>;
  /** Tanlangan holat filtri: kelmagan, o‘z vaqtida kelgan, kechikkan. */
  roster: HisobotEmployeeRow[];
  late: number;
};

export function sliceHisobot(
  report: CoordinatorHisobot,
  shift: string,
  statuses: HisobotStatusKey[] = ["missed"],
): HisobotSlice {
  const real = report.employees.filter((e) => !isVacancyPlaceholder(e) && !isBranchShellRow(e));
  const employees = real.filter((e) => shift === "all" || hisobotShiftKey(e) === shift);
  const cameOf = (list: HisobotEmployeeRow[]) => list.filter((e) => e.presentDays > 0).length;
  const lateOf = (list: HisobotEmployeeRow[]) => list.filter((e) => hisobotLateDays(e) > 0).length;
  const byRole = ROLE_ORDER.map((key) => {
    const list = employees.filter((e) => e.roleKey === key);
    const came = cameOf(list);
    return {
      key,
      label: list[0]?.roleLabel || (key === "mudir" ? "Mudir" : key === "farmasevt" ? "Farmasevt" : key === "stajyor" ? "Stajyor" : "Boshqa"),
      total: list.length,
      came,
      late: lateOf(list),
      missed: list.length - came,
    };
  }).filter((r) => r.total > 0);
  const shiftKeys = [
    ...HISOBOT_SHIFTS.filter((s) => s.key !== "all").map((s) => s.key),
    ...employees.filter((e) => hisobotShiftKey(e) === "other").map(() => "other"),
  ];
  const uniqueShift = [...new Set(shift === "all" ? shiftKeys : [shift])];
  const byShift = uniqueShift
    .map((key) => {
      const list =
        shift === "all"
          ? real.filter((e) => hisobotShiftKey(e) === key)
          : employees;
      const came = cameOf(list);
      return {
        key,
        label: hisobotShiftLabel(key),
        total: list.length,
        came,
        late: lateOf(list),
        missed: list.length - came,
      };
    })
    .filter((s) => s.total > 0);
  const branches = report.branches
    .map((b) => {
      const personOk = (e: HisobotEmployeeRow) =>
        !isVacancyPlaceholder(e) &&
        !isBranchShellRow(e) &&
        (shift === "all" || hisobotShiftKey(e) === shift);
      const keep = (e: HisobotEmployeeRow | null) => (e && personOk(e) ? e : null);
      const mudir = keep(b.mudir);
      const pharmacists = b.pharmacists.filter(personOk);
      const interns = b.interns.filter(personOk);
      const others = b.others.filter(personOk);
      const mudirMissing = Boolean(b.mudirMissing) || (b.mudir != null && isBranchShellRow(b.mudir));
      return {
        ...b,
        mudir: mudirMissing ? null : mudir,
        mudirMissing,
        pharmacists,
        interns,
        others,
        staffCount: pharmacists.length + interns.length + others.length + (mudirMissing ? 0 : mudir ? 1 : 0),
      };
    })
    .filter((b) => b.staffCount > 0 || b.mudirMissing);
  const noShows = employees.filter((e) => e.presentDays === 0);
  const roster = employees
    .filter((e) => matchesHisobotStatus(e, statuses))
    .sort((a, b) => {
      const rank = (e: HisobotEmployeeRow) => (e.presentDays === 0 ? 0 : hisobotLateDays(e) > 0 ? 1 : 2);
      return rank(a) - rank(b) || hisobotIdentity(a).name.localeCompare(hisobotIdentity(b).name, "uz");
    });
  return {
    employees,
    branches,
    noShows,
    roster,
    came: cameOf(employees),
    late: lateOf(employees),
    missed: noShows.length,
    byRole,
    byShift,
  };
}
