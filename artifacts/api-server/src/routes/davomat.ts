import { Router, type IRouter } from "express";
import { and, eq, gte, lte, inArray, desc } from "drizzle-orm";
import ExcelJS from "exceljs";
import {
  db,
  employeesTable,
  departmentsTable,
  attendanceRecordsTable,
  faceProfilesTable,
  usersTable,
  branchAttendanceQrTable,
  departmentAttendanceQrTable,
  employeeBranchAssignmentsTable,
  employeeDayShiftPlansTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { canViewDavomat } from "../lib/roles";
import {
  matchesDavomatStaffFilter,
  parseDavomatStaffFilter,
  staffFilterLabelUz,
} from "../lib/davomat-staff-filter";
import { forceBroadcastDavomatToAll, davomatBroadcastTelegramReady, davomatBroadcastMessage } from "../jobs/davomat-reminders";
import { evaluateLiveness, matchFaceForAuthWithAi, matchFaceForOwnerWithAi, type LivenessProof } from "../lib/face-match";
import { maybeBackfillFacePhoto } from "./face";
import { displayBranchName, gpsFromLocationField } from "../lib/geo-location";
import { dedupeBranchesWithGps } from "../lib/branch-dedupe";
import {
  computeDayAttendance,
  resolveBranchForDay,
  type BranchAssignment,
  type ShiftKey,
  type ShiftDefinition,
  addDaysYmd,
  DEFAULT_SHIFT_DEFS,
} from "../lib/attendance-engine";
import { setSessionCookie } from "../lib/session";
import {
  hoursForStaff,
  workScheduleForStaff,
  normalizeShiftType,
  encodeShiftKeys,
  shiftEndAt,
  CHECKOUT_GRACE_MS,
} from "../lib/shift-hours";
import { getEffectiveShiftDefs } from "../lib/shift-schedule";
import { resolveAttendanceWorkDate } from "../lib/attendance-workdate";
import { loadStaffFromUsers } from "../lib/staff-directory";
import { buildDavomatAnalytics, type DavomatSegment } from "../lib/davomat-analytics";
import { matchesDepartmentFilter, resolveDepartmentFilter } from "../lib/department-filter";
import {
  encodeQrPayload,
  getActiveQrForBranch,
  mintQrSecrets,
  revokeActiveQrForBranch,
  verifyBranchQrPayload,
} from "../lib/branch-attendance-qr";
import {
  getActiveQrForDepartment,
  revokeActiveQrForDepartment,
  verifyDepartmentQrPayload,
} from "../lib/department-attendance-qr";
import { isDeptHeadRole } from "../lib/dept-staff";
import { clientIp, writePunchAudit } from "../lib/punch-audit";

const router: IRouter = Router();

const WORK_START = "09:00";
const WORK_END = "18:00";
const TZ_OFFSET = "+05:00"; // Asia/Tashkent
/** Filial davomati Face ID radius (metr) — barcha xodimlar / farmasevtlar */
export const DAVOMAT_GEOFENCE_METERS = 70;
/** Asosiy ofis — yashil zona 100 m */
export const DAVOMAT_OFFICE_GEOFENCE_METERS = 100;
/** Belgilangan ish joyi: 41°13'09.3"N 69°16'22.9"E */
export const DAVOMAT_SITE_LAT = 41 + 13 / 60 + 9.3 / 3600; // 41.21925
export const DAVOMAT_SITE_LNG = 69 + 16 / 60 + 22.9 / 3600; // ≈ 69.273028
export const DAVOMAT_SITE_LABEL = "41°13'09.3\"N 69°16'22.9\"E";
const FACE_DESCRIPTOR_LEN = 128;

function geofenceMetersForKind(kind: "branch" | "office"): number {
  return kind === "office" ? DAVOMAT_OFFICE_GEOFENCE_METERS : DAVOMAT_GEOFENCE_METERS;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function parseFaceDescriptor(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length !== FACE_DESCRIPTOR_LEN) return null;
  const out: number[] = [];
  for (const n of raw) {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    out.push(n);
  }
  return out;
}

function isPgUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

function requireDavomat(req: AuthRequest, res: { status: (n: number) => { json: (b: unknown) => void } }): boolean {
  if (!canViewDavomat(req.userRole)) {
    res.status(403).json({ error: "Davomat faqat Direktor / HR Direktor / HR Menejer uchun" });
    return false;
  }
  return true;
}

function todayTashkent(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + delta));
  return dt.toISOString().slice(0, 10);
}

function eachDateInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
    guard += 1;
  }
  return out;
}

function parseHm(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(":").map(Number);
  return { h: h ?? 0, m: m ?? 0 };
}

/** YYYY-MM-DD + HH:mm → Date in Tashkent */
function atTashkent(ymd: string, hm: string): Date {
  const { h, m } = parseHm(hm);
  const pad = (n: number) => String(n).padStart(2, "0");
  return new Date(`${ymd}T${pad(h)}:${pad(m)}:00${TZ_OFFSET}`);
}

function formatHm(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

function fmtHours(mins: number): string {
  if (!Number.isFinite(mins) || mins <= 0) return "0:00";
  const h = Math.floor(mins / 60);
  const m = Math.abs(mins % 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function fmtSignedMin(mins: number): string {
  if (!mins) return "0 daq";
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const body = h > 0 ? `${h} soat ${m} daq` : `${m} daq`;
  return mins < 0 ? `−${body}` : body;
}

type Metrics = {
  status: string;
  checkIn: string;
  checkOut: string;
  workedMinutes: number;
  workedHours: string;
  earlyArrivalMin: number;
  lateArrivalMin: number;
  earlyLeaveMin: number;
  overtimeMin: number;
  earlyArrivalLabel: string;
  lateArrivalLabel: string;
  earlyLeaveLabel: string;
  overtimeLabel: string;
};

function computeMetrics(
  workDate: string,
  checkInAt: Date | null | undefined,
  checkOutAt: Date | null | undefined,
  forcedStatus?: string | null,
  hours?: {
    start: string;
    end: string;
    graceMinutes?: number;
    overnight?: boolean;
    shiftKey?: string;
    shiftKeys?: string[];
  },
): Metrics & {
  paidWorkedMinutes?: number;
  unpaidBreakMinutes?: number;
  nightMinutes?: number;
  missingCheckout?: boolean;
  missingCheckoutLabel?: string;
} {
  const shiftKeysRaw =
    Array.isArray(hours?.shiftKeys) && hours!.shiftKeys!.length
      ? hours!.shiftKeys!
      : [hours?.shiftKey || "one"];
  const shiftKeys = shiftKeysRaw
    .map((k) => String(k))
    .filter((k): k is ShiftKey => k === "one" || k === "two" || k === "three" || k === "office");
  const keys = shiftKeys.length ? shiftKeys : (["one"] as ShiftKey[]);
  const primaryKey = keys[0];
  // Bitta punch (Keldim/Ketdim) — combo smenada ertalab birinchi smena, ketish oxirgi smena
  const engine = computeDayAttendance({
    workDate,
    shiftKeys: keys,
    segments: [{ shiftKey: primaryKey, checkInAt: checkInAt ?? null, checkOutAt: checkOutAt ?? null }],
  });

  // Legacy path: OT / erta ketish — to‘liq combo oynasi (1+2 → 08:00…23:45)
  const start = atTashkent(workDate, hours?.start ?? WORK_START);
  let end = atTashkent(
    hours?.overnight ? addDaysYmd(workDate, 1) : workDate,
    hours?.end ?? WORK_END,
  );
  if (end.getTime() <= start.getTime()) {
    end = atTashkent(addDaysYmd(workDate, 1), hours?.end ?? WORK_END);
  }
  let earlyArrivalMin = engine.earlyArrivalMin;
  let lateArrivalMin = engine.lateArrivalMin;
  let earlyLeaveMin = engine.earlyLeaveMin;
  let overtimeMin = engine.overtimeMin;
  let workedMinutes = engine.rawWorkedMinutes;
  let status = forcedStatus || engine.status;

  // Combo: engine bitta segmentni birinchi smena oxiriga solishtiradi — oxirgi smena tugashiga qayta hisoblaymiz
  if (checkInAt) {
    const inDiff = minutesBetween(start, checkInAt);
    if (inDiff < 0) earlyArrivalMin = -inDiff;
    else if (inDiff > 0) lateArrivalMin = inDiff;
    else {
      earlyArrivalMin = 0;
      lateArrivalMin = 0;
    }
  }
  if (checkInAt && checkOutAt && !engine.missingCheckout) {
    const outDiff = minutesBetween(end, checkOutAt);
    if (outDiff < 0) earlyLeaveMin = -outDiff;
    else if (outDiff > 0) overtimeMin = outDiff;
    else {
      earlyLeaveMin = 0;
      overtimeMin = Math.max(0, overtimeMin);
    }
  }

  if (forcedStatus === "leave" || forcedStatus === "absent") {
    status = forcedStatus;
  } else if (engine.missingCheckout) {
    status = "incomplete";
    workedMinutes = 0;
  } else if (checkInAt) {
    const grace = hours?.graceMinutes ?? 15;
    status = lateArrivalMin > grace ? "late" : "present";
  }

  if (engine.missingCheckout) {
    workedMinutes = 0;
  }

  return {
    status,
    checkIn: formatHm(checkInAt ?? null),
    checkOut: formatHm(checkOutAt ?? null),
    workedMinutes,
    workedHours: fmtHours(workedMinutes),
    earlyArrivalMin,
    lateArrivalMin,
    earlyLeaveMin,
    overtimeMin,
    earlyArrivalLabel: earlyArrivalMin ? fmtSignedMin(earlyArrivalMin) : "—",
    lateArrivalLabel: lateArrivalMin ? fmtSignedMin(lateArrivalMin) : "—",
    earlyLeaveLabel: earlyLeaveMin ? fmtSignedMin(earlyLeaveMin) : "—",
    overtimeLabel: overtimeMin ? fmtSignedMin(overtimeMin) : "—",
    paidWorkedMinutes: engine.paidWorkedMinutes,
    unpaidBreakMinutes: engine.unpaidBreakMinutes,
    nightMinutes: engine.nightMinutes,
    missingCheckout: engine.missingCheckout,
    missingCheckoutLabel: engine.missingCheckout ? "Check-out mavjud emas" : undefined,
  };
}

/** Excel va eksport uchun kunlik katak matni — aniq, qisqartmasiz. */
function readableWorkedHours(h: string): string {
  if (!h || h === "—" || h === "0:00") return "0 daqiqa";
  const [hh, mm] = h.split(":").map((x) => Number(x) || 0);
  if (hh > 0 && mm > 0) return `${hh} soat ${mm} daqiqa`;
  if (hh > 0) return `${hh} soat`;
  return `${mm} daqiqa`;
}

function minusDuration(label: string): string {
  if (!label || label === "—") return "—";
  const trimmed = label.trim();
  if (trimmed.startsWith("−") || trimmed.startsWith("-")) return trimmed;
  return `−${trimmed}`;
}

function kechikishDisplay(d: DayCellMetrics): string {
  if (d.lateArrivalLabel && d.lateArrivalLabel !== "—") {
    return minusDuration(d.lateArrivalLabel);
  }
  return "Yo'q";
}

function davomatStatusLine(status: string): string {
  if (status === "late") return "Kechikib keldi";
  if (status === "incomplete") return "Keldi, ketish yozilmagan";
  if (status === "present") return "O'z vaqtida keldi";
  if (status === "leave") return "Ta'tilda";
  return "Kelmagan";
}

type DayCellMetrics = {
  status: string;
  checkIn: string;
  checkOut: string;
  workedHours: string;
  lateArrivalLabel: string;
  earlyArrivalLabel: string;
  earlyLeaveLabel: string;
  overtimeLabel: string;
};

/** Har katakda: keldi, ketdi, kechikish, ishlagan — doim ko‘rinadi */
function applyDavomatDayCell(
  cell: ExcelJS.Cell,
  d: DayCellMetrics | null | undefined,
  hours: { start: string; end: string },
  statusFont: Record<string, string>,
  statusFill: Record<string, string>,
): void {
  const baseFont = { name: "Calibri", size: 9 };
  const border = {
    top: { style: "thin" as const, color: { argb: "FFE2E8F0" } },
    left: { style: "thin" as const, color: { argb: "FFE2E8F0" } },
    bottom: { style: "thin" as const, color: { argb: "FFE2E8F0" } },
    right: { style: "thin" as const, color: { argb: "FFE2E8F0" } },
  };

  const status = d?.status || "absent";
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: statusFill[status] || "FFF8FAFC" },
  };
  cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true, indent: 1 };
  cell.border = border;

  if (!d || status === "absent") {
    cell.value = "Kelmagan\nKeldi: —\nKetdi: —\nKechikish: —\nIshlangan: —";
    cell.font = { ...baseFont, color: { argb: statusFont.absent || "FF94A3B8" } };
    return;
  }
  if (status === "leave") {
    cell.value = "Ta'tilda\nKeldi: —\nKetdi: —\nKechikish: —\nIshlangan: —";
    cell.font = { ...baseFont, color: { argb: statusFont.leave || "FF6D28D9" } };
    return;
  }

  const cin = d.checkIn && d.checkIn !== "—" ? d.checkIn : "—";
  const cout = d.checkOut && d.checkOut !== "—" ? d.checkOut : "—";
  const worked = readableWorkedHours(d.workedHours);
  const kech = kechikishDisplay(d);
  const hasLate = kech !== "Yo'q";

  const rich: ExcelJS.RichText[] = [
    {
      text: `${davomatStatusLine(status)}\n`,
      font: { ...baseFont, bold: true, color: { argb: statusFont[status] || "FF0F172A" } },
    },
    { text: `Keldi: ${cin} (reja ${hours.start})\n`, font: { ...baseFont, color: { argb: "FF0F172A" } } },
    { text: `Ketdi: ${cout} (reja ${hours.end})\n`, font: { ...baseFont, color: { argb: "FF0F172A" } } },
    { text: "Kechikish: ", font: { ...baseFont, color: { argb: "FF0F172A" } } },
    {
      text: `${kech}\n`,
      font: {
        ...baseFont,
        bold: hasLate,
        color: { argb: hasLate ? "FFB91C1C" : "FF64748B" },
      },
    },
    {
      text: `Ishlangan: ${worked}`,
      font: { ...baseFont, bold: true, color: { argb: "FF0F172A" } },
    },
  ];

  if (d.earlyLeaveLabel && d.earlyLeaveLabel !== "—") {
    rich.push({
      text: `\nErta ketish: ${minusDuration(d.earlyLeaveLabel)}`,
      font: { ...baseFont, color: { argb: "FFB45309" } },
    });
  }
  if (d.overtimeLabel && d.overtimeLabel !== "—") {
    rich.push({
      text: `\nQo'shimcha ish: +${d.overtimeLabel.replace(/^−|^-/u, "")}`,
      font: { ...baseFont, bold: true, color: { argb: "FF047857" } },
    });
  }

  cell.value = { richText: rich };
}

const EXTERNAL_USER_ROLES = new Set(["revizor", "reviziya_rahbar", "texnik", "texnik_rahbar"]);

function smenaLabelForEmployee(e: {
  userRole?: string | null;
  orgRole?: string | null;
  shiftType?: string | null;
  shiftLabel?: string | null;
}): string {
  if (EXTERNAL_USER_ROLES.has(e.userRole || "")) return "Tashqi xodimlar";
  const w = workScheduleForStaff(e.userRole, e.orgRole, e.shiftType, e.shiftLabel);
  if (w.key === "office") return "Asosiy ofis";
  return `${w.label}da ishlaydiganlar`;
}

