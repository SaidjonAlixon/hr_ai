/**
 * Mijozlar baholashi — filial QR, faol smena xodimlari, anonim (admin uchun ism/tel).
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import {
  db,
  pool,
  employeesTable,
  usersTable,
  employeeWorkSlotsTable,
  customerRatingQrTable,
  customerRatingsTable,
  customerRatingTargetsTable,
  customerRatingAuditTable,
} from "@workspace/db";
import { displayBranchName } from "./geo-location";
import { getEffectiveShiftDefs } from "./shift-schedule";
import {
  type WorkSlotRow,
  type WorkSlotShiftKey,
} from "./work-slots";
import { addDaysYmd } from "./attendance-engine";
import { logger } from "./logger";
import { publicAppUrl } from "./telegram";
import {
  SERVICE_QUALITY,
  DEMEANOR,
  canManageCustomerRatings,
  canViewCustomerRatings,
  canViewCustomerLeaderboard,
  canSeeCustomerIdentity,
  normalizePhone,
  pickOnDutyShiftForEmployee,
  leaderboardTitleForRank,
  sortLeaderboardRows,
  type ServiceQuality,
  type Demeanor,
} from "./customer-ratings-core.ts";

export {
  SERVICE_QUALITY,
  DEMEANOR,
  canManageCustomerRatings,
  canViewCustomerRatings,
  canViewCustomerLeaderboard,
  canSeeCustomerIdentity,
  pickOnDutyShiftForEmployee,
  leaderboardTitleForRank,
  sortLeaderboardRows,
};
export type { ServiceQuality, Demeanor };

export type OnDutyStaff = {
  employeeId: number;
  fullName: string;
  position: string;
  role: string;
  shiftKey: string;
  workDate: string;
};

let ready: Promise<void> | null = null;

export function ensureCustomerRatingsSchema(): Promise<void> {
  if (!ready) {
    ready = pool
      .query(
        `CREATE TABLE IF NOT EXISTS customer_rating_qr (
           id SERIAL PRIMARY KEY,
           token TEXT NOT NULL UNIQUE,
           branch_id INTEGER NOT NULL,
           branch_label TEXT,
           status TEXT NOT NULL DEFAULT 'active',
           version INTEGER NOT NULL DEFAULT 1,
           created_by_id INTEGER,
           created_by_name TEXT,
           created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           blocked_at TIMESTAMPTZ,
           blocked_by_name TEXT
         );
         CREATE INDEX IF NOT EXISTS customer_rating_qr_branch_idx ON customer_rating_qr (branch_id);
         CREATE INDEX IF NOT EXISTS customer_rating_qr_status_idx ON customer_rating_qr (status);

         CREATE TABLE IF NOT EXISTS customer_ratings (
           id SERIAL PRIMARY KEY,
           qr_id INTEGER,
           branch_id INTEGER NOT NULL,
           branch_label TEXT,
           work_date TEXT NOT NULL,
           shift_key TEXT,
           stars INTEGER NOT NULL,
           service_quality TEXT NOT NULL,
           demeanor TEXT NOT NULL,
           comment TEXT,
           customer_name TEXT NOT NULL,
           customer_phone TEXT NOT NULL,
           target_mode TEXT NOT NULL DEFAULT 'single',
           ip_hash TEXT,
           user_agent TEXT,
           fingerprint TEXT,
           lang TEXT DEFAULT 'uz',
           created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
         );
         CREATE INDEX IF NOT EXISTS customer_ratings_branch_idx ON customer_ratings (branch_id);
         CREATE INDEX IF NOT EXISTS customer_ratings_date_idx ON customer_ratings (work_date);
         CREATE INDEX IF NOT EXISTS customer_ratings_phone_idx ON customer_ratings (customer_phone);
         CREATE INDEX IF NOT EXISTS customer_ratings_created_idx ON customer_ratings (created_at);

         CREATE TABLE IF NOT EXISTS customer_rating_targets (
           id SERIAL PRIMARY KEY,
           rating_id INTEGER NOT NULL,
           employee_id INTEGER NOT NULL,
           employee_name TEXT NOT NULL,
           position TEXT,
           shift_key TEXT
         );
         CREATE INDEX IF NOT EXISTS customer_rating_targets_rating_idx ON customer_rating_targets (rating_id);
         CREATE INDEX IF NOT EXISTS customer_rating_targets_emp_idx ON customer_rating_targets (employee_id);

         CREATE TABLE IF NOT EXISTS customer_rating_audit (
           id SERIAL PRIMARY KEY,
           action TEXT NOT NULL,
           actor_user_id INTEGER,
           actor_name TEXT,
           branch_id INTEGER,
           rating_id INTEGER,
           meta JSONB,
           created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
         );
         CREATE INDEX IF NOT EXISTS customer_rating_audit_created_idx ON customer_rating_audit (created_at);`,
      )
      .then(() => undefined)
      .catch((err) => {
        ready = null;
        throw err;
      });
  }
  return ready;
}

function todayYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

function hashIp(ip: string): string {
  return createHash("sha256").update(String(ip || "")).digest("hex").slice(0, 32);
}

function newToken(): string {
  return randomBytes(18).toString("base64url");
}

function mapWorkSlot(r: {
  id: number;
  employeeId: number;
  branchId: number;
  branchLabel: string | null;
  shiftKey: string;
  mode: string;
  validFrom: string;
  validTo: string | null;
  weekdays: unknown;
  workDates: unknown;
  overrideBase: boolean | null;
  note: string | null;
  active: boolean;
}): WorkSlotRow {
  return {
    id: r.id,
    employeeId: r.employeeId,
    branchId: r.branchId,
    branchLabel: r.branchLabel,
    shiftKey: r.shiftKey as WorkSlotShiftKey,
    mode: r.mode as WorkSlotRow["mode"],
    validFrom: r.validFrom,
    validTo: r.validTo,
    weekdays: Array.isArray(r.weekdays) ? (r.weekdays as number[]) : null,
    workDates: Array.isArray(r.workDates) ? (r.workDates as string[]) : null,
    overrideBase: Boolean(r.overrideBase),
    note: r.note,
    active: r.active,
  };
}

/** Actor uchun ruxsat etilgan filial id lar (null = hammasi) */
export async function scopedBranchIds(userId: number, role: string): Promise<number[] | null> {
  const r = String(role || "").toLowerCase();
  if (canManageCustomerRatings(r)) return null;
  if (r === "mudir") {
    const rows = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(and(eq(employeesTable.userId, userId), eq(employeesTable.orgRole, "manager")));
    return rows.map((x) => x.id);
  }
  if (r === "koordinator" || r === "regional_menejer") {
    const [me] = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(eq(employeesTable.userId, userId))
      .limit(1);
    if (!me) return [];
    const mudirs = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(and(eq(employeesTable.orgRole, "manager"), eq(employeesTable.reportsToId, me.id)));
    return mudirs.map((x) => x.id);
  }
  return [];
}

