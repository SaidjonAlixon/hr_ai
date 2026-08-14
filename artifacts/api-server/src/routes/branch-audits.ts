import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import ExcelJS from "exceljs";
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
import { HR_ROLES, canViewChecklistStatus } from "../lib/roles";
import { gpsFromLocationField, displayBranchName } from "../lib/geo-location";

const router: IRouter = Router();

const VIEW_ROLES = new Set(["koordinator", "admin", ...HR_ROLES, "director"]);
const WRITE_ROLES = new Set(["koordinator", "admin"]);

/** Koordinator filialga 50 m dan yaqin bo‘lishi shart */
export const AUDIT_GEOFENCE_METERS = 50;

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
    branchLocation: displayBranchName(row.branchLocation) || row.branchLocation,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function answerLabel(a: "yes" | "no" | null | undefined) {
  if (a === "yes") return "Ha";
  if (a === "no") return "Yo‘q";
  return "—";
}

async function loadFilteredAudits(req: AuthRequest) {
  let rows = await db
    .select()
    .from(branchAuditsTable)
    .orderBy(desc(branchAuditsTable.visitDate), desc(branchAuditsTable.id));

  if (req.userRole === "koordinator" && req.userId) {
    rows = rows.filter((r) => r.coordinatorId === req.userId);
  }

  const managerId = req.query.managerId
    ? parseInt(String(req.query.managerId), 10)
    : NaN;
  if (!Number.isNaN(managerId)) {
    rows = rows.filter((r) => r.managerEmployeeId === managerId);
  }

  const coordinatorId = req.query.coordinatorId
    ? parseInt(String(req.query.coordinatorId), 10)
    : NaN;
  if (!Number.isNaN(coordinatorId)) {
    rows = rows.filter((r) => r.coordinatorId === coordinatorId);
  }

  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();
  if (from) rows = rows.filter((r) => r.visitDate >= from);
  if (to) rows = rows.filter((r) => r.visitDate <= to);

  const q = String(req.query.q || "").trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) => {
      const loc = displayBranchName(r.branchLocation) || "";
      return (
        loc.toLowerCase().includes(q) ||
        String(r.managerName || "").toLowerCase().includes(q) ||
        String(r.coordinatorName || "").toLowerCase().includes(q) ||
        String(r.visitName || "").toLowerCase().includes(q)
      );
    });
  }

  return rows;
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

  // Koordinator — faqat o‘z mudirlari (reportsToId = coordinator employee id)
  if (req.userRole === "koordinator" && req.userId) {
    const coordRows = await db
      .select({ id: employeesTable.id, orgRole: employeesTable.orgRole })
      .from(employeesTable)
      .where(eq(employeesTable.userId, req.userId));
    const coord = coordRows.find((r) => r.orgRole === "coordinator");
    if (!coord) {
      res.json([]);
      return;
    }
    scoped = scoped.filter((m) => m.reportsToId === coord.id);
  }

  const seen = new Set<number>();
  const active = scoped
    .filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    })
    .map((m) => {
      const fromLoc = gpsFromLocationField(m.location);
      const loc = displayBranchName(m.location);
      const generic =
        !loc ||
        loc === "Filial" ||
        loc === m.fullName ||
        /\d+\s*°/.test(loc) ||
        /^-?\d+[.,]\d+\s*[,;]\s*-?\d+/.test(loc);
      return {
        id: m.id,
        managerName: m.fullName,
        branchLocation: generic ? m.fullName : loc,
        latitude: m.latitude ?? fromLoc?.lat ?? null,
        longitude: m.longitude ?? fromLoc?.lng ?? null,
      };
    })
    .sort((a, b) => a.branchLocation.localeCompare(b.branchLocation, "uz"));

  res.json(active);
});

/** Saqlangan auditlar tarixi */
router.get("/branch-audits", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireRole(req, VIEW_ROLES)) {
    res.status(403).json({ error: "Ruxsat yo'q" });
    return;
  }
  const rows = await loadFilteredAudits(req);
  res.json(await Promise.all(rows.map(enrich)));
});