async function loadActiveEmployees(filters: {
  departmentId?: string;
  location?: string;
  search?: string;
  employeeId?: string;
}) {
  const staff = await loadStaffFromUsers("active");
  const deptIds = [...new Set(staff.map((s) => s.departmentId))];
  const depts =
    deptIds.length > 0
      ? await db
          .select({ id: departmentsTable.id, name: departmentsTable.name })
          .from(departmentsTable)
          .where(inArray(departmentsTable.id, deptIds))
      : [];
  const deptMap = new Map(depts.map((d) => [d.id, d.name]));

  const rows = staff.map((s) => ({
    id: s.id,
    fullName: s.fullName,
    position: s.position,
    departmentId: s.departmentId,
    departmentName: deptMap.get(s.departmentId) ?? null,
    location: s.location,
    employmentStatus: s.employmentStatus,
    userId: s.userId,
    userRole: s.userRole,
    orgRole: s.orgRole || orgRoleFromUserRole(s.userRole || "") || null,
    shiftType: s.shiftType,
    shiftLabel: s.shiftLabel,
    phone: s.phone ?? null,
  }));

  const departmentFilter = filters.departmentId
    ? await resolveDepartmentFilter(filters.departmentId)
    : null;

  return rows.filter((e) => {
    if (filters.employeeId && e.id !== Number(filters.employeeId)) return false;
    if (departmentFilter) {
      if (!matchesDepartmentFilter(e, departmentFilter)) return false;
    } else if (filters.departmentId && e.departmentId !== Number(filters.departmentId)) {
      return false;
    }
    if (filters.location && (e.location || "") !== filters.location) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const hay = [e.fullName, e.position, e.departmentName, e.location].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

async function loadRecords(from: string, to: string, employeeIds: number[]) {
  if (!employeeIds.length) return [];
  return db
    .select()
    .from(attendanceRecordsTable)
    .where(
      and(
        gte(attendanceRecordsTable.workDate, from),
        lte(attendanceRecordsTable.workDate, to),
        inArray(attendanceRecordsTable.employeeId, employeeIds),
      ),
    );
}

function buildReport(
  employees: Awaited<ReturnType<typeof loadActiveEmployees>>,
  records: Awaited<ReturnType<typeof loadRecords>>,
  from: string,
  to: string,
  defs: Record<ShiftKey, ShiftDefinition> = DEFAULT_SHIFT_DEFS,
) {
  const dates = eachDateInclusive(from, to);
  const byEmpDate = new Map<string, (typeof records)[0]>();
  for (const r of records) {
    byEmpDate.set(`${r.employeeId}|${r.workDate}`, r);
  }
  const staffHours = (e: (typeof employees)[0]) =>
    hoursForStaff(e.orgRole, e.shiftType, e.userRole, e.shiftLabel, defs);

  const dayStats = dates.map((date) => {
    let present = 0;
    let late = 0;
    let incomplete = 0;
    let leave = 0;
    let absent = 0;
    const presentList: string[] = [];
    const absentList: string[] = [];
    const lateList: string[] = [];
    const farFromOffice: Array<{
      employeeId: number;
      fullName: string;
      position: string | null;
      departmentName: string | null;
      checkIn: string | null;
      officeDistanceMeters: number;
    }> = [];

    for (const e of employees) {
      const rec = byEmpDate.get(`${e.id}|${date}`);
      if (
        rec?.checkLatitude != null &&
        rec?.checkLongitude != null &&
        Number.isFinite(rec.checkLatitude) &&
        Number.isFinite(rec.checkLongitude)
      ) {
        const officeM = haversineMeters(
          rec.checkLatitude,
          rec.checkLongitude,
          DAVOMAT_SITE_LAT,
          DAVOMAT_SITE_LNG,
        );
        if (officeM > 1000) {
          farFromOffice.push({
            employeeId: e.id,
            fullName: e.fullName,
            position: e.position ?? null,
            departmentName: e.departmentName ?? null,
            checkIn: rec.checkInAt ? formatHm(rec.checkInAt as Date) : null,
            officeDistanceMeters: officeM,
          });
        }
      }
      if (!rec || (!rec.checkInAt && rec.status === "absent")) {
        absent += 1;
        absentList.push(e.fullName);
        continue;
      }
      if (rec.status === "leave") {
        leave += 1;
        continue;
      }
      const m = computeMetrics(date, rec.checkInAt, rec.checkOutAt, rec.status, staffHours(e));
      if (m.status === "late") {
        late += 1;
        lateList.push(e.fullName);
        present += 1;
        presentList.push(e.fullName);
      } else if (m.status === "incomplete") {
        incomplete += 1;
        present += 1;
        presentList.push(e.fullName);
      } else if (m.status === "absent") {
        absent += 1;
        absentList.push(e.fullName);
      } else {
        present += 1;
        presentList.push(e.fullName);
      }
    }
    return {
      date,
      present,
      late,
      incomplete,
      leave,
      absent,
      presentList,
      absentList,
      lateList,
      farFromOffice,
    };
  });

  const employeeRows = employees
    .map((e) => {
      const days = dates.map((date) => {
        const rec = byEmpDate.get(`${e.id}|${date}`);
        if (!rec || (!rec.checkInAt && (rec.status === "absent" || !rec.status))) {
          return {
            date,
            status: "absent" as const,
            checkIn: "—",
            checkOut: "—",
            workedMinutes: 0,
            workedHours: "0:00",
            earlyArrivalMin: 0,
            lateArrivalMin: 0,
            earlyLeaveMin: 0,
            overtimeMin: 0,
            earlyArrivalLabel: "—",
            lateArrivalLabel: "—",
            earlyLeaveLabel: "—",
            overtimeLabel: "—",
            source: null as string | null,
            notes: null as string | null,
            recordId: null as number | null,
          };
        }
        if (rec.status === "leave") {
          return {
            date,
            status: "leave" as const,
            checkIn: "—",
            checkOut: "—",
            workedMinutes: 0,
            workedHours: "0:00",
            earlyArrivalMin: 0,
            lateArrivalMin: 0,
            earlyLeaveMin: 0,
            overtimeMin: 0,
            earlyArrivalLabel: "—",
            lateArrivalLabel: "—",
            earlyLeaveLabel: "—",
            overtimeLabel: "—",
            source: rec.source,
            notes: rec.notes,
            recordId: rec.id,
          };
        }
        const m = computeMetrics(date, rec.checkInAt, rec.checkOutAt, rec.status, staffHours(e));
        return {
          date,
          ...m,
          source: rec.source,
          notes: rec.notes,
          recordId: rec.id,
        };
      });

      const totals = days.reduce(
        (acc, d) => {
          if (d.status === "absent") acc.absent += 1;
          else if (d.status === "leave") acc.leave += 1;
          else {
            acc.present += 1;
            if (d.status === "late") acc.late += 1;
            if (d.status === "incomplete") acc.incomplete += 1;
          }
          acc.workedMinutes += d.workedMinutes;
          acc.lateArrivalMin += d.lateArrivalMin;
          acc.earlyArrivalMin += d.earlyArrivalMin;
          acc.earlyLeaveMin += d.earlyLeaveMin;
          acc.overtimeMin += d.overtimeMin;
          return acc;
        },
        {
          present: 0,
          absent: 0,
          late: 0,
          incomplete: 0,
          leave: 0,
          workedMinutes: 0,
          lateArrivalMin: 0,
          earlyArrivalMin: 0,
          earlyLeaveMin: 0,
          overtimeMin: 0,
        },
      );

      return {
        id: e.id,
        fullName: e.fullName,
        position: e.position,
        departmentId: e.departmentId,
        departmentName: e.departmentName,
        location: e.location,
        orgRole: e.orgRole,
        userRole: e.userRole,
        phone: e.phone ?? null,
        shiftType: normalizeShiftType(e.shiftType, e.shiftLabel),
        shiftLabel: e.shiftLabel,
        ...(() => {
          const h = staffHours(e);
          return { workStart: h.start, workEnd: h.end };
        })(),
        days,
        totals: {
          ...totals,
          workedHours: fmtHours(totals.workedMinutes),
          lateArrivalLabel: totals.lateArrivalMin ? fmtSignedMin(totals.lateArrivalMin) : "—",
          earlyArrivalLabel: totals.earlyArrivalMin ? fmtSignedMin(totals.earlyArrivalMin) : "—",
          earlyLeaveLabel: totals.earlyLeaveMin ? fmtSignedMin(totals.earlyLeaveMin) : "—",
          overtimeLabel: totals.overtimeMin ? fmtSignedMin(totals.overtimeMin) : "—",
        },
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "uz"));

  const summary = {
    employees: employees.length,
    days: dates.length,
    presentPersonDays: employeeRows.reduce((s, e) => s + e.totals.present, 0),
    absentPersonDays: employeeRows.reduce((s, e) => s + e.totals.absent, 0),
    latePersonDays: employeeRows.reduce((s, e) => s + e.totals.late, 0),
    totalWorkedHours: fmtHours(employeeRows.reduce((s, e) => s + e.totals.workedMinutes, 0)),
    totalLateMinutes: employeeRows.reduce((s, e) => s + e.totals.lateArrivalMin, 0),
    totalLateLabel: fmtSignedMin(
      employeeRows.reduce((s, e) => s + e.totals.lateArrivalMin, 0),
    ),
  };

  return {
    workStart: defs.office.startHm,
    workEnd: defs.office.endHm,
    from,
    to,
    dates,
    summary,
    days: dayStats,
    employees: employeeRows,
  };
}

router.get("/davomat", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireDavomat(req, res)) return;
  try {
    const q = req.query as Record<string, string>;
    const to = q.to || todayTashkent();
    const from = q.from || addDays(to, -13);
    const employees = await loadActiveEmployees({
      departmentId: q.departmentId,
      location: q.location,
      search: q.search,
      employeeId: q.employeeId,
    });
    const records = await loadRecords(
      from,
      to,
      employees.map((e) => e.id),
    );
    const defs = await getEffectiveShiftDefs();
    res.json(buildReport(employees, records, from, to, defs));
  } catch (err) {
    console.error("GET /davomat error:", err);
    res.status(503).json({ error: "Davomat yuklanmadi" });
  }
});

router.get("/davomat/analytics", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireDavomat(req, res)) return;
  try {
    const q = req.query as Record<string, string>;
    const to = q.to || todayTashkent();
    const from = q.from || addDays(to, -29);
    const segment = (q.segment === "office" || q.segment === "pharmacy" ? q.segment : "all") as DavomatSegment;
    const employees = await loadActiveEmployees({});
    const employeeIds = employees.map((e) => e.id);
    const records = await loadRecords(from, to, employeeIds);
    const defs = await getEffectiveShiftDefs();
    const report = buildReport(employees, records, from, to, defs);

    const span = eachDateInclusive(from, to).length;
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(span - 1));
    const prevRecords = await loadRecords(prevFrom, prevTo, employeeIds);
    const prevReport = buildReport(employees, prevRecords, prevFrom, prevTo, defs);

    const meta = employees.map((e) => ({
      id: e.id,
      userRole: e.userRole ?? null,
      orgRole: e.orgRole ?? null,
      shiftType: e.shiftType ?? null,
    }));

    res.json(buildDavomatAnalytics(report, meta, segment, prevReport));
  } catch (err) {
    console.error("GET /davomat/analytics error:", err);
    res.status(503).json({ error: "Davomat analitikasi yuklanmadi" });
  }
});

async function ownEmployeeReport(empId: number) {
  const to = todayTashkent();
  const from = addDays(to, -89);
  const employees = await loadActiveEmployees({ employeeId: String(empId) });
  const records = await loadRecords(from, to, [empId]);
  const defs = await getEffectiveShiftDefs();
  const report = buildReport(employees, records, from, to, defs);
  return {
    from,
    to,
    employee: report.employees[0] ?? null,
  };
}

/** Bugungi kun: kelgan / kelmagan */
router.get("/davomat/today", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireDavomat(req, res)) return;
  try {
    const date = (req.query as { date?: string }).date || todayTashkent();
    const employees = await loadActiveEmployees({});
    const records = await loadRecords(date, date, employees.map((e) => e.id));
    const defs = await getEffectiveShiftDefs();
    const report = buildReport(employees, records, date, date, defs);
    const day = report.days[0];
    res.json({
      date,
      workStart: defs.office.startHm,
      workEnd: defs.office.endHm,
      ...day,
      employees: report.employees.map((e) => ({
        id: e.id,
        fullName: e.fullName,
        position: e.position,
        departmentName: e.departmentName,
        location: e.location,
        day: e.days[0],
      })),
    });
  } catch (err) {
    console.error("GET /davomat/today error:", err);
    res.status(503).json({ error: "Bugungi davomat yuklanmadi" });
  }
});

/** HR: qo‘lda kelish/ketish yozish yoki tahrirlash */
router.post("/davomat/manual", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireDavomat(req, res)) return;
  try {
    const {
      employeeId,
      workDate,
      checkIn,
      checkOut,
      status,
      notes,
    } = req.body as {
      employeeId?: number;
      workDate?: string;
      checkIn?: string | null;
      checkOut?: string | null;
      status?: string;
      notes?: string;
    };

    if (!employeeId || !workDate || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
      res.status(400).json({ error: "employeeId va workDate (YYYY-MM-DD) majburiy" });
      return;
    }

    const [emp] = await db
      .select({
        id: employeesTable.id,
        userId: employeesTable.userId,
        orgRole: employeesTable.orgRole,
        shiftType: employeesTable.shiftType,
        shiftLabel: employeesTable.shiftLabel,
        userRole: usersTable.role,
      })
      .from(employeesTable)
      .leftJoin(usersTable, eq(employeesTable.userId, usersTable.id))
      .where(eq(employeesTable.id, employeeId))
      .limit(1);
    if (!emp) {
      res.status(404).json({ error: "Xodim topilmadi" });
      return;
    }

    const checkInAt =
      checkIn && /^\d{1,2}:\d{2}$/.test(checkIn) ? atTashkent(workDate, checkIn) : null;
    const checkOutAt =
      checkOut && /^\d{1,2}:\d{2}$/.test(checkOut) ? atTashkent(workDate, checkOut) : null;

    const hours = hoursForStaff(emp.orgRole, emp.shiftType, emp.userRole, emp.shiftLabel, await getEffectiveShiftDefs());

    let nextStatus = status || "absent";
    if (!status || status === "auto") {
      nextStatus = computeMetrics(workDate, checkInAt, checkOutAt, undefined, hours).status;
      if (!checkInAt && !checkOutAt) nextStatus = "absent";
    }

    const [existing] = await db
      .select({ id: attendanceRecordsTable.id })
      .from(attendanceRecordsTable)
      .where(
        and(
          eq(attendanceRecordsTable.employeeId, employeeId),
          eq(attendanceRecordsTable.workDate, workDate),
        ),
      )
      .limit(1);

    const payload = {
      employeeId,
      userId: emp.userId,
      workDate,
      checkInAt,
      checkOutAt,
      status: nextStatus,
      source: "manual" as const,
      notes: notes || null,
      createdById: req.userId!,
      updatedAt: new Date(),
    };

    if (existing) {
      await db
        .update(attendanceRecordsTable)
        .set(payload)
        .where(eq(attendanceRecordsTable.id, existing.id));
    } else {
      await db.insert(attendanceRecordsTable).values(payload);
    }

    const metrics = computeMetrics(workDate, checkInAt, checkOutAt, nextStatus, hours);
    res.json({ ok: true, workDate, employeeId, ...metrics });
  } catch (err) {
    console.error("POST /davomat/manual error:", err);
    res.status(503).json({ error: "Saqlanmadi" });
  }
});

