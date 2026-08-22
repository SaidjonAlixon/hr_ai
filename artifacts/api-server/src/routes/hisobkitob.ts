import { Router, type IRouter } from "express";
import { and, asc, eq, ilike, inArray, ne, or } from "drizzle-orm";
import ExcelJS from "exceljs";
import {
  db,
  employeesTable,
  settlementLinesTable,
  settlementSheetsTable,
  usersTable,
} from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import {
  canAdminHisobkitob,
  canEditHisobkitob,
  canViewHisobkitob,
  computeLine,
  computeSheetTotals,
} from "../lib/settlement";

const router: IRouter = Router();

function denyView(req: AuthRequest, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  if (!canViewHisobkitob(req.userRole)) {
    res.status(403).json({ error: "Hisob-kitob faqat admin, direktor va moliyachi uchun" });
    return true;
  }
  return false;
}

function denyEdit(req: AuthRequest, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  if (!canEditHisobkitob(req.userRole)) {
    res.status(403).json({ error: "Tahrirlash ruxsati yo‘q" });
    return true;
  }
  return false;
}

function mapLine(row: typeof settlementLinesTable.$inferSelect, taxNetRate: number) {
  const calc = computeLine(
    {
      sales: row.sales,
      percent: row.percent,
      fiksa: row.fiksa,
      planBonus: row.planBonus,
      avans: row.avans,
      inventoryFine: row.inventoryFine,
      timeFine: row.timeFine,
      expiryHold: row.expiryHold,
      cardAmount: row.cardAmount,
    },
    taxNetRate,
  );
  return { ...row, ...calc };
}

async function loadSheet(id: number) {
  const [sheet] = await db.select().from(settlementSheetsTable).where(eq(settlementSheetsTable.id, id)).limit(1);
  if (!sheet) return null;
  const lines = await db
    .select()
    .from(settlementLinesTable)
    .where(eq(settlementLinesTable.sheetId, id))
    .orderBy(asc(settlementLinesTable.sortOrder), asc(settlementLinesTable.id));
  const mapped = lines.map((l) => mapLine(l, sheet.taxNetRate));
  const totals = computeSheetTotals(mapped, sheet.planCurrent, sheet.planPrev);
  return { sheet, lines: mapped, totals };
}

const DEMO_PHONES = ["998901111111", "998902222222", "998903333333", "998904444444"];
const DEMO_NAMES = [
  "Ermatova Saida",
  "Pulatxujayev Akbarxuja",
  "Shuxriddinov Axrorxuja",
  "Shuxriddinov Asrorxuja",
  "Shodiyeva Samira",
];

async function allWorkingStaff() {
  return db
    .select({
      id: employeesTable.id,
      fullName: employeesTable.fullName,
      phone: usersTable.phone,
    })
    .from(employeesTable)
    .leftJoin(usersTable, eq(usersTable.id, employeesTable.userId))
    .where(ne(employeesTable.employmentStatus, "dismissed"))
    .orderBy(asc(employeesTable.fullName));
}

async function fillSheetFromStaff(sheetId: number) {
  const staff = await allWorkingStaff();
  if (!staff.length) return;
  const existing = await db
    .select({
      id: settlementLinesTable.id,
      employeeId: settlementLinesTable.employeeId,
      fullName: settlementLinesTable.fullName,
    })
    .from(settlementLinesTable)
    .where(eq(settlementLinesTable.sheetId, sheetId));
  const haveEmp = new Set(existing.map((r) => r.employeeId).filter((id): id is number => id != null));
  const haveName = new Set(existing.map((r) => r.fullName.trim().toLowerCase()));
  const toAdd = staff.filter((s) => !haveEmp.has(s.id) && !haveName.has(s.fullName.trim().toLowerCase()));
  if (!toAdd.length) return;
  const start = existing.length;
  await db.insert(settlementLinesTable).values(
    toAdd.map((r, i) => ({
      sheetId,
      employeeId: r.id,
      sortOrder: start + i,
      fullName: r.fullName,
      phone: r.phone || null,
      fiksa: 0,
      percent: 0.006,
    })),
  );
}

