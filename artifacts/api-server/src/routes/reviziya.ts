import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import {
  db,
  employeesTable,
  revisionAuditLogTable,
  revisionDictsTable,
  revisionDocumentsTable,
  revisionInTransitTable,
  revisionWatchlistTable,
  usersTable,
  type RevisionCashDenom,
  type RevisionInventoryLine,
} from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import { notifyByRoles, notifyUser } from "../lib/notify";
import {
  DOC_TYPES,
  DOC_TYPE_LABEL,
  FORBIDDEN_ACTIONS,
  IN_TRANSIT_HOURS,
  LOCKED_STATUSES,
  SHORTAGE_LIMIT,
  STATUS_LABEL,
  canApproveAccountant,
  canApproveReviziyaHead,
  canCreateReviziyaDoc,
  canExportReviziya,
  canSbReview,
  canStorno,
  canViewReviziya,
  nextMainStatus,
} from "../lib/reviziya";
import { DEFAULT_DICTS } from "../lib/reviziya";

const router: IRouter = Router();

function denyView(req: AuthRequest, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  if (!canViewReviziya(req.userRole)) {
    res.status(403).json({ error: "Reviziya bo‘limi uchun ruxsat yo‘q" });
    return true;
  }
  return false;
}

function parseId(raw: string | string[] | undefined): number {
  return parseInt(Array.isArray(raw) ? raw[0] : String(raw || ""), 10);
}

async function audit(opts: {
  documentId?: number | null;
  userId?: number;
  userName?: string | null;
  action: string;
  detail?: string;
}) {
  await db.insert(revisionAuditLogTable).values({
    documentId: opts.documentId ?? null,
    userId: opts.userId ?? null,
    userName: opts.userName ?? null,
    action: opts.action,
    detail: opts.detail ?? null,
  });
}

async function ensureDicts() {
  const existing = await db.select({ id: revisionDictsTable.id }).from(revisionDictsTable).limit(1);
  if (existing.length) return;
  await db.insert(revisionDictsTable).values(DEFAULT_DICTS.map((d) => ({ ...d, active: true })));
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function computeInventoryMetrics(lines: RevisionInventoryLine[]) {
  let shortage = 0;
  let expired = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const l of lines) {
    const diffQty = num(l.actualQty) - num(l.bookQty);
    l.diffQty = diffQty;
    l.diffCost = diffQty * num(l.costPrice);
    l.diffSale = diffQty * num(l.salePrice);
    if (diffQty < 0) shortage += Math.abs(l.diffSale || 0);
    if (l.expiryDate && l.expiryDate < today) expired += 1;
  }
  const checked = lines.length;
  const expiredShare = checked ? (expired / checked) * 100 : 0;
  return { shortage, checked, expiredShare };
}

async function maybeWatchlist(branchName: string | null | undefined, shortage: number) {
  if (!branchName || shortage <= 0) return;
  const recent = await db
    .select({ id: revisionDocumentsTable.id, shortageAmount: revisionDocumentsTable.shortageAmount })
    .from(revisionDocumentsTable)
    .where(
      and(
        eq(revisionDocumentsTable.branchName, branchName),
        eq(revisionDocumentsTable.docType, "inventory_act"),
      ),
    )
    .orderBy(desc(revisionDocumentsTable.createdAt))
    .limit(2);
  if (recent.length >= 2 && recent.every((r) => num(r.shortageAmount) > 0)) {
    const [dup] = await db
      .select({ id: revisionWatchlistTable.id })
      .from(revisionWatchlistTable)
      .where(eq(revisionWatchlistTable.branchName, branchName))
      .limit(1);
    if (!dup) {
      await db.insert(revisionWatchlistTable).values({
        branchName,
        reason: "Ketma-ket 2 marta kamomad",
        consecutiveCount: 2,
      });
      await notifyByRoles({
        roles: ["reviziya_rahbar", "director", "admin", "sb_boshliq"],
        text: `${branchName}: ketma-ket 2 marta kamomad — nazorat ro‘yxatiga qo‘shildi`,
        type: "reviziya_watchlist",
        linkUrl: "/reviziya",
      });
    }
  }
}

