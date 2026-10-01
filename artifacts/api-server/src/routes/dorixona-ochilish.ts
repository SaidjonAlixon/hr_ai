import { Router, type IRouter } from "express";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import {
  attendanceRecordsTable,
  attendanceShiftSegmentsTable,
  branchOpenLogsTable,
  db,
  employeesTable,
  pool,
  usersTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { branchDedupeKey, dedupeActiveBranches } from "../lib/branch-dedupe";
import { displayBranchName } from "../lib/geo-location";
import { hasFullPlatformAccess, isSbRole } from "../lib/roles";
import { isVacancyPlaceholder } from "../lib/vacancy-slot";

const router: IRouter = Router();

function canSee(role?: string | null) {
  return hasFullPlatformAccess(role) || isSbRole(role);
}

function ymdOk(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeHm(value: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : value;
}

function hmOk(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [h, m] = value.split(":").map(Number);
  return h! >= 0 && h! <= 23 && m! >= 0 && m! <= 59;
}

function prettyPhone(raw: string) {
  const digits = raw.replace(/\D/g, "");
  const n = digits.startsWith("998") ? digits.slice(0, 12) : digits;
  if (n.length === 12 && n.startsWith("998")) {
    return `+${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5, 8)} ${n.slice(8, 10)} ${n.slice(10, 12)}`;
  }
  return raw.trim();
}

function hmTashkent(value: Date | null): string | null {
  if (!value) return null;
  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
  return text === "24:00" ? "00:00" : text;
}

type Punch = { inAt: Date | null; outAt: Date | null };

function summarize(punches: Punch[]) {
  const arrived = punches.filter((item) => item.inAt);
  if (!arrived.length) {
    return { systemOpen: null as string | null, systemClose: null as string | null, openNow: false };
  }
  const first = arrived.reduce((min, item) => (item.inAt! < min ? item.inAt! : min), arrived[0]!.inAt!);
  const still = arrived.some((item) => !item.outAt);
  const left = arrived.filter((item) => item.outAt);
  const last = !still && left.length ? left.reduce((max, item) => (item.outAt! > max ? item.outAt! : max), left[0]!.outAt!) : null;
  return { systemOpen: hmTashkent(first), systemClose: last ? hmTashkent(last) : null, openNow: still };
}

router.get("/davomat/dorixona-ochilishi", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canSee(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va SB" });
    return;
  }
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");
  if (!ymdOk(from) || !ymdOk(to) || from > to) {
    res.status(400).json({ error: "Sana oralig‘i noto‘g‘ri" });
    return;
  }
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
  if (span > 31) {
    res.status(400).json({ error: "Eng ko‘pi 31 kun" });
    return;
  }
  try {
    const managers = await db
      .select({
        id: employeesTable.id,
        fullName: employeesTable.fullName,
        location: employeesTable.location,
        reportsToId: employeesTable.reportsToId,
        employmentStatus: employeesTable.employmentStatus,
        userId: employeesTable.userId,
      })
      .from(employeesTable)
      .where(eq(employeesTable.orgRole, "manager"));
    const active = managers.filter((row) => !isVacancyPlaceholder(row));
    const branches = dedupeActiveBranches(active);
    const keptByKey = new Map(branches.map((row) => [branchDedupeKey(row.location, row.fullName), row.id]));
    const canonId = new Map<number, number>();
    for (const row of active) {
      const kept = keptByKey.get(branchDedupeKey(row.location, row.fullName));
      if (kept) canonId.set(row.id, kept);
    }
    const ids = [...canonId.keys()];
    const coordIds = [...new Set(branches.map((row) => row.reportsToId).filter((id): id is number => Boolean(id)))];
    const coords = coordIds.length
      ? await db
          .select({ id: employeesTable.id, fullName: employeesTable.fullName })
          .from(employeesTable)
          .where(inArray(employeesTable.id, coordIds))
      : [];
    const coordName = new Map(coords.map((row) => [row.id, row.fullName]));
    const segMap = new Map<string, Punch[]>();
    const recMap = new Map<string, Punch[]>();
    const logMap = new Map<string, { sbOpen: string | null; sbClose: string | null; note: string | null; filledBy: string | null }>();
    if (ids.length) {
      const segments = await db
        .select({
          branchId: attendanceShiftSegmentsTable.branchId,
          workDate: attendanceShiftSegmentsTable.workDate,
          checkInAt: attendanceShiftSegmentsTable.checkInAt,
          checkOutAt: attendanceShiftSegmentsTable.checkOutAt,
        })
        .from(attendanceShiftSegmentsTable)
        .where(and(gte(attendanceShiftSegmentsTable.workDate, from), lte(attendanceShiftSegmentsTable.workDate, to), inArray(attendanceShiftSegmentsTable.branchId, ids)));
      for (const row of segments) {
        const canon = row.branchId ? canonId.get(row.branchId) : undefined;
        if (!canon) continue;
        const key = `${canon}|${row.workDate}`;
        const list = segMap.get(key) ?? [];
        list.push({ inAt: row.checkInAt, outAt: row.checkOutAt });
        segMap.set(key, list);
      }
      const records = await db
        .select({
          branchId: attendanceRecordsTable.resolvedBranchId,
          workDate: attendanceRecordsTable.workDate,
          checkInAt: attendanceRecordsTable.checkInAt,
          checkOutAt: attendanceRecordsTable.checkOutAt,
        })
        .from(attendanceRecordsTable)
        .where(and(gte(attendanceRecordsTable.workDate, from), lte(attendanceRecordsTable.workDate, to), inArray(attendanceRecordsTable.resolvedBranchId, ids)));
      for (const row of records) {
        const canon = row.branchId ? canonId.get(row.branchId) : undefined;
        if (!canon) continue;
        const key = `${canon}|${row.workDate}`;
        const list = recMap.get(key) ?? [];
        list.push({ inAt: row.checkInAt, outAt: row.checkOutAt });
        recMap.set(key, list);
      }
      const logs = await db
        .select({
          branchId: branchOpenLogsTable.branchId,
          workDate: branchOpenLogsTable.workDate,
          sbOpenHm: branchOpenLogsTable.sbOpenHm,
          sbCloseHm: branchOpenLogsTable.sbCloseHm,
          note: branchOpenLogsTable.note,
          filledByUserId: branchOpenLogsTable.filledByUserId,
        })
        .from(branchOpenLogsTable)
        .where(and(gte(branchOpenLogsTable.workDate, from), lte(branchOpenLogsTable.workDate, to), inArray(branchOpenLogsTable.branchId, ids)));
      const userIds = [...new Set(logs.map((row) => row.filledByUserId).filter((id): id is number => Boolean(id)))];
      const writers = userIds.length
        ? await db.select({ id: usersTable.id, fullName: usersTable.fullName }).from(usersTable).where(inArray(usersTable.id, userIds))
        : [];
      const writerName = new Map(writers.map((row) => [row.id, row.fullName]));
      for (const row of logs) {
        logMap.set(`${row.branchId}|${row.workDate}`, {
          sbOpen: row.sbOpenHm,
          sbClose: row.sbCloseHm,
          note: row.note,
          filledBy: row.filledByUserId ? writerName.get(row.filledByUserId) || null : null,
        });
      }
    }
    const dates: string[] = [];
    for (let cursor = from; cursor <= to; ) {
      dates.push(cursor);
      const next = new Date(`${cursor}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      cursor = next.toISOString().slice(0, 10);
    }
    const phoneByBranch = new Map<number, string>();
    if (ids.length) {
      const phones = await pool.query<{ branch_employee_id: number; primary_phone: string }>(
        `SELECT branch_employee_id, primary_phone
         FROM branch_contacts
         WHERE branch_employee_id = ANY($1::int[])`,
        [ids],
      );
      for (const row of phones.rows) {
        const canon = canonId.get(row.branch_employee_id);
        const phone = prettyPhone(String(row.primary_phone || ""));
        if (!canon || !phone) continue;
        if (row.branch_employee_id === canon || !phoneByBranch.has(canon)) phoneByBranch.set(canon, phone);
      }
    }
    const items = branches
      .map((row) => ({
        id: row.id,
        name: displayBranchName(row.location) || row.fullName,
        salesPhone: phoneByBranch.get(row.id) || "",
        coordinatorId: row.reportsToId,
        coordinatorName: row.reportsToId ? coordName.get(row.reportsToId) || "—" : "—",
        days: dates.map((date) => {
          const key = `${row.id}|${date}`;
          const punches = segMap.get(key) ?? recMap.get(key) ?? [];
          const system = summarize(punches);
          const log = logMap.get(key);
          return {
            date,
            ...system,
            sbOpen: log?.sbOpen ?? null,
            sbClose: log?.sbClose ?? null,
            note: log?.note ?? null,
            filledBy: log?.filledBy ?? null,
          };
        }),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "uz"));
    const coordinators = [...coordName.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "uz"));
    res.json({ from, to, dates, coordinators, items });
  } catch (err) {
    console.error("GET /davomat/dorixona-ochilishi", err);
    res.status(503).json({ error: "Dorixona ochilishi yuklanmadi" });
  }
});

router.put("/davomat/dorixona-ochilishi", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canSee(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va SB" });
    return;
  }
  const branchId = Number(req.body?.branchId);
  const day = String(req.body?.day || "");
  const sbOpen = normalizeHm(req.body?.sbOpen == null || req.body?.sbOpen === "" ? null : String(req.body.sbOpen));
  const sbClose = normalizeHm(req.body?.sbClose == null || req.body?.sbClose === "" ? null : String(req.body.sbClose));
  const note = req.body?.note == null ? "" : String(req.body.note).trim();
  if (!Number.isFinite(branchId) || branchId <= 0 || !ymdOk(day)) {
    res.status(400).json({ error: "Dorixona va kun kerak" });
    return;
  }
  if ((sbOpen && !hmOk(sbOpen)) || (sbClose && !hmOk(sbClose))) {
    res.status(400).json({ error: "Vaqt HH:mm bo‘lsin" });
    return;
  }
  if ((sbOpen || sbClose) && note.length < 3) {
    res.status(400).json({ error: "Izoh yozing — nima uchun shu vaqt" });
    return;
  }
  try {
    const now = new Date();
    await db
      .insert(branchOpenLogsTable)
      .values({
        branchId,
        workDate: day,
        sbOpenHm: sbOpen,
        sbCloseHm: sbClose,
        note: note || null,
        filledByUserId: req.userId ?? null,
        filledAt: now,
      })
      .onConflictDoUpdate({
        target: [branchOpenLogsTable.branchId, branchOpenLogsTable.workDate],
        set: {
          sbOpenHm: sbOpen,
          sbCloseHm: sbClose,
          note: note || null,
          filledByUserId: req.userId ?? null,
          filledAt: now,
          updatedAt: now,
        },
      });
    res.json({ ok: true });
  } catch (err) {
    console.error("PUT /davomat/dorixona-ochilishi", err);
    res.status(503).json({ error: "Saqlanmadi" });
  }
});

export default router;