export async function listPharmacyBranches(): Promise<
  Array<{ id: number; label: string; location: string; branchNo: number | null; mudirName: string }>
> {
  const rows = await db
    .select({
      id: employeesTable.id,
      location: employeesTable.location,
      fullName: employeesTable.fullName,
      status: employeesTable.employmentStatus,
      branchNo: employeesTable.branchNo,
    })
    .from(employeesTable)
    .where(eq(employeesTable.orgRole, "manager"));
  return rows
    .filter((r) => !["dismissed", "closed", "need_hire", "searching"].includes(String(r.status || "").toLowerCase()))
    .map((r) => ({
      id: r.id,
      location: r.location || "",
      branchNo: r.branchNo != null ? Number(r.branchNo) : null,
      mudirName: r.fullName || "",
      label: displayBranchName(r.location) || r.location || r.fullName || `Filial #${r.id}`,
    }))
    .sort((a, b) => {
      const an = a.branchNo ?? 9999;
      const bn = b.branchNo ?? 9999;
      if (an !== bn) return an - bn;
      return a.label.localeCompare(b.label, "uz");
    });
}

async function audit(input: {
  action: string;
  actorUserId?: number | null;
  actorName?: string | null;
  branchId?: number | null;
  ratingId?: number | null;
  meta?: Record<string, unknown>;
}) {
  try {
    await ensureCustomerRatingsSchema();
    await db.insert(customerRatingAuditTable).values({
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      actorName: input.actorName ?? null,
      branchId: input.branchId ?? null,
      ratingId: input.ratingId ?? null,
      meta: input.meta ?? null,
    });
  } catch (err) {
    logger.warn({ err }, "customer-rating audit yozilmadi");
  }
}

export async function createOrGetQr(branchId: number, actor: { id: number; name: string }) {
  await ensureCustomerRatingsSchema();
  const branches = await listPharmacyBranches();
  const branch = branches.find((b) => b.id === branchId);
  if (!branch) throw new Error("Filial topilmadi");

  const [existing] = await db
    .select()
    .from(customerRatingQrTable)
    .where(and(eq(customerRatingQrTable.branchId, branchId), eq(customerRatingQrTable.status, "active")))
    .limit(1);
  if (existing) {
    return {
      ...existing,
      publicUrl: `${publicAppUrl().replace(/\/$/, "")}/baho/${existing.token}`,
    };
  }

  const token = newToken();
  const [row] = await db
    .insert(customerRatingQrTable)
    .values({
      token,
      branchId,
      branchLabel: branch.label,
      status: "active",
      version: 1,
      createdById: actor.id,
      createdByName: actor.name,
    })
    .returning();
  await audit({ action: "qr_create", actorUserId: actor.id, actorName: actor.name, branchId, meta: { token } });
  return {
    ...row!,
    publicUrl: `${publicAppUrl().replace(/\/$/, "")}/baho/${token}`,
  };
}

export async function rotateQr(branchId: number, actor: { id: number; name: string }) {
  await ensureCustomerRatingsSchema();
  const branches = await listPharmacyBranches();
  const branch = branches.find((b) => b.id === branchId);
  if (!branch) throw new Error("Filial topilmadi");

  await db
    .update(customerRatingQrTable)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(and(eq(customerRatingQrTable.branchId, branchId), eq(customerRatingQrTable.status, "active")));

  const prevRows = await db
    .select({ version: customerRatingQrTable.version })
    .from(customerRatingQrTable)
    .where(eq(customerRatingQrTable.branchId, branchId));
  const prev = prevRows.sort((a, b) => (b.version || 0) - (a.version || 0))[0];

  const token = newToken();
  const [row] = await db
    .insert(customerRatingQrTable)
    .values({
      token,
      branchId,
      branchLabel: branch.label,
      status: "active",
      version: (prev?.version || 0) + 1,
      createdById: actor.id,
      createdByName: actor.name,
    })
    .returning();
  await audit({ action: "qr_rotate", actorUserId: actor.id, actorName: actor.name, branchId, meta: { token } });
  return {
    ...row!,
    publicUrl: `${publicAppUrl().replace(/\/$/, "")}/baho/${token}`,
  };
}

