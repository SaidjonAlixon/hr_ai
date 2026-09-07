import { Router, type IRouter } from "express";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  db,
  employeesTable,
  employeeBranchAssignmentsTable,
  employeeDayShiftPlansTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { isHrRole } from "../lib/roles";
import { notifyUser } from "../lib/notify";
import { isPharmacyShiftStaff, normalizeShiftType, shiftWindow, parseShiftKeys, encodeShiftKeys, validateShiftCombination } from "../lib/shift-hours";
import { getEffectiveShiftDefs } from "../lib/shift-schedule";
import { displayBranchName } from "../lib/geo-location";
import { dedupeBranchesWithGps } from "../lib/branch-dedupe";

const router: IRouter = Router();

const STAFF_ORG = new Set(["pharmacist", "intern"]);
const MANAGER_ORG = "manager";

function isLeadRole(role: string) {
  return role === "admin" || role === "director" || role === "koordinator" || isHrRole(role);
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
  return row ?? null;
}

function hasGps(e: { latitude: number | null; longitude: number | null }) {
  return e.latitude != null && e.longitude != null && Number.isFinite(e.latitude) && Number.isFinite(e.longitude);
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
  return dedupeBranchesWithGps(rows)
    .map((b) => ({
      id: b.id,
      name: displayBranchName(b.location) || (b.location || "").split("|")[0].trim() || b.fullName,
      managerName: b.fullName,
      hasGps: true,
      reportsToId: b.reportsToId,
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

function canAssignTarget(opts: {
  role: string;
  me: EmpRow;
  target: EmpRow;
  scope: Set<number> | null;
}): boolean {
  const { role, me, target, scope } = opts;
  const org = target.orgRole || "";
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

  if (me && (role === "mudir" || role === "farmasevt" || role === "koordinator" || isLeadRole(role))) {
    const scope = role === "koordinator" ? await coordinatorScopeIds(me) : null;
    const people = await db
      .select(EMP_COLS)
      .from(employeesTable)
      .where(sql`coalesce(${employeesTable.employmentStatus}, 'working') <> 'dismissed'`);

    const branchName = (id: number | null) => branches.find((b) => b.id === id)?.name || null;
    for (const p of people) {
      if (!canAssignTarget({ role, me, target: p, scope })) continue;
      if (p.id === me.id && (role === "farmasevt" || p.orgRole === "pharmacist")) continue;
      assignable.push({
        id: p.id,
        fullName: p.fullName,
        orgRole: p.orgRole,
        shiftType: normalizeShiftType(p.shiftType),
        assignedBranchId: p.assignedBranchId || (p.orgRole === MANAGER_ORG ? p.id : p.reportsToId),
        assignedBranchName:
          branchName(p.assignedBranchId) ||
          branchName(p.orgRole === MANAGER_ORG ? p.id : p.reportsToId) ||
          null,
      });
    }
    assignable.sort((a, b) => a.fullName.localeCompare(b.fullName, "uz"));
  }

  res.json({
    pharmacyStaff: pharmacy,
    canPickShift: pharmacy,
    canPickOwnBranch: Boolean(me && canPickOwnBranch(role, me.orgRole)),
    canAssignOthers: assignable.length > 0,
    canDayRotate: Boolean(
      me && (role === "mudir" || role === "koordinator" || isLeadRole(role) || me.orgRole === MANAGER_ORG),
    ),
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
          label: "Ofis (smena yo‘q)",
          start: officeW.start,
          end: officeW.end,
          warnHm: officeW.warnHm,
          warnText: officeW.warnText,
          windows: [{ type: "office", label: "Ofis", start: officeW.start, end: officeW.end, overnight: false }],
          hoursNote: `Ofis: ${officeW.start}–${officeW.end}. Smena yo‘q — faqat belgilangan vaqt.`,
        },
    branches,
    assignable,
    rules: {
      eligible: "Smena faqat mudir, farmasevt va stajyor uchun",
      office: `Ofis xodimlari smenasiz: ${officeW.start}–${officeW.end}`,
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

  await db.update(employeesTable).set(patch).where(eq(employeesTable.id, target.id));

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
 * Kunlik rotatsiya — faqat tanlangan kun uchun filial + smena.
 * Doimiy assignedBranchId / reportsToId o‘zgarmaydi.
 */
router.post("/smena/rotation", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
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
  const workDate = String(req.body?.workDate || todayTashkentYmd());
  const shiftRaw = req.body?.shiftType != null ? String(req.body.shiftType) : null;
  const note = req.body?.note ? String(req.body.note).slice(0, 400) : null;

  if (!Number.isFinite(employeeId) || !Number.isFinite(branchId) || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    res.status(400).json({ error: "employeeId, branchId va workDate (YYYY-MM-DD) majburiy" });
    return;
  }

  const target = await empById(employeeId);
  if (!target) {
    res.status(404).json({ error: "Xodim topilmadi" });
    return;
  }
  const org = target.orgRole || "";
  if (!(org === MANAGER_ORG || STAFF_ORG.has(org))) {
    res.status(400).json({ error: "Rotatsiya faqat mudir, farmasevt yoki stajyor uchun" });
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

  let dayPlan = null;
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
      [dayPlan] = await db
        .update(employeeDayShiftPlansTable)
        .set({
          shiftKeys,
          note: note || existing.note,
          updatedAt: new Date(),
        })
        .where(eq(employeeDayShiftPlansTable.id, existing.id))
        .returning();
    } else {
      [dayPlan] = await db
        .insert(employeeDayShiftPlansTable)
        .values({
          employeeId,
          workDate,
          shiftKeys,
          createdById: req.userId ?? null,
          note: note || null,
        })
        .returning();
    }
  }

  if (target.userId) {
    const shiftTxt = shiftEncoded ? `, smena: ${shiftEncoded}` : "";
    await notifyUser({
      userId: target.userId,
      text: `${target.fullName}: ${workDate} kuni «${branchLabel}» filialiga rotatsiya${shiftTxt}. Doimiy joy o‘zgarmaydi.`,
      type: "smena_rotation",
      linkUrl: "/davomat-face",
    });
  }

  res.status(201).json({
    ok: true,
    workDate,
    assignment,
    dayPlan,
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
  res.json({ ok: true });
});

export default router;