/** Xodim o‘zi: kelish / ketish — faqat Face ID + geozona orqali */
router.post("/davomat/punch", requireAuth, async (_req: AuthRequest, res): Promise<void> => {
  res.status(400).json({
    error: `Oddiy punch o‘chirilgan. Davomat faqat Face ID + ish joyi (${DAVOMAT_GEOFENCE_METERS} m) orqali.`,
    code: "use_face_punch",
  });
});

type WorkplaceEmp = {
  id: number;
  userId: number | null;
  fullName: string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  orgRole: string | null;
  reportsToId: number | null;
  assignedBranchId: number | null;
  shiftType: string | null;
  shiftLabel: string | null;
};

const BRANCH_USER_ROLES = new Set(["mudir", "farmasevt", "stajyor"]);
const BRANCH_ORG_ROLES = new Set(["manager", "pharmacist", "intern"]);

function usesBranchDavomat(userRole: string, orgRole: string | null | undefined) {
  return BRANCH_USER_ROLES.has(userRole) || BRANCH_ORG_ROLES.has(orgRole || "");
}

function orgRoleFromUserRole(role: string): string | null {
  if (role === "mudir") return "manager";
  if (role === "farmasevt") return "pharmacist";
  if (role === "stajyor") return "intern";
  if (role === "koordinator") return "coordinator";
  return null;
}

type DavomatPoint = {
  latitude: number;
  longitude: number;
  label: string;
  kind: "branch" | "office";
};

function coordsFromEmp(row: {
  latitude: number | null;
  longitude: number | null;
  location: string | null;
}): { lat: number; lng: number } | null {
  if (
    row.latitude != null &&
    row.longitude != null &&
    Number.isFinite(row.latitude) &&
    Number.isFinite(row.longitude)
  ) {
    return { lat: row.latitude, lng: row.longitude };
  }
  return gpsFromLocationField(row.location);
}

async function resolveDavomatPoint(emp: WorkplaceEmp, userRole: string): Promise<
  | { ok: true; point: DavomatPoint }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  if (!usesBranchDavomat(userRole, emp.orgRole)) {
    return {
      ok: true,
      point: {
        latitude: DAVOMAT_SITE_LAT,
        longitude: DAVOMAT_SITE_LNG,
        label: `Asosiy ofis · ${DAVOMAT_SITE_LABEL}`,
        kind: "office",
      },
    };
  }

  let latLng = coordsFromEmp(emp);
  let label = displayBranchName(emp.location) || emp.location || emp.fullName;

  const effective = await effectiveBranchIdForDay(emp);
  const branchId = effective.branchId;
  if (effective.branchLabel) label = effective.branchLabel;

  if (branchId) {
    const [mgr] = await db
      .select({
        latitude: employeesTable.latitude,
        longitude: employeesTable.longitude,
        location: employeesTable.location,
        fullName: employeesTable.fullName,
      })
      .from(employeesTable)
      .where(eq(employeesTable.id, branchId))
      .limit(1);
    if (mgr) {
      const fromMgr = coordsFromEmp(mgr);
      if (fromMgr) latLng = fromMgr;
      label = displayBranchName(mgr.location) || mgr.location || mgr.fullName || label;
    }
  }

  if (!latLng) {
    return {
      ok: false,
      status: 403,
      body: {
        error:
          "Filial lokatsiyasi kiritilmagan. Koordinator avval shu filial GPS ni kiritsin, keyin davomat qilasiz.",
        code: "branch_gps_missing",
        fullName: emp.fullName,
      },
    };
  }

  return {
    ok: true,
    point: {
      latitude: latLng.lat,
      longitude: latLng.lng,
      label: label || "Filial",
      kind: "branch",
    },
  };
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[‘’ʻʼ'`]/g, "'")
    .trim();
}

const ROLE_POSITION: Record<string, string> = {
  admin: "Admin",
  director: "Direktor",
  hr: "HR",
  hr_direktor: "HR Direktor",
  hr_kadr_rahbar: "HR kadr b/m",
  hr_menejer: "HR Menejer",
  hr_auditor: "HR Auditor",
  recruiter: "Rekruter",
  trainer: "Trener",
  mentor: "Mentor",
  department_head: "Bo‘lim boshlig‘i",
  mudir: "Mudir",
  koordinator: "Koordinator",
  texnik: "Texnik",
  ombor: "Ombor",
  farmasevt: "Farmasevt",
  stajyor: "Stajyor",
};

async function findEmployeeByUserId(userId: number): Promise<WorkplaceEmp | null> {
  const [emp] = await db
    .select({
      id: employeesTable.id,
      userId: employeesTable.userId,
      fullName: employeesTable.fullName,
      location: employeesTable.location,
      latitude: employeesTable.latitude,
      longitude: employeesTable.longitude,
      orgRole: employeesTable.orgRole,
      reportsToId: employeesTable.reportsToId,
      assignedBranchId: employeesTable.assignedBranchId,
      shiftType: employeesTable.shiftType,
      shiftLabel: employeesTable.shiftLabel,
    })
    .from(employeesTable)
    .where(eq(employeesTable.userId, userId))
    .limit(1);
  return emp ?? null;
}

/**
 * Davomat majburiy: har bir faol user uchun employees yozuvi bo‘lishi shart.
 * — userId bo‘yicha topadi
 * — yoki F.I.Sh. mos kelgan xodimni bog‘laydi
 * — yo‘q bo‘lsa avtomatik yaratadi
 */
async function ensureEmployeeForUser(user: {
  id: number;
  fullName: string;
  role: string;
  departmentId: number | null;
}): Promise<WorkplaceEmp> {
  const existing = await findEmployeeByUserId(user.id);
  if (existing) return existing;

  const all = await db
    .select({
      id: employeesTable.id,
      userId: employeesTable.userId,
      fullName: employeesTable.fullName,
      location: employeesTable.location,
      latitude: employeesTable.latitude,
      longitude: employeesTable.longitude,
      orgRole: employeesTable.orgRole,
      reportsToId: employeesTable.reportsToId,
      assignedBranchId: employeesTable.assignedBranchId,
      shiftType: employeesTable.shiftType,
      shiftLabel: employeesTable.shiftLabel,
      employmentStatus: employeesTable.employmentStatus,
    })
    .from(employeesTable);

  const target = normalizeName(user.fullName);
  const byName = all.find(
    (e) =>
      normalizeName(e.fullName) === target &&
      (e.userId == null || e.userId === user.id) &&
      (e.employmentStatus || "working") !== "dismissed",
  );

  if (byName) {
    const orgRole = byName.orgRole || orgRoleFromUserRole(user.role);
    await db
      .update(employeesTable)
      .set({
        userId: user.id,
        ...(orgRole && !byName.orgRole ? { orgRole } : {}),
        updatedAt: new Date(),
      })
      .where(eq(employeesTable.id, byName.id));
    return {
      id: byName.id,
      userId: user.id,
      fullName: byName.fullName,
      location: byName.location,
      latitude: byName.latitude,
      longitude: byName.longitude,
      orgRole: orgRole,
      reportsToId: byName.reportsToId,
      assignedBranchId: byName.assignedBranchId,
      shiftType: byName.shiftType,
      shiftLabel: byName.shiftLabel,
    };
  }

  let departmentId = user.departmentId;
  if (!departmentId) {
    const [anyDept] = await db
      .select({ id: departmentsTable.id })
      .from(departmentsTable)
      .limit(1);
    departmentId = anyDept?.id ?? 1;
  }

  const orgRole = orgRoleFromUserRole(user.role);
  const branchStaff = usesBranchDavomat(user.role, orgRole);
  const [created] = await db
    .insert(employeesTable)
    .values({
      fullName: user.fullName,
      position: ROLE_POSITION[user.role] || user.role || "Xodim",
      departmentId,
      hiredAt: todayTashkent(),
      userId: user.id,
      employmentStatus: "working",
      orgRole,
      location: branchStaff ? null : DAVOMAT_SITE_LABEL,
      latitude: branchStaff ? null : DAVOMAT_SITE_LAT,
      longitude: branchStaff ? null : DAVOMAT_SITE_LNG,
      shiftType: "one",
    })
    .returning({
      id: employeesTable.id,
      userId: employeesTable.userId,
      fullName: employeesTable.fullName,
      location: employeesTable.location,
      latitude: employeesTable.latitude,
      longitude: employeesTable.longitude,
      orgRole: employeesTable.orgRole,
      reportsToId: employeesTable.reportsToId,
      assignedBranchId: employeesTable.assignedBranchId,
      shiftType: employeesTable.shiftType,
      shiftLabel: employeesTable.shiftLabel,
    });

  if (!created) throw new Error("Xodim yaratilmadi");
  return created;
}

async function ensureAllActiveUsersLinked(): Promise<number> {
  const users = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      role: usersTable.role,
      departmentId: usersTable.departmentId,
    })
    .from(usersTable)
    .where(eq(usersTable.status, "active"));
  let n = 0;
  for (const u of users) {
    await ensureEmployeeForUser(u);
    n += 1;
  }
  return n;
}

async function matchFaceUserId(
  descriptor: number[] | number[][],
  snapshot?: unknown,
  expected?: { userId: number; fullName: string },
): Promise<
  | { ok: true; userId: number; faceId: number; dist: number; cosine: number }
  | { ok: false; error: string; code: string; fullName?: string }
> {
  if (expected?.userId) {
    const matched = await matchFaceForOwnerWithAi(
      expected.userId,
      descriptor,
      snapshot,
      expected.fullName,
    );
    if (!matched.ok) {
      return {
        ok: false,
        error: matched.error,
        code: matched.code,
        fullName: matched.fullName ?? expected.fullName,
      };
    }
    return { ok: true, userId: matched.userId, faceId: matched.id, dist: matched.dist, cosine: matched.cosine };
  }
  const matched = await matchFaceForAuthWithAi(descriptor, snapshot);
  if (!matched.ok) return { ok: false, error: matched.error, code: matched.code };
  return { ok: true, userId: matched.userId, faceId: matched.id, dist: matched.dist, cosine: matched.cosine };
}

/** Cookie sessiyasi — login/parol bilan kirgan user (majburiy emas). */
function readSessionUserId(req: { cookies?: Record<string, unknown> }): number | null {
  const sessionCookie = req.cookies?.session;
  if (!sessionCookie || typeof sessionCookie !== "string") return null;
  try {
    const decoded = JSON.parse(Buffer.from(sessionCookie, "base64").toString()) as { userId?: number };
    const id = Number(decoded?.userId);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

async function geoGate(
  emp: WorkplaceEmp,
  userRole: string,
  latitude: number,
  longitude: number,
  _accuracyMeters?: number,
): Promise<
  | { ok: true; distanceMeters: number; effectiveRadius: number; point: DavomatPoint }
  | {
      ok: false;
      status: number;
      body: Record<string, unknown>;
    }
> {
  const resolved = await resolveDavomatPoint(emp, userRole);
  if (!resolved.ok) return resolved;
  const point = resolved.point;
  const distanceMeters = haversineMeters(latitude, longitude, point.latitude, point.longitude);
  const effectiveRadius = geofenceMetersForKind(point.kind);

  if (distanceMeters > effectiveRadius) {
    const remainMeters = distanceMeters - effectiveRadius;
    const where = point.kind === "branch" ? "o‘z filiali" : "asosiy ofis";
    return {
      ok: false,
      status: 403,
      body: {
        error: `Hududdan tashqaridasiz (${where}): ${distanceMeters} m. Ruxsat faqat ${effectiveRadius} m. Yana ${remainMeters} m yaqinlashishingiz kerak.`,
        code: "outside_geofence",
        distanceMeters,
        remainMeters,
        allowedMeters: effectiveRadius,
        workplace: {
          location: point.label,
          latitude: point.latitude,
          longitude: point.longitude,
          kind: point.kind,
        },
        fullName: emp.fullName,
      },
    };
  }
  return { ok: true, distanceMeters, effectiveRadius, point };
}

type PunchFail = { ok: false; status: number; body: Record<string, unknown> };

function oncePerDayFail(
  emp: WorkplaceEmp,
  rec: { checkInAt: Date | null; checkOutAt: Date | null } | undefined,
  code: "already_in" | "already_complete",
): PunchFail {
  const checkIn = formatHm(rec?.checkInAt ?? null);
  const checkOut = formatHm(rec?.checkOutAt ?? null);
  return {
    ok: false,
    status: 400,
    body: {
      error:
        code === "already_complete"
          ? `Bugun allaqachon Keldim (${checkIn}) va Ketdim (${checkOut}). Kuniga faqat 1 marta.`
          : `Bugun allaqachon Keldim: ${checkIn}. Qayta belgilab bo‘lmaydi.`,
      code,
      fullName: emp.fullName,
      checkIn,
      checkOut,
      checkInAt: rec?.checkInAt ? rec.checkInAt.toISOString() : null,
      checkOutAt: rec?.checkOutAt ? rec.checkOutAt.toISOString() : null,
    },
  };
}

async function applyFacePunch(opts: {
  emp: WorkplaceEmp;
  userRole: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  allowedMeters: number;
  faceProfileId?: number | null;
  action: "in" | "out";
  verificationMethod?: "FACE_ID" | "QR";
  resolvedBranchId?: number | null;
  resolvedBranchLabel?: string | null;
}): Promise<
  | { ok: true; payload: Record<string, unknown> }
  | PunchFail
> {
  const {
    emp,
    userRole,
    latitude,
    longitude,
    distanceMeters,
    allowedMeters,
    faceProfileId,
    action,
    verificationMethod = "FACE_ID",
    resolvedBranchId = null,
    resolvedBranchLabel = null,
  } = opts;
  const defs = await getEffectiveShiftDefs();
  const today = todayTashkent();
  const yesterday = addDaysYmd(today, -1);
  // Kunlik rotatsiya smenasi (doimiy shiftType o‘rniga)
  const dayShiftType =
    (await dayShiftTypeFor(emp.id, today)) || (await dayShiftTypeFor(emp.id, yesterday));
  const effectiveShiftType = dayShiftType || emp.shiftType;
  const effectiveShiftLabel = dayShiftType ? null : emp.shiftLabel;
  const hours = hoursForStaff(emp.orgRole, effectiveShiftType, userRole, effectiveShiftLabel, defs);
  const [todayRec] = await db
    .select()
    .from(attendanceRecordsTable)
    .where(
      and(eq(attendanceRecordsTable.employeeId, emp.id), eq(attendanceRecordsTable.workDate, today)),
    )
    .limit(1);
  const [yesterdayRec] = await db
    .select()
    .from(attendanceRecordsTable)
    .where(
      and(
        eq(attendanceRecordsTable.employeeId, emp.id),
        eq(attendanceRecordsTable.workDate, yesterday),
      ),
    )
    .limit(1);
  const resolvedWd = resolveAttendanceWorkDate({
    todayYmd: today,
    yesterdayYmd: yesterday,
    now: new Date(),
    shiftType: effectiveShiftType,
    shiftLabel: effectiveShiftLabel,
    todayRec,
    yesterdayRec,
  });
  const workDate = resolvedWd.workDate;
  // Ish kuni aniqlangach — shu kun rejasini ustun qo‘yamiz
  const planForWorkDate = await dayShiftTypeFor(emp.id, workDate);
  const punchShiftType = planForWorkDate || effectiveShiftType;
  const punchShiftLabel = planForWorkDate ? null : effectiveShiftLabel;
  const punchHours = planForWorkDate
    ? hoursForStaff(emp.orgRole, punchShiftType, userRole, punchShiftLabel, defs)
    : hours;
  const now = new Date();
  const dateFilter = and(
    eq(attendanceRecordsTable.employeeId, emp.id),
    eq(attendanceRecordsTable.workDate, workDate),
  );

  const source = verificationMethod === "QR" ? ("qr" as const) : ("face" as const);
  const geoFields = {
    checkLatitude: latitude,
    checkLongitude: longitude,
    distanceMeters,
    source,
    userId: emp.userId,
    updatedAt: now,
    resolvedBranchId: resolvedBranchId ?? undefined,
    resolvedBranchLabel: resolvedBranchLabel ?? undefined,
  };

  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(attendanceRecordsTable)
        .where(dateFilter)
        .limit(1)
        .for("update");

      if (existing?.checkOutAt || existing?.status === "absent" || existing?.status === "leave") {
        return oncePerDayFail(emp, existing, "already_complete");
      }
      if (action === "in" && existing?.checkInAt) {
        return oncePerDayFail(emp, existing, "already_in");
      }
      if (action === "out" && !existing?.checkInAt) {
        return {
          ok: false,
          status: 400,
          body: {
            error: "Avval Keldim ni belgilang",
            code: "need_check_in",
            fullName: emp.fullName,
          },
        };
      }

      // Smena tugagach +2 soatdan keyin Ketdim qabul qilinmaydi
      if (action === "out" && existing?.checkInAt) {
        const sched = workScheduleForStaff(
          userRole,
          emp.orgRole,
          punchShiftType,
          punchShiftLabel,
          defs,
        );
        const endAt = shiftEndAt(workDate, sched.end, sched.overnight);
        if (now.getTime() > endAt.getTime() + CHECKOUT_GRACE_MS) {
          await tx
            .update(attendanceRecordsTable)
            .set({
              status: "absent",
              notes: `auto_absent_no_checkout: Ketdim kechikdi (smena ${sched.end}+2soat)`,
              updatedAt: new Date(),
            })
            .where(eq(attendanceRecordsTable.id, existing.id));
          return {
            ok: false,
            status: 400,
            body: {
              error:
                "Smena tugagach 2 soat o‘tdi — bugun «kelmagan» deb yopildi. Ertaga «Keldim» dan boshlang.",
              code: "checkout_window_closed",
              fullName: emp.fullName,
            },
          };
        }
      }

      let checkInAt = existing?.checkInAt ?? null;
      let checkOutAt = existing?.checkOutAt ?? null;

      if (action === "in") {
        checkInAt = now;
        const status = computeMetrics(workDate, checkInAt, null, null, punchHours).status;
        const methodFields = { checkInMethod: verificationMethod };
        if (existing) {
          await tx
            .update(attendanceRecordsTable)
            .set({ ...geoFields, checkInAt, status, ...methodFields })
            .where(eq(attendanceRecordsTable.id, existing.id));
        } else {
          await tx.insert(attendanceRecordsTable).values({
            employeeId: emp.id,
            userId: emp.userId,
            workDate,
            checkInAt,
            status,
            ...geoFields,
            ...methodFields,
            createdById: emp.userId,
          });
        }
      } else {
        checkOutAt = now;
        checkInAt = existing!.checkInAt;
        const status = computeMetrics(workDate, existing!.checkInAt, checkOutAt, null, punchHours).status;
        await tx
          .update(attendanceRecordsTable)
          .set({ ...geoFields, checkOutAt, status, checkOutMethod: verificationMethod })
          .where(eq(attendanceRecordsTable.id, existing!.id));
      }

      if (faceProfileId) {
        await tx
          .update(faceProfilesTable)
          .set({ lastUsedAt: now })
          .where(eq(faceProfilesTable.id, faceProfileId));
      }

      const metrics = computeMetrics(workDate, checkInAt, checkOutAt, null, punchHours);
      return {
        ok: true as const,
        payload: {
          ok: true,
          action,
          workDate,
          fullName: emp.fullName,
          location: emp.location,
          distanceMeters,
          allowedMeters,
          verificationMethod,
          checkInAt: checkInAt ? checkInAt.toISOString() : null,
          checkOutAt: checkOutAt ? checkOutAt.toISOString() : null,
          message:
            action === "in"
              ? `${emp.fullName}: Keldim (${metrics.checkIn}) · ${verificationMethod === "QR" ? "QR" : "Face ID"}`
              : `${emp.fullName}: Ketdi (${metrics.checkOut}). Ishlangan ${metrics.workedHours} · ${verificationMethod === "QR" ? "QR" : "Face ID"}`,
          ...metrics,
        },
      };
    });
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      const [existing] = await db
        .select()
        .from(attendanceRecordsTable)
        .where(dateFilter)
        .limit(1);
      if (existing?.checkOutAt) return oncePerDayFail(emp, existing, "already_complete");
      if (existing?.checkInAt) return oncePerDayFail(emp, existing, "already_in");
    }
    throw err;
  }
}

