/**
 * Faol xodimlar — foydalanuvchilar (users) asosida, employee kartasi bilan.
 * Xodimlar, Oylik va Hisob-kitob sahifalari shu yuklovchidan foydalanadi.
 */
import { asc, eq, inArray, ne } from "drizzle-orm";
import {
  db,
  departmentsTable,
  employeesTable,
  faceProfilesTable,
  usersTable,
} from "@workspace/db";
import { ensureEmployeeForNewUser } from "./user-employee-sync";
import { formatPersonName } from "./person-name";

export type StaffRow = {
  id: number;
  fullName: string;
  position: string;
  departmentId: number;
  mentorId: number | null;
  hiredAt: string;
  candidateId: number | null;
  orgRole: string | null;
  reportsToId: number | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  shiftType: string | null;
  shiftLabel: string | null;
  employmentStatus: string | null;
  userId: number | null;
  photoUrl: string | null;
  login: string | null;
  phone: string | null;
  userStatus: string | null;
  userRole: string | null;
  fixedSalary: number;
  bonusPercent: number;
  createdAt: Date;
  updatedAt: Date;
};

const ROLE_POSITION: Record<string, string> = {
  admin: "Admin",
  director: "Direktor",
  asoschi: "Asoschi",
  department_head: "Bo‘lim boshlig‘i",
  hr_direktor: "HR Direktor",
  hr_menejer: "HR Menejer",
  hr_auditor: "HR Auditor",
  recruiter: "Rekruter",
  trainer: "Trener",
  mentor: "Mentor",
  mudir: "Mudir",
  koordinator: "Koordinator",
  texnik: "Texnik",
  texnik_rahbar: "Texnik bo‘limi rahbari",
  it: "IT mutaxassisi",
  it_rahbar: "IT bo‘limi rahbari",
  ombor: "Ombor",
  farmasevt: "Farmasevt",
  stajyor: "Stajyor",
  moliya: "Moliyachi",
  revizor: "Revizor-yig‘uvchi",
  reviziya_rahbar: "Reviziya bo‘limi rahbari",
  sb: "SB operatori",
  sb_boshliq: "SB bo‘limi boshlig‘i",
};

const EMP_LIST_SELECT = {
  id: employeesTable.id,
  fullName: employeesTable.fullName,
  position: employeesTable.position,
  departmentId: employeesTable.departmentId,
  mentorId: employeesTable.mentorId,
  hiredAt: employeesTable.hiredAt,
  candidateId: employeesTable.candidateId,
  orgRole: employeesTable.orgRole,
  reportsToId: employeesTable.reportsToId,
  location: employeesTable.location,
  latitude: employeesTable.latitude,
  longitude: employeesTable.longitude,
  shiftType: employeesTable.shiftType,
  shiftLabel: employeesTable.shiftLabel,
  employmentStatus: employeesTable.employmentStatus,
  userId: employeesTable.userId,
  photoUrl: employeesTable.photoUrl,
  fixedSalary: employeesTable.fixedSalary,
  bonusPercent: employeesTable.bonusPercent,
  createdAt: employeesTable.createdAt,
  updatedAt: employeesTable.updatedAt,
};

const EMP_CORE_SELECT = {
  id: employeesTable.id,
  fullName: employeesTable.fullName,
  position: employeesTable.position,
  departmentId: employeesTable.departmentId,
  mentorId: employeesTable.mentorId,
  hiredAt: employeesTable.hiredAt,
  candidateId: employeesTable.candidateId,
  createdAt: employeesTable.createdAt,
  updatedAt: employeesTable.updatedAt,
};

export function normalizeUserStatus(status: string | null | undefined): string {
  if (!status || status === "inactive" || status === "blocked") return "vacant";
  return status;
}

export function isActiveStaffUser(status: string | null | undefined): boolean {
  return normalizeUserStatus(status) === "active";
}

export function employmentFromUserStatus(status: string | null | undefined): string {
  const s = normalizeUserStatus(status);
  if (s === "active") return "working";
  if (s === "on_leave") return "on_leave";
  if (s === "terminated") return "dismissed";
  return "dismissed";
}

export function userStatusFromEmployment(status: string): string {
  if (status === "working" || status === "new") return "active";
  if (status === "on_leave") return "on_leave";
  if (status === "dismissed" || status === "closed") return "terminated";
  return "vacant";
}

function staffPhotoUrl(userId: number, hasFace: boolean, employeePhoto: string | null): string | null {
  if (hasFace) return `/api/staff/${userId}/avatar`;
  return employeePhoto?.trim() || null;
}

const orgRank = (org: string | null) =>
  ({ manager: 5, coordinator: 4, pharmacist: 3, supervisor: 2, intern: 1 }[org || ""] ?? 0);

