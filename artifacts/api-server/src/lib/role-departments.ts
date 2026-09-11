import { eq, sql } from "drizzle-orm";
import { db, departmentsTable } from "@workspace/db";

export const FARMASEVT_DEPARTMENT_NAME = "Farmasevt";

export const PHARMACY_USER_ROLES = ["mudir", "farmasevt", "stajyor"] as const;

/** Rol → bo‘lim nomi. Faqat mudir/farmasevt/stajyor «Farmasevt» bo‘limida. */
export const ROLE_DEPARTMENT_NAME: Record<string, string> = {
  admin: "Rahbariyat",
  director: "Rahbariyat",
  asoschi: "Rahbariyat",
  moliya: "Rahbariyat",
  moliya_rahbar: "Moliya",
  moliya_xodim: "Moliya",
  taminot_rahbar: "Ta’minot",
  taminot: "Ta’minot",
  rivojlantirish_rahbar: "Rivojlantirish",
  rivojlantirish: "Rivojlantirish",
  mamuriy_rahbar: "Ma’muriy-xo‘jalik",
  mamuriy: "Ma’muriy-xo‘jalik",
  gpp_rahbar: "GPP",
  gpp: "GPP",
  ombor_rahbar: "Omborxona",
  oshpaz_rahbar: "Oshpaz",
  oshpaz: "Oshpaz",
  marketing_rahbar: "Marketing",
  marketing: "Marketing",
  mudir: FARMASEVT_DEPARTMENT_NAME,
  farmasevt: FARMASEVT_DEPARTMENT_NAME,
  stajyor: FARMASEVT_DEPARTMENT_NAME,
  kassir: "Moliya",
  yurist: "Rahbariyat",
  komunalniy: "Ma’muriy-xo‘jalik",
  direktor_yordamchisi: "Rahbariyat",
  hr: "HR",
  hr_direktor: "HR",
  hr_kadr_rahbar: "HR",
  hr_menejer: "HR",
  hr_auditor: "HR",
  recruiter: "Rekruting",
  trainer: "Trening",
  koordinator: "Koordinator",
  it: "AyTi",
  it_rahbar: "AyTi",
  it_dasturchi: "AyTi",
  it_tarmoq: "AyTi",
  revizor: "Reviziya",
  reviziya_rahbar: "Reviziya",
  sb: "Xavfsizlik",
  sb_boshliq: "Xavfsizlik",
  ombor: "Omborxona",
  distrib_rahbar: "Distribyutsiya",
  distrib_hr: "Distribyutsiya",
  distrib: "Distribyutsiya",
};

export function departmentNameForRole(role?: string | null): string | null {
  if (!role) return null;
  return ROLE_DEPARTMENT_NAME[role] ?? null;
}

function normalizeDeptName(name: string): string {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("uz");
}

async function reassignDepartmentRefs(fromId: number, toId: number) {
  await db.execute(sql`UPDATE users SET department_id = ${toId} WHERE department_id = ${fromId}`);
  try {
    await db.execute(sql`UPDATE employees SET department_id = ${toId} WHERE department_id = ${fromId}`);
  } catch {
    /* ustun yo‘q bo‘lishi mumkin */
  }
  try {
    await db.execute(sql`UPDATE requests SET department_id = ${toId} WHERE department_id = ${fromId}`);
  } catch {
    /* ignore */
  }
  try {
    await db.execute(
      sql`UPDATE department_job_titles SET department_id = ${toId} WHERE department_id = ${fromId}`,
    );
  } catch {
    /* ignore */
  }
  try {
    await db.execute(
      sql`UPDATE department_attendance_qr SET department_id = ${toId} WHERE department_id = ${fromId}`,
    );
  } catch {
    /* ignore */
  }
}