router.get("/reviziya/meta", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  await ensureDicts();
  const dicts = await db.select().from(revisionDictsTable);
  res.json({
    docTypes: DOC_TYPES.map((t) => ({ value: t, label: DOC_TYPE_LABEL[t] })),
    statuses: Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
    forbidden: FORBIDDEN_ACTIONS,
    shortageLimit: SHORTAGE_LIMIT,
    inTransitHours: IN_TRANSIT_HOURS,
    permissions: {
      create: canCreateReviziyaDoc(req.userRole),
      approveHead: canApproveReviziyaHead(req.userRole),
      approveAccountant: canApproveAccountant(req.userRole),
      storno: canStorno(req.userRole),
      export: canExportReviziya(req.userRole),
      sbReview: canSbReview(req.userRole),
      changePrice: false,
      salesReturn: false,
      manualStockEdit: false,
      deleteDocument: false,
    },
    dicts,
  });
});

router.get("/reviziya/branches", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const rows = await db
    .select({
      id: employeesTable.id,
      fullName: employeesTable.fullName,
      location: employeesTable.location,
      userId: employeesTable.userId,
    })
    .from(employeesTable)
    .where(eq(employeesTable.orgRole, "manager"));
  res.json(
    rows.map((r) => ({
      id: r.id,
      branchName: r.location || r.fullName,
      responsibleName: r.fullName,
      userId: r.userId,
    })),
  );
});

router.get("/reviziya/documents", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const { type, status, branch, q } = req.query as Record<string, string>;
  const conditions = [];
  if (type) conditions.push(eq(revisionDocumentsTable.docType, type));
  if (status) conditions.push(eq(revisionDocumentsTable.status, status));
  if (branch) conditions.push(ilike(revisionDocumentsTable.branchName, `%${branch}%`));
  if (q) {
    conditions.push(
      or(
        ilike(revisionDocumentsTable.docNo, `%${q}%`),
        ilike(revisionDocumentsTable.branchName, `%${q}%`),
        ilike(revisionDocumentsTable.responsibleName, `%${q}%`),
      )!,
    );
  }
  if (req.userRole === "mudir") {
    const [me] = await db
      .select({ location: employeesTable.location, fullName: employeesTable.fullName })
      .from(employeesTable)
      .where(eq(employeesTable.userId, req.userId || 0))
      .limit(1);
    if (me?.location) conditions.push(eq(revisionDocumentsTable.branchName, me.location));
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const rows = await db
    .select()
    .from(revisionDocumentsTable)
    .where(where)
    .orderBy(desc(revisionDocumentsTable.createdAt))
    .limit(400);
  res.json(rows);
});

router.get("/reviziya/documents/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const id = parseId(req.params.id);
  const [row] = await db.select().from(revisionDocumentsTable).where(eq(revisionDocumentsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Hujjat topilmadi" });
    return;
  }
  const logs = await db
    .select()
    .from(revisionAuditLogTable)
    .where(eq(revisionAuditLogTable.documentId, id))
    .orderBy(desc(revisionAuditLogTable.createdAt))
    .limit(80);
  res.json({ ...row, audit: logs });
});