async function resolveFaceAtSite(opts: {
  descriptor: number[] | number[][];
  latitude: number;
  longitude: number;
  accuracy?: number;
  snapshot?: unknown;
  /** Login/parol sessiya — faqat shu user Face ID si. */
  expectedUserId?: number;
  expectedFullName?: string;
}): Promise<
  | {
      ok: true;
      emp: WorkplaceEmp;
      faceId: number;
      user: { id: number; fullName: string; role: string };
      gate: { distanceMeters: number; effectiveRadius: number };
    }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  const matched = await matchFaceUserId(
    opts.descriptor,
    opts.snapshot,
    opts.expectedUserId
      ? { userId: opts.expectedUserId, fullName: opts.expectedFullName || "" }
      : undefined,
  );
  if (!matched.ok) {
    const status = matched.code === "face_not_owner" ? 403 : 401;
    return {
      ok: false,
      status,
      body: {
        error: matched.error,
        code: matched.code,
        fullName: matched.fullName,
      },
    };
  }

  const [user] = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      status: usersTable.status,
      role: usersTable.role,
      departmentId: usersTable.departmentId,
    })
    .from(usersTable)
    .where(eq(usersTable.id, matched.userId))
    .limit(1);
  if (!user || (user.status !== "active" && user.status !== "on_leave")) {
    return { ok: false, status: 403, body: { error: "Profil faol emas", code: "user_inactive" } };
  }

  const emp = await ensureEmployeeForUser(user);
  const gate = await geoGate(emp, user.role, opts.latitude, opts.longitude, opts.accuracy);
  if (!gate.ok) {
    return { ok: false, status: gate.status, body: gate.body };
  }
  return {
    ok: true,
    emp,
    faceId: matched.faceId,
    user: { id: user.id, fullName: user.fullName, role: user.role },
    gate: { distanceMeters: gate.distanceMeters, effectiveRadius: gate.effectiveRadius },
  };
}

/** Face ID tanilgan user — to‘liq profil + sessiya shu akkauntga */
async function adoptFaceSession(res: import("express").Response, userId: number) {
  setSessionCookie(res, userId);
  const [row] = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      role: usersTable.role,
      departmentId: usersTable.departmentId,
      departmentName: departmentsTable.name,
      login: usersTable.login,
      phone: usersTable.phone,
      status: usersTable.status,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .leftJoin(departmentsTable, eq(usersTable.departmentId, departmentsTable.id))
    .where(eq(usersTable.id, userId))
    .limit(1);
  return row ?? null;
}

/** Login qilgan xodim — ish joyi GPS (UI masofa hisobi uchun) */
router.get("/davomat/me/workplace", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const [user] = await db
      .select({
        id: usersTable.id,
        fullName: usersTable.fullName,
        role: usersTable.role,
        departmentId: usersTable.departmentId,
      })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId!))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "Foydalanuvchi topilmadi" });
      return;
    }
    const emp = await ensureEmployeeForUser(user);
    const resolved = await resolveDavomatPoint(emp, user.role);
    const point = resolved.ok
      ? resolved.point
      : {
          latitude: DAVOMAT_SITE_LAT,
          longitude: DAVOMAT_SITE_LNG,
          label: DAVOMAT_SITE_LABEL,
          kind: "office" as const,
        };
    const today = todayTashkent();
    const yesterday = addDaysYmd(today, -1);
    const [todayRec] = await db
      .select()
      .from(attendanceRecordsTable)
      .where(
        and(eq(attendanceRecordsTable.employeeId, emp.id), eq(attendanceRecordsTable.workDate, today)),
      )
      .limit(1);
    const [yesterdayRec] = await db
      .select()
      .from(attendanceRecordsTable)
      .where(
        and(
          eq(attendanceRecordsTable.employeeId, emp.id),
          eq(attendanceRecordsTable.workDate, yesterday),
        ),
      )
      .limit(1);
    const planToday =
      (await dayShiftTypeFor(emp.id, today)) || (await dayShiftTypeFor(emp.id, yesterday));
    const shiftType = planToday || emp.shiftType;
    const shiftLabel = planToday ? null : emp.shiftLabel;
    const workDate = resolveAttendanceWorkDate({
      todayYmd: today,
      yesterdayYmd: yesterday,
      now: new Date(),
      shiftType,
      shiftLabel,
      todayRec,
      yesterdayRec,
    }).workDate;
    const [rec] =
      workDate === today
        ? [todayRec]
        : workDate === yesterday
          ? [yesterdayRec]
          : await db
              .select()
              .from(attendanceRecordsTable)
              .where(
                and(
                  eq(attendanceRecordsTable.employeeId, emp.id),
                  eq(attendanceRecordsTable.workDate, workDate),
                ),
              )
              .limit(1);

    const planForWorkDate = await dayShiftTypeFor(emp.id, workDate);
    const punchShiftType = planForWorkDate || shiftType;
    const punchShiftLabel = planForWorkDate ? null : shiftLabel;
    const defs = await getEffectiveShiftDefs();

    res.json({
      allowedMeters: geofenceMetersForKind(point.kind),
      site: {
        label: point.label,
        latitude: point.latitude,
        longitude: point.longitude,
        kind: point.kind,
      },
      gpsReady: resolved.ok,
      gpsError: resolved.ok ? null : String(resolved.body.error || "Filial GPS yo‘q"),
      workDate,
      shift: (() => {
        const w = workScheduleForStaff(
          user.role,
          emp.orgRole,
          punchShiftType,
          punchShiftLabel,
          defs,
        );
        return {
          type: w.key,
          label: w.label,
          start: w.start,
          end: w.end,
          overnight: Boolean(w.overnight),
          warnHm: w.warnHm,
          warnText: w.warnText,
        };
      })(),
      employee: {
        id: emp.id,
        fullName: emp.fullName,
        location: point.label,
        latitude: point.latitude,
        longitude: point.longitude,
        hasGps: resolved.ok,
      },
      today: rec
        ? {
            checkIn: formatHm(rec.checkInAt),
            checkOut: formatHm(rec.checkOutAt),
            checkInAt: rec.checkInAt ? rec.checkInAt.toISOString() : null,
            checkOutAt: rec.checkOutAt ? rec.checkOutAt.toISOString() : null,
            checkInMethod: rec.checkInMethod ?? null,
            checkOutMethod: rec.checkOutMethod ?? null,
            status: rec.status,
            complete:
              Boolean(rec.checkOutAt) ||
              rec.status === "absent" ||
              rec.status === "leave" ||
              Boolean(rec.checkInAt && rec.checkOutAt),
            nextAction:
              rec.status === "absent" || rec.status === "leave" || rec.checkOutAt
                ? "done"
                : !rec.checkInAt
                  ? "in"
                  : "out",
          }
        : {
            checkIn: "—",
            checkOut: "—",
            checkInAt: null,
            checkOutAt: null,
            checkInMethod: null,
            checkOutMethod: null,
            status: "absent",
            complete: false,
            nextAction: "in",
          },
    });
  } catch (err) {
    console.error("GET /davomat/me/workplace error:", err);
    res.status(503).json({ error: "Ish joyi yuklanmadi" });
  }
});

/** Belgilangan davomat nuqtasi — login shart emas */
router.get("/davomat/site", async (_req, res): Promise<void> => {
  res.json({
    allowedMeters: DAVOMAT_OFFICE_GEOFENCE_METERS,
    label: DAVOMAT_SITE_LABEL,
    latitude: DAVOMAT_SITE_LAT,
    longitude: DAVOMAT_SITE_LNG,
    kind: "office",
  });
});

/** Banner / ogohlantirish holati — barcha login qilgan xodimlar */
router.get("/davomat/me/status", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const [user] = await db
      .select({
        id: usersTable.id,
        fullName: usersTable.fullName,
        role: usersTable.role,
        departmentId: usersTable.departmentId,
      })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId!))
      .limit(1);

    const emp = user ? await ensureEmployeeForUser(user) : null;
    let nextAction: "in" | "out" | "done" | "unlinked" = "unlinked";
    let checkIn = "—";
    let checkOut = "—";
    let fullName: string | null = user?.fullName ?? null;
    let workDate = todayTashkent();

    if (emp) {
      fullName = emp.fullName;
      const today = todayTashkent();
      const yesterday = addDaysYmd(today, -1);
      const [todayRec] = await db
        .select()
        .from(attendanceRecordsTable)
        .where(
          and(eq(attendanceRecordsTable.employeeId, emp.id), eq(attendanceRecordsTable.workDate, today)),
        )
        .limit(1);
      const [yesterdayRec] = await db
        .select()
        .from(attendanceRecordsTable)
        .where(
          and(
            eq(attendanceRecordsTable.employeeId, emp.id),
            eq(attendanceRecordsTable.workDate, yesterday),
          ),
        )
        .limit(1);
      const planToday =
        (await dayShiftTypeFor(emp.id, today)) || (await dayShiftTypeFor(emp.id, yesterday));
      workDate = resolveAttendanceWorkDate({
        todayYmd: today,
        yesterdayYmd: yesterday,
        now: new Date(),
        shiftType: planToday || emp.shiftType,
        shiftLabel: planToday ? null : emp.shiftLabel,
        todayRec,
        yesterdayRec,
      }).workDate;
      const rec =
        workDate === today ? todayRec : workDate === yesterday ? yesterdayRec : undefined;
      const [recAlt] = rec
        ? [rec]
        : await db
            .select()
            .from(attendanceRecordsTable)
            .where(
              and(
                eq(attendanceRecordsTable.employeeId, emp.id),
                eq(attendanceRecordsTable.workDate, workDate),
              ),
            )
            .limit(1);
      const row = rec ?? recAlt;
      checkIn = formatHm(row?.checkInAt ?? null);
      checkOut = formatHm(row?.checkOutAt ?? null);
      if (row?.status === "absent" || row?.status === "leave" || row?.checkOutAt) nextAction = "done";
      else if (!row?.checkInAt) nextAction = "in";
      else nextAction = "out";
    }

    const messages: Record<string, string> = {
      in: `Bugun hali kelish belgilanmagan — Face ID bilan davomatdan o‘ting (filial ${DAVOMAT_GEOFENCE_METERS} m / ofis ${DAVOMAT_OFFICE_GEOFENCE_METERS} m).`,
      out: "Kelish belgilandi. Ketishni ham Face ID bilan belgilang.",
      done: "Bugungi davomat yopilgan (kelish/ketish yoki avtomatik yopilgan).",
      unlinked: "Davomat Face ID orqali majburiy.",
    };

    let allowedMeters = DAVOMAT_OFFICE_GEOFENCE_METERS;
    if (emp && user) {
      const resolved = await resolveDavomatPoint(emp, user.role);
      if (resolved.ok) allowedMeters = geofenceMetersForKind(resolved.point.kind);
    }

    res.json({
      workDate,
      allowedMeters,
      siteLabel: DAVOMAT_SITE_LABEL,
      fullName,
      nextAction,
      checkIn,
      checkOut,
      message: messages[nextAction],
      linkUrl: "/davomat-face",
      warn: nextAction === "in" || nextAction === "out",
    });
  } catch (err) {
    console.error("GET /davomat/me/status error:", err);
    res.status(503).json({ error: "Davomat holati yuklanmadi" });
  }
});

