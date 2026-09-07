/**
 * Javob olish — har bir tanlangan sana uchun alohida so‘rov.
 * Xodim yaratadi → koordinator tasdiqlaydi/rad etadi.
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
import { isHrRole } from "../lib/roles";
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

function isLead(role: string) {
  return role === "admin" || role === "director" || role === "koordinator" || isHrRole(role);
}

function todayTashkentYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

function durationMinutes(fromHm: string, toHm: string): number {
  let a = hmToMinutes(fromHm);
  let b = hmToMinutes(toHm);
  if (b <= a) b += 24 * 60; // tungi oralik
  return b - a;
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h} soat ${m} daqiqa`;
  if (h) return `${h} soat`;
  return `${m} daqiqa`;
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

/** Xodimning koordinator userId sini topish (org daraxti bo‘ylab) */
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

function serializeRow(
  r: typeof javobOlishRequestsTable.$inferSelect,
  empName?: string | null,
) {
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
    status: r.status,
    coordinatorUserId: r.coordinatorUserId,
    decidedById: r.decidedById,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt,
  };
}

/** Tanlangan sanalar uchun smena (UI avto-to‘ldirish) */
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

/** Mening so‘rovlarim + (koordinator) doira so‘rovlari */
router.get("/javob-olish", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  const me = await empByUserId(req.userId!);
  const statusFilter = req.query.status ? String(req.query.status) : null;
  const scope = String(req.query.scope || "mine"); // mine | pending | all

  const people = await db
    .select({ id: employeesTable.id, fullName: employeesTable.fullName })
    .from(employeesTable);
  const nameById = new Map(people.map((p) => [p.id, p.fullName]));

  let rows: (typeof javobOlishRequestsTable.$inferSelect)[] = [];

  if (scope === "pending" && (role === "koordinator" || isLead(role))) {
    let q = db.select().from(javobOlishRequestsTable).where(eq(javobOlishRequestsTable.status, "pending"));
    rows = await q.orderBy(desc(javobOlishRequestsTable.createdAt));
    if (role === "koordinator" && me) {
      const scopeIds = await coordinatorScopeEmployeeIds(me.id);
      rows = rows.filter(
        (r) => scopeIds.has(r.employeeId) || r.coordinatorUserId === req.userId,
      );
    }
  } else if (scope === "all" && isLead(role)) {
    rows = await db
      .select()
      .from(javobOlishRequestsTable)
      .orderBy(desc(javobOlishRequestsTable.createdAt))
      .limit(200);
    if (role === "koordinator" && me) {
      const scopeIds = await coordinatorScopeEmployeeIds(me.id);
      rows = rows.filter(
        (r) => scopeIds.has(r.employeeId) || r.coordinatorUserId === req.userId,
      );
    }
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
    canDecide: role === "koordinator" || isLead(role),
  });
});

/**
 * Ko‘p kunlik yuborish — har sana alohida record.
 * Sodda format: { dates: [...], note } — soat kerak emas, smena avto, bitta izoh.
 */
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
    res.status(400).json({ error: "Izoh majburiy — «Nima sababdan javob olmoqchisiz?»" });
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
    // Soat ixtiyoriy — bo‘lmasa to‘liq smena oynasi
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

  // Pending takrorini tekshirish
  const existing = await db
    .select({ workDate: javobOlishRequestsTable.workDate })
    .from(javobOlishRequestsTable)
    .where(
      and(
        eq(javobOlishRequestsTable.employeeId, me.id),
        eq(javobOlishRequestsTable.status, "pending"),
        inArray(
          javobOlishRequestsTable.workDate,
          prepared.map((p) => p.workDate),
        ),
      ),
    );
  if (existing.length) {
    res.status(409).json({
      error: `Bu sanalarda allaqachon kutilayotgan so‘rov bor: ${existing.map((e) => e.workDate).join(", ")}`,
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
        status: "pending",
        coordinatorUserId: coordUserId,
      })
      .returning();
    created.push(row);
  }

  const count = created.length;
  const datesTxt = prepared.map((p) => p.workDate).join(", ");
  const notifyText = `${me.fullName}: ${count} ta javob olish so‘rovi (${datesTxt}). Har bir kunni alohida tasdiqlang.`;

  if (coordUserId) {
    await notifyUser({
      userId: coordUserId,
      text: notifyText,
      type: "javob_olish",
      linkUrl: "/javob-olish",
    });
  } else {
    await notifyByRoles({
      roles: ["koordinator", "admin"],
      text: notifyText,
      type: "javob_olish",
      linkUrl: "/javob-olish",
    });
  }

  res.status(201).json({
    ok: true,
    count,
    message: `${count} ta kun uchun javob olish so‘rovi yuborildi.`,
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
  if (row.status !== "pending") {
    res.status(400).json({ error: "Faqat kutilayotgan so‘rovni bekor qilish mumkin" });
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
  status: "approved" | "rejected",
): Promise<void> {
  const role = req.userRole || "";
  if (!(role === "koordinator" || isLead(role))) {
    res.status(403).json({ error: "Faqat koordinator tasdiqlashi / rad etishi mumkin" });
    return;
  }
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
  if (row.status !== "pending") {
    res.status(400).json({ error: "So‘rov allaqachon yopilgan" });
    return;
  }

  if (role === "koordinator") {
    const me = await empByUserId(req.userId!);
    if (me) {
      const scope = await coordinatorScopeEmployeeIds(me.id);
      if (!scope.has(row.employeeId) && row.coordinatorUserId !== req.userId) {
        res.status(403).json({ error: "Bu so‘rov sizning doirangizda emas" });
        return;
      }
    }
  }

  const [updated] = await db
    .update(javobOlishRequestsTable)
    .set({
      status,
      decidedById: req.userId!,
      decidedAt: new Date(),
      decisionNote,
      updatedAt: new Date(),
    })
    .where(eq(javobOlishRequestsTable.id, id))
    .returning();

  if (row.userId) {
    await notifyUser({
      userId: row.userId,
      text:
        status === "approved"
          ? `${row.workDate} kunidagi javob olish so‘rovingiz tasdiqlandi (${row.fromHm}–${row.toHm}).`
          : `${row.workDate} kunidagi javob olish so‘rovingiz rad etildi.${decisionNote ? ` Sabab: ${decisionNote}` : ""}`,
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
}

export default router;