router.post("/reviziya/documents", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  if (!canCreateReviziyaDoc(req.userRole) && req.body?.docType !== "explanation") {
    res.status(403).json({ error: "Hujjat yaratish ruxsati yo‘q" });
    return;
  }
  const docType = String(req.body?.docType || "");
  if (!DOC_TYPES.includes(docType as (typeof DOC_TYPES)[number])) {
    res.status(400).json({ error: "Noto‘g‘ri hujjat turi" });
    return;
  }
  const n = Date.now() % 100000;
  const prefix = docType.slice(0, 3).toUpperCase();
  const docNo = `RV-${prefix}-${new Date().getFullYear()}-${String(n).padStart(5, "0")}`;

  const lines = Array.isArray(req.body?.lines) ? (req.body.lines as RevisionInventoryLine[]) : [];
  for (const l of lines) {
    if ("salePriceEdit" in (l as object)) {
      res.status(403).json({ error: "Narxni o‘zgartirish taqiqlangan" });
      return;
    }
  }
  const metrics = computeInventoryMetrics(lines);
  const payload = (req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : {}) as Record<
    string,
    unknown
  >;

  const [created] = await db
    .insert(revisionDocumentsTable)
    .values({
      docNo,
      docType,
      status: String(req.body?.status || "planned"),
      branchName: req.body?.branchName ? String(req.body.branchName) : null,
      plannedDate: req.body?.plannedDate ? String(req.body.plannedDate) : null,
      createdById: req.userId ?? null,
      revizorId: req.body?.revizorId ? Number(req.body.revizorId) : req.userId ?? null,
      responsibleName: req.body?.responsibleName ? String(req.body.responsibleName) : null,
      parentId: req.body?.parentId ? Number(req.body.parentId) : null,
      payload,
      lines,
      denoms: Array.isArray(req.body?.denoms) ? (req.body.denoms as RevisionCashDenom[]) : [],
      photos: Array.isArray(req.body?.photos) ? req.body.photos : [],
      shortageAmount: metrics.shortage || num(payload.cashDiff) || num(payload.amount),
    })
    .returning();
  if (!created) {
    res.status(500).json({ error: "Hujjat saqlanmadi" });
    return;
  }

  await audit({
    documentId: created.id,
    userId: req.userId,
    userName: null,
    action: "create",
    detail: `${DOC_TYPE_LABEL[docType]} ${docNo}`,
  });

  if (docType === "cash_receipt") {
    const amount = num(payload.amount) || num(created.shortageAmount);
    await db.insert(revisionInTransitTable).values({
      receiptDocId: created.id,
      revizorId: created.revizorId || req.userId || 0,
      branchName: created.branchName,
      amount,
      status: "open",
      routeNote: String(payload.route || ""),
      acceptedAt: new Date(),
    });
  }

  if (created.shortageAmount >= SHORTAGE_LIMIT) {
    await notifyByRoles({
      roles: ["reviziya_rahbar", "director", "admin", "sb_boshliq"],
      text: `${created.branchName || "Filial"}: kamomad limiti oshdi (${Math.round(created.shortageAmount)} so‘m)`,
      type: "reviziya_shortage",
      linkUrl: `/reviziya/hujjat/${created.id}`,
    });
  }

  await maybeWatchlist(created.branchName, created.shortageAmount);
  res.status(201).json(created);
});

