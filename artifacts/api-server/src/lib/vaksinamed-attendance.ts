/**
 * VaksinaMed Logistika davomati → HR attendance_records.
 * HR API da davomat yo‘q, shuning uchun SSO (admin) orqali /api/attendance/report o‘qiladi.
 * Faqat VAKSINAMED_ATTENDANCE_MAP dagi odamlar: {"<vm username>": <hr user id>}.
 */
import { eq, sql } from "drizzle-orm";
import { db, employeesTable } from "@workspace/db";
import { logger } from "./logger";

const SOURCE = "vaksinamed";
const METHOD = "VAKSINAMED_GPS";
const BRANCH_LABEL = "VaksinaMed ofis";

type VmDay = {
  date: string;
  status: string;
  inAt: string | null;
  outAt: string | null;
  late: boolean;
  distance_m: number | null;
};

type VmPerson = { userId: string; username: string; name: string; days: VmDay[] };

export type VmSyncResult = {
  month: string;
  people: Array<{ username: string; hrUserId: number; name: string; written: number; skipped: string | null }>;
};

function baseUrl(): string {
  return String(process.env.VAKSINAMED_BASE_URL || "").trim().replace(/\/+$/, "");
}

function apiKey(): string {
  return String(process.env.VAKSINAMED_API_KEY || "").trim();
}

export function attendanceMap(): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const raw = String(process.env.VAKSINAMED_ATTENDANCE_MAP || "").trim();
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [k, v] of Object.entries(parsed || {})) {
      const id = Number(v);
      if (k.trim() && Number.isInteger(id) && id > 0) out.set(k.trim().toLowerCase(), id);
    }
  } catch (err) {
    logger.warn({ err }, "VAKSINAMED_ATTENDANCE_MAP noto‘g‘ri JSON");
  }
  return out;
}

export function isVmAttendanceConfigured(): boolean {
  return Boolean(baseUrl() && apiKey() && attendanceMap().size > 0);
}

function readSid(res: Response): string | null {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const list = headers.getSetCookie?.() ?? [res.headers.get("set-cookie") || ""];
  for (const line of list) {
    const m = /(?:^|,\s*)vm_sid=([^;]+)/.exec(line);
    if (m) return m[1]!;
  }
  return null;
}

async function vmSession(): Promise<string> {
  const username = String(process.env.VAKSINAMED_DEFAULT_USERNAME || "").trim();
  if (!username) throw new Error("VAKSINAMED_DEFAULT_USERNAME sozlanmagan");
  const sso = await fetch(`${baseUrl()}/api/hr/logistics/sso`, {
    method: "POST",
    headers: { "X-API-Key": apiKey(), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username, path: "/attendance", embed: true }),
  });
  const body = (await sso.json().catch(() => ({}))) as { enterUrl?: string; error?: string };
  if (!sso.ok || !body.enterUrl) throw new Error(`VaksinaMed SSO: ${sso.status} ${body.error || ""}`.trim());
  const enter = await fetch(body.enterUrl, { redirect: "manual" });
  const sid = readSid(enter);
  if (!sid) throw new Error(`VaksinaMed sessiya cookie kelmadi (${enter.status})`);
  return sid;
}

async function fetchReport(sid: string, month: string): Promise<VmPerson[]> {
  const res = await fetch(`${baseUrl()}/api/attendance/report?month=${encodeURIComponent(month)}`, {
    headers: { Cookie: `vm_sid=${sid}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`VaksinaMed report ${month}: ${res.status}`);
  const body = (await res.json()) as { people?: VmPerson[] };
  return Array.isArray(body.people) ? body.people : [];
}

function tashkentToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

function toTs(date: string, hms: string | null): string | null {
  if (!hms || !/^\d{2}:\d{2}(:\d{2})?$/.test(hms)) return null;
  return `${date}T${hms.length === 5 ? `${hms}:00` : hms}+05:00`;
}

async function writeDays(employeeId: number, userId: number, days: VmDay[]): Promise<number> {
  const today = tashkentToday();
  let written = 0;
  for (const d of days) {
    if (d.status !== "done" && d.status !== "in") continue;
    if (d.date > today) continue;
    const checkIn = toTs(d.date, d.inAt);
    if (!checkIn) continue;
    const checkOut = toTs(d.date, d.outAt);
    const status = d.late ? "late" : !checkOut && d.date < today ? "incomplete" : "present";
    const distance = d.distance_m == null ? null : Math.round(Number(d.distance_m));
    const outMethod = checkOut ? METHOD : null;
    await db.execute(sql`
      INSERT INTO attendance_records
        (employee_id, user_id, work_date, check_in_at, check_out_at, status, source,
         check_in_method, check_out_method, distance_meters, resolved_branch_label, notes)
      VALUES
        (${employeeId}, ${userId}, ${d.date}, ${checkIn}::timestamptz, ${checkOut}::timestamptz, ${status}, ${SOURCE},
         ${METHOD}, ${outMethod}, ${distance}, ${BRANCH_LABEL}, 'VaksinaMed Logistika davomati')
      ON CONFLICT (employee_id, work_date) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        check_in_at = EXCLUDED.check_in_at,
        check_out_at = EXCLUDED.check_out_at,
        status = EXCLUDED.status,
        source = EXCLUDED.source,
        check_in_method = EXCLUDED.check_in_method,
        check_out_method = EXCLUDED.check_out_method,
        distance_meters = EXCLUDED.distance_meters,
        resolved_branch_label = EXCLUDED.resolved_branch_label,
        notes = EXCLUDED.notes,
        updated_at = now()
    `);
    written += 1;
  }
  return written;
}

export async function syncVaksinamedAttendance(month: string): Promise<VmSyncResult> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("month: YYYY-MM");
  const map = attendanceMap();
  if (!baseUrl() || !apiKey() || !map.size) throw new Error("VaksinaMed davomat sinxronizatsiyasi sozlanmagan");

  const sid = await vmSession();
  const people = await fetchReport(sid, month);
  const result: VmSyncResult = { month, people: [] };

  for (const [username, hrUserId] of map) {
    const person = people.find((p) => String(p.username || "").toLowerCase() === username);
    const row = { username, hrUserId, name: person?.name ?? "", written: 0, skipped: null as string | null };
    if (!person) {
      row.skipped = "VaksinaMed hisobotida topilmadi";
      result.people.push(row);
      continue;
    }
    const [emp] = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(eq(employeesTable.userId, hrUserId))
      .limit(1);
    if (!emp) {
      row.skipped = "HR da xodim kartasi yo‘q";
      result.people.push(row);
      continue;
    }
    row.written = await writeDays(emp.id, hrUserId, person.days || []);
    result.people.push(row);
  }

  logger.info({ event: "vaksinamed_attendance_sync", month, people: result.people }, "VaksinaMed davomat sinxronlandi");
  return result;
}

/** Joriy oy + oy boshida (1–5) o‘tgan oy */
export function monthsToSync(): string[] {
  const today = tashkentToday();
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const cur = `${y}-${String(m).padStart(2, "0")}`;
  if (d > 5) return [cur];
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return [`${py}-${String(pm).padStart(2, "0")}`, cur];
}
