import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  db,
  employeesTable,
  employeeBranchAssignmentsTable,
  employeeDayShiftPlansTable,
  employeeWorkSlotsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { isHrRole, isDirectorRole, canManageSmenaFilial } from "../lib/roles";
import { notifyUser } from "../lib/notify";
import { isPharmacyShiftStaff, normalizeShiftType, shiftWindow, parseShiftKeys, encodeShiftKeys, validateShiftCombination } from "../lib/shift-hours";
import { getEffectiveShiftDefs } from "../lib/shift-schedule";
import { displayBranchName } from "../lib/geo-location";
import { dedupeActiveBranches } from "../lib/branch-dedupe";
import {
  validateSlotInput,
  conflictAmongSlots,
  resolveSlotsForDay,
  formatShiftKeyUz,
  formatModeUz,
  isoWeekdayTashkent,
  normalizeWeekdays,
  weekdayLabelUz,
  type WorkSlotRow,
} from "../lib/work-slots";
import { addDaysYmd } from "../lib/attendance-engine";
import {
  smenaAccessFor,
  logSmenaChange,
  listCoordAccess,
  setCoordAccess,
  querySmenaLog,
  smenaLogStatsByActor,
  listSmenaLogActors,
  type SmenaActorAccess,
  type SmenaLogEntry,
} from "../lib/smena-access";

const router: IRouter = Router();

const STAFF_ORG = new Set(["pharmacist", "intern", "supervisor"]);
const MANAGER_ORG = "manager";

function isLeadRole(role: string) {
  return role === "admin" || isDirectorRole(role) || role === "koordinator" || isHrRole(role);
}

function denyNonAdminOrHr(role: string, res: { status(code: number): { json(body: unknown): void } }): boolean {
  if (!canManageSmenaFilial(role)) {
    res.status(403).json({ error: "Smena va filial boshqaruvi faqat HR menejer va Adminga berilgan." });
    return true;
  }
  return false;
}

function denyCoordinatorEdit(role: string, res: { status(code: number): { json(body: unknown): void } }): boolean {
  return denyNonAdminOrHr(role, res);
}

type EmpRow = {
  id: number;
  userId: number | null;
  fullName: string;
  orgRole: string | null;
  reportsToId: number | null;
  assignedBranchId: number | null;
  shiftType: string | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  employmentStatus: string | null;
};

const EMP_COLS = {
  id: employeesTable.id,
  userId: employeesTable.userId,
  fullName: employeesTable.fullName,
  orgRole: employeesTable.orgRole,
  reportsToId: employeesTable.reportsToId,
  assignedBranchId: employeesTable.assignedBranchId,
  shiftType: employeesTable.shiftType,
  location: employeesTable.location,
  latitude: employeesTable.latitude,
  longitude: employeesTable.longitude,
  employmentStatus: employeesTable.employmentStatus,
};

async function empByUserId(userId: number): Promise<EmpRow | null> {
  const [row] = await db.select(EMP_COLS).from(employeesTable).where(eq(employeesTable.userId, userId)).limit(1);
  return row ?? null;
}

async function empById(id: number): Promise<EmpRow | null> {
  const [row] = await db.select(EMP_COLS).from(employeesTable).where(eq(employeesTable.id, id)).limit(1);
  return row ? (await fillOrgFromUsers([row]))[0]! : null;
}

const ORG_FROM_USER_ROLE: Record<string, string> = { farmasevt: "pharmacist", stajyor: "intern" };

/** Kartasida org_role bo‘sh, lekin akkaunti farmasevt/stajyor — davomatdagidek dorixona xodimi deb olinadi */
async function fillOrgFromUsers<T extends { orgRole: string | null; userId: number | null }>(rows: T[]): Promise<T[]> {
  const ids = [...new Set(rows.filter((r) => !r.orgRole && r.userId != null).map((r) => r.userId!))];
  if (!ids.length) return rows;
  const users = await db
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(inArray(usersTable.id, ids));
  const orgByUser = new Map(
    users.filter((u) => ORG_FROM_USER_ROLE[u.role]).map((u) => [u.id, ORG_FROM_USER_ROLE[u.role]!]),
  );
  return rows.map((r) => (!r.orgRole && r.userId != null && orgByUser.has(r.userId) ? { ...r, orgRole: orgByUser.get(r.userId)! } : r));
}

async function activePeople(): Promise<EmpRow[]> {
  const rows = await db
    .select(EMP_COLS)
    .from(employeesTable)
    .where(sql`coalesce(${employeesTable.employmentStatus}, 'working') <> 'dismissed'`);
  return fillOrgFromUsers(rows);
}

function hasGps(e: { latitude: number | null; longitude: number | null }) {
  return e.latitude != null && e.longitude != null && Number.isFinite(e.latitude) && Number.isFinite(e.longitude);
}

/** Bo‘sh «2-smena — xodim kerak» slot — haqiqiy xodim emas, tanlashda chiqmasin */
function isOpenHireSlot(p: { fullName: string; userId: number | null; employmentStatus: string | null }) {
  if (/xodim kerak/i.test(p.fullName)) return true;
  return p.employmentStatus === "need_hire" && !p.userId;
}

async function listBranches() {
  const rows = await db
    .select({
      id: employeesTable.id,
      fullName: employeesTable.fullName,
      location: employeesTable.location,
      latitude: employeesTable.latitude,
      longitude: employeesTable.longitude,
      reportsToId: employeesTable.reportsToId,
      userId: employeesTable.userId,
      employmentStatus: employeesTable.employmentStatus,
    })
    .from(employeesTable)
    .where(eq(employeesTable.orgRole, MANAGER_ORG));
  // Smena picker: GPS bo‘lmagan / mudirsiz filiallar ham ko‘rinsin
  return dedupeActiveBranches(rows)
    .map((b) => ({
      id: b.id,
      name: displayBranchName(b.location) || (b.location || "").split("|")[0].trim() || b.fullName,
      managerName: b.fullName,
      hasGps: hasGps(b),
      reportsToId: b.reportsToId,
      noManager: b.employmentStatus === "no_manager" || b.userId == null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "uz"));
}

function todayTashkentYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

/** Kunlik rotatsiya: mudir o‘zini + jamoani; koordinator/admin — doira ichida */
function canDayRotate(opts: {
  role: string;
  me: EmpRow;
  target: EmpRow;
  scope: Set<number> | null;
}): boolean {
  return canAssignTarget(opts);
}

async function coordinatorScopeIds(coordEmp: EmpRow): Promise<Set<number>> {
  const mgrs = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(eq(employeesTable.reportsToId, coordEmp.id));
  const ids = new Set(mgrs.map((m) => m.id));
  ids.add(coordEmp.id);
  if (!ids.size) return ids;
  const staff = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(
      or(inArray(employeesTable.reportsToId, [...ids]), inArray(employeesTable.assignedBranchId, [...ids])),
    );
  for (const s of staff) ids.add(s.id);
  return ids;
}

function canPickOwnBranch(role: string, orgRole: string | null) {
  return role === "mudir" || orgRole === MANAGER_ORG || isLeadRole(role);
}

function isMudirPerson(orgRole: string | null | undefined) {
  return orgRole === MANAGER_ORG;
}

function mudirActor(role: string, orgRole?: string | null) {
  return role === "mudir" || orgRole === MANAGER_ORG;
}

function canAssignTarget(opts: {
  role: string;
  me: EmpRow;
  target: EmpRow;
  scope: Set<number> | null;
}): boolean {
  const { role, me, target, scope } = opts;
  const org = target.orgRole || "";
  if (org === MANAGER_ORG || mudirActor(role, me.orgRole)) return false;
  if (isLeadRole(role) && role !== "koordinator") {
    return STAFF_ORG.has(org) || org === MANAGER_ORG;
  }
  if (role === "koordinator") {
    if (!(STAFF_ORG.has(org) || org === MANAGER_ORG)) return false;
    if (!scope) return true;
    return scope.has(target.id) || target.reportsToId === me.id;
  }
  if (role === "mudir" || me.orgRole === MANAGER_ORG) {
    if (target.id === me.id) return true;
    if (!(org === "pharmacist" || org === "intern")) return false;
    return (
      target.reportsToId === me.id ||
      target.assignedBranchId === me.id ||
      target.reportsToId === me.assignedBranchId
    );
  }
  if (role === "farmasevt" || me.orgRole === "pharmacist") {
    if (org !== "intern") return false;
    const myBranch = me.assignedBranchId || me.reportsToId;
    return (
      target.reportsToId === me.id ||
      target.reportsToId === myBranch ||
      target.assignedBranchId === myBranch ||
      target.assignedBranchId === me.id
    );
  }
  return false;
}

function serializeShift(shiftType: string | null, defs?: Awaited<ReturnType<typeof getEffectiveShiftDefs>>) {
  const keys = parseShiftKeys(shiftType).filter((k) => k === "one" || k === "two" || k === "three");
  const encoded = keys.length ? encodeShiftKeys(keys) : "one";
  const span = shiftWindow(encoded, null, defs);
  const windows = keys.map((k) => {
    const w = shiftWindow(k, null, defs);
    return { type: w.key, label: w.label, start: w.start, end: w.end, overnight: !!w.overnight };
  });
  const partsNote = windows
    .map((w) => `${w.label}: ${w.start}–${w.end}${w.overnight ? " (keyingi kun)" : ""}`)
    .join(". ");
  return {
    type: keys.length > 1 ? encoded : span.key,
    types: keys,
    label: keys.length > 1 ? span.label : windows[0]?.label || span.label,
    start: span.start,
    end: span.end,
    warnHm: span.warnHm,
    warnText: span.warnText,
    windows,
    hoursNote:
      keys.length > 1
        ? `${span.label}: kelish ${span.start}, ketish ${span.end}. ${partsNote}`
        : partsNote || `${span.start}–${span.end}`,
  };
}

function applyShiftTypePatch(
  raw: string,
  defs?: Awaited<ReturnType<typeof getEffectiveShiftDefs>>,
): { ok: true; shiftType: string; shiftLabel: string } | { ok: false; error: string; warning?: string } {
  const keys = parseShiftKeys(raw).filter((k) => k === "one" || k === "two" || k === "three");
  if (!keys.length) return { ok: false, error: "Smena 1, 2, 3 yoki juftlik (one+two, two+three) bo‘lishi kerak" };
  const check = validateShiftCombination(keys);
  if (!check.ok) return { ok: false, error: check.error || "Noto‘g‘ri smena juftligi", warning: check.warning };
  return {
    ok: true,
    shiftType: encodeShiftKeys(keys),
    shiftLabel: keys
      .map((k) => {
        const w = shiftWindow(k, null, defs);
        return `${w.label} ${w.start}–${w.end}`;
      })
      .join(" + "),
  };
}

// ---------------------------------------------------------------- ruxsat, doira, jurnal

type SmenaActor = {
  access: SmenaActorAccess;
  me: EmpRow | null;
  /** null — cheklovsiz (admin / HR / «barcha xodimlar» doirali koordinator) */
  scope: Set<number> | null;
  info: { id: number; name: string | null; role: string };
  ip: string | null;
};

/** Smena/rotatsiya qo‘yiladigan xodim: farmasevt, stajyor yoki haqiqiy mudir (filial kartasi emas) */
function isSmenaTarget(p: EmpRow): boolean {
  if (isOpenHireSlot(p)) return false;
  const org = p.orgRole || "";
  if (STAFF_ORG.has(org)) return true;
  return org === MANAGER_ORG && p.userId != null && p.employmentStatus !== "no_manager" && hasGps(p);
}

function targetInScope(actor: SmenaActor, target: EmpRow): boolean {
  if (!actor.scope) return true;
  return actor.scope.has(target.id) || (actor.me != null && target.reportsToId === actor.me.id);
}

function reqIp(req: AuthRequest): string | null {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0]?.trim();
  return (fwd || req.ip || "").slice(0, 64) || null;
}

