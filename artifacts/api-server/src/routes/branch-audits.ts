import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  branchAuditsTable,
  employeesTable,
  usersTable,
  type AuditCategory,
  type AuditChecklistItem,
} from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

const VIEW_ROLES = new Set(["koordinator", "admin", "hr", "director"]);
const WRITE_ROLES = new Set(["koordinator", "admin"]);

/** Koordinator filialga 15 m dan yaqin bo‘lishi shart */
export const AUDIT_GEOFENCE_METERS = 15;

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

function requireRole(req: AuthRequest, roles: Set<string>): boolean {
  return !!req.userRole && roles.has(req.userRole);
}

function flattenItems(categories: AuditCategory[]): AuditChecklistItem[] {
  return categories.flatMap((c) => c.items || []);
}

function computeScore(categories: AuditCategory[]) {
  const items = flattenItems(categories);
  const total = items.length;
  const yes = items.filter((i) => i.answer === "yes").length;
  const no = items.filter((i) => i.answer === "no").length;
  const answered = yes + no;
  const scorePercent = answered === 0 ? 0 : Math.round((yes / answered) * 100);
  return { totalCount: total, yesCount: yes, noCount: no, answeredCount: answered, scorePercent };
}

function sanitizeCategories(raw: unknown): AuditCategory[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((cat: any, ci: number) => ({
    id: String(cat?.id || `cat-${ci}`),
    title: String(cat?.title || "Bo'lim").slice(0, 200),
    items: Array.isArray(cat?.items)
      ? cat.items.map((it: any, ii: number) => ({
          id: String(it?.id || `item-${ci}-${ii}`),
          label: String(it?.label || "Talab").slice(0, 300),
          answer:
            it?.answer === "yes" || it?.answer === "no" ? (it.answer as "yes" | "no") : null,
          note: it?.note ? String(it.note).slice(0, 500) : null,
        }))
      : [],
  }));
}

async function enrich(row: typeof branchAuditsTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Filiallar (mudirlar) ro'yxati — tanlash uchun */
router.get("/branch-audits/branches", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireRole(req, VIEW_ROLES)) {
    res.status(403).json({ error: "Ruxsat yo'q" });
    return;
  }

  const managers = await db
    .select({
      id: employeesTable.id,
      fullName: employeesTable.fullName,
      location: employeesTable.location,
      employmentStatus: employeesTable.employmentStatus,
      reportsToId: employeesTable.reportsToId,
      userId: employeesTable.userId,
      latitude: employeesTable.latitude,
      longitude: employeesTable.longitude,
    })
    .from(employeesTable)
    .where(eq(employeesTable.orgRole, "manager"));

  let scoped = managers.filter((m) => m.employmentStatus !== "dismissed");

  // Koordinator — faqat o'ziga bog'langan filiallar (reportsToId)
  if (req.userRole === "koordinator" && req.userId) {
    const coordRows = await db
      .select({ id: employeesTable.id, orgRole: employeesTable.orgRole })
      .from(employeesTable)
      .where(eq(employeesTable.userId, req.userId));
    const coord =
      coordRows.find((r) => r.orgRole === "coordinator") ?? coordRows[0];
    if (!coord) {
      res.json([]);
      return;
    }
    scoped = scoped.filter((m) => m.reportsToId === coord.id);
  }

  const active = scoped
    .map((m) => ({
      id: m.id,
      managerName: m.fullName,
      branchLocation: m.location || m.fullName,
      latitude: m.latitude ?? null,
      longitude: m.longitude ?? null,
    }))
    .sort((a, b) => a.branchLocation.localeCompare(b.branchLocation, "uz"));

  res.json(active);
});