export async function setQrBlocked(branchId: number, blocked: boolean, actor: { id: number; name: string }) {
  await ensureCustomerRatingsSchema();
  if (blocked) {
    await db
      .update(customerRatingQrTable)
      .set({
        status: "blocked",
        blockedAt: new Date(),
        blockedByName: actor.name,
        updatedAt: new Date(),
      })
      .where(and(eq(customerRatingQrTable.branchId, branchId), inArray(customerRatingQrTable.status, ["active", "blocked"])));
  } else {
    // unblock: eng yangi blocked/revoked dan active qilmaymiz — yangi token yaratamiz
    await rotateQr(branchId, actor);
    return;
  }
  await audit({
    action: blocked ? "qr_block" : "qr_unblock",
    actorUserId: actor.id,
    actorName: actor.name,
    branchId,
  });
}

export async function listQrCodes(scope: number[] | null) {
  await ensureCustomerRatingsSchema();
  const branches = await listPharmacyBranches();
  const allowed = scope ? new Set(scope) : null;
  const filtered = allowed ? branches.filter((b) => allowed.has(b.id)) : branches;

  const qrs = await db.select().from(customerRatingQrTable);
  const byBranch = new Map<number, (typeof qrs)[0]>();
  for (const q of qrs) {
    const prev = byBranch.get(q.branchId);
    if (!prev || (q.version || 0) > (prev.version || 0)) byBranch.set(q.branchId, q);
  }

  const origin = publicAppUrl().replace(/\/$/, "");
  return filtered.map((b) => {
    const q = byBranch.get(b.id);
    const status = q?.status ?? "missing";
    return {
      branchId: b.id,
      branchLabel: b.label,
      branchNo: b.branchNo ?? null,
      mudirName: b.mudirName || "",
      qrId: q?.id ?? null,
      token: q?.token ?? null,
      status,
      version: q?.version ?? 0,
      publicUrl: q?.token && status === "active" ? `${origin}/baho/${q.token}` : q?.token ? `${origin}/baho/${q.token}` : null,
      updatedAt: q?.updatedAt ?? null,
      blockedAt: q?.blockedAt ?? null,
    };
  });
}

/** Barcha filiallarda yo‘q/revoked QR larni yaratish */
export async function createAllMissingQr(actor: { id: number; name: string }) {
  await ensureCustomerRatingsSchema();
  const items = await listQrCodes(null);
  const need = items.filter((i) => i.status === "missing" || i.status === "revoked" || !i.token);
  const created: Array<{ branchId: number; branchLabel: string; publicUrl: string }> = [];
  for (const it of need) {
    const qr = await createOrGetQr(it.branchId, actor);
    created.push({
      branchId: it.branchId,
      branchLabel: it.branchLabel,
      publicUrl: qr.publicUrl,
    });
  }
  await audit({
    action: "qr_create_all",
    actorUserId: actor.id,
    actorName: actor.name,
    meta: { count: created.length },
  });
  return { ok: true, created: created.length, total: items.length, items: created };
}

export async function qrByToken(token: string) {
  await ensureCustomerRatingsSchema();
  const [row] = await db
    .select()
    .from(customerRatingQrTable)
    .where(eq(customerRatingQrTable.token, String(token || "").trim()))
    .limit(1);
  return row || null;
}

/** Shu filialda HOZIR smenasi faol bo‘lgan dorixona xodimlari (tungi smena hisobga olinadi) */
export async function onDutyStaffAtBranch(branchId: number, nowMs = Date.now()): Promise<OnDutyStaff[]> {
  const today = todayYmd();
  const yesterday = addDaysYmd(today, -1);
  const defs = await getEffectiveShiftDefs();

  const staff = await db
    .select({
      id: employeesTable.id,
      fullName: employeesTable.fullName,
      position: employeesTable.position,
      orgRole: employeesTable.orgRole,
      status: employeesTable.employmentStatus,
      assignedBranchId: employeesTable.assignedBranchId,
      reportsToId: employeesTable.reportsToId,
      role: usersTable.role,
    })
    .from(employeesTable)
    .leftJoin(usersTable, eq(usersTable.id, employeesTable.userId))
    .where(
      and(
        or(
          eq(employeesTable.assignedBranchId, branchId),
          eq(employeesTable.reportsToId, branchId),
          eq(employeesTable.id, branchId),
        ),
        ne(employeesTable.employmentStatus, "dismissed"),
      ),
    );

  const candidates = staff.filter((s) => {
    const st = String(s.status || "").toLowerCase();
    if (["dismissed", "closed", "need_hire", "searching"].includes(st)) return false;
    const role = String(s.role || "").toLowerCase();
    const org = String(s.orgRole || "").toLowerCase();
    return (
      role === "mudir" ||
      role === "farmasevt" ||
      role === "stajyor" ||
      role === "stajor" ||
      org === "manager" ||
      org === "pharmacist" ||
      org === "intern"
    );
  });

  if (!candidates.length) return [];

  const empIds = candidates.map((c) => c.id);
  const slotRows = await db
    .select()
    .from(employeeWorkSlotsTable)
    .where(and(inArray(employeeWorkSlotsTable.employeeId, empIds), eq(employeeWorkSlotsTable.active, true)));

  const slotsByEmp = new Map<number, WorkSlotRow[]>();
  for (const r of slotRows) {
    const list = slotsByEmp.get(r.employeeId) || [];
    list.push(mapWorkSlot(r));
    slotsByEmp.set(r.employeeId, list);
  }

  const out: OnDutyStaff[] = [];
  const seen = new Set<number>();

  for (const emp of candidates) {
    const slots = slotsByEmp.get(emp.id) || [];
    // Spec: faqat faol smena. Slot yo‘q bo‘lsa — ko‘rsatilmasin (qat’iy).
    if (!slots.length) continue;

    const pick = pickOnDutyShiftForEmployee({
      branchId,
      slots,
      today,
      yesterday,
      nowMs,
      defs,
    });
    if (!pick || seen.has(emp.id)) continue;
    seen.add(emp.id);
    out.push({
      employeeId: emp.id,
      fullName: emp.fullName,
      position: emp.position || roleTitle(emp.role || emp.orgRole),
      role: String(emp.role || emp.orgRole || ""),
      shiftKey: pick.shiftKey,
      workDate: pick.workDate,
    });
  }

  return out.sort((a, b) => a.fullName.localeCompare(b.fullName, "uz"));
}