async function loadSmenaActor(req: AuthRequest): Promise<SmenaActor> {
  const role = req.userRole || "";
  const [access, me, user] = await Promise.all([
    smenaAccessFor(role, req.userId),
    empByUserId(req.userId!),
    db.select({ fullName: usersTable.fullName }).from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1),
  ]);
  const scope = access.full || access.scope === "all" ? null : me ? await coordinatorScopeIds(me) : new Set<number>();
  return { access, me, scope, info: { id: req.userId!, name: user[0]?.fullName ?? null, role }, ip: reqIp(req) };
}

/** 403 qaytaradi va null beradi; ruxsat bo‘lsa amal bajaruvchini qaytaradi */
async function requireSmena(
  req: AuthRequest,
  res: { status(code: number): { json(body: unknown): void } },
  need: "rotate" | "shift" | "any",
): Promise<SmenaActor | null> {
  const actor = await loadSmenaActor(req);
  const a = actor.access;
  if (!a.any) {
    res.status(403).json({ error: "«Smena va filial» bo‘limiga ruxsatingiz yo‘q. Ruxsatni Admin yoki HR menejer beradi." });
    return null;
  }
  if (need === "rotate" && !a.canRotate) {
    res.status(403).json({ error: "Sizga rotatsiya qilish ruxsati berilmagan." });
    return null;
  }
  if (need === "shift" && !a.canShift) {
    res.status(403).json({ error: "Sizga smena o‘zgartirish ruxsati berilmagan." });
    return null;
  }
  return actor;
}

function denyOutOfScope(actor: SmenaActor, target: EmpRow, res: { status(code: number): { json(body: unknown): void } }): boolean {
  if (!isSmenaTarget(target)) {
    res.status(400).json({ error: "Smena va rotatsiya faqat dorixona xodimlari (farmasevt, stajyor, boshqaruvchi, mudir) uchun" });
    return true;
  }
  if (!targetInScope(actor, target)) {
    res.status(403).json({ error: "Bu xodim sizning filiallaringizga tegishli emas. Ruxsatingiz faqat o‘z xodimlaringiz uchun." });
    return true;
  }
  return false;
}

async function branchLabelOf(branchId: number | null): Promise<string | null> {
  if (!branchId) return null;
  const b = await empById(branchId);
  if (!b) return null;
  return displayBranchName(b.location) || (b.location || "").split("|")[0].trim() || b.fullName;
}

/** Xodimning hozirgi asosiy filiali va asosiy smenasi — jurnaldagi «qayerdan» */
async function placementOf(target: EmpRow): Promise<{ branchId: number | null; branchLabel: string | null; shiftKey: string }> {
  const slots = await db
    .select()
    .from(employeeWorkSlotsTable)
    .where(and(eq(employeeWorkSlotsTable.employeeId, target.id), eq(employeeWorkSlotsTable.active, true)));
  const homeId = homeBranchIdFor(target, slots);
  const base =
    slots.find((r) => !r.overrideBase && r.mode === "permanent" && r.branchId === homeId) ||
    slots.find((r) => !r.overrideBase && r.mode === "permanent") ||
    null;
  return {
    branchId: homeId,
    branchLabel: await branchLabelOf(homeId),
    shiftKey: toBoardShiftKey(base?.shiftKey || target.shiftType),
  };
}

function logBase(actor: SmenaActor, target: EmpRow): Pick<SmenaLogEntry, "actor" | "employee" | "ip"> {
  return {
    actor: actor.info,
    employee: { id: target.id, name: target.fullName, orgRole: target.orgRole },
    ip: actor.ip,
  };
}

function periodText(mode: string, validFrom: string | null, validTo: string | null, weekdays: number[] | null, workDates: string[] | null): string {
  if (mode === "permanent") return `doimiy, ${validFrom || todayTashkentYmd()} dan`;
  if (mode === "period") return `${validFrom} — ${validTo || "cheksiz"}`;
  if (mode === "weekly") return `har hafta: ${(weekdays || []).map((d) => WEEKDAY_FULL_UZ[d] || weekdayLabelUz(d)).join(", ")}`;
  if (mode === "days") return `${(workDates || []).length} kun: ${(workDates || []).join(", ")}`;
  return "";
}

router.get("/smena/access", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  res.json(await smenaAccessFor(req.userRole, req.userId));
});

const SCOPE_UZ: Record<"own" | "all", string> = { own: "faqat o‘z filiallari", all: "barcha filiallar" };

/** Barcha koordinatorlar: kartasi, filiallari, berilgan ruxsatlar va faollik (faqat Admin / HR) */
router.get("/smena/coord-access", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyNonAdminOrHr(req.userRole || "", res)) return;
  try {
    const coords = await db
      .select({ id: usersTable.id, fullName: usersTable.fullName, status: usersTable.status })
      .from(usersTable)
      .where(and(eq(usersTable.role, "koordinator"), sql`coalesce(${usersTable.status}, 'active') <> 'terminated'`));
    const people = await activePeople();
    const [accessMap, stats] = await Promise.all([listCoordAccess(), smenaLogStatsByActor()]);

    const items = coords.map((u) => {
      const card = people.find((p) => p.userId === u.id) || null;
      const branches = card
        ? people.filter((p) => p.orgRole === MANAGER_ORG && p.reportsToId === card.id && hasGps(p))
        : [];
      const branchIds = new Set(branches.map((b) => b.id));
      const staff = people.filter(
        (p) =>
          STAFF_ORG.has(p.orgRole || "") &&
          !isOpenHireSlot(p) &&
          ((p.reportsToId != null && branchIds.has(p.reportsToId)) ||
            (p.assignedBranchId != null && branchIds.has(p.assignedBranchId))),
      );
      const a = accessMap.get(u.id) || null;
      const st = stats.get(u.id);
      return {
        userId: u.id,
        fullName: card?.fullName || u.fullName,
        status: u.status,
        employeeId: card?.id ?? null,
        hasCard: Boolean(card),
        branchCount: branches.length,
        branchNames: branches.map((b) => displayBranchName(b.location) || b.fullName).slice(0, 30),
        staffCount: staff.length,
        mudirCount: branches.filter((b) => b.userId).length,
        canRotate: Boolean(a?.canRotate),
        canShift: Boolean(a?.canShift),
        scope: a?.scope ?? "own",
        grantedByName: a?.grantedByName ?? null,
        grantedAt: a?.updatedAt ?? null,
        actionsTotal: st?.total ?? 0,
        actions30d: st?.last30 ?? 0,
        lastActionAt: st?.lastAt ?? null,
      };
    });
    items.sort((x, y) => x.fullName.localeCompare(y.fullName, "uz"));
    res.json({ items });
  } catch (err) {
    req.log?.error?.({ err }, "smena coord-access list");
    res.status(500).json({ error: "Koordinatorlar ro‘yxatini yuklab bo‘lmadi" });
  }
});

/** Koordinatorga rotatsiya / smena ruxsatini berish yoki olish (faqat Admin / HR) */
router.put("/smena/coord-access/:userId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyNonAdminOrHr(req.userRole || "", res)) return;
  try {
    const userId = Number(req.params.userId);
    const [coord] = await db
      .select({ id: usersTable.id, fullName: usersTable.fullName, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!coord || coord.role !== "koordinator") {
      res.status(404).json({ error: "Koordinator topilmadi" });
      return;
    }
    const canRotate = req.body?.canRotate === true;
    const canShift = req.body?.canShift === true;
    const scope: "own" | "all" = req.body?.scope === "all" ? "all" : "own";

    const [me] = await db
      .select({ id: usersTable.id, fullName: usersTable.fullName, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId!))
      .limit(1);
    const prev = (await listCoordAccess()).get(userId) || null;
    const saved = await setCoordAccess(userId, { canRotate, canShift, scope }, { id: req.userId!, name: me?.fullName || "" });

    const yn = (v: boolean) => (v ? "bor" : "yo‘q");
    const prevTxt = prev
      ? `rotatsiya ${yn(prev.canRotate)}, smena ${yn(prev.canShift)}, ${SCOPE_UZ[prev.scope]}`
      : "ruxsat yo‘q";
    const nextTxt =
      canRotate || canShift ? `rotatsiya ${yn(canRotate)}, smena ${yn(canShift)}, ${SCOPE_UZ[scope]}` : "ruxsat yo‘q";
    await logSmenaChange({
      action: "perm_change",
      actor: { id: req.userId!, name: me?.fullName || null, role: me?.role || req.userRole || null },
      targetUserId: userId,
      ip: reqIp(req),
      summary: `${coord.fullName}: ${prevTxt} → ${nextTxt}`,
      note: coord.fullName,
    });

    if (prevTxt !== nextTxt) {
      const granted = [canRotate && "rotatsiya qilish", canShift && "smena o‘zgartirish"].filter(Boolean).join(" va ");
      await notifyUser({
        userId,
        text: granted
          ? `Sizga «Smena va filial» bo‘limida ${granted} ruxsati berildi (${SCOPE_UZ[scope]}). Bo‘lim menyuda paydo bo‘ldi.`
          : "«Smena va filial» bo‘limidagi ruxsatlaringiz olib qo‘yildi.",
        type: "smena_slot",
        linkUrl: granted ? "/smena-filial" : "/",
      });
    }
    res.json({ ok: true, access: saved });
  } catch (err) {
    req.log?.error?.({ err }, "smena coord-access save");
    res.status(500).json({ error: "Ruxsatni saqlab bo‘lmadi" });
  }
});

