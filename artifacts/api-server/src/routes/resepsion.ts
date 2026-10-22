/**
 * Qabulxoona — ofis tashrif / suhbat / murojaat qaydlari.
 */
import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import {
  attendanceRecordsTable,
  db,
  employeesTable,
  faceProfilesTable,
  receptionLogsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { isHrRole, hasFullPlatformAccess, isDirectorRole } from "../lib/roles";
import { ensureReceptionSchema } from "../lib/ensure-schema";
import { notifyUser } from "../lib/notify";
import { todayTashkentYmd } from "../lib/work-calendar";
import { isOnline } from "../lib/calls";

const router: IRouter = Router();

/** guest | staff | candidate | request | package (+ legacy) */
const VISIT_TYPES = new Set([
  "guest",
  "staff",
  "candidate",
  "request",
  "package",
  "interview",
  "office_visit",
  "other",
]);
const TOPICS = new Set(["delivery", "complaint", "call", "document", "package", "other"]);
const STATUSES = new Set(["waiting", "in_progress", "done", "cancelled", "no_show"]);

function normalizeVisitType(raw: string): string {
  if (raw === "interview") return "candidate";
  if (raw === "office_visit") return "guest";
  if (raw === "other") return "request";
  return raw;
}

function canUseDesk(role: string) {
  return (
    role === "resepsion" ||
    isHrRole(role) ||
    hasFullPlatformAccess(role) ||
    isDirectorRole(role)
  );
}

function canWrite(role: string) {
  return role === "resepsion" || isHrRole(role) || hasFullPlatformAccess(role) || isDirectorRole(role);
}

function parseDate(raw: unknown): Date | null {
  if (raw == null || raw === "") return null;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

function trimOrNull(v: unknown, max = 400): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.slice(0, max);
}

function typeLabel(vt: string) {
  const n = normalizeVisitType(vt);
  if (n === "guest") return "Mehmon";
  if (n === "staff") return "Xodim";
  if (n === "candidate") return "Nomzod";
  if (n === "request") return "Murojaat";
  if (n === "package") return "Posilka";
  return vt;
}

/** Telegram / tizim xabari — chiroyli, qatorma-qator */
function buildReceptionNotifyText(opts: {
  visitType: string;
  visitorFullName: string;
  phone: string;
  purpose: string;
  note?: string | null;
}) {
  const n = normalizeVisitType(opts.visitType);
  const tur = typeLabel(opts.visitType);
  const headline =
    n === "staff"
      ? "👥 Sizga xodim keldi!"
      : n === "candidate"
        ? "🎯 Sizga nomzod (suhbat) keldi!"
        : n === "request"
          ? "📋 Sizga murojaatchi keldi!"
          : n === "package"
            ? "📦 Sizga posilka / kuryer keldi!"
            : "👋 Sizga mehmon keldi!";
  const lines = [
    "🏢 Qabulxoona",
    "",
    headline,
    "",
    `👤 Kim: ${opts.visitorFullName}`,
    `📞 Telefon: ${opts.phone}`,
    `🏷️ Tur: ${tur}`,
    `🎯 Sabab: ${opts.purpose}`,
  ];
  if (opts.note) {
    lines.push(`📝 Izoh: ${opts.note}`);
  }
  lines.push("", "🔔 Iltimos, qabulxonaga chiqing yoki bog‘laning.");
  return lines.join("\n");
}

function formatHmTz(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toLocaleTimeString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type HostPresence = {
  status: "in_office" | "left" | "absent" | "leave";
  label: string;
  checkIn: string | null;
  checkOut: string | null;
};

function presenceFromAttendance(rec: {
  checkInAt: Date | null;
  checkOutAt: Date | null;
  status: string | null;
} | null): HostPresence {
  if (!rec) {
    return { status: "absent", label: "Kelmagan", checkIn: null, checkOut: null };
  }
  if (rec.status === "leave") {
    return {
      status: "leave",
      label: "Ruxsatda",
      checkIn: formatHmTz(rec.checkInAt),
      checkOut: formatHmTz(rec.checkOutAt),
    };
  }
  if (rec.checkInAt && !rec.checkOutAt) {
    return {
      status: "in_office",
      label: "Ofisda",
      checkIn: formatHmTz(rec.checkInAt),
      checkOut: null,
    };
  }
  if (rec.checkInAt && rec.checkOutAt) {
    return {
      status: "left",
      label: "Chiqqan",
      checkIn: formatHmTz(rec.checkInAt),
      checkOut: formatHmTz(rec.checkOutAt),
    };
  }
  return { status: "absent", label: "Kelmagan", checkIn: null, checkOut: null };
}

async function enrich(rows: (typeof receptionLogsTable.$inferSelect)[]) {
  if (!rows.length) return [];
  const ids = new Set<number>();
  for (const r of rows) {
    ids.add(r.loggedByUserId);
    if (r.hostUserId) ids.add(r.hostUserId);
    if (r.interviewerUserId) ids.add(r.interviewerUserId);
  }
  const users = ids.size
    ? await db
        .select({
          id: usersTable.id,
          fullName: usersTable.fullName,
          role: usersTable.role,
          phone: usersTable.phone,
        })
        .from(usersTable)
        .where(inArray(usersTable.id, [...ids]))
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => {
    const host = r.hostUserId ? byId.get(r.hostUserId) : null;
    return {
      ...r,
      visitType: normalizeVisitType(r.visitType),
      visitTypeLabel: typeLabel(r.visitType),
      loggedByName: byId.get(r.loggedByUserId)?.fullName || null,
      hostUserName: host?.fullName || null,
      hostUserRole: host?.role || null,
      hostUserPhone: host?.phone || null,
      interviewerUserName: r.interviewerUserId
        ? byId.get(r.interviewerUserId)?.fullName || null
        : null,
    };
  });
}

router.get("/resepsion/meta", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  if (!canUseDesk(role)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  res.json({
    visitTypes: [
      { value: "guest", label: "Mehmon" },
      { value: "staff", label: "Xodim" },
      { value: "candidate", label: "Nomzod" },
      { value: "request", label: "Murojaat" },
      { value: "package", label: "Posilka" },
    ],
    topics: [
      { value: "delivery", label: "Yetkazib berish" },
      { value: "package", label: "Posilka / yuk" },
      { value: "document", label: "Hujjat" },
      { value: "call", label: "Telefon qo‘ng‘iroq" },
      { value: "complaint", label: "Shikoyat / murojaat" },
      { value: "other", label: "Boshqa" },
    ],
    statuses: [
      { value: "waiting", label: "Kutilmoqda" },
      { value: "in_progress", label: "Ofisda" },
      { value: "done", label: "Chiqdi" },
      { value: "no_show", label: "Kelmadi" },
      { value: "cancelled", label: "Bekor" },
    ],
    roleHints: [
      "Stajyor",
      "Farmasevt",
      "Mudir",
      "Koordinator",
      "Nomzod",
      "Mehmon",
      "Yetkazuvchi",
      "Hamkor",
      "Boshqa",
    ],
    canWrite: canWrite(role),
  });
});

router.get("/resepsion/hosts", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  if (!canUseDesk(role)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const q = String(req.query.q || "").trim().toLowerCase();
  const rows = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      role: usersTable.role,
      phone: usersTable.phone,
      telegramId: usersTable.telegramId,
    })
    .from(usersTable)
    .where(eq(usersTable.status, "active"))
    .orderBy(usersTable.fullName);
  const filtered = q
    ? rows.filter(
        (u) =>
          u.fullName.toLowerCase().includes(q) ||
          String(u.role || "").toLowerCase().includes(q) ||
          String(u.phone || "").includes(q),
      )
    : rows;
  /** Barcha faol xodimlar — ofis/dorixona soni to‘liq bo‘lishi uchun limit yo‘q */
  const slice = filtered;
  const ids = slice.map((u) => u.id);

  const presenceByUser = new Map<number, HostPresence>();
  const hasPhoto = new Set<number>();

  if (ids.length) {
    const today = todayTashkentYmd();
    const empLinks = await db
      .select({ userId: employeesTable.userId, employeeId: employeesTable.id })
      .from(employeesTable)
      .where(and(inArray(employeesTable.userId, ids), isNotNull(employeesTable.userId)));
    const empToUser = new Map<number, number>();
    for (const e of empLinks) {
      if (e.userId) empToUser.set(e.employeeId, e.userId);
    }
    const empIds = [...empToUser.keys()];

    const attConds = [eq(attendanceRecordsTable.workDate, today)];
    const idOr =
      empIds.length > 0
        ? or(
            inArray(attendanceRecordsTable.userId, ids),
            inArray(attendanceRecordsTable.employeeId, empIds),
          )
        : inArray(attendanceRecordsTable.userId, ids);
    attConds.push(idOr!);

    const attRows = await db
      .select({
        userId: attendanceRecordsTable.userId,
        employeeId: attendanceRecordsTable.employeeId,
        checkInAt: attendanceRecordsTable.checkInAt,
        checkOutAt: attendanceRecordsTable.checkOutAt,
        status: attendanceRecordsTable.status,
      })
      .from(attendanceRecordsTable)
      .where(and(...attConds));

    for (const a of attRows) {
      const uid = a.userId || empToUser.get(a.employeeId) || null;
      if (!uid) continue;
      presenceByUser.set(
        uid,
        presenceFromAttendance({
          checkInAt: a.checkInAt,
          checkOutAt: a.checkOutAt,
          status: a.status,
        }),
      );
    }

    const faces = await db
      .select({
        userId: faceProfilesTable.userId,
        photoUrl: faceProfilesTable.photoUrl,
      })
      .from(faceProfilesTable)
      .where(inArray(faceProfilesTable.userId, ids));
    for (const f of faces) {
      if (f.photoUrl?.trim()) hasPhoto.add(f.userId);
    }

    const empPhotos = await db
      .select({ userId: employeesTable.userId, photoUrl: employeesTable.photoUrl })
      .from(employeesTable)
      .where(
        and(
          inArray(employeesTable.userId, ids),
          isNotNull(employeesTable.photoUrl),
          sql`length(trim(${employeesTable.photoUrl})) > 0`,
        ),
      );
    for (const e of empPhotos) {
      if (e.userId) hasPhoto.add(e.userId);
    }
  }

  res.json({
    date: todayTashkentYmd(),
    items: slice.map((u) => {
      const presence = presenceByUser.get(u.id) || presenceFromAttendance(null);
      const photo = hasPhoto.has(u.id);
      return {
        id: u.id,
        fullName: u.fullName,
        role: u.role,
        phone: u.phone || null,
        hasTelegram: Boolean(u.telegramId),
        hasPhoto: photo,
        photoUrl: photo ? `/api/staff/${u.id}/avatar` : null,
        online: isOnline(u.id),
        presence,
      };
    }),
  });
});

