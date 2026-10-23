import { and, eq, isNotNull, ne } from "drizzle-orm";
import {
  attendanceRecordsTable,
  db,
  employeesTable,
  hikvisionEventLogTable,
  hikvisionPersonMapTable,
  usersTable,
} from "@workspace/db";
import { ensureHikvisionSchema } from "./ensure-schema";
import { logger } from "./logger";

let schemaReady: Promise<void> | null = null;

function ensureReady() {
  if (!schemaReady) {
    schemaReady = ensureHikvisionSchema().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export type HikvisionAccessEvent = {
  employeeNo?: string;
  name?: string;
  attendanceStatus?: string;
  label?: string;
  serialNo?: number;
  time?: string;
  majorEventType?: number;
  subEventType?: number;
  currentVerifyMode?: string;
  deviceSerial?: string;
  raw?: Record<string, unknown>;
};

function normalizePersonName(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[‘’ʻʼ'`]/g, "")
    .replace(/[^a-zа-яўқғҳ0-9\s]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokens(s: string): string[] {
  return normalizePersonName(s).split(" ").filter(Boolean);
}

function namesLikelyMatch(a: string, b: string): boolean {
  const na = normalizePersonName(a);
  const nb = normalizePersonName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length < 2 || tb.length < 2) return false;
  const setA = new Set(ta);
  const setB = new Set(tb);
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared += 1;
  // Kamida familiya + ism mos
  return shared >= 2 && (shared >= Math.min(ta.length, tb.length) || shared / Math.max(ta.length, tb.length) >= 0.66);
}

export function actionFromAttendanceStatus(
  status?: string | null,
  label?: string | null,
): "in" | "out" | "auto" {
  const s = String(status || "").toLowerCase();
  const l = String(label || "").toLowerCase();
  if (
    s === "checkin" ||
    s === "breakin" ||
    s === "overtimein" ||
    /keldim|check\s*in|вход|приш/i.test(l)
  ) {
    return "in";
  }
  if (
    s === "checkout" ||
    s === "breakout" ||
    s === "overtimeout" ||
    /ketdim|ketdi|check\s*out|выход|уш[её]л/i.test(l)
  ) {
    return "out";
  }
  return "auto";
}

/** Face authentication success event (minor 75 = attendance / face pass on this firmware) */
export function isAttendanceWorthyEvent(ev: HikvisionAccessEvent): boolean {
  const hasPerson = Boolean(ev.employeeNo || ev.name);
  if (!hasPerson) return false;
  // Explicit attendance status
  if (ev.attendanceStatus && ev.attendanceStatus !== "undefined") return true;
  if (ev.label && /keldim|ketdim|ketdi|check/i.test(ev.label)) return true;
  // Access granted with face/card (major 5 = event)
  if (ev.majorEventType === 5 && (ev.subEventType === 75 || ev.subEventType === 1 || ev.subEventType === 38)) {
    return true;
  }
  return Boolean(ev.employeeNo && (ev.currentVerifyMode || "").toLowerCase().includes("face"));
}

export function parseHikvisionPayload(body: unknown): HikvisionAccessEvent | null {
  if (body == null) return null;
  let obj: Record<string, unknown> | null = null;
  if (typeof body === "string") {
    const t = body.trim();
    if (!t) return null;
    if (t.startsWith("{")) {
      try {
        obj = JSON.parse(t) as Record<string, unknown>;
      } catch {
        return null;
      }
    } else if (t.includes("<")) {
      // Minimal XML field extract
      const pick = (tag: string) => {
        const m = t.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i"));
        return m?.[1]?.trim();
      };
      return {
        employeeNo: pick("employeeNoString") || pick("employeeNo"),
        name: pick("name"),
        attendanceStatus: pick("attendanceStatus"),
        label: pick("label"),
        serialNo: Number(pick("serialNo") || "") || undefined,
        time: pick("time") || pick("dateTime"),
        majorEventType: Number(pick("majorEventType") || pick("major") || "") || undefined,
        subEventType: Number(pick("subEventType") || pick("minor") || "") || undefined,
        currentVerifyMode: pick("currentVerifyMode"),
        raw: { xml: t.slice(0, 2000) },
      };
    } else {
      return null;
    }
  } else if (typeof body === "object") {
    obj = body as Record<string, unknown>;
  }
  if (!obj) return null;

  const ac =
    (obj.AccessControllerEvent as Record<string, unknown> | undefined) ||
    (obj.accessControllerEvent as Record<string, unknown> | undefined) ||
    obj;

  const employeeNo = String(
    ac.employeeNoString ?? ac.employeeNo ?? obj.employeeNoString ?? obj.employeeNo ?? "",
  ).trim();
  const name = String(ac.name ?? obj.name ?? "").trim();
  const attendanceStatus = String(ac.attendanceStatus ?? obj.attendanceStatus ?? "").trim();
  const label = String(ac.label ?? obj.label ?? "").trim();
  const serialNo = Number(ac.serialNo ?? obj.serialNo ?? 0) || undefined;
  const time = String(ac.time ?? obj.dateTime ?? obj.time ?? "").trim() || undefined;
  const majorEventType = Number(ac.majorEventType ?? ac.major ?? obj.majorEventType ?? 0) || undefined;
  const subEventType = Number(ac.subEventType ?? ac.minor ?? obj.subEventType ?? 0) || undefined;
  const currentVerifyMode = String(ac.currentVerifyMode ?? obj.currentVerifyMode ?? "").trim();
  const deviceSerial = String(obj.macAddress ?? ac.macAddress ?? obj.ipAddress ?? "default").trim();

  return {
    employeeNo: employeeNo || undefined,
    name: name || undefined,
    attendanceStatus: attendanceStatus || undefined,
    label: label || undefined,
    serialNo,
    time,
    majorEventType,
    subEventType,
    currentVerifyMode: currentVerifyMode || undefined,
    deviceSerial,
    raw: obj,
  };
}

async function resolveUserForEmployeeNo(
  employeeNo: string,
  deviceName?: string,
): Promise<{ userId: number; employeeId: number | null; matchedBy: string } | null> {
  const [mapped] = await db
    .select()
    .from(hikvisionPersonMapTable)
    .where(eq(hikvisionPersonMapTable.employeeNo, employeeNo))
    .limit(1);
  if (mapped) {
    if (deviceName && deviceName !== mapped.deviceName) {
      await db
        .update(hikvisionPersonMapTable)
        .set({ deviceName, updatedAt: new Date() })
        .where(eq(hikvisionPersonMapTable.id, mapped.id));
    }
    return { userId: mapped.userId, employeeId: mapped.employeeId, matchedBy: mapped.matchedBy };
  }

  if (!deviceName) return null;

  const users = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      status: usersTable.status,
    })
    .from(usersTable)
    .where(eq(usersTable.status, "active"));

  const hit = users.find((u) => namesLikelyMatch(u.fullName, deviceName));
  if (!hit) {
    const emps = await db
      .select({
        id: employeesTable.id,
        userId: employeesTable.userId,
        fullName: employeesTable.fullName,
        employmentStatus: employeesTable.employmentStatus,
      })
      .from(employeesTable)
      .where(
        and(
          ne(employeesTable.employmentStatus, "dismissed"),
          ne(employeesTable.employmentStatus, "closed"),
          isNotNull(employeesTable.userId),
        ),
      );
    const empHit = emps.find((e) => namesLikelyMatch(e.fullName, deviceName) && e.userId);
    if (!empHit?.userId) return null;
    await db
      .insert(hikvisionPersonMapTable)
      .values({
        employeeNo,
        userId: empHit.userId,
        employeeId: empHit.id,
        deviceName,
        matchedBy: "auto_name",
      })
      .onConflictDoNothing({ target: hikvisionPersonMapTable.employeeNo });
    return { userId: empHit.userId, employeeId: empHit.id, matchedBy: "auto_name" };
  }

  const [emp] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(eq(employeesTable.userId, hit.id))
    .limit(1);

  await db
    .insert(hikvisionPersonMapTable)
    .values({
      employeeNo,
      userId: hit.id,
      employeeId: emp?.id ?? null,
      deviceName,
      matchedBy: "auto_name",
    })
    .onConflictDoNothing({ target: hikvisionPersonMapTable.employeeNo });

  return { userId: hit.id, employeeId: emp?.id ?? null, matchedBy: "auto_name" };
}

async function resolveAutoAction(userId: number): Promise<"in" | "out"> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
  const [emp] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(eq(employeesTable.userId, userId))
    .limit(1);
  if (!emp) return "in";
  const [row] = await db
    .select({
      checkInAt: attendanceRecordsTable.checkInAt,
      checkOutAt: attendanceRecordsTable.checkOutAt,
      status: attendanceRecordsTable.status,
    })
    .from(attendanceRecordsTable)
    .where(and(eq(attendanceRecordsTable.employeeId, emp.id), eq(attendanceRecordsTable.workDate, today)))
    .limit(1);
  if (!row?.checkInAt) return "in";
  if (row.checkOutAt || row.status === "absent" || row.status === "leave") return "in";
  return "out";
}

export async function processHikvisionEvent(
  ev: HikvisionAccessEvent,
): Promise<{
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  action?: string;
  userId?: number;
  fullName?: string;
  payload?: Record<string, unknown>;
}> {
  await ensureReady();

  if (!isAttendanceWorthyEvent(ev)) {
    return { ok: true, skipped: true, reason: "not_attendance_event" };
  }

  const employeeNo = String(ev.employeeNo || "").trim();
  if (!employeeNo) {
    return { ok: false, reason: "missing_employee_no" };
  }

  const deviceSerial = String(ev.deviceSerial || "default").slice(0, 64);
  const eventKey =
    ev.serialNo != null
      ? `${deviceSerial}:${ev.serialNo}`
      : `${deviceSerial}:${employeeNo}:${ev.time || ""}:${ev.attendanceStatus || ""}:${ev.label || ""}`;

  try {
    await db.insert(hikvisionEventLogTable).values({
      deviceSerial,
      eventSerial: ev.serialNo ?? null,
      eventKey,
      employeeNo,
      action: null,
      attendanceStatus: ev.attendanceStatus || null,
      result: "received",
      payload: (ev.raw || ev) as Record<string, unknown>,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(msg)) {
      return { ok: true, skipped: true, reason: "duplicate_event" };
    }
    throw err;
  }

  const resolved = await resolveUserForEmployeeNo(employeeNo, ev.name);
  if (!resolved) {
    await db
      .update(hikvisionEventLogTable)
      .set({ result: "unmapped", error: `Xodim bog‘lanmagan: ${ev.name || employeeNo}` })
      .where(eq(hikvisionEventLogTable.eventKey, eventKey));
    logger.warn({ employeeNo, name: ev.name }, "Hikvision person unmapped");
    return { ok: false, reason: "unmapped", skipped: false };
  }

  let action = actionFromAttendanceStatus(ev.attendanceStatus, ev.label);
  if (action === "auto") {
    action = await resolveAutoAction(resolved.userId);
  }

  const note = [
    "Ofis Face ID terminali",
    ev.label ? `· ${ev.label}` : "",
    employeeNo ? `· №${employeeNo}` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);

  const { punchFromHikvisionTerminal } = await import("../routes/davomat");
  const punched = await punchFromHikvisionTerminal({
    userId: resolved.userId,
    action,
    note,
  });

  if (!punched.ok) {
    await db
      .update(hikvisionEventLogTable)
      .set({
        action,
        userId: resolved.userId,
        result: "denied",
        error: String(punched.body.error || punched.body.code || "denied"),
      })
      .where(eq(hikvisionEventLogTable.eventKey, eventKey));
    return {
      ok: false,
      reason: String(punched.body.code || "punch_denied"),
      action,
      userId: resolved.userId,
      payload: punched.body,
    };
  }

  await db
    .update(hikvisionEventLogTable)
    .set({
      action,
      userId: resolved.userId,
      result: "ok",
      error: null,
    })
    .where(eq(hikvisionEventLogTable.eventKey, eventKey));

  return {
    ok: true,
    action,
    userId: resolved.userId,
    fullName: String(punched.payload.fullName || ev.name || ""),
    payload: punched.payload,
  };
}

export async function upsertHikvisionMapping(opts: {
  employeeNo: string;
  userId: number;
  deviceName?: string;
}): Promise<void> {
  await ensureReady();
  const employeeNo = String(opts.employeeNo).trim();
  const [emp] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(eq(employeesTable.userId, opts.userId))
    .limit(1);
  const [existing] = await db
    .select()
    .from(hikvisionPersonMapTable)
    .where(eq(hikvisionPersonMapTable.employeeNo, employeeNo))
    .limit(1);
  if (existing) {
    await db
      .update(hikvisionPersonMapTable)
      .set({
        userId: opts.userId,
        employeeId: emp?.id ?? null,
        deviceName: opts.deviceName || existing.deviceName,
        matchedBy: "manual",
        updatedAt: new Date(),
      })
      .where(eq(hikvisionPersonMapTable.id, existing.id));
    return;
  }
  await db.insert(hikvisionPersonMapTable).values({
    employeeNo,
    userId: opts.userId,
    employeeId: emp?.id ?? null,
    deviceName: opts.deviceName || null,
    matchedBy: "manual",
  });
}