async function purgeDemoSettlementLines() {
  try {
    await db
      .delete(settlementLinesTable)
      .where(or(inArray(settlementLinesTable.phone, DEMO_PHONES), inArray(settlementLinesTable.fullName, DEMO_NAMES)));
    const sheets = await db.select({ id: settlementSheetsTable.id, branchName: settlementSheetsTable.branchName }).from(settlementSheetsTable);
    for (const s of sheets) {
      try {
        await fillSheetFromStaff(s.id);
      } catch (err) {
        console.error("fillSheetFromStaff", s.id, err);
      }
    }
  } catch (err) {
    console.error("purgeDemoSettlementLines", err);
  }
}

router.get("/hisobkitob/sheets", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  try {
    await purgeDemoSettlementLines();
    const month = String(req.query.month || "").slice(0, 7);
    const rows = await db
      .select()
      .from(settlementSheetsTable)
      .orderBy(asc(settlementSheetsTable.branchName));
    const list = month ? rows.filter((s) => s.month === month) : rows;
    res.json({ items: list });
  } catch (err) {
    console.error("GET /hisobkitob/sheets", err);
    res.status(503).json({ error: "Varaqalar yuklanmadi" });
  }
});

router.post("/hisobkitob/sheets", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyEdit(req, res)) return;
  try {
    const branchName = String(req.body?.branchName || "").trim() || "Oylik";
    const month = String(req.body?.month || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      res.status(400).json({ error: "Oy formati YYYY-MM" });
      return;
    }
    const [created] = await db
      .insert(settlementSheetsTable)
      .values({
        branchName,
        month,
        planCurrent: Number(req.body?.planCurrent) || 0,
        planPrev: Number(req.body?.planPrev) || 0,
        taxNetRate: Number(req.body?.taxNetRate) || 0.88,
        createdById: req.userId,
      })
      .returning();
    await fillSheetFromStaff(created!.id).catch((err) => console.error("fillSheetFromStaff", err));
    res.json(created);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "Bu oyda shu nomdagi varaq allaqachon bor" });
      return;
    }
    console.error("POST /hisobkitob/sheets", err);
    res.status(503).json({ error: "Varaq yaratilmadi" });
  }
});

router.get("/hisobkitob/sheets/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  try {
    await purgeDemoSettlementLines();
    const packed = await loadSheet(Number(req.params.id));
    if (!packed) {
      res.status(404).json({ error: "Varaq topilmadi" });
      return;
    }
    res.json({
      ...packed.sheet,
      lines: packed.lines,
      totals: packed.totals,
      canEdit: canEditHisobkitob(req.userRole) && packed.sheet.status !== "approved",
      canAdmin: canAdminHisobkitob(req.userRole),
      locked: packed.sheet.status === "approved" && !canAdminHisobkitob(req.userRole),
    });
  } catch (err) {
    console.error("GET /hisobkitob/sheets/:id", err);
    res.status(503).json({ error: "Varaq yuklanmadi" });
  }
});

router.patch("/hisobkitob/sheets/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyEdit(req, res)) return;
  try {
    const id = Number(req.params.id);
    const [cur] = await db.select().from(settlementSheetsTable).where(eq(settlementSheetsTable.id, id)).limit(1);
    if (!cur) {
      res.status(404).json({ error: "Varaq topilmadi" });
      return;
    }
    if (cur.status === "approved" && !canAdminHisobkitob(req.userRole)) {
      res.status(403).json({ error: "Tasdiqlangan varaqni faqat admin o‘zgartiradi" });
      return;
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (req.body?.branchName != null) patch.branchName = String(req.body.branchName).trim();
    if (req.body?.planCurrent != null) patch.planCurrent = Number(req.body.planCurrent) || 0;
    if (req.body?.planPrev != null) patch.planPrev = Number(req.body.planPrev) || 0;
    if (req.body?.taxNetRate != null && canAdminHisobkitob(req.userRole)) {
      const r = Number(req.body.taxNetRate);
      if (r > 0 && r <= 1) patch.taxNetRate = r;
    }
    await db.update(settlementSheetsTable).set(patch).where(eq(settlementSheetsTable.id, id));
    res.json(await loadSheet(id));
  } catch (err) {
    console.error("PATCH /hisobkitob/sheets/:id", err);
    res.status(503).json({ error: "Saqlanmadi" });
  }
});