router.get("/resepsion/logs", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  if (!canUseDesk(role)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  await ensureReceptionSchema().catch(() => undefined);

  const visitTypeRaw = String(req.query.visitType || "").trim();
  const visitType = visitTypeRaw ? normalizeVisitType(visitTypeRaw) : "";
  const status = String(req.query.status || "").trim();
  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);
  const search = String(req.query.q || "").trim().toLowerCase();
  const hostUserIdQ = Number(req.query.hostUserId);
  const hostUserIdFilter =
    Number.isFinite(hostUserIdQ) && hostUserIdQ > 0 ? hostUserIdQ : null;

  const conds = [];
  if (visitType && VISIT_TYPES.has(visitType)) {
    const aliases =
      visitType === "candidate"
        ? ["candidate", "interview"]
        : visitType === "guest"
          ? ["guest", "office_visit"]
          : visitType === "request"
            ? ["request", "other"]
            : [visitType];
    conds.push(inArray(receptionLogsTable.visitType, aliases));
  }
  if (STATUSES.has(status)) conds.push(eq(receptionLogsTable.status, status));
  if (from) conds.push(gte(receptionLogsTable.visitAt, from));
  if (to) conds.push(lte(receptionLogsTable.visitAt, to));
  if (hostUserIdFilter) conds.push(eq(receptionLogsTable.hostUserId, hostUserIdFilter));

  let rows = await db
    .select()
    .from(receptionLogsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(receptionLogsTable.visitAt))
    .limit(hostUserIdFilter ? 80 : 500);

  if (search) {
    rows = rows.filter((r) => {
      const blob = [
        r.visitorFullName,
        r.visitorPhone,
        r.hostName,
        r.interviewerName,
        r.purpose,
        r.visitorRoleHint,
        r.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(search);
    });
  }

  const items = await enrich(rows);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const todayRows = items.filter((r) => {
    const t = new Date(r.visitAt).getTime();
    return t >= todayStart.getTime() && t <= todayEnd.getTime();
  });

  res.json({
    items,
    stats: {
      total: items.length,
      today: todayRows.length,
      waiting: todayRows.filter((r) => r.status === "waiting").length,
      inProgress: todayRows.filter((r) => r.status === "in_progress").length,
      done: todayRows.filter((r) => r.status === "done").length,
      interviewsToday: todayRows.filter((r) => normalizeVisitType(r.visitType) === "candidate")
        .length,
      visitsToday: todayRows.filter((r) => normalizeVisitType(r.visitType) === "guest").length,
    },
    canWrite: canWrite(role),
  });
});