/** HR/Direktor: yuboriladigan xabar matnini ko‘rish */
router.get("/davomat/announce/preview", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireDavomat(req, res)) return;
  const tg = davomatBroadcastTelegramReady();
  res.json({
    text: davomatBroadcastMessage(),
    recipients: "Barcha faol xodimlar",
    channels: tg ? ["Telegram", "Tizim ichidagi bildirishnoma"] : ["Tizim ichidagi bildirishnoma"],
    telegramConfigured: tg,
    linkUrl: "/davomat-face",
  });
});

/** HR/Direktor: barcha faol xodimlarga darhol xabar + xodim bog‘lash */
router.post("/davomat/announce", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireDavomat(req, res)) return;
  try {
    const linked = await ensureAllActiveUsersLinked();
    const sent = await forceBroadcastDavomatToAll();
    const tg = davomatBroadcastTelegramReady();
    res.json({
      ok: true,
      sent,
      linked,
      telegram: tg,
      message: tg
        ? `${sent} ta xabar yuborildi (Telegram + tizim ichida)`
        : `${sent} ta xabar tizim ichida yuborildi (Telegram sozlanmagan)`,
    });
  } catch (err) {
    console.error("POST /davomat/announce error:", err);
    res.status(503).json({ error: "Xabar yuborilmadi" });
  }
});

/** Xodimning o‘z davomati (so‘nggi 14 kun) */
router.get("/davomat/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const [user] = await db
      .select({
        id: usersTable.id,
        fullName: usersTable.fullName,
        role: usersTable.role,
        departmentId: usersTable.departmentId,
      })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId!))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "Foydalanuvchi topilmadi" });
      return;
    }
    const emp = await ensureEmployeeForUser(user);
    const own = await ownEmployeeReport(emp.id);
    res.json({
      from: own.from,
      to: own.to,
      fullName: emp.fullName,
      employee: own.employee,
    });
  } catch (err) {
    console.error("GET /davomat/me error:", err);
    res.status(503).json({ error: "Davomat yuklanmadi" });
  }
});

/** Face ID tasdiq — login/parol sessiyasi bo‘lsa faqat shu akkaunt yuzi. */
router.post("/davomat/face-verify", async (req, res): Promise<void> => {
  try {
    const descriptors = Array.isArray(req.body?.descriptors)
      ? (req.body.descriptors as unknown[]).map(parseFaceDescriptor).filter((d): d is number[] => Boolean(d))
      : (() => {
          const one = parseFaceDescriptor(req.body?.descriptor);
          return one ? [one] : [];
        })();
    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    const accuracy = Number(req.body?.accuracy);
    if (!descriptors.length) {
      res.status(400).json({ error: "Yuz aniq olinmadi — kameraga qarab turing" });
      return;
    }
    const live = evaluateLiveness(req.body?.liveness as LivenessProof | undefined, "login");
    if (!live.ok) {
      res.status(403).json({ error: live.error, code: live.code });
      return;
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      res.status(400).json({ error: "GPS majburiy — lokatsiyaga ruxsat bering", code: "gps_required" });
      return;
    }

    const sessionUserId = readSessionUserId(req);
    let expectedUserId: number | undefined;
    let expectedFullName: string | undefined;
    if (sessionUserId) {
      const [sess] = await db
        .select({ id: usersTable.id, fullName: usersTable.fullName, status: usersTable.status })
        .from(usersTable)
        .where(eq(usersTable.id, sessionUserId))
        .limit(1);
      if (sess && (sess.status === "active" || sess.status === "on_leave")) {
        expectedUserId = sess.id;
        expectedFullName = sess.fullName;
      }
    }

    const resolved = await resolveFaceAtSite({
      descriptor: descriptors,
      latitude,
      longitude,
      accuracy: Number.isFinite(accuracy) ? accuracy : undefined,
      snapshot: req.body?.snapshot ?? req.body?.photo,
      expectedUserId,
      expectedFullName,
    });
    if (!resolved.ok) {
      res.status(resolved.status).json(resolved.body);
      return;
    }
    await maybeBackfillFacePhoto(resolved.faceId, req.body?.snapshot ?? req.body?.photo);
    const workDate = todayTashkent();
    const [rec] = await db
      .select()
      .from(attendanceRecordsTable)
      .where(
        and(
          eq(attendanceRecordsTable.employeeId, resolved.emp.id),
          eq(attendanceRecordsTable.workDate, workDate),
        ),
      )
      .limit(1);
    const nextAction =
      rec?.status === "absent" || rec?.status === "leave" || rec?.checkOutAt
        ? "done"
        : !rec?.checkInAt
          ? "in"
          : "out";
    const own = await ownEmployeeReport(resolved.emp.id);
    const sessionUser = await adoptFaceSession(res, resolved.user.id);
    res.json({
      ok: true,
      fullName: resolved.user.fullName,
      employeeId: resolved.emp.id,
      distanceMeters: resolved.gate.distanceMeters,
      allowedMeters: resolved.gate.effectiveRadius,
      workDate,
      nextAction,
      checkIn: formatHm(rec?.checkInAt ?? null),
      checkOut: formatHm(rec?.checkOutAt ?? null),
      checkInAt: rec?.checkInAt ? rec.checkInAt.toISOString() : null,
      checkOutAt: rec?.checkOutAt ? rec.checkOutAt.toISOString() : null,
      employee: own.employee,
      user: sessionUser,
      sessionSwitched: !expectedUserId || expectedUserId !== resolved.user.id,
      ownerVerified: Boolean(expectedUserId),
    });
  } catch (err) {
    console.error("POST /davomat/face-verify error:", err);
    res.status(503).json({ error: "Yuz tasdiqlanmadi" });
  }
});

/**
 * Face ID davomat punch.
 * Sessiya bo‘lsa — faqat shu akkaunt yuzi (boshqa odam ochilmaydi).
 */
router.post("/davomat/face-punch", async (req, res): Promise<void> => {
  try {
    const descriptor = parseFaceDescriptor(req.body?.descriptor);
    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    const accuracy = Number(req.body?.accuracy);
    const actionRaw = String(req.body?.action || "");
    const action = actionRaw === "out" ? "out" : actionRaw === "in" ? "in" : null;

    if (!descriptor) {
      res.status(400).json({ error: "Yuz aniq olinmadi — kameraga qarab turing" });
      return;
    }
    // Liveness — faqat kamera skanida (face-verify). Keldim/Ketdim tugmasi qayta bosh burishni talab qilmaydi.
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      res.status(400).json({
        error: "GPS majburiy — lokatsiyaga ruxsat bering",
        code: "gps_required",
      });
      return;
    }
    if (!action) {
      res.status(400).json({ error: "action: in | out", code: "action_required" });
      return;
    }

    const sessionUserId = readSessionUserId(req);
    let expectedUserId: number | undefined;
    let expectedFullName: string | undefined;
    if (sessionUserId) {
      const [sess] = await db
        .select({ id: usersTable.id, fullName: usersTable.fullName, status: usersTable.status })
        .from(usersTable)
        .where(eq(usersTable.id, sessionUserId))
        .limit(1);
      if (sess && (sess.status === "active" || sess.status === "on_leave")) {
        expectedUserId = sess.id;
        expectedFullName = sess.fullName;
      }
    }

    const resolved = await resolveFaceAtSite({
      descriptor,
      latitude,
      longitude,
      accuracy: Number.isFinite(accuracy) ? accuracy : undefined,
      snapshot: req.body?.snapshot ?? req.body?.photo,
      expectedUserId,
      expectedFullName,
    });
    if (!resolved.ok) {
      res.status(resolved.status).json(resolved.body);
      return;
    }
    await maybeBackfillFacePhoto(resolved.faceId, req.body?.snapshot ?? req.body?.photo);

    const punched = await applyFacePunch({
      emp: resolved.emp,
      userRole: resolved.user.role,
      latitude,
      longitude,
      distanceMeters: resolved.gate.distanceMeters,
      allowedMeters: resolved.gate.effectiveRadius,
      faceProfileId: resolved.faceId,
      action,
      verificationMethod: "FACE_ID",
    });
    if (!punched.ok) {
      await writePunchAudit({
        employeeId: resolved.emp.id,
        userId: resolved.user.id,
        verificationMethod: "FACE_ID",
        action,
        gpsResult: "ok",
        gpsDistance: resolved.gate.distanceMeters,
        faceResult: "ok",
        finalResult: "denied",
        failureReason: String(punched.body.error || punched.body.code || "denied"),
        ipAddress: clientIp(req),
      });
      res.status(punched.status).json(punched.body);
      return;
    }
    await writePunchAudit({
      employeeId: resolved.emp.id,
      userId: resolved.user.id,
      verificationMethod: "FACE_ID",
      action,
      gpsResult: "ok",
      gpsDistance: resolved.gate.distanceMeters,
      faceResult: "ok",
      finalResult: "success",
      ipAddress: clientIp(req),
    });
    const own = await ownEmployeeReport(resolved.emp.id);
    const sessionUser = await adoptFaceSession(res, resolved.user.id);
    res.json({
      ...punched.payload,
      employee: own.employee,
      user: sessionUser,
      sessionSwitched: !expectedUserId || expectedUserId !== resolved.user.id,
      ownerVerified: Boolean(expectedUserId),
    });
  } catch (err) {
    console.error("POST /davomat/face-punch error:", err);
    res.status(503).json({ error: "Face ID davomat yozilmadi" });
  }
});

/** Faqat masofa tekshiruvi (Face ID ochishdan oldin, login + workplace) */
router.post("/davomat/geo-check", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    const accuracy = Number(req.body?.accuracy);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      res.status(400).json({ error: "GPS majburiy", code: "gps_required" });
      return;
    }
    const [user] = await db
      .select({
        id: usersTable.id,
        fullName: usersTable.fullName,
        role: usersTable.role,
        departmentId: usersTable.departmentId,
      })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId!))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "Foydalanuvchi topilmadi" });
      return;
    }
    const emp = await ensureEmployeeForUser(user);
    const gate = await geoGate(
      emp,
      user.role,
      latitude,
      longitude,
      Number.isFinite(accuracy) ? accuracy : undefined,
    );
    if (!gate.ok) {
      res.status(gate.status).json(gate.body);
      return;
    }
    res.json({
      ok: true,
      inside: true,
      distanceMeters: gate.distanceMeters,
      remainMeters: 0,
      allowedMeters: gate.effectiveRadius,
      fullName: emp.fullName,
      location: emp.location,
    });
  } catch (err) {
    console.error("POST /davomat/geo-check error:", err);
    res.status(503).json({ error: "GPS tekshiruv xatosi" });
  }
});

