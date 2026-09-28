import { inArray } from "drizzle-orm";
import { db, employeesTable } from "@workspace/db";
import { displayBranchName, gpsFromLocationField } from "./geo-location";

type EmpRow = {
  id: number;
  userId: number | null;
  fullName: string;
  location: string | null;
  orgRole: string | null;
  reportsToId: number | null;
  assignedBranchId: number | null;
  latitude: number | null;
  longitude: number | null;
};

export type UserBranchInfo = {
  employeeId: number;
  branchId: number | null;
  label: string | null;
  lat: number | null;
  lng: number | null;
};

const EMP_COLS = {
  id: employeesTable.id,
  userId: employeesTable.userId,
  fullName: employeesTable.fullName,
  location: employeesTable.location,
  orgRole: employeesTable.orgRole,
  reportsToId: employeesTable.reportsToId,
  assignedBranchId: employeesTable.assignedBranchId,
  latitude: employeesTable.latitude,
  longitude: employeesTable.longitude,
};

function coordsOf(e: EmpRow): { lat: number; lng: number } | null {
  if (
    e.latitude != null &&
    e.longitude != null &&
    Number.isFinite(e.latitude) &&
    Number.isFinite(e.longitude)
  ) {
    return { lat: e.latitude, lng: e.longitude };
  }
  return gpsFromLocationField(e.location);
}

function branchInfo(branch: EmpRow): Omit<UserBranchInfo, "employeeId"> {
  const c = coordsOf(branch);
  return {
    branchId: branch.id,
    label: displayBranchName(branch.location) || branch.location || branch.fullName || null,
    lat: c?.lat ?? null,
    lng: c?.lng ?? null,
  };
}

/**
 * Foydalanuvchining o‘z filiali (mudir kartochkasi) va uning GPS nuqtasi.
 * Tartib: biriktirilgan filial → o‘zi mudir bo‘lsa o‘zi → rahbarlar zanjiridagi birinchi mudir.
 */
export async function resolveUserBranches(userIds: number[]): Promise<Map<number, UserBranchInfo>> {
  const out = new Map<number, UserBranchInfo>();
  const ids = [...new Set(userIds.filter((n) => Number.isFinite(n)))];
  if (!ids.length) return out;

  const own = (await db.select(EMP_COLS).from(employeesTable).where(inArray(employeesTable.userId, ids))) as EmpRow[];
  const byId = new Map<number, EmpRow>(own.map((e) => [e.id, e]));

  let pending = new Set<number>();
  const want = (id: number | null) => {
    if (id && !byId.has(id)) pending.add(id);
  };
  for (const e of own) {
    want(e.assignedBranchId);
    want(e.reportsToId);
  }
  for (let hop = 0; hop < 5 && pending.size; hop++) {
    const rows = (await db
      .select(EMP_COLS)
      .from(employeesTable)
      .where(inArray(employeesTable.id, [...pending]))) as EmpRow[];
    pending = new Set();
    for (const r of rows) byId.set(r.id, r);
    for (const r of rows) {
      want(r.assignedBranchId);
      want(r.reportsToId);
    }
  }

  for (const e of own) {
    if (!e.userId || out.has(e.userId)) continue;
    let info: Omit<UserBranchInfo, "employeeId"> = { branchId: null, label: null, lat: null, lng: null };
    const assigned = e.assignedBranchId ? byId.get(e.assignedBranchId) : undefined;
    if (assigned) {
      info = branchInfo(assigned);
    } else if (e.orgRole === "manager") {
      info = branchInfo(e);
    } else {
      let cursor: EmpRow | undefined = e;
      for (let i = 0; i < 5 && cursor?.reportsToId; i++) {
        const mgr = byId.get(cursor.reportsToId);
        if (!mgr) break;
        if (mgr.orgRole === "manager") {
          info = branchInfo(mgr);
          break;
        }
        cursor = mgr;
      }
    }
    out.set(e.userId, { employeeId: e.id, ...info });
  }
  return out;
}
