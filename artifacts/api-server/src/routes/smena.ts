import { Router, type IRouter } from "express";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db, employeesTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { isHrRole } from "../lib/roles";
import { notifyUser } from "../lib/notify";
import { isPharmacyShiftStaff, normalizeShiftType, shiftWindow, parseShiftKeys, encodeShiftKeys, validateShiftCombination } from "../lib/shift-hours";
import { getEffectiveShiftDefs } from "../lib/shift-schedule";

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
    })
    .from(employeesTable)
    .where(
      and(
        eq(employeesTable.orgRole, MANAGER_ORG),
        sql`coalesce(${employeesTable.employmentStatus}, 'working') <> 'dismissed'`,
      ),
    );
  return rows
    .filter(hasGps)
    .map((b) => ({
      id: b.id,
      name: (b.location || "").split("|")[0].trim() || b.fullName,
      managerName: b.fullName,
      hasGps: true,
      reportsToId: b.reportsToId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "uz"));
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
  const keys = parseShiftKeys(shiftType);
  const primary = shiftWindow(keys[0] || "one", null, defs);
  const windows = keys.map((k) => {
    const w = shiftWindow(k, null, defs);
    return { type: w.key, label: w.label, start: w.start, end: w.end, overnight: !!w.overnight };
  });
  return {
    type: keys.length > 1 ? encodeShiftKeys(keys as any) : primary.key,
    types: keys,
    label: windows.map((w) => w.label).join(" + "),
    start: primary.start,
    end: windows[windows.length - 1]?.end || primary.end,
    warnHm: primary.warnHm,
    warnText: primary.warnText,
    windows,
    hoursNote: windows
      .map((w) => `${w.label}: ${w.start}–${w.end}${w.overnight ? " (keyingi kun)" : ""}`)
      .join(". "),
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
      combo: "Bir kunda max 2 smena: 1+2 va 2+3 ruxsat. 1+2+3 taqiqlangan.",
      branch:
        "Filial ustuvorligi: o‘rniga ishlash → bir kunlik → rotatsiya → doimiy. Face ID belgilangan filial GPS da o‘tadi.",
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

  const body = req.body as { assignedBranchId?: number; shiftType?: string };
  const branchId = Number(body.assignedBranchId);
  const branch = await empById(branchId);
  if (!branch || branch.orgRole !== MANAGER_ORG || !hasGps(branch)) {
    res.status(400).json({ error: "Filial GPS kiritilmagan" });
    return;
  }
  const patch: Record<string, unknown> = {
    assignedBranchId: branchId,
    location: (branch.location || "").split("|")[0].trim() || branch.fullName,
    updatedAt: new Date(),
  };
  if (body.shiftType != null) {
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

  const loc = String(patch.location);
  await db.update(employeesTable).set(patch).where(eq(employeesTable.id, target.id));

  if (target.userId) {
    const shiftTxt = patch.shiftLabel ? String(patch.shiftLabel) : "";
    await notifyUser({
      userId: target.userId,
      text: `${target.fullName}: ${loc} filialiga biriktirildi${shiftTxt ? `, ${shiftTxt}` : ""}. Face ID faqat shu joydan.`,
      type: "smena_branch",
      linkUrl: "/davomat-face",
    });
  }

  res.json({
    ok: true,
    assignedBranchId: branchId,
    assignedBranchName: loc,
    shiftType: patch.shiftType || target.shiftType,
  });
});

export default router;