router.get("/branch-audits/export", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canViewChecklistStatus(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }

  const rows = await loadFilteredAudits(req);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "VAKSINA MED HR";
  workbook.created = new Date();

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

  const paintRow = (row: ExcelJS.Row, zebra: boolean) => {
    const bg = zebra ? "FFF7FAFC" : "FFFFFFFF";
    row.eachCell((cell) => {
      cell.font = { name: "Calibri", size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
    });
    row.height = 22;
  };

  const byCoord = new Map<
    string,
    { visits: number; branches: Set<string>; scores: number[]; last: string }
  >();
  const byBranch = new Map<
    string,
    { visits: number; coordinators: Set<string>; scores: number[]; dates: string[] }
  >();
  for (const r of rows) {
    const cKey = r.coordinatorName || `#${r.coordinatorId}`;
    const bKey = displayBranchName(r.branchLocation) || r.managerName || "Filial";
    const c = byCoord.get(cKey) ?? {
      visits: 0,
      branches: new Set<string>(),
      scores: [],
      last: r.visitDate,
    };
    c.visits += 1;
    c.branches.add(bKey);
    c.scores.push(r.scorePercent);
    if (r.visitDate > c.last) c.last = r.visitDate;
    byCoord.set(cKey, c);

    const b = byBranch.get(bKey) ?? {
      visits: 0,
      coordinators: new Set<string>(),
      scores: [],
      dates: [],
    };
    b.visits += 1;
    b.coordinators.add(cKey);
    b.scores.push(r.scorePercent);
    b.dates.push(r.visitDate);
    byBranch.set(bKey, b);
  }

  const s1 = workbook.addWorksheet("Xulosa", { views: [{ state: "frozen", ySplit: 2 }] });
  s1.mergeCells("A1:F1");
  const t1 = s1.getCell("A1");
  t1.value = `VAKSINA MED — Cheklist holati · ${rows.length} tashrif`;
  t1.font = { name: "Calibri", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
  t1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3A5C" } };
  t1.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  s1.getRow(1).height = 28;

  ["Koordinator", "Tashriflar", "Filiallar", "O‘rtacha %", "Oxirgi tashrif", ""].forEach((h, i) => {
    const cell = s1.getRow(2).getCell(i + 1);
    cell.value = h;
    headerStyle(cell, "FF1A5F8A");
  });
  s1.columns = [{ width: 28 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 16 }, { width: 8 }];
  let i = 0;
  for (const [name, v] of [...byCoord.entries()].sort((a, b) => b[1].visits - a[1].visits)) {
    const avg = v.scores.length ? Math.round(v.scores.reduce((a, b) => a + b, 0) / v.scores.length) : 0;
    const row = s1.addRow([name, v.visits, v.branches.size, avg, v.last, ""]);
    paintRow(row, i++ % 2 === 0);
  }

  s1.addRow([]);
  const gap = s1.addRow(["Filial", "Tashriflar", "Koordinatorlar", "O‘rtacha %", "Sanalar", ""]);
  gap.eachCell((cell) => headerStyle(cell, "FF0F766E"));
  i = 0;
  for (const [name, v] of [...byBranch.entries()].sort((a, b) => b[1].visits - a[1].visits)) {
    const avg = v.scores.length ? Math.round(v.scores.reduce((a, b) => a + b, 0) / v.scores.length) : 0;
    const dates = [...new Set(v.dates)].sort().join(", ");
    const row = s1.addRow([name, v.visits, v.coordinators.size, avg, dates, ""]);
    paintRow(row, i++ % 2 === 0);
  }

  const s2 = workbook.addWorksheet("Tashriflar", { views: [{ state: "frozen", ySplit: 2 }] });
  s2.mergeCells("A1:L1");
  const t2 = s2.getCell("A1");
  t2.value = "VAKSINA MED — Tashriflar (sana, vaqt, filial, mudir, koordinator, lokatsiya, ball)";
  t2.font = { name: "Calibri", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
  t2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3A5C" } };
  s2.getRow(1).height = 28;
  const h2 = [
    "Sana",
    "Vaqt",
    "Tashrif",
    "Filial",
    "Mudir",
    "Koordinator",
    "Ball %",
    "Ha",
    "Yo‘q",
    "GPS",
    "Masofa (m)",
    "Izoh",
  ];
  h2.forEach((h, idx) => {
    const cell = s2.getRow(2).getCell(idx + 1);
    cell.value = h;
    headerStyle(cell, "FF1A5F8A");
  });
  s2.columns = [
    { width: 12 },
    { width: 12 },
    { width: 16 },
    { width: 22 },
    { width: 24 },
    { width: 24 },
    { width: 10 },
    { width: 8 },
    { width: 8 },
    { width: 28 },
    { width: 12 },
    { width: 36 },
  ];
  rows.forEach((r, idx) => {
    const created = r.createdAt ? new Date(r.createdAt) : null;
    const time = created
      ? created.toLocaleTimeString("uz-UZ", {
          timeZone: "Asia/Tashkent",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    const gps =
      r.checkLatitude != null && r.checkLongitude != null
        ? `${Number(r.checkLatitude).toFixed(6)}, ${Number(r.checkLongitude).toFixed(6)}`
        : "—";
    const row = s2.addRow([
      r.visitDate,
      time,
      r.visitName,
      displayBranchName(r.branchLocation) || "Filial",
      r.managerName || "—",
      r.coordinatorName || "—",
      r.scorePercent,
      r.yesCount,
      r.noCount,
      gps,
      r.distanceMeters ?? "—",
      r.generalNote || "",
    ]);
    paintRow(row, idx % 2 === 0);
  });
  s2.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 12 } };

  const s3 = workbook.addWorksheet("Javoblar", { views: [{ state: "frozen", ySplit: 2 }] });
  s3.mergeCells("A1:H1");
  const t3 = s3.getCell("A1");
  t3.value = "VAKSINA MED — Cheklist savollari va javoblar";
  t3.font = { name: "Calibri", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
  t3.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3A5C" } };
  s3.getRow(1).height = 28;
  ["Sana", "Filial", "Koordinator", "Bo‘lim", "Savol", "Javob", "Izoh", "Ball %"].forEach((h, idx) => {
    const cell = s3.getRow(2).getCell(idx + 1);
    cell.value = h;
    headerStyle(cell, "FF1A5F8A");
  });
  s3.columns = [
    { width: 12 },
    { width: 22 },
    { width: 22 },
    { width: 28 },
    { width: 46 },
    { width: 10 },
    { width: 28 },
    { width: 10 },
  ];
  let qIdx = 0;
  for (const r of rows) {
    const cats = Array.isArray(r.categories) ? r.categories : [];
    for (const cat of cats) {
      for (const it of cat.items || []) {
        const row = s3.addRow([
          r.visitDate,
          displayBranchName(r.branchLocation) || "Filial",
          r.coordinatorName || "—",
          cat.title,
          it.label,
          answerLabel(it.answer),
          it.note || "",
          r.scorePercent,
        ]);
        paintRow(row, qIdx++ % 2 === 0);
        if (it.answer === "yes") {
          row.getCell(6).font = { name: "Calibri", size: 10, color: { argb: "FF047857" }, bold: true };
        }
        if (it.answer === "no") {
          row.getCell(6).font = { name: "Calibri", size: 10, color: { argb: "FFB91C1C" }, bold: true };
        }
      }
    }
  }
  s3.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 8 } };

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="cheklist-holati-${stamp}.xlsx"`);
  res.send(buffer);
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
    const owns = coordRows.some((r) => r.id === manager.reportsToId);
    if (!owns) {
      res.status(403).json({ error: "Bu filial sizga biriktirilmagan" });
      return;
    }
  }

  let distanceMeters: number | null = null;
  let savedCheckLat: number | null = null;
  let savedCheckLng: number | null = null;

  const fromLoc = gpsFromLocationField(manager.location);
  const branchLat = manager.latitude ?? fromLoc?.lat ?? null;
  const branchLng = manager.longitude ?? fromLoc?.lng ?? null;

  // Koordinator: filial GPS dan 50 m ichida bo‘lishi shart
  if (req.userRole === "koordinator") {
    if (branchLat == null || branchLng == null) {
      res.status(400).json({
        error: "Filial lokatsiyasi bazada yo‘q — Aptekalar tarmog‘ida koordinata saqlang",
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
      branchLat,
      branchLng,
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
      branchLocation: displayBranchName(manager.location) || manager.fullName,
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