function roleTitle(role: string | null | undefined): string {
  const r = String(role || "").toLowerCase();
  if (r === "mudir" || r === "manager") return "Filial mudiri";
  if (r === "farmasevt" || r === "pharmacist") return "Farmasevt";
  if (r === "stajyor" || r === "stajor" || r === "intern") return "Stajyor";
  return "Xodim";
}

export async function publicSession(token: string) {
  const qr = await qrByToken(token);
  if (!qr) return { error: "QR topilmadi", code: "not_found" as const };
  if (qr.status === "blocked") return { error: "Bu QR bloklangan", code: "blocked" as const };
  if (qr.status !== "active") return { error: "QR faol emas", code: "inactive" as const };

  const staff = await onDutyStaffAtBranch(qr.branchId);
  return {
    token: qr.token,
    branchId: qr.branchId,
    branchLabel: qr.branchLabel || displayBranchName("") || "Filial",
    status: qr.status,
    now: new Date().toISOString(),
    workDate: todayYmd(),
    staff,
    emptyReason: staff.length ? null : "Hozir bu filialda faol smena xodimi yo‘q",
  };
}

export async function submitRating(input: {
  token: string;
  /** staff = xodim(lar), pharmacy = dorixona */
  rateType?: "staff" | "pharmacy";
  employeeIds: number[];
  allShift: boolean;
  stars: number;
  serviceQuality: string;
  demeanor: string;
  comment?: string | null;
  customerName: string;
  customerPhone: string;
  fingerprint?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  lang?: string | null;
}) {
  const qr = await qrByToken(input.token);
  if (!qr || qr.status !== "active") throw Object.assign(new Error("QR faol emas"), { code: "inactive", status: 400 });

  const rateType = input.rateType === "pharmacy" ? "pharmacy" : "staff";
  const stars = Math.round(Number(input.stars));
  if (stars < 1 || stars > 5) throw Object.assign(new Error("Yulduz 1–5 bo‘lishi kerak"), { status: 400 });
  if (!SERVICE_QUALITY.includes(input.serviceQuality as ServiceQuality)) {
    throw Object.assign(new Error("Xizmat sifati noto‘g‘ri"), { status: 400 });
  }
  // Dorixona: 2–3 savollar ham sifat shkalasi; xodim: muomala shkalasi
  if (rateType === "pharmacy") {
    if (!SERVICE_QUALITY.includes(input.demeanor as ServiceQuality)) {
      throw Object.assign(new Error("Dorixona bahosi noto‘g‘ri"), { status: 400 });
    }
  } else if (!DEMEANOR.includes(input.demeanor as Demeanor)) {
    throw Object.assign(new Error("Muomala bahosi noto‘g‘ri"), { status: 400 });
  }

  const name = String(input.customerName || "").trim().replace(/\s+/g, " ");
  if (name.length < 2) throw Object.assign(new Error("Ismingizni yozing"), { status: 400 });
  const phone = normalizePhone(input.customerPhone);
  if (!/^9989\d{8}$/.test(phone)) {
    throw Object.assign(new Error("Telefon +9989 dan boshlanishi kerak"), { status: 400 });
  }

  const day = todayYmd();
  let targets: OnDutyStaff[] = [];
  let targetMode = "pharmacy";
  let workDate = day;
  let shiftKey: string | null = null;

  if (rateType === "staff") {
    const onDuty = await onDutyStaffAtBranch(qr.branchId);
    if (!onDuty.length) throw Object.assign(new Error("Hozir baholash uchun xodim yo‘q"), { status: 400 });

    targets = onDuty;
    if (!input.allShift) {
      const ids = new Set((input.employeeIds || []).map(Number).filter((n) => n > 0));
      if (!ids.size) throw Object.assign(new Error("Xodim tanlang"), { status: 400 });
      targets = onDuty.filter((s) => ids.has(s.employeeId));
      if (!targets.length) throw Object.assign(new Error("Tanlangan xodim hozir smenada emas"), { status: 400 });
    }
    targetMode = input.allShift ? "all_shift" : targets.length > 1 ? "multi" : "single";
    workDate = targets[0]!.workDate;
    shiftKey = targets[0]!.shiftKey;
  }

  // Anti-spam: bir telefon — bir filial — bir kun — bir tur (xodim yoki dorixona)
  const { rows: dup } = await pool.query(
    `SELECT id FROM customer_ratings
      WHERE branch_id = $1 AND customer_phone = $2 AND work_date = $3
        AND (
          ($4 = 'pharmacy' AND target_mode = 'pharmacy')
          OR ($4 = 'staff' AND target_mode <> 'pharmacy')
        )
      LIMIT 1`,
    [qr.branchId, phone, day, rateType],
  );
  if (dup[0]) {
    throw Object.assign(
      new Error(
        rateType === "pharmacy"
          ? "Bugun bu dorixonaga allaqachon baho qoldirilgan"
          : "Bugun bu filial xodimlariga allaqachon baho qoldirilgan",
      ),
      { code: "duplicate", status: 429 },
    );
  }

  // IP: soatiga 5
  const ipHash = input.ip ? hashIp(input.ip) : null;
  if (ipHash) {
    const { rows: ipRows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM customer_ratings
        WHERE ip_hash = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [ipHash],
    );
    if ((ipRows[0]?.c as number) >= 5) {
      throw Object.assign(new Error("Juda ko‘p urinish — keyinroq qayta urinib ko‘ring"), { code: "rate_limit", status: 429 });
    }
  }

  const comment = String(input.comment || "").trim().slice(0, 1000) || null;
  const [rating] = await db
    .insert(customerRatingsTable)
    .values({
      qrId: qr.id,
      branchId: qr.branchId,
      branchLabel: qr.branchLabel,
      workDate,
      shiftKey,
      stars,
      serviceQuality: input.serviceQuality,
      demeanor: input.demeanor,
      comment,
      customerName: name,
      customerPhone: phone,
      targetMode,
      ipHash,
      userAgent: String(input.userAgent || "").slice(0, 300) || null,
      fingerprint: String(input.fingerprint || "").slice(0, 120) || null,
      lang: input.lang === "ru" ? "ru" : "uz",
    })
    .returning();

  for (const t of targets) {
    await db.insert(customerRatingTargetsTable).values({
      ratingId: rating!.id,
      employeeId: t.employeeId,
      employeeName: t.fullName,
      position: t.position,
      shiftKey: t.shiftKey,
    });
  }

  await audit({
    action: "rating_submit",
    branchId: qr.branchId,
    ratingId: rating!.id,
    meta: {
      rateType,
      stars,
      targets: targets.map((t) => t.employeeId),
      allShift: input.allShift,
    },
  });

  return { ok: true, id: rating!.id, rateType };
}

