import { Router } from "express";
import ExcelJS from "exceljs";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import { pool } from "@workspace/db";
import {
  canManageCustomerRatings,
  canSeeCustomerIdentity,
  canViewCustomerRatings,
  canViewCustomerLeaderboard,
  createOrGetQr,
  listQrCodes,
  listPharmacyBranches,
  publicSession,
  ratingsFeed,
  rotateQr,
  scopedBranchIds,
  setQrBlocked,
  submitRating,
  ensureCustomerRatingsSchema,
  employeeLeaderboard,
  deleteRating,
  adminCreateRating,
} from "../lib/customer-ratings";

const router = Router();

async function actorOf(req: AuthRequest) {
  const { rows } = await pool.query(`SELECT full_name, login, role FROM users WHERE id = $1`, [req.userId]);
  return {
    id: Number(req.userId) || 0,
    name: String(rows[0]?.full_name || rows[0]?.login || req.userLogin || "Admin"),
    role: String(req.userRole || rows[0]?.role || ""),
  };
}

async function roleOf(req: AuthRequest): Promise<string> {
  if (req.userRole) return String(req.userRole);
  const a = await actorOf(req);
  return a.role;
}

function clientIp(req: AuthRequest): string {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0]?.trim();
  return xf || req.socket.remoteAddress || "";
}

// ---------- Public (auth yo‘q) ----------

router.get("/public/customer-ratings/:token", async (req, res): Promise<void> => {
  try {
    await ensureCustomerRatingsSchema();
    const data = await publicSession(String(req.params.token || ""));
    if ("error" in data && data.error) {
      res.status(data.code === "not_found" ? 404 : 403).json(data);
      return;
    }
    res.json(data);
  } catch (err) {
    console.error("GET public customer-ratings", err);
    res.status(503).json({ error: "Yuklanmadi" });
  }
});

router.post("/public/customer-ratings/:token", async (req, res): Promise<void> => {
  try {
    await ensureCustomerRatingsSchema();
    const body = req.body || {};
    const result = await submitRating({
      token: String(req.params.token || ""),
      rateType: body.rateType === "pharmacy" ? "pharmacy" : "staff",
      employeeIds: Array.isArray(body.employeeIds) ? body.employeeIds.map(Number) : [],
      allShift: Boolean(body.allShift),
      stars: Number(body.stars),
      serviceQuality: String(body.serviceQuality || ""),
      demeanor: String(body.demeanor || ""),
      comment: body.comment != null ? String(body.comment) : null,
      customerName: String(body.customerName || ""),
      customerPhone: String(body.customerPhone || ""),
      fingerprint: body.fingerprint != null ? String(body.fingerprint) : null,
      ip: clientIp(req as AuthRequest),
      userAgent: String(req.headers["user-agent"] || ""),
      lang: body.lang === "ru" ? "ru" : "uz",
    });
    res.json(result);
  } catch (err) {
    const e = err as Error & { status?: number; code?: string };
    res.status(e.status || 503).json({ error: e.message || "Saqlanmadi", code: e.code });
  }
});

// ---------- Auth ----------

router.get("/customer-ratings/meta", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = await roleOf(req);
  if (!canViewCustomerRatings(role) && !canViewCustomerLeaderboard(role)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  res.json({
    canManage: canManageCustomerRatings(role),
    canSeeIdentity: canSeeCustomerIdentity(role),
    canLeaderboard: canViewCustomerLeaderboard(role),
    role,
  });
});

router.get("/customer-ratings/leaderboard", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const role = await roleOf(req);
    if (!canViewCustomerLeaderboard(role)) {
      res.status(403).json({ error: "Ruxsat yo‘q" });
      return;
    }
    const data = await employeeLeaderboard({
      userId: Number(req.userId),
      role,
      from: req.query.from ? String(req.query.from) : null,
      to: req.query.to ? String(req.query.to) : null,
    });
    res.json(data);
  } catch (err) {
    console.error("GET customer-ratings/leaderboard", err);
    res.status(503).json({ error: "Reyting yuklanmadi" });
  }
});

router.get("/customer-ratings/branches", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const role = await roleOf(req);
    if (!canViewCustomerRatings(role)) {
      res.status(403).json({ error: "Ruxsat yo‘q" });
      return;
    }
    const scope = await scopedBranchIds(Number(req.userId), role);
    const all = await listPharmacyBranches();
    const branches = scope ? all.filter((b) => scope.includes(b.id)) : all;
    res.json({ branches });
  } catch (err) {
    console.error("GET customer-ratings/branches", err);
    res.status(503).json({ error: "Filiallar yuklanmadi" });
  }
});

router.get("/customer-ratings/qr", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const role = await roleOf(req);
    if (!canViewCustomerRatings(role)) {
      res.status(403).json({ error: "Ruxsat yo‘q" });
      return;
    }
    const scope = await scopedBranchIds(Number(req.userId), role);
    // QR boshqaruv faqat admin/HR — mudir/koordinator faqat o‘z QR ni ko‘radi
    const items = await listQrCodes(scope);
    res.json({ items, canManage: canManageCustomerRatings(role) });
  } catch (err) {
    console.error("GET customer-ratings/qr", err);
    res.status(503).json({ error: "QR ro‘yxati yuklanmadi" });
  }
});