/** Saqlangan auditlar tarixi */
router.get("/branch-audits", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireRole(req, VIEW_ROLES)) {
    res.status(403).json({ error: "Ruxsat yo'q" });
    return;
  }

  let rows = await db
    .select()
    .from(branchAuditsTable)
    .orderBy(desc(branchAuditsTable.visitDate), desc(branchAuditsTable.id));

  // Koordinator — faqat o'zi yozganlarini (admin/hr — hammasi)
  if (req.userRole === "koordinator" && req.userId) {
    rows = rows.filter((r) => r.coordinatorId === req.userId);
  }

  const managerId = req.query.managerId
    ? parseInt(String(req.query.managerId), 10)
    : NaN;
  if (!Number.isNaN(managerId)) {
    rows = rows.filter((r) => r.managerEmployeeId === managerId);
  }

  res.json(await Promise.all(rows.map(enrich)));
});

router.get("/branch-audits/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireRole(req, VIEW_ROLES)) {
    res.status(403).json({ error: "Ruxsat yo'q" });
    return;
  }
  const id = parseInt(String(req.params.id), 10);
  const [row] = await db.select().from(branchAuditsTable).where(eq(branchAuditsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  if (
    req.userRole === "koordinator" &&
    req.userId &&
    row.coordinatorId !== req.userId
  ) {
    res.status(403).json({ error: "Ruxsat yo'q" });
    return;
  }
  res.json(await enrich(row));
});

/** Yangi audit saqlash */
router.post("/branch-audits", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireRole(req, WRITE_ROLES)) {
    res.status(403).json({ error: "Faqat koordinator saqlay oladi" });
    return;
  }

  const managerEmployeeId = parseInt(String(req.body?.managerEmployeeId ?? ""), 10);
  const visitDate = String(req.body?.visitDate || "").trim();
  const visitName = String(req.body?.visitName || "1-tashrif").trim();
  const monthLabel = req.body?.monthLabel ? String(req.body.monthLabel).trim() : null;
  const generalNote = req.body?.generalNote ? String(req.body.generalNote).trim() : null;
  const categories = sanitizeCategories(req.body?.categories);
  const checkLat = req.body?.checkLatitude != null ? Number(req.body.checkLatitude) : NaN;
  const checkLng = req.body?.checkLongitude != null ? Number(req.body.checkLongitude) : NaN;

  if (!managerEmployeeId || Number.isNaN(managerEmployeeId)) {
    res.status(400).json({ error: "Filialni tanlang" });
    return;
  }
  if (!visitDate) {
    res.status(400).json({ error: "Tashrif sanasini belgilang" });
    return;
  }
  if (!categories.length) {
    res.status(400).json({ error: "Cheklist bo'sh" });
    return;
  }

  const score = computeScore(categories);
  if (score.answeredCount === 0) {
    res.status(400).json({ error: "Kamida bitta talabga Ha yoki Yo'q belgilang" });
    return;
  }

  const [manager] = await db
    .select({
      fullName: employeesTable.fullName,
      location: employeesTable.location,
      orgRole: employeesTable.orgRole,
      reportsToId: employeesTable.reportsToId,
      latitude: employeesTable.latitude,
      longitude: employeesTable.longitude,
    })
    .from(employeesTable)
    .where(eq(employeesTable.id, managerEmployeeId));

  if (!manager || manager.orgRole !== "manager") {
    res.status(400).json({ error: "Filial (mudir) topilmadi" });
    return;
  }

  // Koordinator faqat o'z filiallariga yozadi
  if (req.userRole === "koordinator" && req.userId) {
    const coordRows = await db
      .select({ id: employeesTable.id, orgRole: employeesTable.orgRole })
      .from(employeesTable)
      .where(eq(employeesTable.userId, req.userId));
    const coord =
      coordRows.find((r) => r.orgRole === "coordinator") ?? coordRows[0];
    if (!coord || manager.reportsToId !== coord.id) {
      res.status(403).json({ error: "Bu filial sizga biriktirilmagan" });
      return;
    }
  }

  let distanceMeters: number | null = null;
  let savedCheckLat: number | null = null;
  let savedCheckLng: number | null = null;

  // Koordinator: filial GPS dan 15 m ichida bo‘lishi shart
  if (req.userRole === "koordinator") {
    if (manager.latitude == null || manager.longitude == null) {
      res.status(400).json({
        error: "Filial lokatsiyasi bazada yo‘q — admin GPS qo‘shishi kerak",
      });
      return;
    }
    if (Number.isNaN(checkLat) || Number.isNaN(checkLng)) {
      res.status(400).json({
        error: "GPS yoqilmagan — joylashuvingizni ruxsat bering",
      });
      return;
    }
    distanceMeters = haversineMeters(
      checkLat,
      checkLng,
      manager.latitude,
      manager.longitude,
    );
    savedCheckLat = checkLat;
    savedCheckLng = checkLng;
    if (distanceMeters > AUDIT_GEOFENCE_METERS) {
      const remain = distanceMeters - AUDIT_GEOFENCE_METERS;
      res.status(403).json({
        error: `Filialdan uzoqdasiz: ${distanceMeters} m. Yana ${remain} m yaqinlashishingiz kerak (ruxsat: ${AUDIT_GEOFENCE_METERS} m).`,
        distanceMeters,
        remainMeters: remain,
        allowedMeters: AUDIT_GEOFENCE_METERS,
      });
      return;
    }
  }

  const [coordUser] = await db
    .select({ fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!));

  const [created] = await db
    .insert(branchAuditsTable)
    .values({
      managerEmployeeId,
      branchLocation: manager.location || manager.fullName,
      managerName: manager.fullName,
      visitDate,
      visitName,
      monthLabel,
      coordinatorId: req.userId!,
      coordinatorName: coordUser?.fullName || null,
      generalNote,
      categories,
      ...score,
      checkLatitude: savedCheckLat,
      checkLongitude: savedCheckLng,
      distanceMeters,
      status: "saved",
    })
    .returning();

  res.status(201).json(await enrich(created));
});

