import { and, eq, gte, inArray, isNotNull, lte, ne, or } from "drizzle-orm";
import {
  db,
  usersTable,
  employeesTable,
  attendanceRecordsTable,
  branchAttendanceQrTable,
} from "@workspace/db";
import { displayBranchName, parseGpsText, withGpsSuffix } from "./geo-location";
import { ensureFarmasevtDepartmentId } from "./farmasevt-department";
import { purgeEmployeeSideEffects, purgeUserSideEffects } from "./delete-pharmacy-staff";
import { archiveAndDeleteUser } from "./dismiss-user";
import { invalidateFilialBranchCache } from "./filial-bot-data";
import { FILIAL_CATALOG, filialNumberLabel, matchFilialCatalog } from "./filial-catalog";
import { foldScript } from "./script-search";
import { ymdInTashkent } from "./shift-hours";
import { sql } from "drizzle-orm";

type PersonInput = {
  firstName: string;
  lastName: string;
  phone: string;
};

export type BranchStaffInput = PersonInput & {
  role: "farmasevt" | "stajyor";
};

export type CreatedAccount = {
  role: "mudir" | "farmasevt" | "stajyor";
  fullName: string;
  login: string;
  temporaryPassword: string;
  employeeId: number;
};

function latinSlug(input: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh",
    ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
    ў: "o", қ: "q", ғ: "g", ҳ: "h",
  };
  let s = input.trim().toLowerCase();
  s = s.replace(/o['ʻ’`]/g, "o").replace(/g['ʻ’`]/g, "g");
  let out = "";
  for (const ch of s) out += map[ch] ?? ch;
  out = out.replace(/[^a-z0-9]+/g, "").slice(0, 14);
  return out || "user";
}

function randomPassword(len = 8): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let pwd = "";
  for (let i = 0; i < len; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
  return pwd;
}

async function uniqueLogin(role: string, fullName: string): Promise<string> {
  const base = `${role}_${latinSlug(fullName)}`;
  let candidate = base;
  for (let i = 0; i < 50; i++) {
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.login, candidate));
    if (!existing) return candidate;
    candidate = `${base}${i + 2}`;
  }
  return `${base}_${Date.now().toString(36).slice(-4)}`;
}

function personName(p: PersonInput): string {
  return `${p.lastName} ${p.firstName}`.replace(/\s+/g, " ").trim();
}

async function insertPerson(opts: {
  person: PersonInput;
  role: "mudir" | "farmasevt" | "stajyor";
  orgRole: "manager" | "pharmacist" | "intern";
  position: string;
  reportsToId: number;
  location: string;
  latitude: number;
  longitude: number;
  departmentId: number;
  actorId: number;
}): Promise<CreatedAccount> {
  const fullName = personName(opts.person);
  const login = await uniqueLogin(opts.role, fullName);
  const temporaryPassword = randomPassword(8);
  const [user] = await db
    .insert(usersTable)
    .values({
      fullName,
      role: opts.role,
      departmentId: opts.departmentId,
      login,
      password: temporaryPassword,
      phone: opts.person.phone.trim(),
      status: "active",
    })
    .returning();
  const [employee] = await db
    .insert(employeesTable)
    .values({
      fullName,
      position: opts.position,
      departmentId: opts.departmentId,
      hiredAt: ymdInTashkent(new Date()),
      orgRole: opts.orgRole,
      reportsToId: opts.reportsToId,
      location: opts.location,
      latitude: opts.latitude,
      longitude: opts.longitude,
      userId: user!.id,
      employmentStatus: "working",
      shiftType: "one",
      shiftLabel: "1-smena",
      createdById: opts.actorId,
    })
    .returning();
  return {
    role: opts.role,
    fullName,
    login,
    temporaryPassword,
    employeeId: employee!.id,
  };
}

export type ActiveBranchInfo = {
  employeeId: number;
  branchNo: number | null;
  branchName: string;
  coordinatorName: string | null;
  mudirName: string | null;
};

/**
 * Hozir ishlayotgan filiallar (mudirli yoki mudirsiz).
 * Bo‘shatilgan/yopilgan qatorlar va o‘chirilgan (terminated) mudirlar raqamni band qilmaydi.
 */
export async function loadActiveBranches(): Promise<ActiveBranchInfo[]> {
  const rows = await db
    .select({
      id: employeesTable.id,
      fullName: employeesTable.fullName,
      location: employeesTable.location,
      branchNo: employeesTable.branchNo,
      reportsToId: employeesTable.reportsToId,
      userId: employeesTable.userId,
      employmentStatus: employeesTable.employmentStatus,
      userStatus: usersTable.status,
    })
    .from(employeesTable)
    .leftJoin(usersTable, eq(usersTable.id, employeesTable.userId))
    .where(eq(employeesTable.orgRole, "manager"));

  const alive = rows.filter((r) => {
    const st = r.employmentStatus || "working";
    if (st === "dismissed" || st === "closed") return false;
    if (r.userId != null && (r.userStatus == null || r.userStatus === "terminated")) return false;
    return true;
  });

  const coordIds = [...new Set(alive.map((r) => r.reportsToId).filter((id): id is number => id != null))];
  const coordName = new Map<number, string>();
  if (coordIds.length) {
    const coords = await db
      .select({ id: employeesTable.id, fullName: employeesTable.fullName })
      .from(employeesTable)
      .where(inArray(employeesTable.id, coordIds));
    for (const c of coords) coordName.set(c.id, c.fullName);
  }

  return alive.map((r) => {
    const vacant = r.userId == null || r.employmentStatus === "no_manager";
    return {
      employeeId: r.id,
      branchNo: r.branchNo ?? null,
      branchName: displayBranchName(r.location) || (r.location || "").split("|")[0].trim() || r.fullName,
      coordinatorName: r.reportsToId != null ? coordName.get(r.reportsToId) ?? null : null,
      mudirName: vacant ? null : r.fullName,
    };
  });
}

function nextFreeNo(branches: ActiveBranchInfo[]): number {
  const used = new Set(branches.map((b) => b.branchNo).filter((n): n is number => n != null));
  let max = 0;
  for (const n of used) if (n > max) max = n;
  return Math.min(999, max + 1);
}

function sameBranchName(a: string, b: string): boolean {
  const fa = foldScript(a);
  return fa.length > 0 && fa === foldScript(b);
}

export type BranchInputCheck = {
  no: {
    value: number;
    label: string;
    free: boolean;
    holder: ActiveBranchInfo | null;
    /** Rasmiy katalogda shu raqamdagi filial nomi */
    catalogName: string | null;
  } | null;
  sameName: ActiveBranchInfo[];
  /** Kiritilgan nom katalogdagi qaysi raqamga to‘g‘ri keladi */
  catalogNoForName: number | null;
  nextFreeNo: number;
};

/** Filial kiritishda raqam va nom bandligini oldindan tekshirish. */
export async function checkBranchInput(input: { branchNo?: number | null; branchName?: string | null }): Promise<BranchInputCheck> {
  const branches = await loadActiveBranches();
  let no: BranchInputCheck["no"] = null;
  const n = input.branchNo;
  if (n != null && Number.isInteger(n) && n >= 0 && n <= 999) {
    const holder = branches.find((b) => b.branchNo === n) ?? null;
    const cat = FILIAL_CATALOG.find((e) => e.no === n);
    no = {
      value: n,
      label: filialNumberLabel(n) || String(n),
      free: !holder,
      holder,
      catalogName: cat ? cat.short || cat.official : null,
    };
  }
  const name = (input.branchName || "").trim();
  const sameName = name.length >= 2 ? branches.filter((b) => sameBranchName(b.branchName, name)) : [];
  const catalogNoForName = name.length >= 2 ? matchFilialCatalog(name)?.no ?? null : null;
  return { no, sameName, catalogNoForName, nextFreeNo: nextFreeNo(branches) };
}

function describeHolder(h: ActiveBranchInfo): string {
  const who = h.mudirName ? `mudir: ${h.mudirName}` : "mudiri yo‘q";
  const coord = h.coordinatorName ? `, koordinator: ${h.coordinatorName}` : "";
  return `«${h.branchName}» (${who}${coord})`;
}

export async function createPharmacyBranch(input: {
  coordinatorEmployeeId: number;
  branchName: string;
  branchNo: number;
  coordinates: string;
  mudir: PersonInput;
  staff: BranchStaffInput[];
  actorId: number;
}): Promise<
  | { ok: true; branchName: string; coordinatorName: string; employeeId: number; accounts: CreatedAccount[] }
  | { ok: false; status: number; error: string }
> {
  const branchName = input.branchName.trim();
  if (branchName.length < 2) return { ok: false, status: 400, error: "Filial nomini kiriting" };
  const branchNo = Number(input.branchNo);
  if (!Number.isInteger(branchNo) || branchNo < 0 || branchNo > 999) {
    return { ok: false, status: 400, error: "Filial raqamini kiriting. Asosiy uchun 0" };
  }
  const check = await checkBranchInput({ branchNo });
  if (check.no?.holder) {
    return {
      ok: false,
      status: 409,
      error: `${check.no.label} band — ${describeHolder(check.no.holder)}. Bo‘sh raqam: ${check.nextFreeNo}`,
    };
  }
  const gps = parseGpsText(input.coordinates);
  if (!gps) {
    return { ok: false, status: 400, error: "Koordinatani Google Mapsdan nusxa qiling" };
  }
  const mudirName = personName(input.mudir);
  if (mudirName.length < 3 || !input.mudir.phone.trim()) {
    return { ok: false, status: 400, error: "Zavedushi ismi, familiyasi va telefoni kerak" };
  }
  for (const s of input.staff) {
    if (personName(s).length < 3 || !s.phone.trim()) {
      return { ok: false, status: 400, error: "Qo‘shilgan xodimning ismi va telefoni to‘liq bo‘lsin" };
    }
    if (s.role !== "farmasevt" && s.role !== "stajyor") {
      return { ok: false, status: 400, error: "Xodim roli: farmasevt yoki stajyor" };
    }
  }

  const [coord] = await db
    .select({
      id: employeesTable.id,
      fullName: employeesTable.fullName,
      orgRole: employeesTable.orgRole,
      employmentStatus: employeesTable.employmentStatus,
    })
    .from(employeesTable)
    .where(eq(employeesTable.id, input.coordinatorEmployeeId))
    .limit(1);
  if (!coord || coord.orgRole !== "coordinator" || coord.employmentStatus === "dismissed") {
    return { ok: false, status: 400, error: "Koordinatorni tanlang" };
  }

  const departmentId = await ensureFarmasevtDepartmentId();
  const location = withGpsSuffix(branchName, gps.lat, gps.lng);
  const accounts: CreatedAccount[] = [];

  const mudir = await insertPerson({
    person: input.mudir,
    role: "mudir",
    orgRole: "manager",
    position: "Filial mudiri",
    reportsToId: coord.id,
    location,
    latitude: gps.lat,
    longitude: gps.lng,
    departmentId,
    actorId: input.actorId,
  });
  accounts.push(mudir);
  // Faol egasi yo‘q — qolgan qatorlardagi shu raqam eski (o‘chirilgan/bo‘shatilgan filial) izi
  await db
    .update(employeesTable)
    .set({ branchNo: null })
    .where(
      and(
        eq(employeesTable.orgRole, "manager"),
        eq(employeesTable.branchNo, branchNo),
        ne(employeesTable.id, mudir.employeeId),
      ),
    );
  await db.update(employeesTable).set({ branchNo }).where(eq(employeesTable.id, mudir.employeeId));

  for (const s of input.staff) {
    const role = s.role;
    accounts.push(
      await insertPerson({
        person: s,
        role,
        orgRole: role === "stajyor" ? "intern" : "pharmacist",
        position: role === "stajyor" ? "Stajyor" : "Farmasevt",
        reportsToId: mudir.employeeId,
        location,
        latitude: gps.lat,
        longitude: gps.lng,
        departmentId,
        actorId: input.actorId,
      }),
    );
  }

  invalidateFilialBranchCache();
  return {
    ok: true,
    branchName,
    coordinatorName: coord.fullName,
    employeeId: mudir.employeeId,
    accounts,
  };
}

async function workedThisMonth(employeeIds: number[]): Promise<Set<number>> {
  if (!employeeIds.length) return new Set();
  const today = ymdInTashkent(new Date());
  const from = `${today.slice(0, 7)}-01`;
  const rows = await db
    .select({ employeeId: attendanceRecordsTable.employeeId })
    .from(attendanceRecordsTable)
    .where(
      and(
        inArray(attendanceRecordsTable.employeeId, employeeIds),
        gte(attendanceRecordsTable.workDate, from),
        lte(attendanceRecordsTable.workDate, today),
        isNotNull(attendanceRecordsTable.checkInAt),
      ),
    );
  return new Set(rows.map((r) => r.employeeId));
}

/** Filialni hamma joydan olib tashlash. Shu oy kelganlar bo‘shatilganlarga o‘tadi. */
export async function removePharmacyBranch(
  managerEmployeeId: number,
  actorId: number,
): Promise<
  | { ok: true; branchName: string; wiped: string[]; dismissed: string[] }
  | { ok: false; status: number; error: string }
> {
  const [manager] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.id, managerEmployeeId))
    .limit(1);
  if (!manager || manager.orgRole !== "manager") {
    return { ok: false, status: 404, error: "Filial topilmadi" };
  }

  const staff = await db
    .select()
    .from(employeesTable)
    .where(
      or(
        eq(employeesTable.reportsToId, manager.id),
        eq(employeesTable.assignedBranchId, manager.id),
      ),
    );
  const people = [manager, ...staff.filter((s) => s.id !== manager.id)];
  const worked = await workedThisMonth(people.map((p) => p.id));

  try {
    await db.delete(branchAttendanceQrTable).where(eq(branchAttendanceQrTable.branchId, manager.id));
  } catch {
    /* QR jadvali bo‘lmasa ham davom */
  }
  try {
    await db.execute(sql`DELETE FROM branch_contacts WHERE branch_employee_id = ${manager.id}`);
  } catch {
    /* kontakt jadvali bo‘lmasa ham davom */
  }

  // Raqam darhol bo‘shasin — yangi filialga qayta berish mumkin bo‘lsin
  await db.update(employeesTable).set({ branchNo: null }).where(eq(employeesTable.id, manager.id));

  const wipe = people.filter((p) => !p.userId || !worked.has(p.id));
  const keep = people.filter((p) => p.userId && worked.has(p.id));

  if (wipe.length) {
    const wipeIds = wipe.map((p) => p.id);
    const userIds = [...new Set(wipe.map((p) => p.userId).filter((id): id is number => id != null))];
    await purgeEmployeeSideEffects(wipeIds);
    if (userIds.length) await purgeUserSideEffects(userIds);
    await db.delete(employeesTable).where(inArray(employeesTable.id, wipeIds));
    if (userIds.length) {
      await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    }
  }

  const dismissed: string[] = [];
  for (const person of keep) {
    if (!person.userId) continue;
    const ok = await archiveAndDeleteUser(person.userId, {
      actorId,
      reason: "Filial o‘chirildi. Shu oyda davomat qilgan — hisobotda oy oxirigacha qoladi.",
    });
    if (ok) dismissed.push(person.fullName);
  }

  invalidateFilialBranchCache();
  return {
    ok: true,
    branchName: displayBranchName(manager.location) || manager.fullName,
    wiped: wipe.map((p) => p.fullName),
    dismissed,
  };
}

/**
 * Filialni boshqa koordinatorga o‘tkazish.
 * Faqat mudir qatoridagi reportsToId o‘zgaradi. Nom, GPS, xodimlar, smena, login va davomat qoladi.
 */
export async function transferPharmacyBranch(
  managerEmployeeId: number,
  coordinatorEmployeeId: number,
): Promise<
  | {
      ok: true;
      branchName: string;
      fromCoordinator: string;
      toCoordinator: string;
      message: string;
    }
  | { ok: false; status: number; error: string }
> {
  if (!Number.isFinite(managerEmployeeId) || managerEmployeeId <= 0) {
    return { ok: false, status: 400, error: "Filial tanlanmagan" };
  }
  if (!Number.isFinite(coordinatorEmployeeId) || coordinatorEmployeeId <= 0) {
    return { ok: false, status: 400, error: "Yangi koordinator tanlanmagan" };
  }
  if (managerEmployeeId === coordinatorEmployeeId) {
    return { ok: false, status: 400, error: "Filialni o‘ziga o‘tkazib bo‘lmaydi" };
  }

  const [manager] = await db
    .select({
      id: employeesTable.id,
      orgRole: employeesTable.orgRole,
      fullName: employeesTable.fullName,
      location: employeesTable.location,
      reportsToId: employeesTable.reportsToId,
      employmentStatus: employeesTable.employmentStatus,
    })
    .from(employeesTable)
    .where(eq(employeesTable.id, managerEmployeeId))
    .limit(1);
  if (!manager || manager.orgRole !== "manager") {
    return { ok: false, status: 404, error: "Filial topilmadi" };
  }
  if (manager.employmentStatus === "dismissed") {
    return { ok: false, status: 400, error: "Bo‘shatilgan filialni o‘tkazib bo‘lmaydi" };
  }

  const [next] = await db
    .select({
      id: employeesTable.id,
      orgRole: employeesTable.orgRole,
      fullName: employeesTable.fullName,
      employmentStatus: employeesTable.employmentStatus,
    })
    .from(employeesTable)
    .where(eq(employeesTable.id, coordinatorEmployeeId))
    .limit(1);
  if (!next || next.orgRole !== "coordinator") {
    return { ok: false, status: 404, error: "Koordinator topilmadi" };
  }
  if (next.employmentStatus === "dismissed" || next.employmentStatus === "closed") {
    return { ok: false, status: 400, error: "Bu koordinator faol emas" };
  }
  if (manager.reportsToId === next.id) {
    return { ok: false, status: 409, error: "Filial allaqachon shu koordinatorga tegishli" };
  }

  let fromCoordinator = "Koordinatorsiz";
  if (manager.reportsToId) {
    const [prev] = await db
      .select({ fullName: employeesTable.fullName })
      .from(employeesTable)
      .where(eq(employeesTable.id, manager.reportsToId))
      .limit(1);
    if (prev?.fullName?.trim()) fromCoordinator = prev.fullName.trim();
  }

  await db
    .update(employeesTable)
    .set({ reportsToId: next.id, updatedAt: new Date() })
    .where(eq(employeesTable.id, manager.id));

  invalidateFilialBranchCache();
  const branchName = displayBranchName(manager.location) || manager.fullName;
  const toCoordinator = next.fullName.trim();
  return {
    ok: true,
    branchName,
    fromCoordinator,
    toCoordinator,
    message: `«${branchName}» ${fromCoordinator}dan ${toCoordinator}ga o‘tdi. Xodim, smena, GPS va davomat o‘zgarmadi.`,
  };
}