/** Rotatsiya va smena o‘zgarishlari tarixi: kim, kimni, qachon, qayerdan → qayerga */
router.get("/smena/history", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const actor = await requireSmena(req, res, "any");
  if (!actor) return;
  try {
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const ymd = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const action = typeof req.query.action === "string" ? req.query.action.trim() || null : null;
    if (action === "perm_change" && !actor.access.full) {
      res.status(403).json({ error: "Ruxsatlar tarixi faqat Admin va HR uchun" });
      return;
    }
    const items = await querySmenaLog({
      actorUserId: num(req.query.actorUserId),
      employeeId: num(req.query.employeeId),
      action,
      fromYmd: ymd(req.query.from),
      toYmd: ymd(req.query.to),
      q: typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) || null : null,
      limitToActorOrEmployees: actor.scope
        ? { actorUserId: actor.info.id, employeeIds: [...actor.scope] }
        : null,
      limit: num(req.query.limit) ?? 500,
    });
    const visible = actor.access.full ? items : items.filter((i) => i.action !== "perm_change");
    const actors = actor.access.full
      ? await listSmenaLogActors()
      : [...new Map(visible.filter((i) => i.actorUserId).map((i) => [i.actorUserId!, { userId: i.actorUserId!, name: i.actorName, role: i.actorRole, total: 0 }])).values()];
    res.json({ items: visible, actors, full: actor.access.full });
  } catch (err) {
    req.log?.error?.({ err }, "smena history");
    res.status(500).json({ error: "Tarixni yuklab bo‘lmadi" });
  }
});

router.get("/smena/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  const me = await empByUserId(req.userId!);
  const pharmacy = isPharmacyShiftStaff(role, me?.orgRole);
  const defs = await getEffectiveShiftDefs();
  const officeW = shiftWindow("office", null, defs);
  const branches = pharmacy || isLeadRole(role) ? await listBranches() : [];
  const assignedId = me?.assignedBranchId || (me?.orgRole === MANAGER_ORG ? me.id : me?.reportsToId) || null;
  const assigned = assignedId ? branches.find((b) => b.id === assignedId) || null : null;

  const assignable: Array<{
    id: number;
    fullName: string;
    orgRole: string | null;
    shiftType: string;
    assignedBranchId: number | null;
    assignedBranchName: string | null;
  }> = [];

  const access = await smenaAccessFor(role, req.userId);
  if (access.any) {
    const scope = access.full || access.scope === "all" ? null : me ? await coordinatorScopeIds(me) : new Set<number>();
    const people = await activePeople();

    const branchName = (id: number | null) => branches.find((b) => b.id === id)?.name || null;
    for (const p of people) {
      if (!isSmenaTarget(p)) continue;
      if (scope && !(scope.has(p.id) || (me != null && p.reportsToId === me.id))) continue;
      assignable.push({
        id: p.id,
        fullName: p.fullName,
        orgRole: p.orgRole,
        shiftType: normalizeShiftType(p.shiftType),
        assignedBranchId: p.assignedBranchId || (p.orgRole === MANAGER_ORG ? p.id : p.reportsToId),
        assignedBranchName:
          branchName(p.assignedBranchId) ||
          branchName(p.orgRole === MANAGER_ORG ? p.id : p.reportsToId) ||
          (p.orgRole === MANAGER_ORG
            ? displayBranchName(p.location) || p.fullName
            : null),
      });
    }
    assignable.sort((a, b) => a.fullName.localeCompare(b.fullName, "uz"));
  }

  const canManage = access.any;

  res.json({
    access,
    pharmacyStaff: pharmacy,
    canPickShift: canManage,
    canPickOwnBranch: false,
    canAssignOthers: canManage && assignable.length > 0,
    canDayRotate: canManage,
    canManageSlots: canManage,
    viewOnly: !canManage,
    employee: me
      ? {
          id: me.id,
          fullName: me.fullName,
          orgRole: me.orgRole,
          assignedBranchId: assignedId,
          assignedBranchName: assigned?.name || me.location || null,
        }
      : null,
    shift: pharmacy
      ? serializeShift(me?.shiftType || "one", defs)
      : {
          type: "office",
          types: ["office"],
          label: "Ofis ish vaqti",
          start: officeW.start,
          end: officeW.end,
          warnHm: officeW.warnHm,
          warnText: officeW.warnText,
          windows: [{ type: "office", label: "Ofis", start: officeW.start, end: officeW.end, overnight: false }],
          hoursNote: `Ofis xodimlari, sizning ish vaqtingiz: ${officeW.start}–${officeW.end}`,
        },
    branches,
    assignable,
    rules: {
      eligible: "Smena faqat mudir, farmasevt va stajyor uchun",
      office: `Ofis xodimlari, sizning ish vaqtingiz: ${officeW.start}–${officeW.end}`,
      shift1: `1-smena: ${defs.one.startHm}–${defs.one.endHm}`,
      shift2: `2-smena: ${defs.two.startHm}–${defs.two.endHm}`,
      shift3: `3-smena: ${defs.three.startHm}–${defs.three.endHm}${defs.three.overnight ? " (tungi)" : ""}`,
      combo:
        "1+2: kelish 1-smena boshlanishida, ketish 2-smena oxirida (bitta to‘liq smena). 2+3 xuddi shunday. Alohida 1/2/3 — o‘z vaqtida.",
      branch:
        "Doimiy: filial va/yoki faqat smena. Kunlik rotatsiya: tanlangan kun uchun — doimiy joy o‘zgarmaydi. Face ID shu kun filial GPS da.",
    },
  });
});

router.patch("/smena/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  if (role === "mudir" || role === "koordinator") {
    res.status(403).json({
      error: role === "koordinator"
        ? "Koordinator smena va filialni faqat ko‘radi. O‘zgartirish admin va HR menejerda."
        : "Mudir smena, filial va rotatsiyani o‘zgartira olmaydi",
    });
    return;
  }
  const me = await empByUserId(req.userId!);
  if (!me) {
    res.status(400).json({ error: "Xodim kartochkasi yo‘q" });
    return;
  }
  const body = req.body as { shiftType?: string; assignedBranchId?: number | null };
  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (body.shiftType != null) {
    if (!isPharmacyShiftStaff(role, me.orgRole)) {
      res.status(403).json({ error: "Smena tanlash faqat mudir, farmasevt va stajyor uchun" });
      return;
    }
    const defs = await getEffectiveShiftDefs();
    const applied = applyShiftTypePatch(String(body.shiftType), defs);
    if (!applied.ok) {
      res.status(400).json({ error: applied.error, warning: applied.warning });
      return;
    }
    patch.shiftType = applied.shiftType;
    patch.shiftLabel = applied.shiftLabel;
  }

  if (body.assignedBranchId !== undefined) {
    if (!canPickOwnBranch(role, me.orgRole)) {
      res.status(403).json({
        error: "Filialni o‘zingiz tanlay olmaysiz. Mudir yoki koordinator belgilaydi.",
      });
      return;
    }
    const bid = body.assignedBranchId == null ? me.id : Number(body.assignedBranchId);
    const branch = await empById(bid);
    if (!branch || branch.orgRole !== MANAGER_ORG || !hasGps(branch)) {
      res.status(400).json({ error: "Filial GPS yo‘q yoki mudir emas" });
      return;
    }
    patch.assignedBranchId = bid === me.id ? null : bid;
  }

  await db.update(employeesTable).set(patch).where(eq(employeesTable.id, me.id));
  res.json({ ok: true });
});

router.patch("/smena/assign/:employeeId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  if (role === "mudir" || role === "koordinator") {
    res.status(403).json({
      error: role === "koordinator"
        ? "Koordinator smena va filialni faqat ko‘radi. O‘zgartirish admin va HR menejerda."
        : "Mudir smena, filial va rotatsiyani o‘zgartira olmaydi",
    });
    return;
  }
  const me = await empByUserId(req.userId!);
  if (!me) {
    res.status(400).json({ error: "Sizning xodim kartochkangiz yo‘q" });
    return;
  }
  const targetId = Number(req.params.employeeId);
  const target = await empById(targetId);
  if (!target) {
    res.status(404).json({ error: "Xodim topilmadi" });
    return;
  }
  const scope = role === "koordinator" ? await coordinatorScopeIds(me) : null;
  if (!canAssignTarget({ role, me, target, scope })) {
    res.status(403).json({ error: "Bu xodimning filialini belgilash huquqi yo‘q" });
    return;
  }
  if (isMudirPerson(target.orgRole)) {
    res.status(400).json({ error: "Mudirga smena, filial va rotatsiya qo‘yilmaydi" });
    return;
  }
  if (target.orgRole === "pharmacist" && !(role === "mudir" || role === "koordinator" || isLeadRole(role))) {
    res.status(403).json({ error: "Farmasevt filialini faqat mudir yoki koordinator belgilaydi" });
    return;
  }

  const body = req.body as { assignedBranchId?: number | null; shiftType?: string };
  const hasBranch = body.assignedBranchId != null && Number.isFinite(Number(body.assignedBranchId));
  const hasShift = body.shiftType != null && String(body.shiftType).trim() !== "";
  if (!hasBranch && !hasShift) {
    res.status(400).json({ error: "Filial yoki smena kerak" });
    return;
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  let branchId =
    target.assignedBranchId ||
    (target.orgRole === MANAGER_ORG ? target.id : target.reportsToId) ||
    null;
  let loc =
    (target.location || "").split("|")[0].trim() ||
    target.fullName ||
    "";

  if (hasBranch) {
    branchId = Number(body.assignedBranchId);
    const branch = await empById(branchId!);
  if (!branch || branch.orgRole !== MANAGER_ORG || !hasGps(branch)) {
    res.status(400).json({ error: "Filial GPS kiritilmagan" });
    return;
  }
    loc = (branch.location || "").split("|")[0].trim() || branch.fullName;
    patch.assignedBranchId = branchId;
    patch.location = loc;
  } else if (!branchId) {
    res.status(400).json({ error: "Avval filial biriktirilgan bo‘lishi kerak, yoki filialni tanlang" });
    return;
  }

  if (hasShift) {
    if (!isPharmacyShiftStaff(null, target.orgRole)) {
      res.status(400).json({ error: "Smena faqat mudir, farmasevt va stajyor uchun. Ofis xodimlarida smena yo‘q." });
      return;
    }
    const defs = await getEffectiveShiftDefs();
    const applied = applyShiftTypePatch(String(body.shiftType), defs);
    if (!applied.ok) {
      res.status(400).json({ error: applied.error, warning: applied.warning });
      return;
    }
    patch.shiftType = applied.shiftType;
    patch.shiftLabel = applied.shiftLabel;
  }

  const before = await placementOf(target);
  await db.update(employeesTable).set(patch).where(eq(employeesTable.id, target.id));
  if (hasBranch && branchId) {
    await moveShiftOverridesToBranch(target.id, branchId, loc || null);
  }
  {
    const actor = await loadSmenaActor(req);
    const toShift = patch.shiftType ? toBoardShiftKey(String(patch.shiftType)) : before.shiftKey;
    await logSmenaChange({
      ...logBase(actor, target),
      action: "legacy_assign",
      fromBranch: { id: before.branchId, label: before.branchLabel },
      toBranch: { id: branchId, label: loc || null },
      fromShift: before.shiftKey,
      toShift,
      mode: "permanent",
      summary: hasBranch
        ? `Asosiy filial: «${before.branchLabel || "—"}» → «${loc}»${patch.shiftType ? `, smena ${formatShiftKeyUz(before.shiftKey)} → ${formatShiftKeyUz(toShift)}` : ""}`
        : `Asosiy smena: ${formatShiftKeyUz(before.shiftKey)} → ${formatShiftKeyUz(toShift)}`,
    });
  }

  if (target.userId) {
    const shiftTxt = patch.shiftLabel ? String(patch.shiftLabel) : "";
    const msg = hasBranch
      ? `${target.fullName}: ${loc} filialiga biriktirildi${shiftTxt ? `, ${shiftTxt}` : ""}. Face ID faqat shu joydan.`
      : `${target.fullName}: smena yangilandi${shiftTxt ? ` — ${shiftTxt}` : ""}. Filial o‘zgarishsiz (${loc || "joriy"}).`;
    await notifyUser({
      userId: target.userId,
      text: msg,
      type: "smena_branch",
      linkUrl: "/davomat-face",
    });
  }

  res.json({
    ok: true,
      assignedBranchId: branchId,
    assignedBranchName: loc,
    shiftType: patch.shiftType || target.shiftType,
    shiftOnly: !hasBranch,
  });
});