router.post("/customer-ratings/qr", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const role = await roleOf(req);
    if (!canManageCustomerRatings(role)) {
      res.status(403).json({ error: "Faqat admin/HR QR yaratadi" });
      return;
    }
    const branchId = Number(req.body?.branchId);
    if (!branchId) {
      res.status(400).json({ error: "Filial tanlang" });
      return;
    }
    const qr = await createOrGetQr(branchId, await actorOf(req));
    res.json({ ok: true, qr });
  } catch (err) {
    res.status(503).json({ error: (err as Error).message || "Yaratilmadi" });
  }
});

router.post("/customer-ratings/qr/:branchId/rotate", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const role = await roleOf(req);
    if (!canManageCustomerRatings(role)) {
      res.status(403).json({ error: "Ruxsat yo‘q" });
      return;
    }
    const branchId = Number(req.params.branchId);
    const qr = await rotateQr(branchId, await actorOf(req));
    res.json({ ok: true, qr });
  } catch (err) {
    res.status(503).json({ error: (err as Error).message || "Yangilanmadi" });
  }
});

router.post("/customer-ratings/qr/:branchId/block", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const role = await roleOf(req);
    if (!canManageCustomerRatings(role)) {
      res.status(403).json({ error: "Ruxsat yo‘q" });
      return;
    }
    const branchId = Number(req.params.branchId);
    const blocked = req.body?.blocked !== false;
    await setQrBlocked(branchId, blocked, await actorOf(req));
    const items = await listQrCodes(null);
    res.json({ ok: true, item: items.find((i) => i.branchId === branchId) });
  } catch (err) {
    res.status(503).json({ error: (err as Error).message || "Saqlanmadi" });
  }
});

router.get("/customer-ratings/feed", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const role = await roleOf(req);
    if (!canViewCustomerRatings(role)) {
      res.status(403).json({ error: "Ruxsat yo‘q" });
      return;
    }
    const scope = await scopedBranchIds(Number(req.userId), role);
    const branchId = req.query.branchId ? Number(req.query.branchId) : null;
    if (scope && branchId && !scope.includes(branchId)) {
      res.status(403).json({ error: "Bu filialga ruxsat yo‘q" });
      return;
    }
    const rateTypeRaw = String(req.query.rateType || "all");
    const rateType =
      rateTypeRaw === "pharmacy" || rateTypeRaw === "staff" ? rateTypeRaw : ("all" as const);
    const data = await ratingsFeed({
      scope,
      branchId,
      employeeId: req.query.employeeId ? Number(req.query.employeeId) : null,
      from: req.query.from ? String(req.query.from) : null,
      to: req.query.to ? String(req.query.to) : null,
      minStars: req.query.minStars ? Number(req.query.minStars) : null,
      complaintsOnly: String(req.query.complaints || "") === "1",
      rateType,
      limit: req.query.limit ? Number(req.query.limit) : 500,
      showIdentity: canSeeCustomerIdentity(role),
    });
    res.json(data);
  } catch (err) {
    console.error("GET customer-ratings/feed", err);
    res.status(503).json({ error: "Baholar yuklanmadi" });
  }
});

router.get("/customer-ratings/branch-staff", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const role = await roleOf(req);
    if (!canManageCustomerRatings(role)) {
      res.status(403).json({ error: "Ruxsat yo‘q" });
      return;
    }
    const branchId = Number(req.query.branchId);
    if (!branchId) {
      res.status(400).json({ error: "Filial tanlang" });
      return;
    }
    const { rows } = await pool.query(
      `SELECT e.id, e.full_name, e.position, u.role
         FROM employees e
         LEFT JOIN users u ON u.id = e.user_id
        WHERE e.employment_status IS DISTINCT FROM 'dismissed'
          AND (
            e.assigned_branch_id = $1
            OR e.reports_to_id = $1
            OR e.id = $1
          )
          AND (
            LOWER(COALESCE(u.role,'')) IN ('mudir','farmasevt','stajyor','stajor')
            OR LOWER(COALESCE(e.org_role,'')) IN ('manager','pharmacist','intern')
          )
        ORDER BY e.full_name ASC
        LIMIT 200`,
      [branchId],
    );
    res.json({
      staff: rows.map((r) => ({
        employeeId: r.id as number,
        fullName: r.full_name as string,
        position: (r.position as string) || "",
        role: (r.role as string) || "",
      })),
    });
  } catch (err) {
    console.error("GET customer-ratings/branch-staff", err);
    res.status(503).json({ error: "Xodimlar yuklanmadi" });
  }
});