router.patch("/reviziya/documents/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const id = parseId(req.params.id);
  const [existing] = await db.select().from(revisionDocumentsTable).where(eq(revisionDocumentsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  if (LOCKED_STATUSES.has(existing.status)) {
    res.status(403).json({ error: "Yopilgan/storno hujjat tahrirlanmaydi" });
    return;
  }
  if (req.body?.delete === true || req.body?.action === "delete") {
    res.status(403).json({ error: "Hujjatni o‘chirish taqiqlangan — faqat storno" });
    return;
  }
  if (req.body?.action === "vozvrat" || req.body?.salesReturn) {
    res.status(403).json({ error: "Sotuvni qaytarish (vozvrat) taqiqlangan" });
    return;
  }
  if (req.body?.manualStockEdit) {
    res.status(403).json({ error: "Qoldiqni qo‘lda tahrirlash taqiqlangan" });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (req.body.branchName !== undefined) updates.branchName = String(req.body.branchName);
  if (req.body.plannedDate !== undefined) updates.plannedDate = String(req.body.plannedDate);
  if (req.body.responsibleName !== undefined) updates.responsibleName = String(req.body.responsibleName);
  if (req.body.payload && typeof req.body.payload === "object") {
    updates.payload = { ...(existing.payload || {}), ...req.body.payload };
  }
  if (Array.isArray(req.body.lines)) {
    const lines = req.body.lines as RevisionInventoryLine[];
    const prevByBarcode = new Map((existing.lines || []).map((l) => [l.barcode || l.sku || l.name, l]));
    for (const l of lines) {
      const prev = prevByBarcode.get(l.barcode || l.sku || l.name);
      if (prev && num(l.salePrice) !== num(prev.salePrice) && num(l.salePrice) > 0 && num(prev.salePrice) > 0) {
        res.status(403).json({ error: "Narxni o‘zgartirish taqiqlangan" });
        return;
      }
      if (prev && num(l.costPrice) !== num(prev.costPrice) && num(l.costPrice) > 0 && num(prev.costPrice) > 0) {
        res.status(403).json({ error: "Narxni o‘zgartirish taqiqlangan" });
        return;
      }
    }
    const metrics = computeInventoryMetrics(lines);
    updates.lines = lines;
    updates.shortageAmount = metrics.shortage;
  }
  if (Array.isArray(req.body.denoms)) updates.denoms = req.body.denoms;
  if (Array.isArray(req.body.photos)) updates.photos = req.body.photos;
  if (req.body.checkLat != null) updates.checkLat = num(req.body.checkLat);
  if (req.body.checkLng != null) updates.checkLng = num(req.body.checkLng);

  const [updated] = await db
    .update(revisionDocumentsTable)
    .set(updates)
    .where(eq(revisionDocumentsTable.id, id))
    .returning();
  await audit({
    documentId: id,
    userId: req.userId,
    userName: null,
    action: "update",
    detail: Object.keys(updates).join(", "),
  });
  res.json(updated);
});

router.post("/reviziya/documents/:id/advance", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const id = parseId(req.params.id);
  const [row] = await db.select().from(revisionDocumentsTable).where(eq(revisionDocumentsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  if (LOCKED_STATUSES.has(row.status)) {
    res.status(403).json({ error: "Hujjat yopilgan" });
    return;
  }

  const force = String(req.body?.status || "");
  let next = force || nextMainStatus(row.status);
  if (force === "awaiting_explanation" || force === "sb_review" || force === "recovery") next = force;

  if (next === "signed" && !canApproveReviziyaHead(req.userRole)) {
    res.status(403).json({ error: "Imzo: Reviziya bo‘limi rahbari" });
    return;
  }
  if (next === "accounting_approved" && !canApproveAccountant(req.userRole)) {
    res.status(403).json({ error: "Buxgalteriya tasdig‘i: bosh buxgalter / moliya" });
    return;
  }
  if (next === "sb_review" && !canSbReview(req.userRole) && !isReviziyaLike(req.userRole)) {
    res.status(403).json({ error: "SB tekshiruvi uchun ruxsat yo‘q" });
    return;
  }
  if (!next) {
    res.status(400).json({ error: "Keyingi holat yo‘q" });
    return;
  }

  const extra: Record<string, unknown> = { status: next };
  if (next === "en_route" || next === "inspecting") extra.startedAt = extra.startedAt || new Date();
  if (next === "signed") {
    extra.signedAt = new Date();
    extra.signedByReviziyaHeadId = req.userId;
  }
  if (next === "accounting_approved") extra.signedByAccountantId = req.userId;
  if (next === "closed") extra.closedAt = new Date();

  const [updated] = await db
    .update(revisionDocumentsTable)
    .set(extra)
    .where(eq(revisionDocumentsTable.id, id))
    .returning();

  await audit({
    documentId: id,
    userId: req.userId,
    userName: null,
    action: "status",
    detail: `${STATUS_LABEL[row.status]} → ${STATUS_LABEL[next]}`,
  });

  if (next === "signed") {
    await notifyByRoles({
      roles: ["moliya", "director", "admin"],
      text: `${row.docNo} Reviziya rahbari imzoladi — buxgalteriya tasdig‘i kutilmoqda`,
      type: "reviziya_accounting",
      linkUrl: `/reviziya/hujjat/${id}`,
    });
  }
  if (next === "awaiting_explanation") {
    await notifyByRoles({
      roles: ["mudir", "reviziya_rahbar"],
      text: `${row.branchName || "Filial"}: tushuntirish xati talab qilinadi`,
      type: "reviziya_explanation",
      linkUrl: `/reviziya/hujjat/${id}`,
    });
  }
  res.json(updated);
});

function isReviziyaLike(role?: string | null) {
  return role === "revizor" || role === "reviziya_rahbar" || role === "admin";
}

router.post("/reviziya/documents/:id/otp", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const id = parseId(req.params.id);
  const [row] = await db.select().from(revisionDocumentsTable).where(eq(revisionDocumentsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await db.update(revisionDocumentsTable).set({ otpCode: code }).where(eq(revisionDocumentsTable.id, id));
  await notifyUser({
    userId: req.userId,
    text: `Reviziya OTP: ${code} (${row.docNo})`,
    type: "reviziya_otp",
    linkUrl: `/reviziya/hujjat/${id}`,
  });
  res.json({ ok: true, hint: "Kod bildirishnomaga yuborildi" });
});

router.post("/reviziya/documents/:id/confirm-otp", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const id = parseId(req.params.id);
  const [row] = await db.select().from(revisionDocumentsTable).where(eq(revisionDocumentsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  if (String(req.body?.code || "") !== String(row.otpCode || "")) {
    res.status(400).json({ error: "OTP noto‘g‘ri" });
    return;
  }
  const payload = { ...(row.payload || {}), otpConfirmedAt: new Date().toISOString(), otpBy: req.userId };
  const [updated] = await db
    .update(revisionDocumentsTable)
    .set({ payload, otpCode: null })
    .where(eq(revisionDocumentsTable.id, id))
    .returning();
  await audit({
    documentId: id,
    userId: req.userId,
    userName: null,
    action: "otp_confirm",
  });
  res.json(updated);
});

router.post("/reviziya/documents/:id/storno", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  if (!canStorno(req.userRole)) {
    res.status(403).json({ error: "Storno faqat rahbar" });
    return;
  }
  const id = parseId(req.params.id);
  const [row] = await db.select().from(revisionDocumentsTable).where(eq(revisionDocumentsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  if (row.status === "storno") {
    res.status(400).json({ error: "Allaqachon storno" });
    return;
  }
  const [created] = await db
    .insert(revisionDocumentsTable)
    .values({
      docNo: `${row.docNo}-ST`,
      docType: row.docType,
      status: "storno",
      branchName: row.branchName,
      createdById: req.userId ?? null,
      revizorId: row.revizorId,
      parentId: row.id,
      stornoOfId: row.id,
      payload: { ...(row.payload || {}), stornoReason: String(req.body?.reason || "") },
      lines: (row.lines || []).map((l) => ({
        ...l,
        bookQty: num(l.actualQty),
        actualQty: num(l.bookQty),
        diffQty: -num(l.diffQty),
        diffCost: -num(l.diffCost),
        diffSale: -num(l.diffSale),
      })),
      shortageAmount: -num(row.shortageAmount),
    })
    .returning();
  await db.update(revisionDocumentsTable).set({ status: "storno" }).where(eq(revisionDocumentsTable.id, id));
  if (row.docType === "cash_receipt") {
    await db
      .update(revisionInTransitTable)
      .set({ status: "handed", handedAt: new Date() })
      .where(eq(revisionInTransitTable.receiptDocId, id));
  }
  await audit({
    documentId: id,
    userId: req.userId,
    userName: null,
    action: "storno",
    detail: created.docNo,
  });
  res.json(created);
});

router.get("/reviziya/in-transit", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const rows = await db.select().from(revisionInTransitTable).orderBy(desc(revisionInTransitTable.acceptedAt));
  const now = Date.now();
  const mapped = rows.map((r) => {
    const hours = (now - new Date(r.acceptedAt).getTime()) / 36e5;
    return {
      ...r,
      hoursOpen: Math.round(hours * 10) / 10,
      overdue: r.status === "open" && hours > IN_TRANSIT_HOURS,
    };
  });
  res.json(mapped);
});

router.post("/reviziya/in-transit/:id/handover", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const id = parseId(req.params.id);
  const [row] = await db.select().from(revisionInTransitTable).where(eq(revisionInTransitTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  const [updated] = await db
    .update(revisionInTransitTable)
    .set({
      status: "handed",
      handedAt: new Date(),
      handoverDocId: req.body?.handoverDocId ? Number(req.body.handoverDocId) : row.handoverDocId,
    })
    .where(eq(revisionInTransitTable.id, id))
    .returning();
  await audit({
    documentId: row.receiptDocId,
    userId: req.userId,
    userName: null,
    action: "in_transit_handover",
  });
  res.json(updated);
});

router.get("/reviziya/dashboard", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const docs = await db.select().from(revisionDocumentsTable).orderBy(desc(revisionDocumentsTable.createdAt)).limit(800);
  const trans = await db.select().from(revisionInTransitTable);
  const watch = await db.select().from(revisionWatchlistTable);
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  const doneToday = docs.filter((d) => d.updatedAt && String(d.updatedAt).slice(0, 10) === today && d.status === "closed");
  const collectedToday = trans
    .filter((t) => String(t.acceptedAt).slice(0, 10) === today)
    .reduce((s, t) => s + num(t.amount), 0);
  const inTransitOpen = trans.filter((t) => t.status === "open");
  const overdueTransit = inTransitOpen.filter(
    (t) => (Date.now() - new Date(t.acceptedAt).getTime()) / 36e5 > IN_TRANSIT_HOURS,
  );
  const shortages = docs.filter((d) => num(d.shortageAmount) > 0);
  const byBranch: Record<string, { shortage: number; count: number }> = {};
  for (const d of docs) {
    const b = d.branchName || "—";
    if (!byBranch[b]) byBranch[b] = { shortage: 0, count: 0 };
    byBranch[b].shortage += num(d.shortageAmount);
    byBranch[b].count += 1;
  }
  const ranking = Object.entries(byBranch)
    .map(([branch, v]) => ({ branch, ...v }))
    .sort((a, b) => b.shortage - a.shortage)
    .slice(0, 20);

  const load: Record<number, number> = {};
  for (const d of docs) {
    if (d.revizorId) load[d.revizorId] = (load[d.revizorId] || 0) + 1;
  }
  const revizorIds = Object.keys(load).map(Number);
  const revizors = revizorIds.length
    ? await db.select({ id: usersTable.id, fullName: usersTable.fullName }).from(usersTable).where(inArray(usersTable.id, revizorIds))
    : [];
  const revizorLoad = revizors.map((u) => ({ id: u.id, name: u.fullName, count: load[u.id] || 0 }));

  const missed = docs.filter((d) => d.docType === "assignment" && d.status === "planned" && d.plannedDate && d.plannedDate < today);

  const expiry = { d90: 0, d60: 0, d30: 0 };
  const todayMs = Date.now();
  for (const d of docs) {
    for (const l of d.lines || []) {
      if (!l.expiryDate) continue;
      const days = (new Date(l.expiryDate).getTime() - todayMs) / 864e5;
      if (days >= 0 && days <= 30) expiry.d30 += 1;
      else if (days > 30 && days <= 60) expiry.d60 += 1;
      else if (days > 60 && days <= 90) expiry.d90 += 1;
    }
  }

  res.json({
    daily: {
      closedCount: doneToday.length,
      collected: collectedToday,
      inspecting: docs.filter((d) => d.status === "inspecting").length,
    },
    weekly: {
      docs: docs.filter((d) => String(d.createdAt).slice(0, 10) >= weekAgo).length,
      problemBranches: ranking.filter((r) => r.shortage > 0).slice(0, 8),
    },
    monthly: {
      shortageTotal: docs.filter((d) => String(d.createdAt).slice(0, 7) === month).reduce((s, d) => s + num(d.shortageAmount), 0),
      ranking,
    },
    inTransit: { open: inTransitOpen.length, overdue: overdueTransit.length, amount: inTransitOpen.reduce((s, t) => s + num(t.amount), 0) },
    watchlist: watch,
    shortages: shortages.length,
    missedPlan: missed.length,
    expiry,
    revizorLoad,
    metrics: {
      shortagePct:
        docs.length > 0 ? Math.round((shortages.length / docs.length) * 1000) / 10 : 0,
    },
  });
});

router.get("/reviziya/dicts", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  await ensureDicts();
  const rows = await db.select().from(revisionDictsTable);
  res.json(rows);
});

router.post("/reviziya/dicts", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  if (!canApproveReviziyaHead(req.userRole) && req.userRole !== "admin") {
    res.status(403).json({ error: "Spravochnikni rahbar qo‘shadi" });
    return;
  }
  const [row] = await db
    .insert(revisionDictsTable)
    .values({
      kind: String(req.body?.kind || "violation"),
      code: String(req.body?.code || "").trim(),
      label: String(req.body?.label || "").trim(),
      active: true,
    })
    .returning();
  res.status(201).json(row);
});

router.get("/reviziya/export", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  if (!canExportReviziya(req.userRole)) {
    res.status(403).json({ error: "Eksport faqat rahbariyat ruxsati bilan" });
    return;
  }
  const rows = await db.select().from(revisionDocumentsTable).orderBy(desc(revisionDocumentsTable.createdAt)).limit(2000);
  await audit({ userId: req.userId, userName: req.userName, action: "export", detail: `${rows.length} hujjat` });
  res.json({ rows });
});

router.post("/reviziya/sync", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const ops = Array.isArray(req.body?.ops) ? req.body.ops : [];
  let applied = 0;
  for (const op of ops.slice(0, 50)) {
    if (op?.kind === "create" && op.doc) {
      req.body = op.doc;
      applied += 1;
    }
  }
  res.json({ applied, note: "Offline navbat qabul qilindi. Yangi hujjatlarni alohida POST qiling." });
});

router.get("/reviziya/audit", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  if (!canExportReviziya(req.userRole) && req.userRole !== "revizor") {
    res.status(403).json({ error: "Audit log ruxsati cheklangan" });
    return;
  }
  const rows = await db.select().from(revisionAuditLogTable).orderBy(desc(revisionAuditLogTable.createdAt)).limit(300);
  res.json(rows);
});

export default router;