router.get("/davomat/export", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireDavomat(req, res)) return;
  try {
    const q = req.query as Record<string, string>;
    const to = q.to || todayTashkent();
    const from = q.from || addDays(to, -13);
    const staffFilter = parseDavomatStaffFilter(q.staffFilter);
    let employees = await loadActiveEmployees({
      departmentId: q.departmentId,
      location: q.location,
      search: q.search,
      employeeId: q.employeeId,
    });
    employees = employees.filter((e) => matchesDavomatStaffFilter(e, staffFilter));
    const records = await loadRecords(
      from,
      to,
      employees.map((e) => e.id),
    );
    const report = buildReport(employees, records, from, to, await getEffectiveShiftDefs());

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "VAKSINA MED HR";
    workbook.created = new Date();
    const filterNote = [
      `Davr: ${from} — ${to}`,
      q.departmentId ? `Bo'lim ID: ${q.departmentId}` : "Bo'lim: barcha",
      `Xodimlar guruhi: ${staffFilterLabelUz(staffFilter)}`,
      q.search ? `Qidiruv: ${q.search}` : null,
      q.location ? `Filial: ${q.location}` : null,
      `Xodimlar: ${employees.length} ta`,
    ]
      .filter(Boolean)
      .join(" · ");

    const headerStyle = (cell: ExcelJS.Cell, fill = "FF0B3A5C") => {
      cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FF083049" } },
        left: { style: "thin", color: { argb: "FF083049" } },
        bottom: { style: "thin", color: { argb: "FF083049" } },
        right: { style: "thin", color: { argb: "FF083049" } },
      };
    };

    const paintRow = (row: ExcelJS.Row, zebra: boolean, centerCols: number[] = []) => {
      const bg = zebra ? "FFF7FAFC" : "FFFFFFFF";
      row.eachCell((cell, col) => {
        cell.font = { name: "Calibri", size: 10 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        cell.alignment = {
          vertical: "middle",
          horizontal: centerCols.includes(col) ? "center" : "left",
          wrapText: true,
        };
        cell.border = {
          top: { style: "thin", color: { argb: "FFE2E8F0" } },
          left: { style: "thin", color: { argb: "FFE2E8F0" } },
          bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
          right: { style: "thin", color: { argb: "FFE2E8F0" } },
        };
      });
      row.height = 20;
    };

    const statusUz: Record<string, string> = {
      present: "O'z vaqtida keldi",
      late: "Kechikib keldi",
      incomplete: "Ketish yozilmagan",
      absent: "Kelmagan",
      leave: "Ta'tilda",
    };

    const statusFill: Record<string, string> = {
      present: "FFECFDF5",
      late: "FFFFFBEB",
      incomplete: "FFF0F9FF",
      absent: "FFF8FAFC",
      leave: "FFF5F3FF",
    };
    const statusFont: Record<string, string> = {
      present: "FF047857",
      late: "FFB45309",
      incomplete: "FF0369A1",
      absent: "FF94A3B8",
      leave: "FF6D28D9",
    };

    const weekdayUz = ["Du", "Se", "Cho", "Pay", "Ju", "Sha", "Yak"];
    const weekdayLabel = (ymd: string) => {
      const [y, m, d] = ymd.split("-").map(Number);
      const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
      const idx = dow === 0 ? 6 : dow - 1;
      return weekdayUz[idx] ?? "";
    };

    const dates = report.dates?.length
      ? report.dates
      : report.days.map((d) => d.date);
    const metaCols = 7; // No, F.I.Sh., Lavozim, Bo'lim, Filial, Smena, Ish vaqti
    const lastCol = metaCols + dates.length;

    // —— Sheet 0: Qo'llanma ——
    const sGuide = workbook.addWorksheet("Qo'llanma");
    sGuide.mergeCells("A1:D1");
    const gTitle = sGuide.getCell("A1");
    gTitle.value = "VAKSINA MED — Davomat hisoboti qo'llanmasi";
    gTitle.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
    gTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3A5C" } };
    gTitle.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    sGuide.getRow(1).height = 28;

    sGuide.mergeCells("A2:D2");
    const gFilter = sGuide.getCell("A2");
    gFilter.value = filterNote;
    gFilter.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF0B3A5C" } };
    gFilter.alignment = { vertical: "middle", horizontal: "left", indent: 1, wrapText: true };
    sGuide.getRow(2).height = 36;

    const guideRows: [string, string][] = [
      ["Ustun: Smena", "1-smenada ishlaydiganlar · 2-smenada ishlaydiganlar · Asosiy ofis · Tashqi xodimlar"],
      ["Ustun: Ish vaqti", "Har xodimning reja bo'yicha kelish/ketish vaqti (masalan 08:00–17:00 yoki 17:00–23:45)"],
      ["Katak: Keldi", "Face ID orqali belgilangan kelish vaqti (qavsda reja vaqti)"],
      ["Katak: Ketdi", "Face ID orqali belgilangan ketish vaqti (qavsda reja vaqti)"],
      ["Katak: Kechikish", "Rejadan kech kelgan vaqt. Yo'q = vaqtida kelgan. Kechiksa − belgisi bilan, qizil"],
      ["Katak: Ishlangan", "Ketish − Kelish = necha soat/daqiqa ishlagan (har doim ko'rsatiladi)"],
      ["Katak: Erta ketish", "Rejadan oldin ketgan vaqt (− belgisi bilan, ixtiyoriy qator)"],
      ["Katak: Qo'shimcha ish", "Rejadan keyin ishlagan vaqt (+ belgisi bilan, yashil)"],
      ["Rang: yashil fon", "O'z vaqtida kelgan"],
      ["Rang: sariq fon", "Kechikib kelgan"],
      ["Rang: ko'k fon", "Kelgan, lekin ketish yozilmagan"],
      ["Rang: kulrang fon", "Kelmagan"],
      ["Rang: binafsha fon", "Ta'tilda"],
      ["Varaqlar", "Davomat jadvali → Kunlik xulosa → Xodimlar jami → Kelganlar → Kelmaganlar"],
    ];
    sGuide.getRow(3).getCell(1).value = "Maydon";
    sGuide.getRow(3).getCell(2).value = "Ma'nosi";
    headerStyle(sGuide.getRow(3).getCell(1), "FF1A5F8A");
    headerStyle(sGuide.getRow(3).getCell(2), "FF1A5F8A");
    sGuide.mergeCells(3, 2, 3, 4);
    guideRows.forEach(([k, v], i) => {
      const row = sGuide.getRow(4 + i);
      row.getCell(1).value = k;
      row.getCell(2).value = v;
      row.getCell(1).font = { name: "Calibri", size: 10, bold: true };
      row.getCell(2).font = { name: "Calibri", size: 10 };
      row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: i % 2 ? "FFF7FAFC" : "FFFFFFFF" } };
      row.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: i % 2 ? "FFF7FAFC" : "FFFFFFFF" } };
      sGuide.mergeCells(4 + i, 2, 4 + i, 4);
      row.height = 22;
    });
    sGuide.getColumn(1).width = 22;
    sGuide.getColumn(2).width = 70;

    // —— Sheet 1: Jadval (1 xodim = 1 qator, sanalar o‘ngga) ——
    const sGrid = workbook.addWorksheet("Davomat jadvali", {
      views: [{ state: "frozen", ySplit: 3, xSplit: metaCols }],
    });
    sGrid.mergeCells(1, 1, 1, Math.max(lastCol, 7));
    const tGrid = sGrid.getCell("A1");
    tGrid.value = `VAKSINA MED — Davomat jadvali (${from} — ${to}) · ${dates.length} kun`;
    tGrid.font = { name: "Calibri", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
    tGrid.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3A5C" } };
    tGrid.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    sGrid.getRow(1).height = 26;

    sGrid.mergeCells(2, 1, 2, Math.max(lastCol, 7));
    const tLegend = sGrid.getCell("A2");
    tLegend.value =
      "Har katakda: Keldi · Ketdi · Kechikish · Ishlangan (soat/daqiqa) — har doim ko'rsatiladi";
    tLegend.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF334155" } };
    tLegend.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    tLegend.alignment = { vertical: "middle", horizontal: "left", indent: 1, wrapText: true };
    sGrid.getRow(2).height = 22;

    const metaHeaders = ["No", "F.I.Sh.", "Lavozim", "Bo‘lim", "Filial", "Smena", "Ish vaqti"];
    metaHeaders.forEach((h, i) => {
      const cell = sGrid.getRow(3).getCell(i + 1);
      cell.value = h;
      headerStyle(cell, "FF1A5F8A");
    });
    dates.forEach((date, i) => {
      const col = metaCols + 1 + i;
      const c2 = sGrid.getRow(3).getCell(col);
      c2.value = `${weekdayLabel(date)}\n${date}`;
      headerStyle(c2, "FF0B3A5C");
    });
    sGrid.getRow(3).height = 36;

    sGrid.getColumn(1).width = 5;
    sGrid.getColumn(2).width = 28;
    sGrid.getColumn(3).width = 16;
    sGrid.getColumn(4).width = 16;
    sGrid.getColumn(5).width = 14;
    sGrid.getColumn(6).width = 22;
    sGrid.getColumn(7).width = 13;
    dates.forEach((_, i) => {
      sGrid.getColumn(metaCols + 1 + i).width = 28;
    });

    report.employees.forEach((e, idx) => {
      const row = sGrid.getRow(4 + idx);
      const zebra = idx % 2 === 0;
      const bg = zebra ? "FFF7FAFC" : "FFFFFFFF";
      const empHours = {
        start: e.workStart ?? WORK_START,
        end: e.workEnd ?? WORK_END,
      };
      const vals: (string | number)[] = [
        idx + 1,
        e.fullName,
        e.position,
        e.departmentName || "—",
        e.location || "—",
        smenaLabelForEmployee(e),
        `${empHours.start}–${empHours.end}`,
      ];
      vals.forEach((v, i) => {
        const cell = row.getCell(i + 1);
        cell.value = v;
        cell.font = { name: "Calibri", size: 10, bold: i === 1 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        cell.alignment = {
          vertical: "middle",
          horizontal: i === 0 ? "center" : "left",
          wrapText: true,
        };
        cell.border = {
          top: { style: "thin", color: { argb: "FFE2E8F0" } },
          left: { style: "thin", color: { argb: "FFE2E8F0" } },
          bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
          right: { style: "thin", color: { argb: "FFE2E8F0" } },
        };
      });
      dates.forEach((date, i) => {
        const d = e.days.find((x) => x.date === date);
        const cell = row.getCell(metaCols + 1 + i);
        applyDavomatDayCell(cell, d, empHours, statusFont, statusFill);
      });
      row.height = 76;
    });
    if (lastCol >= 1) {
      sGrid.autoFilter = {
        from: { row: 3, column: 1 },
        to: { row: 3, column: Math.min(lastCol, metaCols) },
      };
    }

    // —— Sheet 2: Kunlik xulosa (faqat raqamlar) ——
    const s1 = workbook.addWorksheet("Kunlik xulosa", {
      views: [{ state: "frozen", ySplit: 2 }],
    });
    s1.mergeCells("A1:F1");
    const t1 = s1.getCell("A1");
    t1.value = `VAKSINA MED — Kunlik xulosa (${from} — ${to}) · Har xodim o‘z smenasiga qarab hisoblanadi`;
    t1.font = { name: "Calibri", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
    t1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3A5C" } };
    t1.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    s1.getRow(1).height = 30;

    const h1 = ["Sana", "O'z vaqtida", "Kechikib keldi", "Ketish yozilmagan", "Ta'tilda", "Kelmagan"];
    h1.forEach((h, i) => {
      const cell = s1.getRow(2).getCell(i + 1);
      cell.value = h;
      headerStyle(cell, "FF1A5F8A");
    });
    s1.columns = [
      { width: 14 },
      { width: 12 },
      { width: 14 },
      { width: 14 },
      { width: 12 },
      { width: 12 },
    ];
    report.days.forEach((d, idx) => {
      const row = s1.addRow([d.date, d.present, d.late, d.incomplete, d.leave, d.absent]);
      paintRow(row, idx % 2 === 0, [1, 2, 3, 4, 5, 6]);
      if (d.absent > 0) {
        row.getCell(6).font = { name: "Calibri", size: 10, color: { argb: "FFB91C1C" } };
      }
      if (d.present > 0) {
        row.getCell(2).font = { name: "Calibri", size: 10, color: { argb: "FF047857" } };
      }
    });
    s1.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 6 } };

    // —— Sheet 3: Xodimlar jami ——
    const s3 = workbook.addWorksheet("Xodimlar jami", {
      views: [{ state: "frozen", ySplit: 2 }],
    });
    s3.mergeCells("A1:O1");
    const t3 = s3.getCell("A1");
    t3.value = `Xodimlar bo‘yicha jami (${from} — ${to}) · Har xodim o‘z ish vaqtiga qarab`;
    t3.font = { name: "Calibri", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
    t3.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3A5C" } };
    t3.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    s3.getRow(1).height = 30;

    const h3 = [
      "No",
      "F.I.Sh.",
      "Lavozim",
      "Bo‘lim",
      "Filial",
      "Smena",
      "Ish vaqti",
      "Kelgan kun",
      "Kelmagan kun",
      "Kechikkan kun",
      "Jami ishlagan",
      "Kechikish (jami)",
      "Erta kelish (jami)",
      "Erta ketish (jami)",
      "Qo'shimcha ish (jami)",
    ];
    h3.forEach((h, i) => {
      const cell = s3.getRow(2).getCell(i + 1);
      cell.value = h;
      headerStyle(cell, "FF1A5F8A");
    });
    s3.columns = [
      { width: 5 },
      { width: 26 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 14 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 18 },
    ];
    report.employees.forEach((e, idx) => {
      const empHours = `${e.workStart ?? WORK_START}–${e.workEnd ?? WORK_END}`;
      const row = s3.addRow([
        idx + 1,
        e.fullName,
        e.position,
        e.departmentName || "—",
        e.location || "—",
        smenaLabelForEmployee(e),
        empHours,
        e.totals.present,
        e.totals.absent,
        e.totals.late,
        e.totals.workedHours,
        e.totals.lateArrivalLabel,
        e.totals.earlyArrivalLabel,
        e.totals.earlyLeaveLabel,
        e.totals.overtimeLabel,
      ]);
      paintRow(row, idx % 2 === 0, [1, 8, 9, 10, 11]);
    });
    s3.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 15 } };

    const paintBanner = (row: ExcelJS.Row, fill: string, lastCol: number) => {
      for (let c = 1; c <= lastCol; c++) {
        const cell = row.getCell(c);
        cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
        cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      }
      row.height = 22;
    };

    // —— Sheet 4: Kelganlar ——
    const s4 = workbook.addWorksheet("Kelganlar", {
      views: [{ state: "frozen", ySplit: 2 }],
    });
    s4.mergeCells("A1:K1");
    const t4 = s4.getCell("A1");
    t4.value = `Kelganlar — batafsil (${from} — ${to})`;
    t4.font = { name: "Calibri", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
    t4.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF047857" } };
    t4.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    s4.getRow(1).height = 30;
    ["Sana", "No", "F.I.Sh.", "Smena", "Ish vaqti", "Holat", "Keldi", "Ketdi", "Kechikish", "Ishlangan", "Telefon"].forEach((h, i) => {
      const cell = s4.getRow(2).getCell(i + 1);
      cell.value = h;
      headerStyle(cell, "FF059669");
    });
    s4.columns = [
      { width: 12 },
      { width: 5 },
      { width: 26 },
      { width: 20 },
      { width: 12 },
      { width: 18 },
      { width: 10 },
      { width: 10 },
      { width: 14 },
      { width: 16 },
      { width: 16 },
    ];
    let presentCount = 0;
    report.days.forEach((day) => {
      const arrived = report.employees
        .map((e) => ({ e, d: e.days.find((x) => x.date === day.date) }))
        .filter(({ d }) => d && d.status !== "absent" && d.status !== "leave");
      if (arrived.length === 0) return;
      const banner = s4.addRow([`${day.date}  ·  ${arrived.length} kishi kelgan`, "", "", "", "", "", "", "", "", "", ""]);
      s4.mergeCells(banner.number, 1, banner.number, 11);
      paintBanner(banner, "FF047857", 11);
      arrived.forEach(({ e, d }, i) => {
        presentCount += 1;
        const empHours = {
          start: e.workStart ?? WORK_START,
          end: e.workEnd ?? WORK_END,
        };
        const cin = d!.checkIn && d!.checkIn !== "—" ? d!.checkIn : "—";
        const cout = d!.checkOut && d!.checkOut !== "—" ? d!.checkOut : "—";
        const kech = kechikishDisplay(d!);
        const row = s4.addRow([
          day.date,
          i + 1,
          e.fullName,
          smenaLabelForEmployee(e),
          `${empHours.start}–${empHours.end}`,
          davomatStatusLine(d!.status),
          cin,
          cout,
          kech,
          readableWorkedHours(d!.workedHours),
          e.phone || "—",
        ]);
        paintRow(row, i % 2 === 1, [1, 2, 6, 7, 8, 9, 10, 11]);
        if (kech !== "Yo'q") {
          row.getCell(9).font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFB91C1C" } };
        }
      });
    });
    if (presentCount === 0) {
      const row = s4.addRow(["—", "", "Bu davrda kelgan xodim yo‘q", "", "", "", "", "", "", "", ""]);
      paintRow(row, false);
    }

    // —— Sheet 5: Kelmaganlar ——
    const s5 = workbook.addWorksheet("Kelmaganlar", {
      views: [{ state: "frozen", ySplit: 2 }],
    });
    s5.mergeCells("A1:H1");
    const t5 = s5.getCell("A1");
    t5.value = `Kelmaganlar — batafsil (${from} — ${to})`;
    t5.font = { name: "Calibri", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
    t5.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB91C1C" } };
    t5.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    s5.getRow(1).height = 30;
    ["Sana", "No", "F.I.Sh.", "Lavozim", "Smena", "Filial", "Bo‘lim", "Telefon"].forEach((h, i) => {
      const cell = s5.getRow(2).getCell(i + 1);
      cell.value = h;
      headerStyle(cell, "FFBE123C");
    });
    s5.columns = [
      { width: 12 },
      { width: 5 },
      { width: 26 },
      { width: 16 },
      { width: 20 },
      { width: 14 },
      { width: 16 },
      { width: 16 },
    ];
    let absentCount = 0;
    report.days.forEach((day) => {
      const missing = report.employees
        .map((e) => ({ e, d: e.days.find((x) => x.date === day.date) }))
        .filter(({ d }) => d?.status === "absent");
      if (missing.length === 0) return;
      const banner = s5.addRow([`${day.date}  ·  ${missing.length} kishi kelmagan`, "", "", "", "", "", "", ""]);
      s5.mergeCells(banner.number, 1, banner.number, 8);
      paintBanner(banner, "FFB91C1C", 8);
      missing.forEach(({ e }, i) => {
        absentCount += 1;
        const row = s5.addRow([
          day.date,
          i + 1,
          e.fullName,
          e.position,
          smenaLabelForEmployee(e),
          e.location || "—",
          e.departmentName || "—",
          e.phone || "—",
        ]);
        paintRow(row, i % 2 === 1, [1, 2, 8]);
      });
    });
    if (absentCount === 0) {
      const row = s5.addRow(["—", "", "Bu davrda kelmagan xodim yo‘q", "", "", "", "", ""]);
      paintRow(row, false);
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const stamp = `${from}_${to}`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="davomat_${stamp}.xlsx"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(buffer);
  } catch (err) {
    console.error("GET /davomat/export error:", err);
    res.status(503).json({ error: "Excel yuklanmadi" });
  }
});

function assignedBranchIdForEmp(emp: WorkplaceEmp): number | null {
  if (emp.assignedBranchId) return emp.assignedBranchId;
  if (emp.orgRole === "manager") return emp.id;
  return emp.reportsToId ?? null;
}

/** Doimiy + kunlik rotatsiya (temp_one_day / substitute / …) */
async function effectiveBranchIdForDay(
  emp: WorkplaceEmp,
  workDate?: string,
): Promise<{ branchId: number | null; branchLabel: string | null }> {
  const permanent = assignedBranchIdForEmp(emp);
  const permanentLabel = displayBranchName(emp.location) || emp.location || emp.fullName || null;
  try {
    const date = workDate || todayTashkent();
    const assignRows = await db
      .select()
      .from(employeeBranchAssignmentsTable)
      .where(eq(employeeBranchAssignmentsTable.employeeId, emp.id));
    if (!assignRows.length) {
      return { branchId: permanent, branchLabel: permanentLabel };
    }
    const mapped: BranchAssignment[] = assignRows.map((r) => ({
      kind: r.kind as BranchAssignment["kind"],
      branchId: r.branchId,
      branchLabel: r.branchLabel,
      validFrom: r.validFrom,
      validTo: r.validTo,
      replacesEmployeeId: r.replacesEmployeeId,
    }));
    const resolved = resolveBranchForDay(
      date,
      mapped,
      permanent ? { branchId: permanent, branchLabel: permanentLabel } : null,
    );
    return {
      branchId: resolved?.branchId ?? permanent,
      branchLabel: resolved?.branchLabel || permanentLabel,
    };
  } catch {
    return { branchId: permanent, branchLabel: permanentLabel };
  }
}