router.delete("/customer-ratings/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const role = await roleOf(req);
    if (!canManageCustomerRatings(role)) {
      res.status(403).json({ error: "Faqat admin/HR o‘chira oladi" });
      return;
    }
    const id = Number(req.params.id);
    if (!id) {
      res.status(400).json({ error: "ID kerak" });
      return;
    }
    await deleteRating(id, await actorOf(req));
    res.json({ ok: true });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status || 503).json({ error: e.message || "O‘chirilmadi" });
  }
});

router.post("/customer-ratings", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const role = await roleOf(req);
    if (!canManageCustomerRatings(role)) {
      res.status(403).json({ error: "Faqat admin/HR qo‘sha oladi" });
      return;
    }
    const body = req.body || {};
    const result = await adminCreateRating({
      actor: await actorOf(req),
      rateType: body.rateType === "pharmacy" ? "pharmacy" : "staff",
      branchId: Number(body.branchId),
      employeeIds: Array.isArray(body.employeeIds) ? body.employeeIds.map(Number) : [],
      stars: Number(body.stars),
      serviceQuality: String(body.serviceQuality || ""),
      demeanor: String(body.demeanor || ""),
      comment: body.comment != null ? String(body.comment) : null,
      customerName: String(body.customerName || ""),
      customerPhone: String(body.customerPhone || ""),
      workDate: body.workDate != null ? String(body.workDate) : null,
    });
    res.json(result);
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status || 503).json({ error: e.message || "Saqlanmadi" });
  }
});

router.get("/customer-ratings/export.xlsx", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const role = await roleOf(req);
    if (!canViewCustomerRatings(role)) {
      res.status(403).json({ error: "Ruxsat yo‘q" });
      return;
    }
    const scope = await scopedBranchIds(Number(req.userId), role);
    const showId = canSeeCustomerIdentity(role);
    const rateTypeRaw = String(req.query.rateType || "all");
    const rateType =
      rateTypeRaw === "pharmacy" || rateTypeRaw === "staff" ? rateTypeRaw : ("all" as const);
    const data = await ratingsFeed({
      scope,
      branchId: req.query.branchId ? Number(req.query.branchId) : null,
      from: req.query.from ? String(req.query.from) : null,
      to: req.query.to ? String(req.query.to) : null,
      complaintsOnly: String(req.query.complaints || "") === "1",
      rateType,
      limit: 5000,
      showIdentity: showId,
    });

    const wb = new ExcelJS.Workbook();
    const staffSheet = wb.addWorksheet("Xodim baholari");
    const pharmSheet = wb.addWorksheet("Dorixona baholari");

    const baseCols = [
      { header: "Sana", key: "date", width: 12 },
      { header: "Filial №", key: "branchNo", width: 10 },
      { header: "Filial nomi", key: "branch", width: 28 },
      { header: "Filial tel", key: "branchPhone", width: 16 },
      { header: "Mudir", key: "mudir", width: 24 },
      { header: "Mudir tel", key: "mudirPhone", width: 16 },
      { header: "Koordinator", key: "coord", width: 24 },
      { header: "Koordinator tel", key: "coordPhone", width: 16 },
      { header: "Yulduz", key: "stars", width: 8 },
    ];

    staffSheet.columns = [
      ...baseCols,
      { header: "Xodimlar", key: "staff", width: 36 },
      { header: "Xizmat", key: "service", width: 14 },
      { header: "Muomala", key: "demeanor", width: 14 },
      { header: "Izoh", key: "comment", width: 40 },
      ...(showId
        ? [
            { header: "Mijoz ismi", key: "name", width: 20 },
            { header: "Mijoz telefon", key: "phone", width: 16 },
          ]
        : []),
      { header: "Vaqt", key: "at", width: 20 },
    ];

    pharmSheet.columns = [
      ...baseCols,
      { header: "Tozalik", key: "service", width: 14 },
      { header: "Mahsulot tanlovi", key: "demeanor", width: 16 },
      { header: "Izoh", key: "comment", width: 40 },
      ...(showId
        ? [
            { header: "Mijoz ismi", key: "name", width: 20 },
            { header: "Mijoz telefon", key: "phone", width: 16 },
          ]
        : []),
      { header: "Vaqt", key: "at", width: 20 },
    ];

    for (const it of data.items) {
      const row = {
        date: it.workDate,
        branchNo: it.branchNo ?? "",
        branch: it.branchName || it.branchLabel,
        branchPhone: it.branchPhone || "",
        mudir: it.mudirName || "",
        mudirPhone: it.mudirPhone || "",
        coord: it.coordinatorName || "",
        coordPhone: it.coordinatorPhone || "",
        stars: it.stars,
        staff: it.targets.map((t) => t.employeeName).join(", "),
        service: it.serviceQuality,
        demeanor: it.demeanor,
        comment: it.comment || "",
        name: it.customerName || "",
        phone: it.customerPhone || "",
        at: it.createdAt,
      };
      if (it.rateType === "pharmacy") pharmSheet.addRow(row);
      else staffSheet.addRow(row);
    }

    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="mijozlar_baholashi.xlsx"`);
    res.send(buf);
  } catch (err) {
    console.error("GET customer-ratings/export", err);
    res.status(503).json({ error: "Export xato" });
  }
});

export default router;