/**
 * Kunlik rotatsiya — tanlangan kun(lar) uchun filial + smena.
 * Doimiy assignedBranchId / reportsToId o‘zgarmaydi.
 * Kunlar tugagach resolveBranchForDay endi temp_one_day ni qo‘llamaydi → standartga qaytadi.
 */
router.post("/smena/rotation", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  if (role === "mudir" || role === "koordinator") {
    res.status(403).json({
      error: role === "koordinator"
        ? "Koordinator smena va filialni faqat ko‘radi. O‘zgartirish admin va HR menejerda."
        : "Mudir smena, filial va rotatsiyani o‘zgartira olmaydi",
    });
    return;
  }
  const me = await empByUserId(req.userId!);
  if (!me) {
    res.status(400).json({ error: "Xodim kartochkasi yo‘q" });
    return;
  }
  if (!(role === "mudir" || role === "koordinator" || isLeadRole(role) || me.orgRole === MANAGER_ORG)) {
    res.status(403).json({ error: "Kunlik rotatsiya faqat mudir, koordinator yoki rahbar uchun" });
    return;
  }

  const employeeId = Number(req.body?.employeeId ?? me.id);
  const branchId = Number(req.body?.branchId);
  const shiftRaw = req.body?.shiftType != null ? String(req.body.shiftType) : null;
  const note = req.body?.note ? String(req.body.note).slice(0, 400) : null;

  const rawDates: string[] = Array.isArray(req.body?.workDates)
    ? req.body.workDates.map((d: unknown) => String(d))
    : req.body?.workDate
      ? [String(req.body.workDate)]
      : [todayTashkentYmd()];

  const workDates = [
    ...new Set(
      rawDates
        .map((d) => d.trim())
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    ),
  ].sort();

  if (!Number.isFinite(employeeId) || !Number.isFinite(branchId)) {
    res.status(400).json({ error: "employeeId va branchId majburiy" });
    return;
  }
  if (!workDates.length) {
    res.status(400).json({ error: "Kamida bitta ish kuni (workDates) tanlang" });
    return;
  }
  if (workDates.length > 62) {
    res.status(400).json({ error: "Bir martada ko‘pi bilan 62 kun" });
    return;
  }

  const target = await empById(employeeId);
  if (!target) {
    res.status(404).json({ error: "Xodim topilmadi" });
    return;
  }
  const org = target.orgRole || "";
  if (org === MANAGER_ORG) {
    res.status(400).json({ error: "Mudirga smena, filial va rotatsiya qo‘yilmaydi" });
    return;
  }
  if (!STAFF_ORG.has(org)) {
    res.status(400).json({ error: "Rotatsiya faqat farmasevt va stajyor uchun" });
    return;
  }

  const scope = role === "koordinator" ? await coordinatorScopeIds(me) : null;
  if (!canDayRotate({ role, me, target, scope })) {
    res.status(403).json({ error: "Bu xodimni rotatsiya qilish huquqi yo‘q" });
    return;
  }

  const branch = await empById(branchId);
  if (!branch || branch.orgRole !== MANAGER_ORG || !hasGps(branch)) {
    res.status(400).json({ error: "Filial GPS yo‘q yoki mudir emas" });
    return;
  }
  const branchLabel =
    displayBranchName(branch.location) || (branch.location || "").split("|")[0].trim() || branch.fullName;

  let shiftKeys: string[] | null = null;
  let shiftEncoded: string | null = null;
  if (shiftRaw) {
    const defs = await getEffectiveShiftDefs();
    const applied = applyShiftTypePatch(shiftRaw, defs);
    if (!applied.ok) {
      res.status(400).json({ error: applied.error, warning: applied.warning });
      return;
    }
    shiftKeys = parseShiftKeys(applied.shiftType).filter((k) => k === "one" || k === "two" || k === "three");
    shiftEncoded = applied.shiftType;
  }

  const assignments = [];
  const dayPlans = [];

  for (const workDate of workDates) {
    // Shu kun uchun eski bir kunlik biriktirishni almashtiramiz
    await db
      .delete(employeeBranchAssignmentsTable)
      .where(
        and(
          eq(employeeBranchAssignmentsTable.employeeId, employeeId),
          eq(employeeBranchAssignmentsTable.kind, "temp_one_day"),
          eq(employeeBranchAssignmentsTable.validFrom, workDate),
        ),
      );

    const [assignment] = await db
      .insert(employeeBranchAssignmentsTable)
      .values({
        employeeId,
        branchId,
        branchLabel,
        kind: "temp_one_day",
        validFrom: workDate,
        validTo: workDate,
        note: note || `Kunlik rotatsiya · ${workDate}`,
        createdById: req.userId ?? null,
      })
      .returning();
    assignments.push(assignment);

    if (shiftKeys && shiftKeys.length) {
      const [existing] = await db
        .select()
        .from(employeeDayShiftPlansTable)
        .where(
          and(
            eq(employeeDayShiftPlansTable.employeeId, employeeId),
            eq(employeeDayShiftPlansTable.workDate, workDate),
          ),
        )
        .limit(1);
      if (existing) {
        const [dayPlan] = await db
          .update(employeeDayShiftPlansTable)
          .set({
            shiftKeys,
            note: note || existing.note,
      updatedAt: new Date(),
    })
          .where(eq(employeeDayShiftPlansTable.id, existing.id))
          .returning();
        dayPlans.push(dayPlan);
      } else {
        const [dayPlan] = await db
          .insert(employeeDayShiftPlansTable)
          .values({
            employeeId,
            workDate,
            shiftKeys,
            createdById: req.userId ?? null,
            note: note || null,
          })
          .returning();
        dayPlans.push(dayPlan);
      }
    }
  }

  {
    const actor = await loadSmenaActor(req);
    const before = await placementOf(target);
    await logSmenaChange({
      ...logBase(actor, target),
      action: "legacy_day_rotation",
      fromBranch: { id: before.branchId, label: before.branchLabel },
      toBranch: { id: branchId, label: branchLabel },
      fromShift: before.shiftKey,
      toShift: shiftEncoded,
      mode: "days",
      validFrom: workDates[0],
      validTo: workDates[workDates.length - 1],
      workDates,
      note,
      summary: `Kunlik rotatsiya: «${before.branchLabel || "—"}» → «${branchLabel}», ${workDates.length} kun`,
    });
  }

  if (target.userId) {
    const shiftTxt = shiftEncoded ? `, smena: ${shiftEncoded}` : "";
    const daysTxt =
      workDates.length === 1
        ? workDates[0]
        : `${workDates.length} kun (${workDates[0]} … ${workDates[workDates.length - 1]})`;
    await notifyUser({
      userId: target.userId,
      text: `${target.fullName}: ${daysTxt} «${branchLabel}» filialiga vaqtinchalik rotatsiya${shiftTxt}. Kunlar tugagach doimiy joyga qaytasiz.`,
      type: "smena_rotation",
      linkUrl: "/davomat-face",
    });
  }

  res.status(201).json({
    ok: true,
    workDate: workDates[0],
    workDates,
    count: workDates.length,
    assignments,
    dayPlans,
    branchLabel,
    shiftType: shiftEncoded,
    permanentUnchanged: true,
  });
});

/** Tanlangan kundagi rotatsiyalar (doira ichida) */
router.get("/smena/rotations", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  const me = await empByUserId(req.userId!);
  if (!me) {
    res.status(400).json({ error: "Xodim kartochkasi yo‘q" });
    return;
  }
  const workDate = String(req.query.date || todayTashkentYmd());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    res.status(400).json({ error: "date YYYY-MM-DD" });
    return;
  }

  const scope = role === "koordinator" ? await coordinatorScopeIds(me) : null;
  const people = await db
    .select(EMP_COLS)
    .from(employeesTable)
    .where(sql`coalesce(${employeesTable.employmentStatus}, 'working') <> 'dismissed'`);

  const allowedIds = new Set<number>();
  for (const p of people) {
    if (canDayRotate({ role, me, target: p, scope })) allowedIds.add(p.id);
  }
  if (!allowedIds.size) {
    res.json({ workDate, items: [] });
    return;
  }

  const rows = await db
    .select()
    .from(employeeBranchAssignmentsTable)
    .where(
      and(
        eq(employeeBranchAssignmentsTable.kind, "temp_one_day"),
        eq(employeeBranchAssignmentsTable.validFrom, workDate),
      ),
    );

  const plans = await db
    .select()
    .from(employeeDayShiftPlansTable)
    .where(eq(employeeDayShiftPlansTable.workDate, workDate));
  const planByEmp = new Map(plans.map((p) => [p.employeeId, p]));
  const empByIdMap = new Map(people.map((p) => [p.id, p]));

  const items = rows
    .filter((r) => allowedIds.has(r.employeeId))
    .map((r) => {
      const emp = empByIdMap.get(r.employeeId);
      const plan = planByEmp.get(r.employeeId);
      return {
        id: r.id,
        employeeId: r.employeeId,
        fullName: emp?.fullName || `#${r.employeeId}`,
        orgRole: emp?.orgRole || null,
        branchId: r.branchId,
        branchLabel: r.branchLabel,
        workDate: r.validFrom,
        shiftKeys: plan?.shiftKeys || [],
        note: r.note,
        createdAt: r.createdAt,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "uz"));

  res.json({ workDate, items });
});