/** Kunlik smena rejasini (rotatsiya) encoded shiftType sifatida qaytaradi */
async function dayShiftTypeFor(employeeId: number, workDate: string): Promise<string | null> {
  try {
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
  } catch {
    return null;
  }
}

/** Filial QR ko‘rish — mudir, koordinator, admin, direktor */
function canViewBranchQr(role: string | null | undefined) {
  return role === "mudir" || role === "koordinator" || role === "admin" || role === "director";
}

/** Filial QR yaratish/yangilash/o‘chirish — faqat admin va koordinator */
function canEditBranchQr(role: string | null | undefined) {
  return role === "koordinator" || role === "admin";
}

function isQrAdmin(role: string | null | undefined) {
  return role === "admin" || role === "director";
}

/** Barcha ofis xodimlari uchun bitta umumiy QR (department_id = 0) */
export const OFFICE_SHARED_QR_DEPARTMENT_ID = 0;
export const OFFICE_SHARED_QR_LABEL = "Ofis";

function isOfficeSharedQrDepartment(departmentId: number | null | undefined) {
  return Number(departmentId) === OFFICE_SHARED_QR_DEPARTMENT_ID;
}

/** Ofis QR ko‘rish/yuklash — admin, direktor, bo‘lim boshliqlari */
function canViewDeptQrRole(role: string | null | undefined) {
  if (!role) return false;
  if (isQrAdmin(role)) return true;
  if (isDeptHeadRole(role)) return true;
  return /_rahbar$/.test(role);
}

/** Ofis QR yaratish/yangilash/o‘chirish — faqat admin */
function canEditDeptQrRole(role: string | null | undefined) {
  return role === "admin";
}

/** @deprecated use canViewDeptQrRole / canEditDeptQrRole */
function canManageDeptQrRole(role: string | null | undefined) {
  return canViewDeptQrRole(role);
}

/** Faqat admin: istalgan filial/bo‘lim QR + lokatsiya shartsiz (geofence yo‘q) */
function isAdminQrAnywhere(role: string | null | undefined) {
  return role === "admin";
}

async function assertCanViewDeptQr(
  role: string | null | undefined,
  userId: number,
  departmentId: number,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!canViewDeptQrRole(role)) {
    return { ok: false, status: 403, error: "Bo‘lim QR ko‘rishga ruxsat yo‘q" };
  }
  if (isOfficeSharedQrDepartment(departmentId)) {
    return { ok: true };
  }
  if (isQrAdmin(role)) return { ok: true };
  const [me] = await db
    .select({ departmentId: usersTable.departmentId })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!me?.departmentId || me.departmentId !== departmentId) {
    return { ok: false, status: 403, error: "Faqat o‘z bo‘limingiz QR ini ko‘rishingiz mumkin" };
  }
  return { ok: true };
}

async function assertCanEditDeptQr(
  role: string | null | undefined,
  _userId: number,
  departmentId: number,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!canEditDeptQrRole(role)) {
    return {
      ok: false,
      status: 403,
      error: "Ofis QR yaratish/o‘chirish faqat admin uchun. Boshqalar faqat ko‘radi yoki yuklab oladi.",
    };
  }
  if (!isOfficeSharedQrDepartment(departmentId) && !isQrAdmin(role)) {
    return { ok: false, status: 403, error: "Faqat umumiy Ofis QR boshqariladi" };
  }
  return { ok: true };
}

/** legacy alias */
async function assertCanAccessDeptQr(
  role: string | null | undefined,
  userId: number,
  departmentId: number,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  return assertCanEditDeptQr(role, userId, departmentId);
}

async function assertCanAccessBranchQr(
  role: string | null | undefined,
  userId: number,
  branchId: number,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (isQrAdmin(role)) return { ok: true };
  const me = await findEmployeeByUserId(userId);
  const [branch] = await db
    .select({
      id: employeesTable.id,
      orgRole: employeesTable.orgRole,
      reportsToId: employeesTable.reportsToId,
    })
    .from(employeesTable)
    .where(eq(employeesTable.id, branchId))
    .limit(1);
  if (!branch || branch.orgRole !== "manager") {
    return { ok: false, status: 404, error: "Filial topilmadi" };
  }
  if (role === "mudir" && me && branch.id === me.id) return { ok: true };
  if (role === "koordinator" && me && (branch.reportsToId === me.id || branch.id === me.id)) return { ok: true };
  return { ok: false, status: 403, error: "Bu filial QR iga ruxsat yo‘q" };
}

/** QR ro‘yxat / ko‘rish — mudir, koordinator, admin */
router.get("/davomat/qr/branches", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canViewBranchQr(req.userRole)) {
    res.status(403).json({ error: "Filial QR ko‘rishga ruxsat yo‘q", code: "qr_forbidden" });
    return;
  }
  try {
    const me = await findEmployeeByUserId(req.userId!);
    const managers = await db
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
      .where(eq(employeesTable.orgRole, "manager"));

    /** Bo‘shatilgan / dublikat filiallar chiqariladi — faqat haqiqiy ishlaydigan */
    let list = dedupeBranchesWithGps(managers);

    if (req.userRole === "mudir" && me) {
      list = list.filter((m) => m.id === me.id);
    } else if (req.userRole === "koordinator" && me) {
      list = list.filter((m) => m.reportsToId === me.id || m.id === me.id);
    }
    // admin/director — barcha (dedupe qilingan) filiallar

    const branches = await Promise.all(
      list.map(async (m) => {
        const active = await getActiveQrForBranch(m.id);
        return {
          id: m.id,
          name: displayBranchName(m.location) || m.location || m.fullName,
          managerName: m.fullName,
          hasActiveQr: Boolean(active),
          hasPayload: Boolean(active?.tokenPayload),
          qrId: active?.qrId ?? null,
          version: active?.version ?? null,
          createdAt: active?.createdAt?.toISOString() ?? null,
        };
      }),
    );
    branches.sort((a, b) => a.name.localeCompare(b.name, "uz"));
    res.json({ branches });
  } catch (err) {
    console.error("GET /davomat/qr/branches error:", err);
    res.status(503).json({ error: "Filiallar yuklanmadi" });
  }
});

/** Yangi QR yaratish — eski active bekor; payload DB da saqlanadi (qayta ko‘rinadi) */
router.post("/davomat/qr/issue", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canEditBranchQr(req.userRole)) {
    res.status(403).json({
      error: "QR yaratish faqat admin yoki koordinator uchun (mudir faqat ko‘radi)",
      code: "qr_forbidden",
    });
    return;
  }
  try {
    const branchId = Number(req.body?.branchId);
    if (!Number.isFinite(branchId)) {
      res.status(400).json({ error: "branchId majburiy" });
      return;
    }
    const access = await assertCanAccessBranchQr(req.userRole, req.userId!, branchId);
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const [branch] = await db
      .select({
        id: employeesTable.id,
        fullName: employeesTable.fullName,
        location: employeesTable.location,
        orgRole: employeesTable.orgRole,
      })
      .from(employeesTable)
      .where(eq(employeesTable.id, branchId))
      .limit(1);
    if (!branch || branch.orgRole !== "manager") {
      res.status(404).json({ error: "Filial (mudir) topilmadi" });
      return;
    }

    const prev = await getActiveQrForBranch(branchId);
    await revokeActiveQrForBranch(branchId);
    const secrets = mintQrSecrets();
    const version = (prev?.version ?? 0) + 1;
    const label = displayBranchName(branch.location) || branch.location || branch.fullName;
    const payload = encodeQrPayload(secrets.qrId, secrets.rawToken);
    const [row] = await db
      .insert(branchAttendanceQrTable)
      .values({
        qrId: secrets.qrId,
        branchId,
        branchLabel: label,
        tokenHash: secrets.tokenHash,
        tokenPayload: payload,
        version,
        status: "active",
        createdById: req.userId!,
        expiresAt: null,
      })
      .returning();

    res.json({
      ok: true,
      qrId: row.qrId,
      branchId,
      branchLabel: label,
      version: row.version,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      expiresAt: null,
      payload,
      note: "QR saqlandi — mudir ko‘ra oladi. Yangi yaratilsa eski o‘chadi.",
    });
  } catch (err) {
    console.error("POST /davomat/qr/issue error:", err);
    res.status(503).json({ error: "QR yaratilmadi" });
  }
});

/** Faol QR + payload — mudir/koordinator/admin qayta ko‘radi */
router.get("/davomat/qr/active/:branchId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canViewBranchQr(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q", code: "qr_forbidden" });
    return;
  }
  const branchId = Number(req.params.branchId);
  if (!Number.isFinite(branchId)) {
    res.status(400).json({ error: "branchId noto‘g‘ri" });
    return;
  }
  const access = await assertCanAccessBranchQr(req.userRole, req.userId!, branchId);
  if (!access.ok) {
    res.status(access.status).json({ error: access.error });
    return;
  }
  const active = await getActiveQrForBranch(branchId);
  if (!active) {
    res.json({ active: null });
    return;
  }
  res.json({
    active: {
      qrId: active.qrId,
      branchId: active.branchId,
      branchLabel: active.branchLabel,
      version: active.version,
      status: active.status,
      createdAt: active.createdAt.toISOString(),
      expiresAt: active.expiresAt?.toISOString() ?? null,
      payload: active.tokenPayload || null,
      needsReissue: !active.tokenPayload,
    },
  });
});

/** Faol QR ni bekor qilish — faqat koordinator/admin (mudir o‘chira olmaydi) */
router.delete("/davomat/qr/active/:branchId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canEditBranchQr(req.userRole)) {
    res.status(403).json({
      error: "QR o‘chirish faqat admin yoki koordinator uchun",
      code: "qr_forbidden",
    });
    return;
  }
  const branchId = Number(req.params.branchId);
  if (!Number.isFinite(branchId)) {
    res.status(400).json({ error: "branchId noto‘g‘ri" });
    return;
  }
  const access = await assertCanAccessBranchQr(req.userRole, req.userId!, branchId);
  if (!access.ok) {
    res.status(access.status).json({ error: access.error });
    return;
  }
  const before = await getActiveQrForBranch(branchId);
  if (!before) {
    res.json({ ok: true, revoked: false });
    return;
  }
  await revokeActiveQrForBranch(branchId);
  res.json({ ok: true, revoked: true, qrId: before.qrId, version: before.version });
});

/** Ofis QR — ko‘rish: admin/direktor/bo‘lim boshliqlari; yaratish: faqat admin */
router.get("/davomat/qr/departments", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canViewDeptQrRole(req.userRole)) {
    res.status(403).json({ error: "Bo‘lim QR ko‘rishga ruxsat yo‘q", code: "qr_forbidden" });
    return;
  }
  try {
    const officeActive = await getActiveQrForDepartment(OFFICE_SHARED_QR_DEPARTMENT_ID);
    res.json({
      departments: [
        {
          id: OFFICE_SHARED_QR_DEPARTMENT_ID,
          name: OFFICE_SHARED_QR_LABEL,
          hasActiveQr: Boolean(officeActive),
          hasPayload: Boolean(officeActive?.tokenPayload),
          qrId: officeActive?.qrId ?? null,
          version: officeActive?.version ?? null,
          createdAt: officeActive?.createdAt?.toISOString() ?? null,
          sharedOffice: true,
          canEdit: canEditDeptQrRole(req.userRole),
        },
      ],
    });
  } catch (err) {
    console.error("GET /davomat/qr/departments error:", err);
    res.status(503).json({ error: "Bo‘limlar yuklanmadi" });
  }
});

router.post("/davomat/qr/department/issue", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canEditDeptQrRole(req.userRole)) {
    res.status(403).json({
      error: "Ofis QR yaratish faqat admin uchun",
      code: "qr_create_admin_only",
    });
    return;
  }
  try {
    const departmentId = Number(req.body?.departmentId);
    if (!Number.isFinite(departmentId)) {
      res.status(400).json({ error: "departmentId majburiy" });
      return;
    }
    if (!isOfficeSharedQrDepartment(departmentId)) {
      res.status(400).json({
        error: "Faqat umumiy Ofis QR yaratiladi. Alohida bo‘lim QR o‘chirilgan.",
        code: "only_office_qr",
      });
      return;
    }
    const access = await assertCanEditDeptQr(req.userRole, req.userId!, departmentId);
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const label = OFFICE_SHARED_QR_LABEL;
    const prev = await getActiveQrForDepartment(departmentId);
    await revokeActiveQrForDepartment(departmentId);
    const secrets = mintQrSecrets();
    const version = (prev?.version ?? 0) + 1;
    const payload = encodeQrPayload(secrets.qrId, secrets.rawToken);
    const [row] = await db
      .insert(departmentAttendanceQrTable)
      .values({
        qrId: secrets.qrId,
        departmentId,
        departmentLabel: label,
        tokenHash: secrets.tokenHash,
        tokenPayload: payload,
        version,
        status: "active",
        createdById: req.userId!,
        expiresAt: null,
      })
      .returning();

    res.json({
      ok: true,
      qrId: row.qrId,
      departmentId,
      departmentLabel: label,
      version: row.version,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      expiresAt: null,
      payload,
      sharedOffice: true,
      note: "Ofis QR saqlandi. Faqat ofis xodimlari yashil zonada skaner yoki Face ID qiladi. Mudir/farmasevt/stajyor — filial QR.",
    });
  } catch (err) {
    console.error("POST /davomat/qr/department/issue error:", err);
    res.status(503).json({ error: "Bo‘lim QR yaratilmadi" });
  }
});

router.get("/davomat/qr/department/active/:departmentId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canViewDeptQrRole(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q", code: "qr_forbidden" });
    return;
  }
  const departmentId = Number(req.params.departmentId);
  if (!Number.isFinite(departmentId)) {
    res.status(400).json({ error: "departmentId noto‘g‘ri" });
    return;
  }
  const access = await assertCanViewDeptQr(req.userRole, req.userId!, departmentId);
  if (!access.ok) {
    res.status(access.status).json({ error: access.error });
    return;
  }
  const active = await getActiveQrForDepartment(departmentId);
  if (!active) {
    res.json({ active: null });
    return;
  }
  res.json({
    active: {
      qrId: active.qrId,
      departmentId: active.departmentId,
      departmentLabel: active.departmentLabel,
      version: active.version,
      status: active.status,
      createdAt: active.createdAt.toISOString(),
      expiresAt: active.expiresAt?.toISOString() ?? null,
      payload: active.tokenPayload || null,
      needsReissue: !active.tokenPayload,
    },
  });
});

router.delete("/davomat/qr/department/active/:departmentId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canEditDeptQrRole(req.userRole)) {
    res.status(403).json({
      error: "Ofis QR o‘chirish faqat admin uchun",
      code: "qr_revoke_admin_only",
    });
    return;
  }
  const departmentId = Number(req.params.departmentId);
  if (!Number.isFinite(departmentId)) {
    res.status(400).json({ error: "departmentId noto‘g‘ri" });
    return;
  }
  const access = await assertCanEditDeptQr(req.userRole, req.userId!, departmentId);
  if (!access.ok) {
    res.status(access.status).json({ error: access.error });
    return;
  }
  const before = await getActiveQrForDepartment(departmentId);
  if (!before) {
    res.json({ ok: true, revoked: false });
    return;
  }
  await revokeActiveQrForDepartment(departmentId);
  res.json({ ok: true, revoked: true, qrId: before.qrId, version: before.version });
});

