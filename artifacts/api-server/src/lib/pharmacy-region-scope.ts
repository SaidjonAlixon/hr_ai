/**
 * Regional menejer: biriktirilgan viloyatdagi filiallar, koordinatorlar va xodimlar doirasi.
 */
import { eq } from "drizzle-orm";
import { db, employeesTable, usersTable } from "@workspace/db";
import { branchViloyatSlug } from "./viloyat";

export const REGIONAL_MANAGER_ROLE = "regional_menejer";

export function isRegionalManagerRole(role?: string | null): boolean {
  return (role ?? "").trim().toLowerCase() === REGIONAL_MANAGER_ROLE;
}

export async function getUserAssignedViloyat(userId: number): Promise<string | null> {
  const [u] = await db
    .select({ assignedViloyat: usersTable.assignedViloyat })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  const slug = (u?.assignedViloyat || "").trim();
  return slug || null;
}

type EmpLite = {
  id: number;
  userId: number | null;
  orgRole: string | null;
  reportsToId: number | null;
  assignedBranchId: number | null;
  latitude: number | null;
  longitude: number | null;
  location: string | null;
  employmentStatus: string | null;
};

async function loadEmployees(): Promise<EmpLite[]> {
  return db
    .select({
      id: employeesTable.id,
      userId: employeesTable.userId,
      orgRole: employeesTable.orgRole,
      reportsToId: employeesTable.reportsToId,
      assignedBranchId: employeesTable.assignedBranchId,
      latitude: employeesTable.latitude,
      longitude: employeesTable.longitude,
      location: employeesTable.location,
      employmentStatus: employeesTable.employmentStatus,
    })
    .from(employeesTable);
}

/** Viloyatdagi mudir (filial) id lari — GPS + joy nomi bo‘yicha */
export async function managerIdsInViloyat(viloyatSlug: string): Promise<Set<number>> {
  const rows = await loadEmployees();
  const out = new Set<number>();
  for (const r of rows) {
    if (String(r.orgRole || "") !== "manager") continue;
    if (r.employmentStatus === "dismissed") continue;
    const slug = branchViloyatSlug(r.latitude, r.longitude, r.location);
    if (slug === viloyatSlug) out.add(r.id);
  }
  return out;
}

/**
 * Viloyat doirasidagi barcha xodim id lari:
 * mudirlar + ularning staffi + shu mudirlarga bog‘langan koordinatorlar.
 */
export async function employeeIdsInViloyat(viloyatSlug: string): Promise<Set<number>> {
  const rows = await loadEmployees();
  const managers = await managerIdsInViloyat(viloyatSlug);
  const keep = new Set<number>(managers);

  // Koordinatorlar — viloyatdagi kamida 1 filialga bog‘langan
  for (const r of rows) {
    if (String(r.orgRole || "") !== "manager" || !managers.has(r.id)) continue;
    if (r.reportsToId != null) keep.add(r.reportsToId);
  }

  // Staff: reports_to mudir yoki assigned_branch
  for (const r of rows) {
    if (r.employmentStatus === "dismissed") continue;
    if (r.reportsToId != null && managers.has(r.reportsToId)) keep.add(r.id);
    if (r.assignedBranchId != null && managers.has(r.assignedBranchId)) keep.add(r.id);
  }

  // Koordinator ostidagi boshqa tugunlar (BFS)
  const children = new Map<number, EmpLite[]>();
  for (const r of rows) {
    if (r.reportsToId == null) continue;
    const list = children.get(r.reportsToId) ?? [];
    list.push(r);
    children.set(r.reportsToId, list);
  }
  const queue = [...keep];
  const seen = new Set(keep);
  while (queue.length) {
    const id = queue.shift()!;
    for (const child of children.get(id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      if (child.employmentStatus === "dismissed") continue;
      keep.add(child.id);
      queue.push(child.id);
    }
  }

  return keep;
}

export async function employeeIdsForRegionalManager(userId: number): Promise<Set<number>> {
  const viloyat = await getUserAssignedViloyat(userId);
  if (!viloyat) return new Set();
  return employeeIdsInViloyat(viloyat);
}

export async function managerIdsForRegionalManager(userId: number): Promise<Set<number>> {
  const viloyat = await getUserAssignedViloyat(userId);
  if (!viloyat) return new Set();
  return managerIdsInViloyat(viloyat);
}