router.delete("/smena/rotation/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  if (denyCoordinatorEdit(role, res)) return;
  const me = await empByUserId(req.userId!);
  if (!me) {
    res.status(400).json({ error: "Xodim kartochkasi yo‘q" });
    return;
  }
  const id = Number(req.params.id);
  const [row] = await db
    .select()
    .from(employeeBranchAssignmentsTable)
    .where(eq(employeeBranchAssignmentsTable.id, id))
    .limit(1);
  if (!row || row.kind !== "temp_one_day") {
    res.status(404).json({ error: "Rotatsiya topilmadi" });
    return;
  }
  const target = await empById(row.employeeId);
  if (!target) {
    res.status(404).json({ error: "Xodim topilmadi" });
    return;
  }
  const scope = role === "koordinator" ? await coordinatorScopeIds(me) : null;
  if (!canDayRotate({ role, me, target, scope })) {
    res.status(403).json({ error: "Bekor qilish huquqi yo‘q" });
    return;
  }
  await db.delete(employeeBranchAssignmentsTable).where(eq(employeeBranchAssignmentsTable.id, id));
  await db
    .delete(employeeDayShiftPlansTable)
    .where(
      and(
        eq(employeeDayShiftPlansTable.employeeId, row.employeeId),
        eq(employeeDayShiftPlansTable.workDate, row.validFrom),
      ),
    );
  {
    const actor = await loadSmenaActor(req);
    await logSmenaChange({
      ...logBase(actor, target),
      action: "legacy_day_rotation_cancel",
      fromBranch: { id: row.branchId, label: row.branchLabel },
      mode: "days",
      validFrom: row.validFrom,
      validTo: row.validTo,
      summary: `Kunlik rotatsiya bekor qilindi: «${row.branchLabel || "—"}», ${row.validFrom}`,
    });
  }
  res.json({ ok: true });
});

function mapSlotRow(r: typeof employeeWorkSlotsTable.$inferSelect): WorkSlotRow {
  return {
    id: r.id,
    employeeId: r.employeeId,
    branchId: r.branchId,
    branchLabel: r.branchLabel,
    shiftKey: (r.shiftKey as WorkSlotRow["shiftKey"]) || "one",
    mode: (r.mode as WorkSlotRow["mode"]) || "permanent",
    validFrom: r.validFrom,
    validTo: r.validTo,
    weekdays: (r.weekdays as number[] | null) || null,
    workDates: (r.workDates as string[] | null) || null,
    overrideBase: Boolean(r.overrideBase),
    note: r.note,
    active: r.active,
  };
}

/** Haftalik smena almashtirishlar asosiy filial o‘zgarganda ham shu xodim bilan birga ko‘chadi */
async function moveShiftOverridesToBranch(
  employeeId: number,
  branchId: number,
  branchLabel: string | null,
): Promise<void> {
  await db
    .update(employeeWorkSlotsTable)
    .set({ branchId, branchLabel, updatedAt: new Date() })
    .where(
      and(
        eq(employeeWorkSlotsTable.employeeId, employeeId),
        eq(employeeWorkSlotsTable.active, true),
        eq(employeeWorkSlotsTable.overrideBase, true),
      ),
    );
}

async function syncPrimaryFromSlots(employeeId: number): Promise<void> {
  const rows = await db
    .select()
    .from(employeeWorkSlotsTable)
    .where(and(eq(employeeWorkSlotsTable.employeeId, employeeId), eq(employeeWorkSlotsTable.active, true)));
  const today = todayTashkentYmd();
  // Haftalik almashtirish asosiy smenani (employees.shift_type) o‘zgartirmaydi
  const resolved = resolveSlotsForDay(
    today,
    rows.filter((r) => !r.overrideBase).map(mapSlotRow),
  );
  if (!resolved.length) return;
  const target = await empById(employeeId);
  if (!target) return;
  if (target.orgRole === MANAGER_ORG && !resolved.some((s) => s.mode === "permanent")) return;
  const primary = resolved[0]!;
  const keys = resolved
    .flatMap((s) => parseShiftKeys(s.shiftKey))
    .filter((k): k is "one" | "two" | "three" => k === "one" || k === "two" || k === "three");
  const shiftType = encodeShiftKeys(keys);
  const patch: {
    shiftType: string;
    shiftLabel: string;
    assignedBranchId?: number | null;
    reportsToId?: number | null;
    location?: string;
  } = {
    shiftType,
    shiftLabel: resolved.map((s) => formatShiftKeyUz(s.shiftKey)).join(" + "),
  };
  // Mudir kartasi filialning o‘zi: location (nom + GPS) va bog‘lanishlar rotatsiyadan o‘zgarmasligi kerak
  if (target.orgRole !== MANAGER_ORG) {
    patch.assignedBranchId = primary.branchId;
    patch.reportsToId = primary.branchId;
    if (primary.branchLabel) patch.location = primary.branchLabel;
  }
  await db.update(employeesTable).set(patch).where(eq(employeesTable.id, employeeId));
}

/** Xodimning barcha ish slotlari */
router.get("/smena/slots", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  const me = await empByUserId(req.userId!);
  if (!me) {
    res.status(400).json({ error: "Xodim kartochkasi yo‘q" });
    return;
  }
  const employeeId = Number(req.query.employeeId || me.id);
  if (!Number.isFinite(employeeId)) {
    res.status(400).json({ error: "employeeId noto‘g‘ri" });
    return;
  }
  const target = await empById(employeeId);
  if (!target) {
    res.status(404).json({ error: "Xodim topilmadi" });
    return;
  }
  const scope = role === "koordinator" ? await coordinatorScopeIds(me) : null;
  const canSee =
    target.id === me.id || canAssignTarget({ role, me, target, scope }) || isLeadRole(role);
  if (!canSee) {
    res.status(403).json({ error: "Ko‘rish huquqi yo‘q" });
    return;
  }
  const rows = await db
    .select()
    .from(employeeWorkSlotsTable)
    .where(eq(employeeWorkSlotsTable.employeeId, employeeId));
  const activeOnly = String(req.query.active || "1") !== "0";
  const items = rows
    .filter((r) => (activeOnly ? r.active : true))
    .map((r) => ({
      ...mapSlotRow(r),
      modeLabel: formatModeUz(r.mode),
      shiftLabel: formatShiftKeyUz(r.shiftKey),
      createdAt: r.createdAt,
    }))
    .sort((a, b) => {
      const m = String(a.mode).localeCompare(String(b.mode));
      if (m !== 0) return m;
      return String(a.shiftKey).localeCompare(String(b.shiftKey));
    });

  const onDate = String(req.query.date || todayTashkentYmd());
  const daySlots = /^\d{4}-\d{2}-\d{2}$/.test(onDate)
    ? resolveSlotsForDay(onDate, items)
    : [];

  res.json({ employeeId, items, daySlots, date: onDate });
});

/** Doira ichidagi barcha faol slotlar (ro‘yxat) */
router.get("/smena/slots/all", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const actor = await requireSmena(req, res, "any");
  if (!actor) return;

  const people = (await activePeople()).filter(
    (p) => !actor.scope || (isSmenaTarget(p) && targetInScope(actor, p)),
  );

  if (!people.length) {
    res.json({ items: [], staffMonitoring: [] });
    return;
  }

  const rows = await db
    .select()
    .from(employeeWorkSlotsTable)
    .orderBy(desc(employeeWorkSlotsTable.id));

  const creatorIds = [
    ...new Set(
      rows
        .map((r) => r.createdById)
        .filter((id): id is number => typeof id === "number" && id > 0),
    ),
  ];
  const creators = creatorIds.length
    ? await db
        .select({ id: usersTable.id, fullName: usersTable.fullName })
        .from(usersTable)
        .where(inArray(usersTable.id, creatorIds))
    : [];
  const creatorMap = new Map(creators.map((c) => [c.id, c.fullName]));

  const today = todayTashkentYmd();
  const empMap = new Map(people.map((p) => [p.id, p]));

  const items = rows
    .filter((r) => empMap.has(r.employeeId))
    .map((r) => {
      const emp = empMap.get(r.employeeId);
      const isExpired = Boolean(r.validTo && r.validTo < today);
      return {
        ...mapSlotRow(r),
        fullName: emp?.fullName || `#${r.employeeId}`,
        orgRole: emp?.orgRole || null,
        primaryBranchId: emp?.assignedBranchId ?? null,
        primaryBranchName: emp?.location || null,
        modeLabel: formatModeUz(r.mode),
        shiftLabel: formatShiftKeyUz(r.shiftKey),
        createdAt: r.createdAt,
        createdByName: r.createdById ? creatorMap.get(r.createdById) || `#${r.createdById}` : "Admin / HR",
        isExpired,
        active: r.active,
      };
    })
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      if (a.isExpired !== b.isExpired) return a.isExpired ? 1 : -1;
      return a.fullName.localeCompare(b.fullName, "uz");
    });

  // Ayni vaqtdagi xodimlar holati (Live staff monitoring base)
  const staffMonitoring = people
    .filter((p) => isSmenaTarget(p))
    .map((p) => {
      const pSlots = rows.filter((r) => r.employeeId === p.id && r.active);
      const daySlots = resolveSlotsForDay(today, pSlots.map(mapSlotRow));
      const activeSlot = daySlots[0] || null;
      return {
        employeeId: p.id,
        fullName: p.fullName,
        orgRole: p.orgRole,
        primaryBranchId: p.assignedBranchId,
        primaryBranchName: p.location,
        todayBranchId: activeSlot?.branchId || p.assignedBranchId,
        todayBranchLabel: activeSlot?.branchLabel || p.location,
        todayShiftKey: activeSlot?.shiftKey || p.shiftType || "one",
        todayShiftLabel: activeSlot ? formatShiftKeyUz(activeSlot.shiftKey) : formatShiftKeyUz(p.shiftType || "one"),
        todayMode: activeSlot?.mode || "permanent",
        todayModeLabel: formatModeUz(activeSlot?.mode || "permanent"),
        slotsCount: pSlots.length,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "uz"));

  res.json({ items, staffMonitoring });
});