async function loadBranchMeta(branchIds: number[]) {
  const ids = [...new Set(branchIds.filter((n) => n > 0))];
  const map = new Map<
    number,
    {
      branchNo: number | null;
      branchName: string;
      location: string;
      mudirName: string;
      mudirPhone: string;
      coordinatorName: string;
      coordinatorPhone: string;
      branchPhone: string;
    }
  >();
  if (!ids.length) return map;

  const { rows } = await pool.query(
    `SELECT e.id,
            e.full_name AS mudir_name,
            e.location,
            e.branch_no,
            u.phone AS mudir_phone,
            c.full_name AS coordinator_name,
            cu.phone AS coordinator_phone,
            bc.primary_phone AS branch_phone
       FROM employees e
       LEFT JOIN users u ON u.id = e.user_id
       LEFT JOIN employees c ON c.id = e.reports_to_id
       LEFT JOIN users cu ON cu.id = c.user_id
       LEFT JOIN branch_contacts bc ON bc.branch_employee_id = e.id
      WHERE e.id = ANY($1::int[])`,
    [ids],
  );

  for (const r of rows) {
    const id = r.id as number;
    const location = String(r.location || "");
    map.set(id, {
      branchNo: r.branch_no != null ? Number(r.branch_no) : null,
      branchName: displayBranchName(location) || location || String(r.mudir_name || `Filial #${id}`),
      location,
      mudirName: String(r.mudir_name || ""),
      mudirPhone: String(r.mudir_phone || r.branch_phone || ""),
      coordinatorName: String(r.coordinator_name || ""),
      coordinatorPhone: String(r.coordinator_phone || ""),
      branchPhone: String(r.branch_phone || r.mudir_phone || ""),
    });
  }
  return map;
}