router.delete("/hisobkitob/sheets/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canAdminHisobkitob(req.userRole)) {
    res.status(403).json({ error: "O‘chirish faqat admin uchun" });
    return;
  }
  const id = Number(req.params.id);
  await db.delete(settlementLinesTable).where(eq(settlementLinesTable.sheetId, id));
  await db.delete(settlementSheetsTable).where(eq(settlementSheetsTable.id, id));
  res.json({ ok: true });
});

router.post("/hisobkitob/sheets/:id/approve", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canAdminHisobkitob(req.userRole) && req.userRole !== "director" && req.userRole !== "moliya") {
    res.status(403).json({ error: "Tasdiqlash ruxsati yo‘q" });
    return;
  }
  const id = Number(req.params.id);
  await db
    .update(settlementSheetsTable)
    .set({
      status: "approved",
      approvedById: req.userId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(settlementSheetsTable.id, id));
  res.json(await loadSheet(id));
});

router.post("/hisobkitob/sheets/:id/unlock", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canAdminHisobkitob(req.userRole)) {
    res.status(403).json({ error: "Qayta ochish faqat admin uchun" });
    return;
  }
  const id = Number(req.params.id);
  await db
    .update(settlementSheetsTable)
    .set({ status: "draft", approvedById: null, approvedAt: null, updatedAt: new Date() })
    .where(eq(settlementSheetsTable.id, id));
  res.json(await loadSheet(id));
});

router.post("/hisobkitob/sheets/:id/lines", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyEdit(req, res)) return;
  try {
    const sheetId = Number(req.params.id);
    const packed = await loadSheet(sheetId);
    if (!packed) {
      res.status(404).json({ error: "Varaq topilmadi" });
      return;
    }
    if (packed.sheet.status === "approved" && !canAdminHisobkitob(req.userRole)) {
      res.status(403).json({ error: "Tasdiqlangan varaq yopiq" });
      return;
    }
    const [row] = await db
      .insert(settlementLinesTable)
      .values({
        sheetId,
        sortOrder: packed.lines.length,
        fullName: String(req.body?.fullName || "Yangi xodim").trim(),
        phone: req.body?.phone ? String(req.body.phone) : null,
        employeeId: req.body?.employeeId != null ? Number(req.body.employeeId) : null,
        sales: Number(req.body?.sales) || 0,
        percent: Number(req.body?.percent) || 0.006,
        fiksa: Number(req.body?.fiksa) || 0,
        planBonus: Number(req.body?.planBonus) || 0,
      })
      .returning();
    res.json(mapLine(row!, packed.sheet.taxNetRate));
  } catch (err) {
    console.error("POST lines", err);
    res.status(503).json({ error: "Qator qo‘shilmadi" });
  }
});

