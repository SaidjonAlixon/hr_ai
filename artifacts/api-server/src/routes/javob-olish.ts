/**
 * Javob olish — 1-koordinator → (8 soat) HR menejer/direktor → yakuniy.
 * Tasdiqlangan soat/kun davomat jarimasidan ozod.
 */
import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  db,
  employeesTable,
  usersTable,
  javobOlishRequestsTable,
  employeeDayShiftPlansTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { isHrRole, isDirectorRole } from "../lib/roles";
import { notifyUser, notifyByRoles } from "../lib/notify";
import {
  hoursForStaff,
  encodeShiftKeys,
  parseShiftKeys,
  hmToMinutes,
} from "../lib/shift-hours";
import { getEffectiveShiftDefs } from "../lib/shift-schedule";

const router: IRouter = Router();

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const OPEN_STATUSES = ["pending", "pending_coord", "pending_hr"] as const;

function isCoordRole(role: string) {
  return role === "koordinator";
}

function isHrApprover(role: string) {
  return (
    role === "hr_menejer" ||
    role === "hr_direktor" ||
    role === "hr" ||
    role === "hr_kadr_rahbar" ||
    role === "admin" ||
    isDirectorRole(role)
  );
}

function isLead(role: string) {
  return role === "admin" || isDirectorRole(role) || isCoordRole(role) || isHrRole(role);
}