router.post("/resepsion/logs", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  if (!canWrite(role)) {
    res.status(403).json({ error: "Yozishga ruxsat yo‘q" });
    return;
  }
  await ensureReceptionSchema().catch(() => undefined);

  const visitTypeRaw = String(req.body?.visitType || "").trim();
  if (!VISIT_TYPES.has(visitTypeRaw)) {
    res.status(400).json({ error: "Tur noto‘g‘ri" });
    return;
  }
  const visitType = normalizeVisitType(visitTypeRaw);
  const visitorFullName = String(req.body?.visitorFullName || "").trim();
  if (visitorFullName.length < 2) {
    res.status(400).json({ error: "Ism familiya majburiy" });
    return;
  }
  const visitAt = parseDate(req.body?.visitAt) || new Date();
  const statusRaw = String(req.body?.status || "in_progress").trim();
  const status = STATUSES.has(statusRaw) ? statusRaw : "in_progress";
  const topicRaw = trimOrNull(req.body?.topic, 40);
  const topic =
    topicRaw && TOPICS.has(topicRaw)
      ? topicRaw
      : visitType === "package"
        ? "package"
        : visitType === "request"
          ? "other"
          : null;

  const hostUserId = req.body?.hostUserId ? Number(req.body.hostUserId) || null : null;

  const [row] = await db
    .insert(receptionLogsTable)
    .values({
      visitType,
      topic,
      visitorFullName: visitorFullName.slice(0, 200),
      visitorPhone: trimOrNull(req.body?.visitorPhone, 40),
      visitorRoleHint: trimOrNull(req.body?.visitorRoleHint, 80),
      hostName: trimOrNull(req.body?.hostName, 200),
      hostUserId,
      interviewerName: trimOrNull(req.body?.interviewerName, 200),
      interviewerUserId: req.body?.interviewerUserId
        ? Number(req.body.interviewerUserId) || null
        : null,
      purpose: trimOrNull(req.body?.purpose, 800),
      notes: trimOrNull(req.body?.notes, 1200),
      status,
      visitAt,
      leftAt: parseDate(req.body?.leftAt),
      loggedByUserId: req.userId!,
    })
    .returning();

  if (hostUserId) {
    const text = buildReceptionNotifyText({
      visitType,
      visitorFullName,
      phone: trimOrNull(req.body?.visitorPhone, 40) || "—",
      purpose: trimOrNull(req.body?.purpose, 200) || "—",
      note: trimOrNull(req.body?.notes, 300),
    });
    await notifyUser({
      userId: hostUserId,
      text,
      type: "resepsion_visit",
      linkUrl: "/resepsion",
      title: "🏢 Qabulxoona",
    }).catch(() => undefined);
  }

  const [item] = await enrich([row]);
  res.status(201).json({ ok: true, item });
});