/** Yangilash */
router.patch("/branch-audits/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireRole(req, WRITE_ROLES)) {
    res.status(403).json({ error: "Ruxsat yo'q" });
    return;
  }
  const id = parseInt(String(req.params.id), 10);
  const [existing] = await db.select().from(branchAuditsTable).where(eq(branchAuditsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  if (
    req.userRole === "koordinator" &&
    req.userId &&
    existing.coordinatorId !== req.userId
  ) {
    res.status(403).json({ error: "Faqat o'z auditini tahrirlashingiz mumkin" });
    return;
  }

  const categories =
    req.body?.categories !== undefined
      ? sanitizeCategories(req.body.categories)
      : (existing.categories as AuditCategory[]);
  const score = computeScore(categories);

  const [updated] = await db
    .update(branchAuditsTable)
    .set({
      visitDate: req.body?.visitDate
        ? String(req.body.visitDate).trim()
        : existing.visitDate,
      visitName: req.body?.visitName
        ? String(req.body.visitName).trim()
        : existing.visitName,
      monthLabel:
        req.body?.monthLabel !== undefined
          ? String(req.body.monthLabel || "").trim() || null
          : existing.monthLabel,
      generalNote:
        req.body?.generalNote !== undefined
          ? String(req.body.generalNote || "").trim() || null
          : existing.generalNote,
      categories,
      ...score,
    })
    .where(eq(branchAuditsTable.id, id))
    .returning();

  res.json(await enrich(updated));
});

router.delete("/branch-audits/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireRole(req, WRITE_ROLES)) {
    res.status(403).json({ error: "Ruxsat yo'q" });
    return;
  }
  const id = parseInt(String(req.params.id), 10);
  const [existing] = await db.select().from(branchAuditsTable).where(eq(branchAuditsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  if (
    req.userRole === "koordinator" &&
    req.userId &&
    existing.coordinatorId !== req.userId
  ) {
    res.status(403).json({ error: "Ruxsat yo'q" });
    return;
  }
  await db.delete(branchAuditsTable).where(eq(branchAuditsTable.id, id));
  res.status(204).end();
});

export default router;