function durationMinutes(fromHm: string, toHm: string): number {
  let a = hmToMinutes(fromHm);
  let b = hmToMinutes(toHm);
  if (b <= a) b += 24 * 60;
  return b - a;
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h} soat ${m} daqiqa`;
  if (h) return `${h} soat`;
  return `${m} daqiqa`;
}

function fmtDt(d: Date | string | null | undefined) {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(x.getTime())) return "—";
  return x.toLocaleString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function empByUserId(userId: number) {
  const [row] = await db
    .select({
      id: employeesTable.id,
      userId: employeesTable.userId,
      fullName: employeesTable.fullName,
      orgRole: employeesTable.orgRole,
      reportsToId: employeesTable.reportsToId,
      assignedBranchId: employeesTable.assignedBranchId,
      shiftType: employeesTable.shiftType,
      shiftLabel: employeesTable.shiftLabel,
      location: employeesTable.location,
    })
    .from(employeesTable)
    .where(eq(employeesTable.userId, userId))
    .limit(1);
  return row ?? null;
}

async function dayShiftTypeFor(employeeId: number, workDate: string): Promise<string | null> {
  const [plan] = await db
    .select({ shiftKeys: employeeDayShiftPlansTable.shiftKeys })
    .from(employeeDayShiftPlansTable)
    .where(
      and(
        eq(employeeDayShiftPlansTable.employeeId, employeeId),
        eq(employeeDayShiftPlansTable.workDate, workDate),
      ),
    )
    .limit(1);
  if (!plan?.shiftKeys?.length) return null;
  const keys = (plan.shiftKeys as string[]).filter((k) => k === "one" || k === "two" || k === "three");
  if (!keys.length) return null;
  return encodeShiftKeys(keys as ("one" | "two" | "three")[]);
}

async function resolveShiftForDate(
  emp: NonNullable<Awaited<ReturnType<typeof empByUserId>>>,
  workDate: string,
  userRole: string,
) {
  const defs = await getEffectiveShiftDefs();
  const dayType = await dayShiftTypeFor(emp.id, workDate);
  const shiftType = dayType || emp.shiftType || "one";
  const shiftLabel = dayType ? null : emp.shiftLabel;
  const hours = hoursForStaff(emp.orgRole, shiftType, userRole, shiftLabel, defs);
  const keys = parseShiftKeys(shiftType, shiftLabel);
  return {
    shiftType: keys.length > 1 ? encodeShiftKeys(keys as ("one" | "two" | "three")[]) : hours.shiftKey || "one",
    shiftLabel:
      keys.length > 1
        ? `${keys.map((k) => (k === "one" ? "1" : k === "two" ? "2" : "3")).join("+")}-smena ${hours.start}–${hours.end}`
        : `${hours.shiftKey === "two" ? "2" : hours.shiftKey === "three" ? "3" : hours.shiftKey === "office" ? "Ofis" : "1"}-smena ${hours.start}–${hours.end}`,
    shiftStartHm: hours.start,
    shiftEndHm: hours.end,
    overnight: Boolean(hours.overnight),
    durationLabel: formatDuration(durationMinutes(hours.start, hours.end)),
  };
}

async function findCoordinatorUserId(empId: number): Promise<number | null> {
  let currentId: number | null = empId;
  for (let i = 0; i < 6 && currentId; i++) {
    const [row] = await db
      .select({
        reportsToId: employeesTable.reportsToId,
        userId: employeesTable.userId,
      })
      .from(employeesTable)
      .where(eq(employeesTable.id, currentId))
      .limit(1);
    if (!row?.reportsToId) break;
    const [mgr] = await db
      .select({
        id: employeesTable.id,
        userId: employeesTable.userId,
      })
      .from(employeesTable)
      .where(eq(employeesTable.id, row.reportsToId))
      .limit(1);
    if (!mgr) break;
    if (mgr.userId) {
      const [u] = await db
        .select({ role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.id, mgr.userId))
        .limit(1);
      if (u?.role === "koordinator") return mgr.userId;
    }
    currentId = mgr.id;
  }
  return null;
}

async function coordinatorScopeEmployeeIds(coordEmpId: number): Promise<Set<number>> {
  const mgrs = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(eq(employeesTable.reportsToId, coordEmpId));
  const ids = new Set(mgrs.map((m) => m.id));
  ids.add(coordEmpId);
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

function normalizeStatus(s: string) {
  if (s === "pending") return "pending_coord";
  return s;
}

function serializeRow(r: typeof javobOlishRequestsTable.$inferSelect, empName?: string | null) {
  const status = normalizeStatus(r.status);
  const fullDay = r.fromHm === r.shiftStartHm && r.toHm === r.shiftEndHm;
  return {
    id: r.id,
    employeeId: r.employeeId,
    userId: r.userId,
    fullName: empName || null,
    workDate: r.workDate,
    shiftType: r.shiftType,
    shiftLabel: r.shiftLabel,
    shiftStartHm: r.shiftStartHm,
    shiftEndHm: r.shiftEndHm,
    shiftOvernight: Boolean(r.shiftOvernight),
    fromHm: r.fromHm,
    toHm: r.toHm,
    durationMinutes: r.durationMinutes,
    durationLabel: formatDuration(r.durationMinutes),
    note: r.note,
    status,
    kind: fullDay ? "day" : "hour",
    coordinatorUserId: r.coordinatorUserId,
    coordDecidedById: r.coordDecidedById,
    coordDecidedAt: r.coordDecidedAt,
    coordDecisionNote: r.coordDecisionNote,
    escalatedAt: r.escalatedAt,
    escalatedNote: r.escalatedNote,
    decidedById: r.decidedById,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt,
    createdAtLabel: fmtDt(r.createdAt),
    escalatedAtLabel: fmtDt(r.escalatedAt),
  };
}

router.get("/javob-olish/shifts", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const me = await empByUserId(req.userId!);
  if (!me) {
    res.status(400).json({ error: "Xodim kartochkasi yo‘q" });
    return;
  }
  const raw = String(req.query.dates || "");
  const dates = raw
    .split(",")
    .map((d) => d.trim())
    .filter((d) => YMD.test(d));
  if (!dates.length) {
    res.status(400).json({ error: "dates=YYYY-MM-DD,..." });
    return;
  }
  const role = req.userRole || "";
  const items = [];
  for (const d of dates.slice(0, 31)) {
    const shift = await resolveShiftForDate(me, d, role);
    items.push({ workDate: d, ...shift });
  }
  res.json({ items });
});

router.get("/javob-olish", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  const me = await empByUserId(req.userId!);
  const statusFilter = req.query.status ? String(req.query.status) : null;
  const scope = String(req.query.scope || "mine");

  const people = await db
    .select({ id: employeesTable.id, fullName: employeesTable.fullName })
    .from(employeesTable);
  const nameById = new Map(people.map((p) => [p.id, p.fullName]));

  let rows: (typeof javobOlishRequestsTable.$inferSelect)[] = [];
  let canDecide = false;

  if (scope === "pending") {
    if (role === "admin" || isDirectorRole(role)) {
      rows = await db
        .select()
        .from(javobOlishRequestsTable)
        .where(inArray(javobOlishRequestsTable.status, ["pending", "pending_coord", "pending_hr"]))
        .orderBy(desc(javobOlishRequestsTable.createdAt));
      canDecide = true;
    } else if (isCoordRole(role) && me) {
      rows = await db
        .select()
        .from(javobOlishRequestsTable)
        .where(inArray(javobOlishRequestsTable.status, ["pending", "pending_coord"]))
        .orderBy(desc(javobOlishRequestsTable.createdAt));
      const scopeIds = await coordinatorScopeEmployeeIds(me.id);
      rows = rows.filter((r) => scopeIds.has(r.employeeId) || r.coordinatorUserId === req.userId);
      canDecide = true;
    } else if (isHrApprover(role)) {
      rows = await db
        .select()
        .from(javobOlishRequestsTable)
        .where(eq(javobOlishRequestsTable.status, "pending_hr"))
        .orderBy(desc(javobOlishRequestsTable.createdAt));
      canDecide = true;
    } else {
      res.status(403).json({ error: "Ruxsat yo‘q" });
      return;
    }
  } else if (scope === "all" && isLead(role)) {
    rows = await db
      .select()
      .from(javobOlishRequestsTable)
      .orderBy(desc(javobOlishRequestsTable.createdAt))
      .limit(200);
    if (isCoordRole(role) && me) {
      const scopeIds = await coordinatorScopeEmployeeIds(me.id);
      rows = rows.filter((r) => scopeIds.has(r.employeeId) || r.coordinatorUserId === req.userId);
    }
    canDecide = isCoordRole(role) || isHrApprover(role);
  } else {
    if (!me) {
      res.status(400).json({ error: "Xodim kartochkasi yo‘q" });
      return;
    }
    const conds = [eq(javobOlishRequestsTable.employeeId, me.id)];
    if (statusFilter) conds.push(eq(javobOlishRequestsTable.status, statusFilter));
    rows = await db
      .select()
      .from(javobOlishRequestsTable)
      .where(and(...conds))
      .orderBy(desc(javobOlishRequestsTable.workDate))
      .limit(100);
  }

  res.json({
    items: rows.map((r) => serializeRow(r, nameById.get(r.employeeId))),
    canDecide,
    roleScope: isHrApprover(role) ? "hr" : isCoordRole(role) ? "coord" : "none",
  });
});

router.post("/javob-olish", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  const me = await empByUserId(req.userId!);
  if (!me) {
    res.status(400).json({ error: "Xodim kartochkasi yo‘q" });
    return;
  }

  const sharedNote = String(req.body?.note || "").trim();
  type DayIn = { workDate?: string; fromHm?: string; toHm?: string; note?: string };

  let daysRaw: DayIn[] | null = null;
  if (Array.isArray(req.body?.dates) && req.body.dates.length) {
    daysRaw = (req.body.dates as unknown[]).map((d) => ({
      workDate: String(d),
      note: sharedNote,
    }));
  } else if (Array.isArray(req.body?.days) && req.body.days.length) {
    daysRaw = req.body.days as DayIn[];
  }

  if (!daysRaw?.length) {
    res.status(400).json({ error: "Kamida bitta kun tanlang" });
    return;
  }
  if (daysRaw.length > 31) {
    res.status(400).json({ error: "Bir martada max 31 kun" });
    return;
  }

  const batchNote = sharedNote || String(daysRaw[0]?.note || "").trim();
  if (!batchNote || batchNote.length < 3) {
    res.status(400).json({ error: "Izoh majburiy — sababni yozing" });
    return;
  }
  if (batchNote.length > 800) {
    res.status(400).json({ error: "Izoh juda uzun (max 800)" });
    return;
  }

  const prepared: Array<{
    workDate: string;
    fromHm: string;
    toHm: string;
    note: string;
    shift: Awaited<ReturnType<typeof resolveShiftForDate>>;
    durationMinutes: number;
  }> = [];

  const seen = new Set<string>();
  for (const raw of daysRaw) {
    const workDate = String(raw.workDate || "").trim();
    if (!YMD.test(workDate)) {
      res.status(400).json({ error: `Noto‘g‘ri sana: ${workDate}` });
      return;
    }
    if (seen.has(workDate)) {
      res.status(400).json({ error: `Takroriy sana: ${workDate}` });
      return;
    }
    seen.add(workDate);

    const shift = await resolveShiftForDate(me, workDate, role);
    let fromHm = String(raw.fromHm || "").trim() || shift.shiftStartHm;
    let toHm = String(raw.toHm || "").trim() || shift.shiftEndHm;
    if (!HM.test(fromHm) || !HM.test(toHm)) {
      fromHm = shift.shiftStartHm;
      toHm = shift.shiftEndHm;
    }
    const dur = durationMinutes(fromHm, toHm);
    prepared.push({
      workDate,
      fromHm,
      toHm,
      note: batchNote,
      shift,
      durationMinutes: dur > 0 ? dur : durationMinutes(shift.shiftStartHm, shift.shiftEndHm),
    });
  }

  const existing = await db
    .select({ workDate: javobOlishRequestsTable.workDate })
    .from(javobOlishRequestsTable)
    .where(
      and(
        eq(javobOlishRequestsTable.employeeId, me.id),
        inArray(javobOlishRequestsTable.status, [...OPEN_STATUSES]),
        inArray(
          javobOlishRequestsTable.workDate,
          prepared.map((p) => p.workDate),
        ),
      ),
    );
  if (existing.length) {
    res.status(409).json({
      error: `Bu sanalarda allaqachon ochiq so‘rov bor: ${existing.map((e) => e.workDate).join(", ")}`,
    });
    return;
  }

  const coordUserId = await findCoordinatorUserId(me.id);
  const created = [];

  for (const p of prepared) {
    const [row] = await db
      .insert(javobOlishRequestsTable)
      .values({
        employeeId: me.id,
        userId: me.userId,
        workDate: p.workDate,
        shiftType: p.shift.shiftType,
        shiftLabel: p.shift.shiftLabel,
        shiftStartHm: p.shift.shiftStartHm,
        shiftEndHm: p.shift.shiftEndHm,
        shiftOvernight: p.shift.overnight ? 1 : 0,
        fromHm: p.fromHm,
        toHm: p.toHm,
        durationMinutes: p.durationMinutes,
        note: p.note,
        status: "pending_coord",
        coordinatorUserId: coordUserId,
      })
      .returning();
    created.push(row);
  }

  const count = created.length;
  const datesTxt = prepared.map((p) => p.workDate).join(", ");
  const timeTxt = prepared
    .map((p) => `${p.workDate} ${p.fromHm}–${p.toHm}`)
    .join("; ");
  const notifyText = `${me.fullName}: javob olish so‘rovi (${count} ta). ${timeTxt}. Sabab: ${batchNote}. Yuborilgan: ${fmtDt(new Date())}. 8 soat ichida javob bering.`;

  if (coordUserId) {
    await notifyUser({
      userId: coordUserId,
      text: notifyText,
      type: "javob_olish",
      linkUrl: "/javob-olish",
    });
  } else {
    await notifyByRoles({
      roles: ["koordinator", "hr_menejer", "hr_direktor", "admin"],
      text: `${notifyText} (1-koordinator topilmadi — HR ko‘rib chiqing)`,
      type: "javob_olish",
      linkUrl: "/javob-olish",
    });
  }

  res.status(201).json({
    ok: true,
    count,
    message: `${count} ta kun uchun so‘rov 1-koordinatorga yuborildi.`,
    items: created.map((r) => serializeRow(r, me.fullName)),
  });
});

router.post("/javob-olish/:id/approve", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  await decide(req, res, "approved");
});

router.post("/javob-olish/:id/reject", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  await decide(req, res, "rejected");
});

router.post("/javob-olish/:id/cancel", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const me = await empByUserId(req.userId!);
  const id = Number(req.params.id);
  const [row] = await db
    .select()
    .from(javobOlishRequestsTable)
    .where(eq(javobOlishRequestsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "So‘rov topilmadi" });
    return;
  }
  const st = normalizeStatus(row.status);
  if (st !== "pending_coord" && st !== "pending_hr") {
    res.status(400).json({ error: "Faqat ochiq so‘rovni bekor qilish mumkin" });
    return;
  }
  if (!me || row.employeeId !== me.id) {
    res.status(403).json({ error: "Faqat o‘z so‘rovingizni bekor qilasiz" });
    return;
  }
  const [updated] = await db
    .update(javobOlishRequestsTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(javobOlishRequestsTable.id, id))
    .returning();
  res.json({ ok: true, item: serializeRow(updated, me.fullName) });
});

async function decide(
  req: AuthRequest,
  res: import("express").Response,
  decision: "approved" | "rejected",
): Promise<void> {
  const role = req.userRole || "";
  const id = Number(req.params.id);
  const decisionNote = req.body?.note ? String(req.body.note).slice(0, 400) : null;
  const [row] = await db
    .select()
    .from(javobOlishRequestsTable)
    .where(eq(javobOlishRequestsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "So‘rov topilmadi" });
    return;
  }

  const status = normalizeStatus(row.status);
  const now = new Date();

  /** 1-bosqich: koordinator */
  if (status === "pending_coord") {
    if (!(isCoordRole(role) || role === "admin" || isDirectorRole(role))) {
      res.status(403).json({ error: "Avval 1-koordinator javob beradi" });
      return;
    }
    if (isCoordRole(role)) {
      const me = await empByUserId(req.userId!);
      if (me) {
        const scope = await coordinatorScopeEmployeeIds(me.id);
        if (!scope.has(row.employeeId) && row.coordinatorUserId !== req.userId) {
          res.status(403).json({ error: "Bu so‘rov sizning doirangizda emas" });
          return;
        }
      }
    }

    if (decision === "rejected") {
      const [updated] = await db
        .update(javobOlishRequestsTable)
        .set({
          status: "rejected",
          coordDecidedById: req.userId!,
          coordDecidedAt: now,
          coordDecisionNote: decisionNote,
          decidedById: req.userId!,
          decidedAt: now,
          decisionNote,
          updatedAt: now,
        })
        .where(eq(javobOlishRequestsTable.id, id))
        .returning();
      if (row.userId) {
        await notifyUser({
          userId: row.userId,
          text: `${row.workDate} javob olish so‘rovingiz koordinator tomonidan rad etildi.${decisionNote ? ` Sabab: ${decisionNote}` : ""}`,
          type: "javob_olish_decision",
          linkUrl: "/javob-olish",
        });
      }
      const [emp] = await db
        .select({ fullName: employeesTable.fullName })
        .from(employeesTable)
        .where(eq(employeesTable.id, row.employeeId))
        .limit(1);
      res.json({ ok: true, item: serializeRow(updated, emp?.fullName) });
      return;
    }

    // Koordinator tasdiqladi → HR yakuniy
    const [updated] = await db
      .update(javobOlishRequestsTable)
      .set({
        status: "pending_hr",
        coordDecidedById: req.userId!,
        coordDecidedAt: now,
        coordDecisionNote: decisionNote,
        updatedAt: now,
      })
      .where(eq(javobOlishRequestsTable.id, id))
      .returning();

    const [emp] = await db
      .select({ fullName: employeesTable.fullName })
      .from(employeesTable)
      .where(eq(employeesTable.id, row.employeeId))
      .limit(1);

    await notifyByRoles({
      roles: ["hr_menejer", "hr_direktor", "admin"],
      text: `${emp?.fullName || "Xodim"}: koordinator tasdiqladi — HR yakuniy ruxsat kerak. ${row.workDate} ${row.fromHm}–${row.toHm}. Sabab: ${row.note}. Yuborilgan: ${fmtDt(row.createdAt)}.`,
      type: "javob_olish",
      linkUrl: "/javob-olish",
    });

    res.json({ ok: true, item: serializeRow(updated, emp?.fullName) });
    return;
  }

  /** 2-bosqich: HR */
  if (status === "pending_hr") {
    if (!isHrApprover(role)) {
      res.status(403).json({ error: "Yakuniy ruxsatni HR beradi" });
      return;
    }

    const [updated] = await db
      .update(javobOlishRequestsTable)
      .set({
        status: decision === "approved" ? "approved" : "rejected",
        decidedById: req.userId!,
        decidedAt: now,
        decisionNote,
        updatedAt: now,
      })
      .where(eq(javobOlishRequestsTable.id, id))
      .returning();

    if (row.userId) {
      await notifyUser({
        userId: row.userId,
        text:
          decision === "approved"
            ? `${row.workDate} ${row.fromHm}–${row.toHm} javob olish tasdiqlandi (HR). Bu vaqt/kun jarima qilinmaydi.`
            : `${row.workDate} javob olish so‘rovingiz HR tomonidan rad etildi.${decisionNote ? ` Sabab: ${decisionNote}` : ""}`,
        type: "javob_olish_decision",
        linkUrl: "/javob-olish",
      });
    }

    const [emp] = await db
      .select({ fullName: employeesTable.fullName })
      .from(employeesTable)
      .where(eq(employeesTable.id, row.employeeId))
      .limit(1);

    res.json({ ok: true, item: serializeRow(updated, emp?.fullName) });
    return;
  }

  res.status(400).json({ error: "So‘rov allaqachon yopilgan" });
}

export default router;