export async function ratingsFeed(opts: {
  scope: number[] | null;
  branchId?: number | null;
  employeeId?: number | null;
  from?: string | null;
  to?: string | null;
  minStars?: number | null;
  complaintsOnly?: boolean;
  /** staff | pharmacy | all */
  rateType?: "staff" | "pharmacy" | "all" | null;
  limit?: number;
  showIdentity: boolean;
}) {
  await ensureCustomerRatingsSchema();
  const limit = Math.min(Math.max(opts.limit || 200, 1), 5000);
  const params: unknown[] = [];
  const where: string[] = ["1=1"];

  if (opts.scope) {
    if (!opts.scope.length) return { items: [], stats: emptyStats() };
    params.push(opts.scope);
    where.push(`r.branch_id = ANY($${params.length}::int[])`);
  }
  if (opts.branchId) {
    params.push(opts.branchId);
    where.push(`r.branch_id = $${params.length}`);
  }
  if (opts.from) {
    params.push(opts.from);
    where.push(`r.work_date >= $${params.length}`);
  }
  if (opts.to) {
    params.push(opts.to);
    where.push(`r.work_date <= $${params.length}`);
  }
  if (opts.minStars) {
    params.push(opts.minStars);
    where.push(`r.stars <= $${params.length}`);
  }
  if (opts.complaintsOnly) {
    where.push(`(r.stars <= 2 OR r.service_quality IN ('yomon','juda_yomon') OR r.demeanor IN ('qopol','juda_qopol'))`);
  }
  if (opts.rateType === "pharmacy") {
    where.push(`r.target_mode = 'pharmacy'`);
  } else if (opts.rateType === "staff") {
    where.push(`r.target_mode <> 'pharmacy'`);
  }
  if (opts.employeeId) {
    params.push(opts.employeeId);
    where.push(`EXISTS (SELECT 1 FROM customer_rating_targets t WHERE t.rating_id = r.id AND t.employee_id = $${params.length})`);
  }

  params.push(limit);
  const { rows } = await pool.query(
    `SELECT r.*,
            COALESCE(json_agg(json_build_object(
              'employeeId', t.employee_id,
              'employeeName', t.employee_name,
              'position', t.position,
              'shiftKey', t.shift_key
            ) ORDER BY t.id) FILTER (WHERE t.id IS NOT NULL), '[]') AS targets
       FROM customer_ratings r
       LEFT JOIN customer_rating_targets t ON t.rating_id = r.id
      WHERE ${where.join(" AND ")}
      GROUP BY r.id
      ORDER BY r.created_at DESC
      LIMIT $${params.length}`,
    params,
  );

  const meta = await loadBranchMeta(rows.map((r) => Number(r.branch_id)));

  const items = rows.map((r) => {
    const targetMode = String(r.target_mode || "");
    const branchId = r.branch_id as number;
    const bm = meta.get(branchId);
    return {
      id: r.id as number,
      branchId,
      branchLabel: (r.branch_label as string) || bm?.branchName || "",
      branchNo: bm?.branchNo ?? null,
      branchName: bm?.branchName || (r.branch_label as string) || "",
      branchPhone: bm?.branchPhone || "",
      mudirName: bm?.mudirName || "",
      mudirPhone: bm?.mudirPhone || "",
      coordinatorName: bm?.coordinatorName || "",
      coordinatorPhone: bm?.coordinatorPhone || "",
      workDate: r.work_date as string,
      shiftKey: r.shift_key as string | null,
      stars: r.stars as number,
      serviceQuality: r.service_quality as string,
      demeanor: r.demeanor as string,
      comment: r.comment as string | null,
      targetMode,
      rateType: targetMode === "pharmacy" ? ("pharmacy" as const) : ("staff" as const),
      createdAt: r.created_at as string,
      targets: r.targets as Array<{
        employeeId: number;
        employeeName: string;
        position: string | null;
        shiftKey: string | null;
      }>,
      customerName: opts.showIdentity ? (r.customer_name as string) : null,
      customerPhone: opts.showIdentity ? (r.customer_phone as string) : null,
      anonymous: !opts.showIdentity,
    };
  });

  const stats = await ratingsStats(
    opts.scope,
    opts.branchId ?? null,
    opts.from ?? null,
    opts.to ?? null,
    opts.rateType === "pharmacy" || opts.rateType === "staff" ? opts.rateType : null,
  );
  return { items, stats };
}

export async function deleteRating(
  ratingId: number,
  actor: { id: number; name: string },
): Promise<{ ok: true }> {
  await ensureCustomerRatingsSchema();
  const { rows } = await pool.query(`SELECT id, branch_id FROM customer_ratings WHERE id = $1`, [ratingId]);
  if (!rows[0]) throw Object.assign(new Error("Baho topilmadi"), { status: 404 });
  await pool.query(`DELETE FROM customer_rating_targets WHERE rating_id = $1`, [ratingId]);
  await pool.query(`DELETE FROM customer_ratings WHERE id = $1`, [ratingId]);
  await audit({
    action: "rating_delete",
    actorUserId: actor.id,
    actorName: actor.name,
    branchId: Number(rows[0].branch_id),
    ratingId,
  });
  return { ok: true };
}