/**
 * QR orqali davomat — Face ID talab qilinmaydi.
 * Filial QR: farmasevt yo‘li + filial GPS.
 * Bo‘lim QR: ofis xodimi + ofis GPS (100 m).
 * Admin: istalgan QR, lokatsiya shartsiz.
 */
router.post("/davomat/qr-punch", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const latitudeRaw = Number(req.body?.latitude);
  const longitudeRaw = Number(req.body?.longitude);
  const accuracy = Number(req.body?.accuracy);
  const actionRaw = String(req.body?.action || "");
  const action = actionRaw === "out" ? "out" : actionRaw === "in" ? "in" : null;
  const payload = String(req.body?.payload || req.body?.qr || "").trim();
  const ip = clientIp(req);
  const deviceId = req.body?.deviceId ? String(req.body.deviceId).slice(0, 120) : null;

  try {
    if (!action) {
      res.status(400).json({ error: "action: in | out", code: "action_required" });
      return;
    }
    if (!payload) {
      res.status(400).json({ error: "QR payload majburiy", code: "qr_required" });
      return;
    }

    const [user] = await db
      .select({
        id: usersTable.id,
        fullName: usersTable.fullName,
        status: usersTable.status,
        role: usersTable.role,
        departmentId: usersTable.departmentId,
      })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId!))
      .limit(1);
    if (!user || (user.status !== "active" && user.status !== "on_leave")) {
      res.status(403).json({ error: "Profil faol emas", code: "user_inactive" });
      return;
    }

    const adminAnywhere = isAdminQrAnywhere(user.role);
    const hasGps = Number.isFinite(latitudeRaw) && Number.isFinite(longitudeRaw);

    if (!hasGps && !adminAnywhere) {
      await writePunchAudit({
        userId: req.userId,
        verificationMethod: "QR",
        action,
        gpsResult: "missing",
        finalResult: "denied",
        failureReason: "gps_required",
        ipAddress: ip,
        deviceId,
      });
      res.status(400).json({ error: "GPS majburiy — lokatsiyaga ruxsat bering", code: "gps_required" });
      return;
    }

    const emp = await ensureEmployeeForUser(user);
    const pharmacy = usesBranchDavomat(user.role, emp.orgRole);
    const effective = await effectiveBranchIdForDay(emp);
    const myBranchId = effective.branchId;
    const myDeptId = user.departmentId;

    const branchQr = await verifyBranchQrPayload(payload);
    if (branchQr.ok) {
      /** Filial QR: apteka yo‘li yoki filial biriktirilgan xodim; ofis — bo‘lim QR */
      const canUseBranchQr = pharmacy || adminAnywhere || Boolean(myBranchId);
      if (!canUseBranchQr) {
        await writePunchAudit({
          employeeId: emp.id,
          userId: user.id,
          verificationMethod: "QR",
          action,
          finalResult: "denied",
          failureReason: "role_not_allowed",
          ipAddress: ip,
          deviceId,
        });
        res.status(403).json({
          error: "Filial QR uchun filial biriktirilmagan. Ofis xodimi — bo‘lim QR ini skaner qiling.",
          code: "role_not_allowed",
        });
        return;
      }
      if (!adminAnywhere && !myBranchId) {
        res.status(400).json({
          error: "Filial biriktirilmagan — avval smena/filial belgilansin",
          code: "branch_unassigned",
        });
        return;
      }
      if (!adminAnywhere && branchQr.row.branchId !== myBranchId) {
        await writePunchAudit({
          employeeId: emp.id,
          userId: user.id,
          branchId: myBranchId,
          verificationMethod: "QR",
          action,
          qrResult: "wrong_branch",
          finalResult: "denied",
          failureReason: "QR boshqa filialga tegishli",
          ipAddress: ip,
          deviceId,
          meta: { qrBranchId: branchQr.row.branchId, myBranchId },
        });
        res.status(403).json({
          error: "Bu QR boshqa filialniki. Faqat o‘z filialingiz QR i bilan davomat qiling.",
          code: "qr_wrong_branch",
          myBranchId,
          qrBranchId: branchQr.row.branchId,
        });
        return;
      }

      const punchBranchId = adminAnywhere ? branchQr.row.branchId : myBranchId!;
      let latitude = hasGps ? latitudeRaw : 0;
      let longitude = hasGps ? longitudeRaw : 0;
      let distanceMeters = 0;
      let allowedMeters = 0;
      let gpsResult: string = adminAnywhere ? "admin_bypass" : "ok";

      if (!adminAnywhere) {
        const gate = await geoGate(
          emp,
          user.role,
          latitude,
          longitude,
          Number.isFinite(accuracy) ? accuracy : undefined,
        );
        if (!gate.ok) {
          await writePunchAudit({
            employeeId: emp.id,
            userId: user.id,
            branchId: myBranchId,
            verificationMethod: "QR",
            action,
            gpsResult: String(gate.body.code || "outside"),
            gpsDistance: typeof gate.body.distanceMeters === "number" ? gate.body.distanceMeters : null,
            qrResult: "ok",
            finalResult: "denied",
            failureReason: String(gate.body.error || "geofence"),
            ipAddress: ip,
            deviceId,
          });
          res.status(gate.status).json(gate.body);
          return;
        }
        distanceMeters = gate.distanceMeters;
        allowedMeters = gate.effectiveRadius;
        gpsResult = "ok";
      } else if (hasGps) {
        try {
          const resolved = await resolveDavomatPoint(emp, user.role);
          if (resolved.ok) {
            distanceMeters = haversineMeters(latitude, longitude, resolved.point.latitude, resolved.point.longitude);
            allowedMeters = geofenceMetersForKind(resolved.point.kind);
          }
        } catch {
          /* ignore */
        }
      } else {
        const [branch] = await db
          .select({
            latitude: employeesTable.latitude,
            longitude: employeesTable.longitude,
          })
          .from(employeesTable)
          .where(eq(employeesTable.id, punchBranchId))
          .limit(1);
        if (
          branch?.latitude != null &&
          branch?.longitude != null &&
          Number.isFinite(branch.latitude) &&
          Number.isFinite(branch.longitude)
        ) {
          latitude = branch.latitude;
          longitude = branch.longitude;
        }
      }

      const punched = await applyFacePunch({
        emp,
        userRole: user.role,
        latitude,
        longitude,
        distanceMeters,
        allowedMeters: adminAnywhere ? Math.max(allowedMeters, 999_999) : allowedMeters,
        faceProfileId: null,
        action,
        verificationMethod: "QR",
        resolvedBranchId: punchBranchId,
        resolvedBranchLabel: branchQr.row.branchLabel || null,
      });
      if (!punched.ok) {
        await writePunchAudit({
          employeeId: emp.id,
          userId: user.id,
          branchId: punchBranchId,
          verificationMethod: "QR",
          action,
          gpsResult,
          gpsDistance: distanceMeters,
          qrResult: "ok",
          finalResult: "denied",
          failureReason: String(punched.body.error || punched.body.code || "denied"),
          ipAddress: ip,
          deviceId,
          meta: adminAnywhere ? { adminQrAnywhere: true } : undefined,
        });
        res.status(punched.status).json(punched.body);
        return;
      }

      await writePunchAudit({
        employeeId: emp.id,
        userId: user.id,
        branchId: punchBranchId,
        verificationMethod: "QR",
        action,
        gpsResult,
        gpsDistance: distanceMeters,
        qrResult: "ok",
        finalResult: "success",
        ipAddress: ip,
        deviceId,
        meta: adminAnywhere ? { adminQrAnywhere: true, qrBranchId: branchQr.row.branchId } : undefined,
      });

      const own = await ownEmployeeReport(emp.id);
      res.json({
        ...punched.payload,
        employee: own.employee,
        branchId: punchBranchId,
        branchLabel: branchQr.row.branchLabel,
        adminQrAnywhere: adminAnywhere || undefined,
      });
      return;
    }

    const deptQr = await verifyDepartmentQrPayload(payload);
    if (!deptQr.ok) {
      await writePunchAudit({
        employeeId: emp.id,
        userId: user.id,
        branchId: myBranchId,
        verificationMethod: "QR",
        action,
        qrResult: deptQr.code !== "qr_unknown" ? deptQr.code : branchQr.code,
        finalResult: "denied",
        failureReason: deptQr.code !== "qr_unknown" ? deptQr.error : branchQr.error,
        ipAddress: ip,
        deviceId,
      });
      const fail = deptQr.code !== "qr_unknown" ? deptQr : branchQr;
      res.status(400).json({ error: fail.error, code: fail.code });
      return;
    }

    const sharedOffice =
      isOfficeSharedQrDepartment(deptQr.row.departmentId) ||
      String(deptQr.row.departmentLabel || "").trim().toLowerCase() === "ofis";

    if (!sharedOffice) {
      res.status(403).json({
        error: "Alohida bo‘lim QR o‘chirilgan. Ofis QR yoki Face ID ishlating.",
        code: "dept_qr_disabled",
      });
      return;
    }

    // Ofis QR faqat ofis xodimlari — mudir/farmasevt/stajyor filial QR ishlatadi
    if (!adminAnywhere && usesBranchDavomat(user.role, emp.orgRole)) {
      await writePunchAudit({
        employeeId: emp.id,
        userId: user.id,
        verificationMethod: "QR",
        action,
        qrResult: "office_qr_pharmacy_blocked",
        finalResult: "denied",
        failureReason: "Apteka xodimi Ofis QR ishlata olmaydi",
        ipAddress: ip,
        deviceId,
      });
      res.status(403).json({
        error: "Ofis QR faqat ofis xodimlari uchun. O‘z filialingiz QR kodini skaner qiling (yoki Face ID).",
        code: "office_qr_pharmacy",
      });
      return;
    }

    // Ofis QR: asosiy ofis yashil zonasi (100 m)
    let latitude = hasGps ? latitudeRaw : DAVOMAT_SITE_LAT;
    let longitude = hasGps ? longitudeRaw : DAVOMAT_SITE_LNG;
    let distanceMeters = 0;
    let allowedMeters = DAVOMAT_OFFICE_GEOFENCE_METERS;
    let gpsResult: string = adminAnywhere ? "admin_bypass" : "ok";

    if (!adminAnywhere) {
      if (!hasGps) {
        res.status(400).json({
          error: "Lokatsiya yoqilishi shart — ofis yashil zonasida bo‘ling",
          code: "gps_required",
        });
        return;
      }
      distanceMeters = haversineMeters(latitude, longitude, DAVOMAT_SITE_LAT, DAVOMAT_SITE_LNG);
      if (distanceMeters > allowedMeters) {
        const remainMeters = distanceMeters - allowedMeters;
        await writePunchAudit({
          employeeId: emp.id,
          userId: user.id,
          verificationMethod: "QR",
          action,
          gpsResult: "outside",
          gpsDistance: distanceMeters,
          qrResult: "ok",
          finalResult: "denied",
          failureReason: "outside_office_geofence",
          ipAddress: ip,
          deviceId,
          meta: { qrKind: "office_shared" },
        });
        res.status(403).json({
          error: `Hududdan tashqaridasiz (asosiy ofis): ${distanceMeters} m. Ruxsat faqat ${allowedMeters} m. Yana ${remainMeters} m yaqinlashishingiz kerak.`,
          code: "outside_geofence",
          distanceMeters,
          remainMeters,
          allowedMeters,
          workplace: {
            location: `Asosiy ofis · ${DAVOMAT_SITE_LABEL}`,
            latitude: DAVOMAT_SITE_LAT,
            longitude: DAVOMAT_SITE_LNG,
            kind: "office",
          },
          fullName: emp.fullName,
        });
        return;
      }
      gpsResult = "ok";
    } else if (hasGps) {
      distanceMeters = haversineMeters(latitude, longitude, DAVOMAT_SITE_LAT, DAVOMAT_SITE_LNG);
    }

    const punched = await applyFacePunch({
      emp,
      userRole: user.role,
      latitude,
      longitude,
      distanceMeters,
      allowedMeters: adminAnywhere ? Math.max(allowedMeters, 999_999) : allowedMeters,
      faceProfileId: null,
      action,
      verificationMethod: "QR",
      resolvedBranchId: null,
      resolvedBranchLabel: OFFICE_SHARED_QR_LABEL,
    });
    if (!punched.ok) {
      await writePunchAudit({
        employeeId: emp.id,
        userId: user.id,
        verificationMethod: "QR",
        action,
        gpsResult,
        gpsDistance: distanceMeters,
        qrResult: "ok",
        finalResult: "denied",
        failureReason: String(punched.body.error || punched.body.code || "denied"),
        ipAddress: ip,
        deviceId,
        meta: { qrKind: "office_shared", departmentId: deptQr.row.departmentId },
      });
      res.status(punched.status).json(punched.body);
      return;
    }

    await writePunchAudit({
      employeeId: emp.id,
      userId: user.id,
      verificationMethod: "QR",
      action,
      gpsResult,
      gpsDistance: distanceMeters,
      qrResult: "ok",
      finalResult: "success",
      ipAddress: ip,
      deviceId,
      meta: {
        qrKind: "office_shared",
        departmentId: deptQr.row.departmentId,
        ...(adminAnywhere ? { adminQrAnywhere: true } : {}),
      },
    });

    const own = await ownEmployeeReport(emp.id);
    res.json({
      ...punched.payload,
      employee: own.employee,
      departmentId: OFFICE_SHARED_QR_DEPARTMENT_ID,
      departmentLabel: OFFICE_SHARED_QR_LABEL,
      sharedOffice: true,
      adminQrAnywhere: adminAnywhere || undefined,
    });
  } catch (err) {
    console.error("POST /davomat/qr-punch error:", err);
    await writePunchAudit({
      userId: req.userId,
      verificationMethod: "QR",
      action: action || null,
      finalResult: "error",
      failureReason: "server_error",
      ipAddress: ip,
      deviceId,
    });
    res.status(503).json({ error: "QR davomat yozilmadi" });
  }
});

/** Workplace: Face ID | QR — barcha xodimlar (apteka, ofis, boshqa) */
router.get("/davomat/methods", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const [user] = await db
      .select({ id: usersTable.id, role: usersTable.role, departmentId: usersTable.departmentId, fullName: usersTable.fullName })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId!))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "User topilmadi" });
      return;
    }
    const emp = await ensureEmployeeForUser(user);
    const pharmacy = usesBranchDavomat(user.role, emp.orgRole);
    const adminQrAnywhere = isAdminQrAnywhere(user.role);
    /** Apteka emas — ofis / boshqa rollar (bo‘limi bo‘lmasa ham QR ko‘rinadi) */
    const officeStaff = !pharmacy;
    const viewBranch = canViewBranchQr(user.role);
    const editBranch = canEditBranchQr(user.role);
    const viewDept = canViewDeptQrRole(user.role);
    const editDept = canEditDeptQrRole(user.role);
    const methods: Array<"FACE_ID" | "QR"> = ["FACE_ID", "QR"];
    res.json({
      pharmacyStaff: pharmacy,
      officeStaff,
      adminQrAnywhere,
      methods,
      canManageQr: editBranch || editDept,
      canManageBranchQr: editBranch,
      canViewBranchQr: viewBranch,
      canManageDeptQr: editDept,
      canViewDeptQr: viewDept,
      assignedBranchId: assignedBranchIdForEmp(emp),
      departmentId: user.departmentId,
    });
  } catch (err) {
    console.error("GET /davomat/methods error:", err);
    res.status(503).json({ error: "Usullar yuklanmadi" });
  }
});

export default router;