router.patch("/resepsion/logs/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  if (!canWrite(role)) {
    res.status(403).json({ error: "O‘zgartirishga ruxsat yo‘q" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Noto‘g‘ri id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(receptionLogsTable)
    .where(eq(receptionLogsTable.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Yozuv topilmadi" });
    return;
  }

  const patch: Partial<typeof receptionLogsTable.$inferInsert> = { updatedAt: new Date() };
  if (req.body?.visitType != null) {
    const vt = String(req.body.visitType).trim();
    if (VISIT_TYPES.has(vt)) patch.visitType = normalizeVisitType(vt);
  }
  if (req.body?.status != null) {
    const st = String(req.body.status).trim();
    if (STATUSES.has(st)) patch.status = st;
  }
  if (req.body?.topic != null) {
    const tp = String(req.body.topic).trim();
    patch.topic = TOPICS.has(tp) ? tp : null;
  }
  if (req.body?.visitorFullName != null) {
    const n = String(req.body.visitorFullName).trim();
    if (n.length >= 2) patch.visitorFullName = n.slice(0, 200);
  }
  if (req.body?.visitorPhone !== undefined) patch.visitorPhone = trimOrNull(req.body.visitorPhone, 40);
  if (req.body?.visitorRoleHint !== undefined)
    patch.visitorRoleHint = trimOrNull(req.body.visitorRoleHint, 80);
  if (req.body?.hostName !== undefined) patch.hostName = trimOrNull(req.body.hostName, 200);
  if (req.body?.hostUserId !== undefined)
    patch.hostUserId = req.body.hostUserId ? Number(req.body.hostUserId) || null : null;
  if (req.body?.interviewerName !== undefined)
    patch.interviewerName = trimOrNull(req.body.interviewerName, 200);
  if (req.body?.interviewerUserId !== undefined)
    patch.interviewerUserId = req.body.interviewerUserId
      ? Number(req.body.interviewerUserId) || null
      : null;
  if (req.body?.purpose !== undefined) patch.purpose = trimOrNull(req.body.purpose, 800);
  if (req.body?.notes !== undefined) patch.notes = trimOrNull(req.body.notes, 1200);
  if (req.body?.visitAt !== undefined) {
    const d = parseDate(req.body.visitAt);
    if (d) patch.visitAt = d;
  }
  if (req.body?.leftAt !== undefined) patch.leftAt = parseDate(req.body.leftAt);

  if (patch.status === "done" && !patch.leftAt && !existing.leftAt) {
    patch.leftAt = new Date();
  }

  const [row] = await db
    .update(receptionLogsTable)
    .set(patch)
    .where(eq(receptionLogsTable.id, id))
    .returning();
  const [item] = await enrich([row]);
  res.json({ ok: true, item });
});

router.delete("/resepsion/logs/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  if (!canWrite(role)) {
    res.status(403).json({ error: "O‘chirishga ruxsat yo‘q" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Noto‘g‘ri id" });
    return;
  }
  const deleted = await db
    .delete(receptionLogsTable)
    .where(eq(receptionLogsTable.id, id))
    .returning({ id: receptionLogsTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Yozuv topilmadi" });
    return;
  }
  res.json({ ok: true });
});

export default router;