/** Admin qo‘lda baho qo‘shish (audit bilan) */
export async function adminCreateRating(input: {
  actor: { id: number; name: string };
  rateType: "staff" | "pharmacy";
  branchId: number;
  employeeIds?: number[];
  stars: number;
  serviceQuality: string;
  demeanor: string;
  comment?: string | null;
  customerName: string;
  customerPhone: string;
  workDate?: string | null;
}) {
  await ensureCustomerRatingsSchema();
  const branches = await listPharmacyBranches();
  const branch = branches.find((b) => b.id === input.branchId);
  if (!branch) throw Object.assign(new Error("Filial topilmadi"), { status: 400 });

  const stars = Math.round(Number(input.stars));
  if (stars < 1 || stars > 5) throw Object.assign(new Error("Yulduz 1–5"), { status: 400 });
  if (!SERVICE_QUALITY.includes(input.serviceQuality as ServiceQuality)) {
    throw Object.assign(new Error("Xizmat sifati noto‘g‘ri"), { status: 400 });
  }
  if (input.rateType === "pharmacy") {
    if (!SERVICE_QUALITY.includes(input.demeanor as ServiceQuality)) {
      throw Object.assign(new Error("Dorixona bahosi noto‘g‘ri"), { status: 400 });
    }
  } else if (!DEMEANOR.includes(input.demeanor as Demeanor)) {
    throw Object.assign(new Error("Muomala bahosi noto‘g‘ri"), { status: 400 });
  }

  const name = String(input.customerName || "").trim().replace(/\s+/g, " ");
  if (name.length < 2) throw Object.assign(new Error("Mijoz ismini yozing"), { status: 400 });
  const phone = normalizePhone(input.customerPhone);
  if (!/^9989\d{8}$/.test(phone)) {
    throw Object.assign(new Error("Telefon +9989 dan boshlanishi kerak"), { status: 400 });
  }

  let targets: Array<{ employeeId: number; fullName: string; position: string; shiftKey: string | null }> = [];
  if (input.rateType === "staff") {
    const ids = [...new Set((input.employeeIds || []).map(Number).filter((n) => n > 0))];
    if (!ids.length) throw Object.assign(new Error("Xodim tanlang"), { status: 400 });
    const emps = await db
      .select({
        id: employeesTable.id,
        fullName: employeesTable.fullName,
        position: employeesTable.position,
      })
      .from(employeesTable)
      .where(inArray(employeesTable.id, ids));
    if (!emps.length) throw Object.assign(new Error("Xodim topilmadi"), { status: 400 });
    targets = emps.map((e) => ({
      employeeId: e.id,
      fullName: e.fullName,
      position: e.position || "",
      shiftKey: null,
    }));
  }

  const workDate = String(input.workDate || todayYmd()).slice(0, 10);
  const [rating] = await db
    .insert(customerRatingsTable)
    .values({
      qrId: null,
      branchId: branch.id,
      branchLabel: branch.label,
      workDate,
      shiftKey: null,
      stars,
      serviceQuality: input.serviceQuality,
      demeanor: input.demeanor,
      comment: String(input.comment || "").trim().slice(0, 1000) || null,
      customerName: name,
      customerPhone: phone,
      targetMode: input.rateType === "pharmacy" ? "pharmacy" : targets.length > 1 ? "multi" : "single",
      lang: "uz",
    })
    .returning();

  for (const t of targets) {
    await db.insert(customerRatingTargetsTable).values({
      ratingId: rating!.id,
      employeeId: t.employeeId,
      employeeName: t.fullName,
      position: t.position,
      shiftKey: t.shiftKey,
    });
  }

  await audit({
    action: "rating_admin_create",
    actorUserId: input.actor.id,
    actorName: input.actor.name,
    branchId: branch.id,
    ratingId: rating!.id,
    meta: { rateType: input.rateType, stars, targets: targets.map((t) => t.employeeId) },
  });

  return { ok: true, id: rating!.id };
}

function emptyStats() {
  return {
    total: 0,
    avgStars: 0,
    complaints: 0,
    byBranch: [] as Array<{ branchId: number; label: string; count: number; avg: number }>,
    byEmployee: [] as Array<{ employeeId: number; name: string; count: number; avg: number }>,
  };
}

async function ratingsStats(
  scope: number[] | null,
  branchId: number | null,
  from: string | null,
  to: string | null,
  rateType: "staff" | "pharmacy" | null = null,
) {
  const params: unknown[] = [];
  const where: string[] = ["1=1"];
  if (scope) {
    if (!scope.length) return emptyStats();
    params.push(scope);
    where.push(`r.branch_id = ANY($${params.length}::int[])`);
  }
  if (branchId) {
    params.push(branchId);
    where.push(`r.branch_id = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`r.work_date >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`r.work_date <= $${params.length}`);
  }
  if (rateType === "pharmacy") where.push(`r.target_mode = 'pharmacy'`);
  else if (rateType === "staff") where.push(`r.target_mode <> 'pharmacy'`);
  const w = where.join(" AND ");

  const { rows: tot } = await pool.query(
    `SELECT COUNT(*)::int AS c,
            COALESCE(AVG(stars),0)::float AS avg,
            COUNT(*) FILTER (WHERE stars <= 2 OR service_quality IN ('yomon','juda_yomon') OR demeanor IN ('qopol','juda_qopol'))::int AS complaints
       FROM customer_ratings r WHERE ${w}`,
    params,
  );

  const { rows: byBranch } = await pool.query(
    `SELECT branch_id, COALESCE(branch_label,'') AS label, COUNT(*)::int AS c, COALESCE(AVG(stars),0)::float AS avg
       FROM customer_ratings r WHERE ${w}
      GROUP BY branch_id, branch_label ORDER BY c DESC LIMIT 100`,
    params,
  );

  const { rows: byEmp } = await pool.query(
    `SELECT t.employee_id, t.employee_name, COUNT(*)::int AS c, COALESCE(AVG(r.stars),0)::float AS avg
       FROM customer_rating_targets t
       JOIN customer_ratings r ON r.id = t.rating_id
      WHERE ${w}
      GROUP BY t.employee_id, t.employee_name
      ORDER BY avg ASC, c DESC LIMIT 100`,
    params,
  );

  return {
    total: (tot[0]?.c as number) || 0,
    avgStars: Math.round(((tot[0]?.avg as number) || 0) * 100) / 100,
    complaints: (tot[0]?.complaints as number) || 0,
    byBranch: byBranch.map((b) => ({
      branchId: b.branch_id as number,
      label: (b.label as string) || `#${b.branch_id}`,
      count: b.c as number,
      avg: Math.round((b.avg as number) * 100) / 100,
    })),
    byEmployee: byEmp.map((e) => ({
      employeeId: e.employee_id as number,
      name: e.employee_name as string,
      count: e.c as number,
      avg: Math.round((e.avg as number) * 100) / 100,
    })),
  };
}

