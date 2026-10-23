import { and, eq, ne } from "drizzle-orm";
import {
  attendanceRecordsTable,
  db,
  employeesTable,
  hikvisionPersonMapTable,
  usersTable,
} from "@workspace/db";
import { foldScript } from "./script-search";
import { actionFromAttendanceStatus, upsertHikvisionMapping } from "./hikvision-attendance";
import {
  fetchDeviceAttendanceEvents,
  hikvisionDeviceConfigured,
  type DeviceAcsEvent,
} from "./hikvision-device-client";
import { ensureHikvisionSchema } from "./ensure-schema";
import { logger } from "./logger";

type OfficePerson = {
  userId: number;
  employeeId: number;
  fullName: string;
  fold: string;
  tokens: string[];
};

const NON_OFFICE_USER_ROLES = new Set(["mudir", "farmasevt", "stajyor", "koordinator", "admin"]);
const NON_OFFICE_ORG_ROLES = new Set([
  "manager",
  "pharmacist",
  "intern",
  "coordinator",
  "supervisor",
]);
const PHARMACY_WORDS = new Set([
  "mudir",
  "farmasevt",
  "stajyor",
  "stajor",
  "koordinator",
  "фармацевт",
  "заведующий",
]);

function positionHasPharmacyWord(position: string): boolean {
  const tokens = String(position || "")
    .toLowerCase()
    .replace(/[ʻʼ'`´]/g, "'")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return tokens.some((w) => PHARMACY_WORDS.has(w));
}

function isOfficeCandidate(row: {
  userRole: string;
  orgRole: string | null;
  position: string;
}): boolean {
  if (NON_OFFICE_USER_ROLES.has(row.userRole)) return false;
  if (row.orgRole && NON_OFFICE_ORG_ROLES.has(row.orgRole)) return false;
  if (positionHasPharmacyWord(row.position)) return false;
  return true;
}

function nameTokensFold(name: string): string[] {
  return foldScript(name)
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/** Kirill/lotin farqsiz: familiya+ism mosligi */
export function namesMatchOffice(deviceName: string, hrName: string): boolean {
  const a = foldScript(deviceName);
  const b = foldScript(hrName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) {
    const shorter = Math.min(a.length, b.length);
    if (shorter >= 8) return true;
  }
  const ta = nameTokensFold(deviceName);
  const tb = nameTokensFold(hrName);
  if (ta.length < 2 || tb.length < 2) return false;
  const setB = new Set(tb);
  let shared = 0;
  for (const t of ta) {
    if (setB.has(t)) shared += 1;
    else {
      for (const u of setB) {
        if (t.length >= 4 && u.length >= 4 && (t.startsWith(u) || u.startsWith(t))) {
          shared += 1;
          break;
        }
      }
    }
  }
  return shared >= 2;
}

async function loadOfficePeople(): Promise<OfficePerson[]> {
  const rows = await db
    .select({
      userId: usersTable.id,
      employeeId: employeesTable.id,
      fullName: usersTable.fullName,
      empName: employeesTable.fullName,
      userRole: usersTable.role,
      orgRole: employeesTable.orgRole,
      position: employeesTable.position,
    })
    .from(usersTable)
    .innerJoin(employeesTable, eq(employeesTable.userId, usersTable.id))
    .where(and(eq(usersTable.status, "active"), ne(employeesTable.employmentStatus, "dismissed")));

  const out: OfficePerson[] = [];
  for (const r of rows) {
    if (!isOfficeCandidate(r)) continue;
    const fullName = String(r.fullName || r.empName || "").trim();
    if (!fullName) continue;
    out.push({
      userId: r.userId,
      employeeId: r.employeeId,
      fullName,
      fold: foldScript(fullName),
      tokens: nameTokensFold(fullName),
    });
  }
  return out;
}

function parseDeviceTime(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

function dayStatus(checkIn: Date | null, checkOut: Date | null, workDate: string): string {
  if (!checkIn && !checkOut) return "absent";
  if (checkIn && !checkOut) return "incomplete";
  if (!checkIn && checkOut) return "incomplete";
  const start = new Date(`${workDate}T09:00:00+05:00`);
  if (checkIn && checkIn.getTime() > start.getTime() + 5 * 60_000) return "late";
  return "present";
}

type PersonAgg = {
  person: OfficePerson;
  employeeNo?: string;
  matchBy: string;
  firstIn: Date | null;
  lastIn: Date | null;
  lastOut: Date | null;
  events: number;
};

function resolvePerson(
  ev: DeviceAcsEvent,
  byEmpNo: Map<string, OfficePerson>,
  office: OfficePerson[],
): { person: OfficePerson; matchBy: string } | null {
  const no = String(ev.employeeNo || "").trim();
  if (no && byEmpNo.has(no)) {
    return { person: byEmpNo.get(no)!, matchBy: `map:${no}` };
  }
  const name = String(ev.name || "").trim();
  if (!name) return null;
  const hits = office.filter((p) => namesMatchOffice(name, p.fullName));
  if (hits.length === 1) return { person: hits[0]!, matchBy: "name" };
  if (hits.length > 1) {
    // Eng uzun fold o‘xshashligi
    hits.sort((a, b) => b.fold.length - a.fold.length);
    return { person: hits[0]!, matchBy: "name_ambiguous" };
  }
  return null;
}

export type HikvisionSyncResult = {
  ok: boolean;
  workDate: string;
  deviceEvents: number;
  matchedPeople: number;
  written: number;
  unmatched: Array<{ name?: string; employeeNo?: string; time: string; label?: string }>;
  updated: Array<{
    fullName: string;
    userId: number;
    checkIn: string | null;
    checkOut: string | null;
    matchBy: string;
  }>;
  error?: string;
};

/**
 * Qurilmadan kunlik Keldim/Ketdim → faqat ofis xodimlari (kirill/lotin ism) → attendance_records.
 */
export async function syncHikvisionDayFromDevice(workDate: string): Promise<HikvisionSyncResult> {
  const date = String(workDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return {
      ok: false,
      workDate: date,
      deviceEvents: 0,
      matchedPeople: 0,
      written: 0,
      unmatched: [],
      updated: [],
      error: "Sana YYYY-MM-DD bo‘lishi kerak",
    };
  }
  if (!hikvisionDeviceConfigured()) {
    return {
      ok: false,
      workDate: date,
      deviceEvents: 0,
      matchedPeople: 0,
      written: 0,
      unmatched: [],
      updated: [],
      error: "HIKVISION_DEVICE_PASSWORD sozlanmagan",
    };
  }

  await ensureHikvisionSchema().catch(() => undefined);

  let events: DeviceAcsEvent[];
  try {
    events = await fetchDeviceAttendanceEvents(date);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Qurilmaga ulanib bo‘lmadi";
    logger.error({ err, workDate: date }, "hikvision device sync fetch failed");
    return {
      ok: false,
      workDate: date,
      deviceEvents: 0,
      matchedPeople: 0,
      written: 0,
      unmatched: [],
      updated: [],
      error: msg.includes("Failed to connect") || msg.includes("Connection refused")
        ? "Qurilmaga ulanib bo‘lmadi (VPS → Face ID tarmog‘i). Tunnel yoki VPN tekshiring."
        : msg,
    };
  }

  const office = await loadOfficePeople();
  const maps = await db.select().from(hikvisionPersonMapTable);
  const byEmpNo = new Map<string, OfficePerson>();
  const officeByUser = new Map(office.map((p) => [p.userId, p]));
  for (const m of maps) {
    const p = officeByUser.get(m.userId);
    if (p) byEmpNo.set(String(m.employeeNo).trim(), p);
  }

  const aggs = new Map<number, PersonAgg>();
  const unmatched: HikvisionSyncResult["unmatched"] = [];

  for (const ev of events) {
    const resolved = resolvePerson(ev, byEmpNo, office);
    if (!resolved) {
      unmatched.push({
        name: ev.name,
        employeeNo: ev.employeeNo,
        time: ev.time,
        label: ev.label || ev.attendanceStatus,
      });
      continue;
    }
    const at = parseDeviceTime(ev.time);
    if (!at) continue;
    const action = actionFromAttendanceStatus(ev.attendanceStatus, ev.label);
    let agg = aggs.get(resolved.person.userId);
    if (!agg) {
      agg = {
        person: resolved.person,
        employeeNo: ev.employeeNo,
        matchBy: resolved.matchBy,
        firstIn: null,
        lastIn: null,
        lastOut: null,
        events: 0,
      };
      aggs.set(resolved.person.userId, agg);
    }
    agg.events += 1;
    if (ev.employeeNo) agg.employeeNo = ev.employeeNo;
    if (action === "in") {
      if (!agg.firstIn || at < agg.firstIn) agg.firstIn = at;
      if (!agg.lastIn || at > agg.lastIn) agg.lastIn = at;
    } else if (action === "out") {
      if (!agg.lastOut || at > agg.lastOut) agg.lastOut = at;
    } else if (!agg.firstIn) {
      agg.firstIn = at;
      agg.lastIn = at;
    } else if (!agg.lastOut || at > agg.lastOut) {
      agg.lastOut = at;
    }
  }

  // Oxirgi event Keldim bo‘lsa — hali ofisda (Ketdim yo‘q). Aks holda birinchi Keldim + oxirgi Ketdim.
  for (const agg of aggs.values()) {
    if (agg.firstIn && agg.lastOut && agg.lastOut <= agg.firstIn) {
      agg.lastOut = null;
    }
    if (agg.lastIn && agg.lastOut && agg.lastIn > agg.lastOut) {
      agg.lastOut = null;
    }
  }

  const updated: HikvisionSyncResult["updated"] = [];
  let written = 0;

  for (const agg of aggs.values()) {
    const checkInAt = agg.firstIn;
    const checkOutAt = agg.lastOut;
    if (!checkInAt && !checkOutAt) continue;

    const status = dayStatus(checkInAt, checkOutAt, date);
    const notes = [
      "Ofis Face ID terminali · sync",
      agg.matchBy,
      agg.employeeNo ? `№${agg.employeeNo}` : "",
      checkInAt
        ? `Keldim ${checkInAt.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" })}`
        : "",
      checkOutAt
        ? `Ketdim ${checkOutAt.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" })}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 500);

    const existing = await db
      .select({ id: attendanceRecordsTable.id })
      .from(attendanceRecordsTable)
      .where(
        and(
          eq(attendanceRecordsTable.employeeId, agg.person.employeeId),
          eq(attendanceRecordsTable.workDate, date),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await db
        .update(attendanceRecordsTable)
        .set({
          userId: agg.person.userId,
          checkInAt: checkInAt,
          checkOutAt: checkOutAt,
          status,
          source: "face_id",
          checkInMethod: checkInAt ? "FACE_ID" : null,
          checkOutMethod: checkOutAt ? "FACE_ID" : null,
          resolvedBranchLabel: "Asosiy ofis · Face ID terminal",
          distanceMeters: 0,
          notes,
          updatedAt: new Date(),
        })
        .where(eq(attendanceRecordsTable.id, existing[0].id));
    } else {
      await db.insert(attendanceRecordsTable).values({
        employeeId: agg.person.employeeId,
        userId: agg.person.userId,
        workDate: date,
        checkInAt,
        checkOutAt,
        status,
        source: "face_id",
        checkInMethod: checkInAt ? "FACE_ID" : null,
        checkOutMethod: checkOutAt ? "FACE_ID" : null,
        resolvedBranchLabel: "Asosiy ofis · Face ID terminal",
        distanceMeters: 0,
        notes,
      });
    }

    if (agg.employeeNo) {
      await upsertHikvisionMapping({
        employeeNo: agg.employeeNo,
        userId: agg.person.userId,
        deviceName: agg.person.fullName,
      }).catch(() => undefined);
    }

    written += 1;
    updated.push({
      fullName: agg.person.fullName,
      userId: agg.person.userId,
      checkIn: checkInAt
        ? checkInAt.toLocaleTimeString("uz-UZ", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            timeZone: "Asia/Tashkent",
          })
        : null,
      checkOut: checkOutAt
        ? checkOutAt.toLocaleTimeString("uz-UZ", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            timeZone: "Asia/Tashkent",
          })
        : null,
      matchBy: agg.matchBy,
    });
  }

  // unmatched ro‘yxatini qisqartirish (bir xodim ko‘p event)
  const uniqUnmatched = new Map<string, (typeof unmatched)[0]>();
  for (const u of unmatched) {
    const key = `${u.employeeNo || ""}|${foldScript(u.name || "")}`;
    if (!uniqUnmatched.has(key)) uniqUnmatched.set(key, u);
  }

  logger.info(
    { workDate: date, deviceEvents: events.length, written, unmatched: uniqUnmatched.size },
    "hikvision device day sync",
  );

  return {
    ok: true,
    workDate: date,
    deviceEvents: events.length,
    matchedPeople: aggs.size,
    written,
    unmatched: [...uniqUnmatched.values()].slice(0, 40),
    updated,
  };
}