router.post("/smena/slots", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const actor = await requireSmena(req, res, "rotate");
    if (!actor) return;

    const employeeId = Number(req.body?.employeeId);
    const branchId = Number(req.body?.branchId);
    if (!Number.isFinite(employeeId) || !Number.isFinite(branchId)) {
      res.status(400).json({ error: "Xodim va filialni tanlang (employeeId, branchId)" });
      return;
    }
    const target = await empById(employeeId);
    if (!target) {
      res.status(404).json({ error: "Xodim topilmadi" });
      return;
    }
    if (denyOutOfScope(actor, target, res)) return;
    const targetIsMudir = isMudirPerson(target.orgRole);

    const branch = await empById(branchId);
    if (!branch || branch.orgRole !== MANAGER_ORG || !hasGps(branch)) {
      res.status(400).json({ error: "Filial GPS yo‘q yoki mudir emas" });
      return;
    }

    const mode = String(req.body?.mode || "permanent").trim();
    if (targetIsMudir && mode === "permanent") {
      res.status(400).json({
        error:
          "Mudirni boshqa filialga doimiy o‘tkazish filial tuzilmasini o‘zgartiradi — buni «Aptekalar tarmog‘i» bo‘limida qiling. Bu yerda mudirga muddatli, haftalik yoki kunlik rotatsiya qo‘yiladi.",
      });
      return;
    }
    if (targetIsMudir && branchId === target.id) {
      res.status(400).json({ error: "Mudir o‘z filialida ishlaydi — rotatsiya uchun boshqa filialni tanlang" });
      return;
    }
    const before = await placementOf(target);
    const today = todayTashkentYmd();

    const parsed = validateSlotInput({
      mode,
      shiftKey: req.body?.shiftKey,
      validFrom: mode === "permanent" ? today : req.body?.validFrom,
      validTo: mode === "permanent" ? null : req.body?.validTo,
      weekdays: req.body?.weekdays,
      workDates: req.body?.workDates,
    });
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    // Doimiy rotatsiya: oldingi doimiy slotlar ziddiyat bermasligi uchun avtomatik arxivlanadi
    if (parsed.mode === "permanent") {
      await db
        .update(employeeWorkSlotsTable)
        .set({ active: false, updatedAt: new Date() })
        .where(
          and(
            eq(employeeWorkSlotsTable.employeeId, employeeId),
            eq(employeeWorkSlotsTable.mode, "permanent"),
            eq(employeeWorkSlotsTable.active, true),
          ),
        );
    }

    const branchLabel =
      displayBranchName(branch.location) || (branch.location || "").split("|")[0].trim() || branch.fullName;
    const note = req.body?.note ? String(req.body.note).slice(0, 400) : null;

    const existing = await db
      .select()
      .from(employeeWorkSlotsTable)
      .where(and(eq(employeeWorkSlotsTable.employeeId, employeeId), eq(employeeWorkSlotsTable.active, true)));
    const defs = await getEffectiveShiftDefs();
    const proposed: WorkSlotRow[] = [
      ...existing.map((r) => {
        const m = mapSlotRow(r);
        return parsed.mode === "permanent" && m.overrideBase ? { ...m, branchId, branchLabel } : m;
      }),
      {
        employeeId,
        branchId,
        branchLabel,
        shiftKey: parsed.shiftKey,
        mode: parsed.mode,
        validFrom: parsed.validFrom,
        validTo: parsed.validTo,
        weekdays: parsed.weekdays,
        workDates: parsed.workDates,
        active: true,
      },
    ];
    const sampleTo =
      parsed.validTo ||
      (parsed.workDates?.length ? parsed.workDates[parsed.workDates.length - 1]! : addDaysYmd(parsed.validFrom, 28));
    const conflict = conflictAmongSlots(proposed, parsed.validFrom, sampleTo, defs);
    if (conflict) {
      res.status(400).json({ error: conflict });
      return;
    }

    const [row] = await db
      .insert(employeeWorkSlotsTable)
      .values({
        employeeId,
        branchId,
        branchLabel,
        shiftKey: parsed.shiftKey,
        mode: parsed.mode,
        validFrom: parsed.validFrom,
        validTo: parsed.validTo,
        weekdays: parsed.weekdays,
        workDates: parsed.workDates,
        note,
        active: true,
        createdById: req.userId ?? null,
      })
      .returning();

    // Kunlik: legacy rotatsiya jadvallariga ham yozamiz (eski resolve uchun)
    if (parsed.mode === "days" && parsed.workDates?.length) {
      for (const workDate of parsed.workDates) {
        await db
          .delete(employeeBranchAssignmentsTable)
          .where(
            and(
              eq(employeeBranchAssignmentsTable.employeeId, employeeId),
              eq(employeeBranchAssignmentsTable.kind, "temp_one_day"),
              eq(employeeBranchAssignmentsTable.validFrom, workDate),
              eq(employeeBranchAssignmentsTable.branchId, branchId),
            ),
          );
        await db.insert(employeeBranchAssignmentsTable).values({
          employeeId,
          branchId,
          branchLabel,
          kind: "temp_one_day",
          validFrom: workDate,
          validTo: workDate,
          note: note || `Kunlik slot · ${formatShiftKeyUz(parsed.shiftKey)}`,
          createdById: req.userId ?? null,
        });
        const [plan] = await db
          .select()
          .from(employeeDayShiftPlansTable)
          .where(
            and(
              eq(employeeDayShiftPlansTable.employeeId, employeeId),
              eq(employeeDayShiftPlansTable.workDate, workDate),
            ),
          )
          .limit(1);
        const prevKeys = (plan?.shiftKeys as string[]) || [];
        const added = parseShiftKeys(parsed.shiftKey).filter(
          (k): k is "one" | "two" | "three" => k === "one" || k === "two" || k === "three",
        );
        const nextKeys = [...new Set([...prevKeys, ...added])];
        if (plan) {
          await db
            .update(employeeDayShiftPlansTable)
            .set({ shiftKeys: nextKeys, updatedAt: new Date() })
            .where(eq(employeeDayShiftPlansTable.id, plan.id));
        } else {
          await db.insert(employeeDayShiftPlansTable).values({
            employeeId,
            workDate,
            shiftKeys: nextKeys,
            createdById: req.userId ?? null,
            note,
          });
        }
      }
    }

    if (parsed.mode === "permanent") {
      await moveShiftOverridesToBranch(employeeId, branchId, branchLabel);
    }
    if (parsed.mode === "permanent" || parsed.mode === "period" || parsed.mode === "weekly") {
      await syncPrimaryFromSlots(employeeId);
    }

    await logSmenaChange({
      ...logBase(actor, target),
      action: "rotation_create",
      fromBranch: { id: before.branchId, label: before.branchLabel },
      toBranch: { id: branchId, label: branchLabel },
      fromShift: before.shiftKey,
      toShift: parsed.shiftKey,
      mode: parsed.mode,
      validFrom: parsed.validFrom,
      validTo: parsed.validTo,
      weekdays: parsed.weekdays,
      workDates: parsed.workDates,
      note,
      slotId: row!.id,
      summary: `${formatModeUz(parsed.mode)} rotatsiya: «${before.branchLabel || "—"}» → «${branchLabel}», ${formatShiftKeyUz(parsed.shiftKey)} (${periodText(parsed.mode, parsed.validFrom, parsed.validTo, parsed.weekdays, parsed.workDates)})`,
    });

    if (target.userId) {
      let notifText = "";
      if (parsed.mode === "permanent") {
        notifText = `Siz «${branchLabel}» filialiga doimiy biriktirildingiz (${formatShiftKeyUz(parsed.shiftKey)}). Endi shu filialdan bemalol davomat qilishingiz mumkin.`;
      } else if (parsed.mode === "period") {
        notifText = `Siz «${branchLabel}» filialiga ${parsed.validFrom} dan ${parsed.validTo} gacha (${formatShiftKeyUz(parsed.shiftKey)}) muddatli rotatsiyaga biriktirildingiz. Muddat tugagach avtomatik asosiy filialingizga qaytasiz.`;
      } else if (parsed.mode === "weekly") {
        notifText = `Siz «${branchLabel}» filialida haftaning belgilangan kunlarida (${(parsed.weekdays || []).join(", ")}) ${formatShiftKeyUz(parsed.shiftKey)}da ishlashingiz belgilandi.`;
      } else {
        notifText = `Siz «${branchLabel}» filialiga kunlik rotatsiya bo‘yicha (${(parsed.workDates || []).join(", ")}) ${formatShiftKeyUz(parsed.shiftKey)}ga biriktirildingiz.`;
      }

      await notifyUser({
        userId: target.userId,
        text: notifText,
        type: "smena_slot",
        linkUrl: "/smena-filial",
      });
    }

    res.status(201).json({
      ok: true,
      item: {
        ...mapSlotRow(row!),
        modeLabel: formatModeUz(row!.mode),
        shiftLabel: formatShiftKeyUz(row!.shiftKey),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("POST /smena/slots error:", err);
    if (/employee_work_slots|does not exist|relation/i.test(msg)) {
      res.status(503).json({
        error: "Jadval hali yaratilmagan. API ni qayta ishga tushiring (employee_work_slots).",
      });
      return;
    }
    res.status(500).json({ error: msg.slice(0, 300) || "Slot saqlanmadi" });
  }
});

router.delete("/smena/slots/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const actor = await requireSmena(req, res, "rotate");
  if (!actor) return;
  const id = Number(req.params.id);
  const [row] = await db.select().from(employeeWorkSlotsTable).where(eq(employeeWorkSlotsTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Slot topilmadi" });
    return;
  }
  const target = await empById(row.employeeId);
  if (!target) {
    res.status(404).json({ error: "Xodim topilmadi" });
    return;
  }
  if (actor.scope && denyOutOfScope(actor, target, res)) return;
  await db
    .update(employeeWorkSlotsTable)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(employeeWorkSlotsTable.id, id));
  await syncPrimaryFromSlots(row.employeeId);
  const after = await placementOf(target);
  const weekdays = (row.weekdays as number[] | null) || null;
  const workDates = (row.workDates as string[] | null) || null;
  await logSmenaChange({
    ...logBase(actor, target),
    action: "rotation_cancel",
    fromBranch: { id: row.branchId, label: row.branchLabel },
    toBranch: { id: after.branchId, label: after.branchLabel },
    fromShift: row.shiftKey,
    toShift: after.shiftKey,
    mode: row.mode,
    validFrom: row.validFrom,
    validTo: row.validTo,
    weekdays,
    workDates,
    slotId: row.id,
    summary: `${row.overrideBase ? "Haftalik smena almashtirish" : `${formatModeUz(row.mode)} rotatsiya`} bekor qilindi: «${row.branchLabel || "—"}», ${formatShiftKeyUz(row.shiftKey)} (${periodText(row.mode, row.validFrom, row.validTo, weekdays, workDates)})`,
  });
  if (target.userId && actor.info.id !== target.userId) {
    await notifyUser({
      userId: target.userId,
      text: `«${row.branchLabel || "Filial"}» filialidagi ${formatModeUz(row.mode).toLowerCase()} rotatsiyangiz bekor qilindi. Davomat endi «${after.branchLabel || "asosiy filial"}» bo‘yicha.`,
      type: "smena_slot",
      linkUrl: "/davomat-face",
    });
  }
  res.json({ ok: true });
});

/**
 * Filialni o‘zgartirmasdan faqat smenani almashtirish.
 * branchId saqlanadi — xodim boshqa filialga ko‘chmaydi.
 */