/**
 * Mijoz ovozlari bo‘yicha xodimlar reytingi (anonim mijoz).
 * Faqat baholangan xodimlar. Top-3 unvon + o‘z o‘rni.
 */
export async function employeeLeaderboard(opts: {
  userId: number;
  role: string;
  from?: string | null;
  to?: string | null;
}) {
  await ensureCustomerRatingsSchema();
  const role = String(opts.role || "").toLowerCase();
  // Farmasevt/stajyor — butun tarmoq; mudir/koordinator — scope filiallar
  let scope: number[] | null = null;
  if (role === "mudir" || role === "koordinator" || role === "regional_menejer") {
    scope = await scopedBranchIds(opts.userId, role);
  } else if (!canManageCustomerRatings(role) && role !== "farmasevt" && role !== "stajyor" && role !== "stajor") {
    scope = [];
  }

  const params: unknown[] = [];
  const where: string[] = [`r.target_mode <> 'pharmacy'`];
  if (scope) {
    if (!scope.length) {
      return { items: [], me: null, totalRated: 0, period: { from: opts.from || null, to: opts.to || null } };
    }
    params.push(scope);
    where.push(`r.branch_id = ANY($${params.length}::int[])`);
  }
  if (opts.from) {
    params.push(opts.from);
    where.push(`r.work_date >= $${params.length}`);
  }
  if (opts.to) {
    params.push(opts.to);
    where.push(`r.work_date <= $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT t.employee_id,
            MAX(t.employee_name) AS employee_name,
            COUNT(*)::int AS votes,
            COALESCE(AVG(r.stars), 0)::float AS avg_stars,
            COUNT(*) FILTER (WHERE r.stars >= 5)::int AS five_star,
            COUNT(*) FILTER (WHERE r.stars <= 2)::int AS low_star
       FROM customer_rating_targets t
       JOIN customer_ratings r ON r.id = t.rating_id
      WHERE ${where.join(" AND ")}
      GROUP BY t.employee_id
     HAVING COUNT(*) >= 1`,
    params,
  );

  const sorted = sortLeaderboardRows(
    rows.map((r) => ({
      employeeId: r.employee_id as number,
      name: String(r.employee_name || "Xodim"),
      count: r.votes as number,
      avg: Math.round((r.avg_stars as number) * 100) / 100,
      fiveStar: r.five_star as number,
      lowStar: r.low_star as number,
    })),
  );

  const items = sorted.map((row, i) => {
    const rank = i + 1;
    const titleKey = leaderboardTitleForRank(rank);
    return {
      rank,
      employeeId: row.employeeId,
      // Anonim ko‘rinish: to‘liq ism emas — faqat reyting uchun ism (xodimlar o‘zaro ko‘radi)
      displayName: row.name,
      votes: row.count,
      avgStars: row.avg,
      fiveStar: row.fiveStar,
      titleKey,
      titleUz:
        titleKey === "best"
          ? "Eng yaxshi xodim"
          : titleKey === "responsible"
            ? "Mas'uliyatli xodim"
            : titleKey === "trusted"
              ? "Ishonchli xodim"
              : null,
      titleRu:
        titleKey === "best"
          ? "Лучший сотрудник"
          : titleKey === "responsible"
            ? "Ответственный сотрудник"
            : titleKey === "trusted"
              ? "Надёжный сотрудник"
              : null,
      tier: rank <= 3 ? "top3" : rank <= 10 ? "top10" : "rest",
    };
  });

  const [meEmp] = await db
    .select({ id: employeesTable.id, fullName: employeesTable.fullName })
    .from(employeesTable)
    .where(eq(employeesTable.userId, opts.userId))
    .limit(1);

  let me: {
    employeeId: number;
    rank: number | null;
    avgStars: number | null;
    votes: number | null;
    titleUz: string | null;
    titleRu: string | null;
    inBoard: boolean;
  } | null = null;

  if (meEmp) {
    const found = items.find((x) => x.employeeId === meEmp.id);
    me = {
      employeeId: meEmp.id,
      rank: found?.rank ?? null,
      avgStars: found?.avgStars ?? null,
      votes: found?.votes ?? null,
      titleUz: found?.titleUz ?? null,
      titleRu: found?.titleRu ?? null,
      inBoard: Boolean(found),
    };
  }

  return {
    items,
    me,
    totalRated: items.length,
    period: { from: opts.from || null, to: opts.to || null },
  };
}

/** Test helpers — exported for unit tests */
export const __test = {
  normalizePhone,
  hashIp,
  todayYmd,
  addDaysYmd,
};