/** Bir xil nomdagi dublikatlarni birlashtirish (masalan 2 ta «Koordinator»). */
export async function dedupeDepartmentsByName(): Promise<number> {
  const rows = await db
    .select({
      id: departmentsTable.id,
      name: departmentsTable.name,
      headId: departmentsTable.headId,
    })
    .from(departmentsTable);

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = normalizeDeptName(r.name);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  let removed = 0;
  for (const [, list] of groups) {
    if (list.length < 2) continue;
    // Saqlanadigan: boshlig‘i bor yoki eng kichik id
    const sorted = [...list].sort((a, b) => {
      if ((a.headId != null) !== (b.headId != null)) return a.headId != null ? -1 : 1;
      return a.id - b.id;
    });
    const keep = sorted[0]!;
    const canonName =
      Object.values(ROLE_DEPARTMENT_NAME).find(
        (n) => normalizeDeptName(n) === normalizeDeptName(keep.name),
      ) || keep.name.trim();

    if (keep.name !== canonName) {
      await db
        .update(departmentsTable)
        .set({ name: canonName })
        .where(eq(departmentsTable.id, keep.id));
    }

    for (const dup of sorted.slice(1)) {
      await reassignDepartmentRefs(dup.id, keep.id);
      await db.delete(departmentsTable).where(eq(departmentsTable.id, dup.id));
      removed += 1;
    }
  }
  return removed;
}

export async function ensureDepartmentByName(name: string): Promise<number> {
  const trimmed = String(name || "").trim().replace(/\s+/g, " ");
  if (!trimmed) throw new Error("Bo‘lim nomi bo‘sh");

  const [existing] = await db
    .select({ id: departmentsTable.id, name: departmentsTable.name })
    .from(departmentsTable)
    .where(sql`lower(trim(name)) = ${normalizeDeptName(trimmed)}`)
    .limit(1);
  if (existing) {
    if (existing.name !== trimmed) {
      await db
        .update(departmentsTable)
        .set({ name: trimmed })
        .where(eq(departmentsTable.id, existing.id));
    }
    return existing.id;
  }

  const [created] = await db
    .insert(departmentsTable)
    .values({ name: trimmed })
    .returning({ id: departmentsTable.id });
  if (created) return created.id;

  const [again] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(sql`lower(trim(name)) = ${normalizeDeptName(trimmed)}`)
    .limit(1);
  if (!again) throw new Error(`«${trimmed}» bo‘limi yaratilmadi`);
  return again.id;
}

export async function resolveDepartmentIdForRole(role: string): Promise<number | null> {
  const name = departmentNameForRole(role);
  if (!name) return null;
  return ensureDepartmentByName(name);
}

/** Barcha rollarni o‘z bo‘limiga; faqat apteka tarmog‘i — Farmasevt. */
export async function syncAllRoleDepartmentAssignments(): Promise<void> {
  await dedupeDepartmentsByName();

  const { ensureItDepartmentId } = await import("./it-department");
  await ensureItDepartmentId();
  try {
    const { ensureDistribyutsiyaSetup } = await import("./distribyutsiya-department");
    await ensureDistribyutsiyaSetup();
  } catch {
    /* jadval hali yo‘q bo‘lishi mumkin */
  }
  const farmId = await ensureDepartmentByName(FARMASEVT_DEPARTMENT_NAME);

  for (const [role, deptName] of Object.entries(ROLE_DEPARTMENT_NAME)) {
    if ((PHARMACY_USER_ROLES as readonly string[]).includes(role)) continue;
    const deptId = await ensureDepartmentByName(deptName);
    await db.execute(sql`
      UPDATE users
      SET department_id = ${deptId}
      WHERE role = ${role}
        AND department_id IS DISTINCT FROM ${deptId}
    `);
    await db.execute(sql`
      UPDATE employees e
      SET department_id = ${deptId}
      FROM users u
      WHERE e.user_id = u.id
        AND u.role = ${role}
        AND e.department_id IS DISTINCT FROM ${deptId}
    `);
  }

  await db.execute(sql`
    UPDATE users
    SET department_id = ${farmId}
    WHERE role IN ('mudir', 'farmasevt', 'stajyor')
      AND department_id IS DISTINCT FROM ${farmId}
  `);
  await db.execute(sql`
    UPDATE employees e
    SET department_id = ${farmId}
    FROM users u
    WHERE e.user_id = u.id
      AND u.role IN ('mudir', 'farmasevt', 'stajyor')
      AND e.department_id IS DISTINCT FROM ${farmId}
  `);
  await db.execute(sql`
    UPDATE employees
    SET department_id = ${farmId}
    WHERE org_role IN ('manager', 'pharmacist', 'intern')
      AND (
        user_id IS NULL
        OR user_id IN (SELECT id FROM users WHERE role IN ('mudir', 'farmasevt', 'stajyor'))
      )
      AND department_id IS DISTINCT FROM ${farmId}
  `);

  await dedupeDepartmentsByName();
}