router.patch("/smena/slots/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const actor = await requireSmena(req, res, "any");
    if (!actor) return;
    const id = Number(req.params.id);
    const [row] = await db.select().from(employeeWorkSlotsTable).where(eq(employeeWorkSlotsTable.id, id)).limit(1);
    if (!row || !row.active) {
      res.status(404).json({ error: "Slot topilmadi" });
      return;
    }
    const target = await empById(row.employeeId);
    if (!target) {
      res.status(404).json({ error: "Xodim topilmadi" });
      return;
    }
    if (actor.scope && denyOutOfScope(actor, target, res)) return;

    const newShiftRaw = String(req.body?.shiftKey ?? "").trim();
    if (!newShiftRaw) {
      res.status(400).json({ error: "Yangi smenani tanlang" });
      return;
    }
    const parsed = validateSlotInput({
      mode: row.mode,
      shiftKey: newShiftRaw,
      validFrom: row.validFrom,
      validTo: row.validTo,
      weekdays: row.weekdays,
      workDates: row.workDates,
    });
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    if (parsed.shiftKey === row.shiftKey) {
      res.json({
        ok: true,
        item: {
          ...mapSlotRow(row),
          modeLabel: formatModeUz(row.mode),
          shiftLabel: formatShiftKeyUz(row.shiftKey),
        },
        unchanged: true,
      });
      return;
    }

    const existing = await db
      .select()
      .from(employeeWorkSlotsTable)
      .where(and(eq(employeeWorkSlotsTable.employeeId, row.employeeId), eq(employeeWorkSlotsTable.active, true)));
    const defs = await getEffectiveShiftDefs();
    const proposed: WorkSlotRow[] = existing.map((r) => {
      if (r.id === row.id) {
        return { ...mapSlotRow(r), shiftKey: parsed.shiftKey };
      }
      return mapSlotRow(r);
    });
    const sampleTo =
      row.validTo ||
      (Array.isArray(row.workDates) && row.workDates.length
        ? String(row.workDates[row.workDates.length - 1])
        : addDaysYmd(row.validFrom, 28));
    const conflict = conflictAmongSlots(proposed, row.validFrom, sampleTo, defs);
    if (conflict) {
      res.status(400).json({ error: conflict });
      return;
    }

    const [updated] = await db
      .update(employeeWorkSlotsTable)
      .set({ shiftKey: parsed.shiftKey, updatedAt: new Date() })
      .where(eq(employeeWorkSlotsTable.id, id))
      .returning();

    await syncPrimaryFromSlots(row.employeeId);

    await logSmenaChange({
      ...logBase(actor, target),
      action: "slot_shift_change",
      fromBranch: { id: row.branchId, label: row.branchLabel },
      toBranch: { id: row.branchId, label: row.branchLabel },
      fromShift: row.shiftKey,
      toShift: parsed.shiftKey,
      mode: row.mode,
      validFrom: row.validFrom,
      validTo: row.validTo,
      slotId: row.id,
      summary: `${formatModeUz(row.mode)} rotatsiya smenasi: ${formatShiftKeyUz(row.shiftKey)} → ${formatShiftKeyUz(parsed.shiftKey)}, filial «${row.branchLabel || "—"}» o‘zgarmadi`,
    });
    if (target.userId) {
      await notifyUser({
        userId: target.userId,
        text: `«${row.branchLabel || "Filial"}» filialidagi smenangiz o‘zgardi: ${formatShiftKeyUz(row.shiftKey)} → ${formatShiftKeyUz(parsed.shiftKey)}.`,
        type: "smena_slot",
        linkUrl: "/davomat-face",
      });
    }

    res.json({
      ok: true,
      item: {
        ...mapSlotRow(updated!),
        modeLabel: formatModeUz(updated!.mode),
        shiftLabel: formatShiftKeyUz(updated!.shiftKey),
      },
      message: `Smena o‘zgardi · filial «${updated!.branchLabel || row.branchLabel}» o‘zgarmadi`,
    });
  } catch (err) {
    console.error("PATCH /smena/slots/:id error:", err);
    res.status(500).json({ error: "Smena o‘zgartirilmadi" });
  }
});

/**
 * Xodimning joriy filialida faqat smenani almashtirish (filial ID o‘zgarmaydi).
 * Slot bo‘lmasa — employee.shiftType yangilanadi; bo‘lsa — asosiy doimiy slot yangilanadi.
 */
router.patch("/smena/shift-only/:employeeId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const actor = await requireSmena(req, res, "shift");
    if (!actor) return;
    const employeeId = Number(req.params.employeeId);
    const target = await empById(employeeId);
    if (!target) {
      res.status(404).json({ error: "Xodim topilmadi" });
      return;
    }
    if (denyOutOfScope(actor, target, res)) return;
    const before = await placementOf(target);

    const shiftRaw = String(req.body?.shiftKey ?? req.body?.shiftType ?? "").trim();
    if (!shiftRaw) {
      res.status(400).json({ error: "Smenani tanlang" });
      return;
    }
    const defs = await getEffectiveShiftDefs();
    const applied = applyShiftTypePatch(shiftRaw, defs);
    if (!applied.ok) {
      res.status(400).json({ error: applied.error, warning: applied.warning });
      return;
    }

    const slots = await db
      .select()
      .from(employeeWorkSlotsTable)
      .where(and(eq(employeeWorkSlotsTable.employeeId, employeeId), eq(employeeWorkSlotsTable.active, true)));

    const branchId =
      target.assignedBranchId ||
      (target.orgRole === MANAGER_ORG ? target.id : target.reportsToId) ||
      slots[0]?.branchId ||
      null;
    if (!branchId) {
      res.status(400).json({ error: "Avval filial biriktirilgan bo‘lishi kerak" });
      return;
    }

    const atBranch = slots.filter((s) => s.branchId === branchId && !s.overrideBase);
    const permanentAtBranch = atBranch.filter((s) => s.mode === "permanent");
    const toUpdate = permanentAtBranch[0] || atBranch[0] || null;

    if (toUpdate) {
      const others = slots.filter((s) => s.id !== toUpdate.id);
      const proposed: WorkSlotRow[] = [
        ...others.map(mapSlotRow),
        { ...mapSlotRow(toUpdate), shiftKey: applied.shiftType as WorkSlotRow["shiftKey"] },
      ];
      const sampleTo = toUpdate.validTo || addDaysYmd(toUpdate.validFrom, 28);
      const conflict = conflictAmongSlots(proposed, toUpdate.validFrom, sampleTo, defs);
      if (conflict) {
        res.status(400).json({ error: conflict });
        return;
      }
      await db
        .update(employeeWorkSlotsTable)
        .set({ shiftKey: applied.shiftType, updatedAt: new Date() })
        .where(eq(employeeWorkSlotsTable.id, toUpdate.id));
      await syncPrimaryFromSlots(employeeId);
    } else {
      await db
        .update(employeesTable)
        .set({
          shiftType: applied.shiftType,
          shiftLabel: applied.shiftLabel,
          updatedAt: new Date(),
        })
        .where(eq(employeesTable.id, employeeId));
    }

    const branch = await empById(branchId);
    const branchName =
      displayBranchName(branch?.location) ||
      (branch?.location || "").split("|")[0].trim() ||
      branch?.fullName ||
      (target.location || "").split("|")[0].trim() ||
      "Filial";

    await logSmenaChange({
      ...logBase(actor, target),
      action: "shift_change",
      fromBranch: { id: branchId, label: branchName },
      toBranch: { id: branchId, label: branchName },
      fromShift: before.shiftKey,
      toShift: applied.shiftType,
      mode: "permanent",
      summary: `Asosiy smena: ${formatShiftKeyUz(before.shiftKey)} → ${formatShiftKeyUz(applied.shiftType)}, filial «${branchName}» o‘zgarmadi`,
    });

    if (target.userId) {
      await notifyUser({
        userId: target.userId,
        text: `Asosiy smenangiz o‘zgardi: ${applied.shiftLabel}. Filial o‘zgarmadi (${branchName}).`,
        type: "smena_slot",
        linkUrl: "/davomat-face",
      });
    }

    res.json({
      ok: true,
      shiftOnly: true,
      shiftType: applied.shiftType,
      shiftLabel: applied.shiftLabel,
      branchId,
      branchName,
      message: `Smena «${applied.shiftLabel}» · filial «${branchName}» o‘zgarmadi`,
    });
  } catch (err) {
    console.error("PATCH /smena/shift-only error:", err);
    res.status(500).json({ error: "Smena o‘zgartirilmadi" });
  }
});

const BOARD_SHIFT_KEYS = ["one", "two", "three", "one+two", "two+three"] as const;
type BoardShiftKey = (typeof BOARD_SHIFT_KEYS)[number];