/** Foydalanuvchilar bazasidan xodimlar — Xodimlar / Oylik / Hisob-kitob uchun yagona manba */
export async function loadStaffFromUsers(group: "active" | "other" = "active"): Promise<StaffRow[]> {
  const users = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      phone: usersTable.phone,
      login: usersTable.login,
      role: usersTable.role,
      departmentId: usersTable.departmentId,
      status: usersTable.status,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(ne(usersTable.role, "admin"))
    .orderBy(asc(usersTable.fullName));

  const filteredUsers = users.filter((u) =>
    group === "active" ? isActiveStaffUser(u.status) : !isActiveStaffUser(u.status),
  );
  if (!filteredUsers.length) return [];

  const userIds = filteredUsers.map((u) => u.id);

  await Promise.all(
    filteredUsers.map(async (u) => {
      const [linked] = await db
        .select({ id: employeesTable.id })
        .from(employeesTable)
        .where(eq(employeesTable.userId, u.id))
        .limit(1);
      if (!linked) {
        await ensureEmployeeForNewUser({
          id: u.id,
          fullName: u.fullName,
          role: u.role,
          departmentId: u.departmentId,
        });
      }
    }),
  );

  let empRows: StaffRow[] = [];
  try {
    empRows = (await db
      .select(EMP_LIST_SELECT)
      .from(employeesTable)
      .where(inArray(employeesTable.userId, userIds))
      .orderBy(asc(employeesTable.fullName))) as StaffRow[];
  } catch (err) {
    console.error("staff-directory select fallback:", err);
    const core = await db
      .select(EMP_CORE_SELECT)
      .from(employeesTable)
      .where(inArray(employeesTable.userId, userIds))
      .orderBy(asc(employeesTable.fullName));
    empRows = core.map((r) => ({
      ...r,
      orgRole: null,
      reportsToId: null,
      location: null,
      latitude: null,
      longitude: null,
      shiftType: "one",
      shiftLabel: null,
      employmentStatus: "working",
      userId: null,
      photoUrl: null,
      login: null,
      phone: null,
      userStatus: null,
      userRole: null,
      fixedSalary: 0,
      bonusPercent: 30,
    }));
  }

  const faces = await db
    .select({ userId: faceProfilesTable.userId, photoUrl: faceProfilesTable.photoUrl })
    .from(faceProfilesTable)
    .where(inArray(faceProfilesTable.userId, userIds));
  const faceSet = new Set(faces.filter((f) => f.photoUrl?.trim()).map((f) => f.userId));

  const empByUser = new Map<number, StaffRow>();
  for (const r of empRows.sort((a, b) => orgRank(b.orgRole) - orgRank(a.orgRole) || a.id - b.id)) {
    const uid = r.userId;
    if (uid == null) continue;
    if (!empByUser.has(uid)) empByUser.set(uid, r);
  }

  const [fallbackDept] = await db.select({ id: departmentsTable.id }).from(departmentsTable).limit(1);
  const fallbackDeptId = fallbackDept?.id ?? 1;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });

  return filteredUsers.map((u) => {
    const emp = empByUser.get(u.id);
    const hasFace = faceSet.has(u.id);
    const userStatus = normalizeUserStatus(u.status);
    if (emp) {
      return {
        ...emp,
        fullName: formatPersonName(u.fullName.trim() || emp.fullName),
        login: u.login ?? null,
        phone: u.phone ?? null,
        userStatus,
        userRole: u.role,
        employmentStatus: emp.employmentStatus || employmentFromUserStatus(u.status),
        photoUrl: staffPhotoUrl(u.id, hasFace, emp.photoUrl),
        fixedSalary: Math.max(0, Math.round(Number(emp.fixedSalary ?? 0))),
        bonusPercent: Math.max(0, Number(emp.bonusPercent ?? 30)),
      };
    }
    return {
      id: u.id,
      fullName: formatPersonName(u.fullName),
      position: ROLE_POSITION[u.role] || u.role || "Xodim",
      departmentId: u.departmentId ?? fallbackDeptId,
      mentorId: null,
      hiredAt: today,
      candidateId: null,
      orgRole: null,
      reportsToId: null,
      location: null,
      latitude: null,
      longitude: null,
      shiftType: "one",
      shiftLabel: null,
      employmentStatus: employmentFromUserStatus(u.status),
      userId: u.id,
      photoUrl: staffPhotoUrl(u.id, hasFace, null),
      login: u.login ?? null,
      phone: u.phone ?? null,
      userStatus,
      userRole: u.role,
      fixedSalary: 0,
      bonusPercent: 30,
      createdAt: u.createdAt,
      updatedAt: u.createdAt,
    };
  });
}