router.patch("/hisobkitob/lines/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyEdit(req, res)) return;
  try {
    const id = Number(req.params.id);
    const [line] = await db.select().from(settlementLinesTable).where(eq(settlementLinesTable.id, id)).limit(1);
    if (!line) {
      res.status(404).json({ error: "Qator topilmadi" });
      return;
    }
    const [sheet] = await db.select().from(settlementSheetsTable).where(eq(settlementSheetsTable.id, line.sheetId)).limit(1);
    if (sheet?.status === "approved" && !canAdminHisobkitob(req.userRole)) {
      res.status(403).json({ error: "Tasdiqlangan varaq yopiq" });
      return;
    }
    const b = req.body ?? {};
    const num = (k: string) => (b[k] == null || b[k] === "" ? undefined : Number(b[k]));
    await db
      .update(settlementLinesTable)
      .set({
        ...(b.fullName != null ? { fullName: String(b.fullName) } : {}),
        ...(b.phone !== undefined ? { phone: b.phone ? String(b.phone) : null } : {}),
        ...(num("sales") != null ? { sales: num("sales")! } : {}),
        ...(num("percent") != null ? { percent: num("percent")! } : {}),
        ...(num("fiksa") != null ? { fiksa: num("fiksa")! } : {}),
        ...(num("planBonus") != null ? { planBonus: num("planBonus")! } : {}),
        ...(num("avans") != null ? { avans: num("avans")! } : {}),
        ...(num("inventoryFine") != null ? { inventoryFine: num("inventoryFine")! } : {}),
        ...(num("timeFine") != null ? { timeFine: num("timeFine")! } : {}),
        ...(num("expiryHold") != null ? { expiryHold: num("expiryHold")! } : {}),
        ...(b.cardAmount === null || b.cardAmount === ""
          ? { cardAmount: null }
          : num("cardAmount") != null
            ? { cardAmount: num("cardAmount")! }
            : {}),
        updatedAt: new Date(),
      })
      .where(eq(settlementLinesTable.id, id));
    const packed = await loadSheet(line.sheetId);
    res.json(packed);
  } catch (err) {
    console.error("PATCH line", err);
    res.status(503).json({ error: "Qator saqlanmadi" });
  }
});

router.delete("/hisobkitob/lines/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyEdit(req, res)) return;
  const id = Number(req.params.id);
  const [line] = await db.select().from(settlementLinesTable).where(eq(settlementLinesTable.id, id)).limit(1);
  if (!line) {
    res.status(404).json({ error: "Qator topilmadi" });
    return;
  }
  const [sheet] = await db.select().from(settlementSheetsTable).where(eq(settlementSheetsTable.id, line.sheetId)).limit(1);
  if (sheet?.status === "approved" && !canAdminHisobkitob(req.userRole)) {
    res.status(403).json({ error: "Tasdiqlangan varaq yopiq" });
    return;
  }
  await db.delete(settlementLinesTable).where(eq(settlementLinesTable.id, id));
  res.json(await loadSheet(line.sheetId));
});

router.get("/hisobkitob/staff", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const q = String(req.query.q || "").trim();
  const rows = await db
    .select({
      id: employeesTable.id,
      fullName: employeesTable.fullName,
      location: employeesTable.location,
      position: employeesTable.position,
      phone: usersTable.phone,
      fiksa: employeesTable.fixedSalary,
    })
    .from(employeesTable)
    .leftJoin(usersTable, eq(usersTable.id, employeesTable.userId))
    .where(q ? ilike(employeesTable.fullName, `%${q}%`) : undefined)
    .limit(40);
  res.json({ items: rows });
});

router.get("/hisobkitob/sheets/:id/export", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const packed = await loadSheet(Number(req.params.id));
  if (!packed) {
    res.status(404).json({ error: "Varaq topilmadi" });
    return;
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(packed.sheet.branchName.slice(0, 28));
  ws.addRow([
    "FILIAL",
    "TELEFON",
    "SAVDO",
    "PROTSENT",
    "OYLIK %",
    "FIKSA",
    "REJA BONUSI",
    "AVANS",
    "PEREUCHYOT",
    "VAQT JARIMA",
    "SROK",
    "JAMI",
    "KARTA",
    "FARQ",
    "GROSS",
  ]);
  ws.addRow([
    packed.sheet.branchName,
    "",
    packed.totals.salesTotal,
    "",
    packed.totals.oylikPctTotal,
    "",
    "",
    "",
    "",
    "",
    "",
    packed.totals.netTotal,
    packed.totals.cardTotal,
    packed.totals.diffTotal,
    packed.totals.grossTotal,
  ]);
  for (const l of packed.lines) {
    ws.addRow([
      l.fullName,
      l.phone,
      l.sales,
      l.percent,
      l.oylikPct,
      l.fiksa,
      l.planBonus,
      l.avans,
      l.inventoryFine,
      l.timeFine,
      l.expiryHold,
      l.net,
      l.card,
      l.diff,
      l.gross,
    ]);
  }
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="hisobkitob-${packed.sheet.branchName}-${packed.sheet.month}.xlsx"`,
  );
  await wb.xlsx.write(res);
  res.end();
});

export default router;