const WEEKDAY_FULL_UZ = ["", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"];

function shiftNameUz(key: string): string {
  const s = formatShiftKeyUz(key);
  return s.includes("+") ? `${s} smena` : s;
}

function toBoardShiftKey(raw: string | null | undefined): BoardShiftKey {
  const keys = parseShiftKeys(raw || "one").filter(
    (k): k is "one" | "two" | "three" => k === "one" || k === "two" || k === "three",
  );
  const enc = encodeShiftKeys(keys.length ? keys : ["one"]);
  return (BOARD_SHIFT_KEYS as readonly string[]).includes(enc) ? (enc as BoardShiftKey) : "one";
}

function homeBranchIdFor(
  target: EmpRow,
  slots: Array<{ branchId: number; mode: string; overrideBase: boolean }>,
): number | null {
  return (
    target.assignedBranchId ||
    (target.orgRole === MANAGER_ORG ? target.id : target.reportsToId) ||
    slots.find((s) => !s.overrideBase && s.mode === "permanent")?.branchId ||
    slots.find((s) => !s.overrideBase)?.branchId ||
    null
  );
}

/**
 * Smena almashtirish taxtasi: farmasevt va stajyorlar, asosiy smena,
 * bugungi smena va haftaning har bir kuni uchun reja.
 */
router.get("/smena/shift-board", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const actor = await requireSmena(req, res, "shift");
  if (!actor) return;
  try {
    const defs = await getEffectiveShiftDefs();
    const branches = await listBranches();
    const branchName = (id: number | null) => (id ? branches.find((b) => b.id === id)?.name || null : null);

    const people = (await activePeople()).filter((p) => isSmenaTarget(p) && targetInScope(actor, p));

    const ids = people.map((p) => p.id);
    const slotRows = ids.length
      ? await db
          .select()
          .from(employeeWorkSlotsTable)
          .where(and(inArray(employeeWorkSlotsTable.employeeId, ids), eq(employeeWorkSlotsTable.active, true)))
      : [];
    const slotsByEmp = new Map<number, typeof slotRows>();
    for (const r of slotRows) {
      const list = slotsByEmp.get(r.employeeId) || [];
      list.push(r);
      slotsByEmp.set(r.employeeId, list);
    }

    const today = todayTashkentYmd();
    const todayWd = isoWeekdayTashkent(today);

    const staff = people.map((p) => {
      const rows = slotsByEmp.get(p.id) || [];
      const homeId = homeBranchIdFor(p, rows);
      const baseSlot =
        rows.find((r) => !r.overrideBase && r.mode === "permanent" && r.branchId === homeId) ||
        rows.find((r) => !r.overrideBase && r.mode === "permanent") ||
        null;
      const baseShiftKey = toBoardShiftKey(baseSlot?.shiftKey || p.shiftType);
      const overrides = rows
        .filter((r) => r.overrideBase && r.mode === "weekly")
        .map((r) => ({
          id: r.id,
          shiftKey: toBoardShiftKey(r.shiftKey),
          weekdays: ((r.weekdays as number[] | null) || []).slice().sort((a, b) => a - b),
        }));
      const week = [1, 2, 3, 4, 5, 6, 7].map((wd) => {
        const ov = overrides.find((o) => o.weekdays.includes(wd));
        return { weekday: wd, shiftKey: ov ? ov.shiftKey : baseShiftKey, override: Boolean(ov) };
      });
      const todayResolved = resolveSlotsForDay(today, rows.map(mapSlotRow));
      const todayKeys = todayResolved
        .map((s) => s.shiftKey)
        .filter((k): k is "one" | "two" | "three" => k === "one" || k === "two" || k === "three");
      const todayShiftKey = todayKeys.length
        ? toBoardShiftKey(encodeShiftKeys(todayKeys))
        : week[todayWd - 1]!.shiftKey;
      const otherRotations = rows.filter((r) => !r.overrideBase && r.branchId !== homeId).length;
      return {
        employeeId: p.id,
        fullName: p.fullName,
        orgRole: p.orgRole,
        branchId: homeId,
        branchName: branchName(homeId) || (p.location || "").split("|")[0].trim() || null,
        baseShiftKey,
        todayShiftKey,
        overrides,
        week,
        otherRotations,
      };
    });
    staff.sort((a, b) => a.fullName.localeCompare(b.fullName, "uz"));

    const shiftOptions = BOARD_SHIFT_KEYS.map((key) => {
      const w = shiftWindow(key, null, defs);
      return {
        key,
        label: shiftNameUz(key),
        start: w.start,
        end: w.end,
        overnight: key.includes("three"),
      };
    });

    res.json({ today, todayWeekday: todayWd, shiftOptions, staff });
  } catch (err) {
    console.error("GET /smena/shift-board error:", err);
    res.status(500).json({ error: "Smena ro‘yxati yuklanmadi" });
  }
});

/**
 * Haftaning tanlangan kunlari uchun boshqa smena (filial o‘zgarmaydi).
 * shiftKey = null — tanlangan kunlar asosiy smenaga qaytadi.
 */
router.post("/smena/shift-override", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const actor = await requireSmena(req, res, "shift");
  if (!actor) return;
  try {
    const employeeId = Number(req.body?.employeeId);
    const weekdays = normalizeWeekdays(req.body?.weekdays);
    const shiftRaw = req.body?.shiftKey == null || req.body?.shiftKey === "" ? null : String(req.body.shiftKey);
    if (!Number.isFinite(employeeId) || employeeId <= 0) {
      res.status(400).json({ error: "Xodimni tanlang" });
      return;
    }
    if (!weekdays.length) {
      res.status(400).json({ error: "Kamida bitta hafta kunini tanlang" });
      return;
    }
    const target = await empById(employeeId);
    if (!target) {
      res.status(404).json({ error: "Xodim topilmadi" });
      return;
    }
    if (denyOutOfScope(actor, target, res)) return;

    const slots = await db
      .select()
      .from(employeeWorkSlotsTable)
      .where(and(eq(employeeWorkSlotsTable.employeeId, employeeId), eq(employeeWorkSlotsTable.active, true)));
    const branchId = homeBranchIdFor(target, slots);
    if (!branchId) {
      res.status(400).json({ error: "Avval xodimga filial biriktirilgan bo‘lishi kerak" });
      return;
    }
    const branch = await empById(branchId);
    const branchLabel =
      displayBranchName(branch?.location) ||
      (branch?.location || "").split("|")[0].trim() ||
      branch?.fullName ||
      null;

    let newShift: WorkSlotRow["shiftKey"] | null = null;
    if (shiftRaw) {
      const parsed = validateSlotInput({ mode: "weekly", shiftKey: shiftRaw, validFrom: todayTashkentYmd(), weekdays });
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      newShift = parsed.shiftKey;
    }

    const baseSlot =
      slots.find((r) => !r.overrideBase && r.mode === "permanent" && r.branchId === branchId) ||
      slots.find((r) => !r.overrideBase && r.mode === "permanent") ||
      null;
    const baseShiftKey = toBoardShiftKey(baseSlot?.shiftKey || target.shiftType);
    if (newShift && newShift === baseShiftKey) newShift = null;

    // Tanlangan kunlarni eski almashtirishlardan olib tashlaymiz (bir kun — bitta almashtirish)
    const overrides = slots.filter((s) => s.overrideBase && s.mode === "weekly");
    const plan: Array<{ id: number; weekdays: number[] }> = overrides.map((o) => ({
      id: o.id,
      weekdays: ((o.weekdays as number[] | null) || []).filter((d) => !weekdays.includes(d)),
    }));

    const today = todayTashkentYmd();
    // Asosiy smena faqat xodim kartasida bo‘lsa — doimiy slot sifatida yozamiz, aks holda
    // almashtirish bo‘lmagan kunlarda davomat kechagi (almashtirilgan) smenani olib qolishi mumkin
    const baseSlotToCreate: WorkSlotRow | null =
      newShift && !baseSlot
        ? {
            employeeId,
            branchId,
            branchLabel,
            shiftKey: baseShiftKey,
            mode: "permanent",
            validFrom: today,
            validTo: null,
            active: true,
          }
        : null;
    const proposed: WorkSlotRow[] = [
      ...slots
        .filter((s) => !(s.overrideBase && s.mode === "weekly"))
        .map(mapSlotRow),
      ...(baseSlotToCreate ? [baseSlotToCreate] : []),
      ...overrides
        .map((o) => ({ ...mapSlotRow(o), weekdays: plan.find((p) => p.id === o.id)!.weekdays }))
        .filter((o) => (o.weekdays || []).length > 0),
      ...(newShift
        ? [
            {
              employeeId,
              branchId,
              branchLabel,
              shiftKey: newShift,
              mode: "weekly" as const,
              validFrom: today,
              validTo: null,
              weekdays,
              overrideBase: true,
              active: true,
            },
          ]
        : []),
    ];
    const defs = await getEffectiveShiftDefs();
    const conflict = conflictAmongSlots(proposed, today, addDaysYmd(today, 13), defs);
    if (conflict) {
      res.status(400).json({ error: conflict });
      return;
    }

    for (const p of plan) {
      const prev = overrides.find((o) => o.id === p.id)!;
      const prevDays = (prev.weekdays as number[] | null) || [];
      if (p.weekdays.length === prevDays.length) continue;
      await db
        .update(employeeWorkSlotsTable)
        .set(
          p.weekdays.length
            ? { weekdays: p.weekdays, updatedAt: new Date() }
            : { active: false, updatedAt: new Date() },
        )
        .where(eq(employeeWorkSlotsTable.id, p.id));
    }

    if (baseSlotToCreate) {
      await db.insert(employeeWorkSlotsTable).values({
        employeeId,
        branchId,
        branchLabel,
        shiftKey: baseShiftKey,
        mode: "permanent",
        validFrom: today,
        validTo: null,
        weekdays: null,
        workDates: null,
        overrideBase: false,
        note: "Asosiy smena (smena almashtirish bo‘limidan)",
        active: true,
        createdById: req.userId ?? null,
      });
    }

    if (newShift) {
      await db.insert(employeeWorkSlotsTable).values({
        employeeId,
        branchId,
        branchLabel,
        shiftKey: newShift,
        mode: "weekly",
        validFrom: today,
        validTo: null,
        weekdays,
        workDates: null,
        overrideBase: true,
        note: "Haftalik smena almashtirish",
        active: true,
        createdById: req.userId ?? null,
      });
    }

    const daysTxt = weekdays.map((d) => WEEKDAY_FULL_UZ[d] || weekdayLabelUz(d)).join(", ");
    const text = newShift
      ? `Smena jadvalingiz yangilandi: ${daysTxt} kunlari — ${shiftNameUz(newShift)}. Qolgan kunlar asosiy smena (${shiftNameUz(baseShiftKey)}). Filial o‘zgarmadi.`
      : `Smena jadvalingiz yangilandi: ${daysTxt} kunlari asosiy smenaga (${shiftNameUz(baseShiftKey)}) qaytarildi.`;
    const prevOnDays = [
      ...new Set(
        weekdays.map((d) => overrides.find((o) => ((o.weekdays as number[] | null) || []).includes(d))?.shiftKey ?? baseShiftKey),
      ),
    ].join(", ");
    await logSmenaChange({
      actor: actor.info,
      employee: { id: target.id, name: target.fullName, orgRole: target.orgRole },
      ip: actor.ip,
      action: "shift_override",
      fromBranch: { id: branchId, label: branchLabel },
      toBranch: { id: branchId, label: branchLabel },
      fromShift: prevOnDays,
      toShift: newShift ?? baseShiftKey,
      mode: "weekly",
      validFrom: today,
      weekdays,
      summary: newShift
        ? `Haftalik smena: ${daysTxt} — ${shiftNameUz(newShift)} (asosiy ${shiftNameUz(baseShiftKey)}), filial «${branchLabel || "—"}» o‘zgarmadi`
        : `Haftalik smena: ${daysTxt} asosiy smenaga (${shiftNameUz(baseShiftKey)}) qaytarildi`,
    });

    if (target.userId) {
      await notifyUser({ userId: target.userId, text, type: "smena_slot", linkUrl: "/davomat-face" });
    }

    res.json({ ok: true, message: text, cleared: !newShift });
  } catch (err) {
    console.error("POST /smena/shift-override error:", err);
    res.status(500).json({ error: "Smena saqlanmadi" });
  }
});

/** Bugungi kun rejasini ko‘rish */
router.get("/smena/slots/day-plan", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const me = await empByUserId(req.userId!);
  if (!me) {
    res.status(400).json({ error: "Xodim kartochkasi yo‘q" });
    return;
  }
  const employeeId = Number(req.query.employeeId || me.id);
  const workDate = String(req.query.date || todayTashkentYmd());
  const rows = await db
    .select()
    .from(employeeWorkSlotsTable)
    .where(and(eq(employeeWorkSlotsTable.employeeId, employeeId), eq(employeeWorkSlotsTable.active, true)));
  const daySlots = resolveSlotsForDay(workDate, rows.map(mapSlotRow));
  res.json({ employeeId, workDate, slots: daySlots });
});

export default router;
