import { Router } from "express";
import ExcelJS from "exceljs";
import type { AuthRequest } from "../middlewares/auth";
import { optionalAuth, requireAuth } from "../middlewares/auth";
import { pool } from "@workspace/db";
import {
  canManageCustomerRatings,
  canSeeCustomerIdentity,
  canViewCustomerRatings,
  canViewCustomerLeaderboard,
  createOrGetQr,
  createAllMissingQr,
  listQrCodes,
  listPharmacyBranches,
  publicSession,
  ratingsFeed,
  scopedBranchIds,
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

router.get("/public/customer-ratings/:token", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    await ensureCustomerRatingsSchema();
    if (req.userId) {
      res.status(403).json({
        error:
          "Bu forma faqat mijozlar uchun. Platformaga kirgan xodimlar QR orqali baholay olmaydi — brauzerda chiqing yoki boshqa (mijoz) qurilmadan oching.",
        code: "staff_blocked",
      });
      return;
    }
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

router.post("/public/customer-ratings/:token", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    await ensureCustomerRatingsSchema();
    const body = req.body || {};
    const rateTypeRaw = String(body.rateType || "staff");
    const rateType =
      rateTypeRaw === "pharmacy" || rateTypeRaw === "complaint" ? rateTypeRaw : ("staff" as const);
    const result = await submitRating({
      token: String(req.params.token || ""),
      rateType,
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
      actorUserId: req.userId ?? null,
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
    // Barcha filiallarga birga
    if (req.body?.all === true || req.body?.createAll === true) {
      const result = await createAllMissingQr(await actorOf(req));
      res.json(result);
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

router.post("/customer-ratings/qr/:branchId/rotate", requireAuth, async (_req: AuthRequest, res): Promise<void> => {
  res.status(403).json({ error: "QR o‘zgarmas — almashtirish yopiq" });
});

router.post("/customer-ratings/qr/:branchId/block", requireAuth, async (_req: AuthRequest, res): Promise<void> => {
  res.status(403).json({ error: "QR o‘zgarmas — bloklash yopiq" });
});

/** Barcha QR larni to‘liq o‘chirish — yopiq (yaratilgan QR saqlanadi) */
router.delete("/customer-ratings/qr", requireAuth, async (_req: AuthRequest, res): Promise<void> => {
  res.status(403).json({ error: "QR o‘zgarmas — o‘chirish yopiq" });
});

/** Bitta filial QR sini to‘liq o‘chirish — yopiq */
router.delete("/customer-ratings/qr/:branchId", requireAuth, async (_req: AuthRequest, res): Promise<void> => {
  res.status(403).json({ error: "QR o‘zgarmas — o‘chirish yopiq" });
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
      rateTypeRaw === "pharmacy" || rateTypeRaw === "staff" || rateTypeRaw === "complaint"
        ? rateTypeRaw
        : ("all" as const);
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
      rateTypeRaw === "pharmacy" || rateTypeRaw === "staff" || rateTypeRaw === "complaint"
        ? rateTypeRaw
        : ("all" as const);
    const q = String(req.query.q || "").trim().toLocaleLowerCase("uz");
    const starsFilter = req.query.stars ? Number(req.query.stars) : null;
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

    const filtered = data.items.filter((it) => {
      if (starsFilter != null && Number.isFinite(starsFilter) && it.stars !== starsFilter) return false;
      if (!q) return true;
      const hay = [
        it.branchLabel,
        it.branchName,
        it.branchNo != null ? String(it.branchNo) : "",
        it.branchPhone,
        it.mudirName,
        it.mudirPhone,
        it.coordinatorName,
        it.coordinatorPhone,
        it.serviceQuality,
        it.demeanor,
        it.comment,
        it.customerName,
        it.customerPhone,
        it.workDate,
        ...it.targets.map((t) => t.employeeName),
        String(it.stars),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("uz");
      return q.split(/\s+/).filter(Boolean).every((tok) => hay.includes(tok));
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = "Vaksina HR";
    wb.created = new Date();
    const staffSheet = wb.addWorksheet("Xodim baholari", {
      views: [{ state: "frozen", ySplit: 3 }],
      properties: { defaultRowHeight: 18 },
    });
    const pharmSheet = wb.addWorksheet("Dorixona baholari", {
      views: [{ state: "frozen", ySplit: 3 }],
      properties: { defaultRowHeight: 18 },
    });
    const complaintSheet = wb.addWorksheet("Shikoyatlar", {
      views: [{ state: "frozen", ySplit: 3 }],
      properties: { defaultRowHeight: 18 },
    });

    const brand = {
      purple: "FF5C2D91",
      gold: "FFC9A227",
      headerBg: "FF5C2D91",
      headerFg: "FFFFFFFF",
      altRow: "FFF7F3FC",
      lowBg: "FFFFE4E6",
      highBg: "FFFFF7E6",
      border: "FFD4C4E8",
      titleFg: "FF5C2D91",
      muted: "FF64748B",
    };

    type ColDef = { header: string; key: string; width: number };
    const baseCols: ColDef[] = [
      { header: "Sana", key: "date", width: 12 },
      { header: "Filial №", key: "branchNo", width: 10 },
      { header: "Filial nomi", key: "branch", width: 30 },
      { header: "Filial tel", key: "branchPhone", width: 16 },
      { header: "Mudir", key: "mudir", width: 24 },
      { header: "Mudir tel", key: "mudirPhone", width: 16 },
      { header: "Koordinator", key: "coord", width: 24 },
      { header: "Koordinator tel", key: "coordPhone", width: 16 },
      { header: "Yulduz", key: "stars", width: 10 },
    ];
    const idCols: ColDef[] = showId
      ? [
          { header: "Mijoz ismi", key: "name", width: 20 },
          { header: "Mijoz telefon", key: "phone", width: 16 },
        ]
      : [];
    const staffCols: ColDef[] = [
      ...baseCols,
      { header: "Xodimlar", key: "staff", width: 36 },
      { header: "Xizmat", key: "service", width: 14 },
      { header: "Muomala", key: "demeanor", width: 14 },
      { header: "Izoh", key: "comment", width: 42 },
      ...idCols,
      { header: "Belgilangan vaqt", key: "at", width: 22 },
    ];
    const pharmCols: ColDef[] = [
      ...baseCols,
      { header: "Tozalik", key: "service", width: 14 },
      { header: "Mahsulot tanlovi", key: "demeanor", width: 18 },
      { header: "Izoh", key: "comment", width: 42 },
      ...idCols,
      { header: "Belgilangan vaqt", key: "at", width: 22 },
    ];
    const complaintCols: ColDef[] = [
      { header: "Sana", key: "date", width: 12 },
      { header: "Filial №", key: "branchNo", width: 10 },
      { header: "Filial nomi", key: "branch", width: 30 },
      { header: "Filial tel", key: "branchPhone", width: 16 },
      { header: "Mudir", key: "mudir", width: 24 },
      { header: "Mudir tel", key: "mudirPhone", width: 16 },
      { header: "Koordinator", key: "coord", width: 24 },
      { header: "Koordinator tel", key: "coordPhone", width: 16 },
      { header: "Shikoyat", key: "comment", width: 56 },
      ...idCols,
      { header: "Belgilangan vaqt", key: "at", width: 22 },
    ];

    const nowLabel = new Date().toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" });
    const filterBits = [
      rateType === "staff"
        ? "faqat xodim"
        : rateType === "pharmacy"
          ? "faqat dorixona"
          : rateType === "complaint"
            ? "faqat shikoyat"
            : "barcha turlar",
      req.query.branchId ? `filial #${req.query.branchId}` : "barcha filiallar",
      String(req.query.complaints || "") === "1" ? "past baholar" : null,
      starsFilter != null && Number.isFinite(starsFilter) ? `${starsFilter}★` : null,
      q ? `qidiruv: «${String(req.query.q)}»` : null,
    ].filter(Boolean);

    const styleSheet = (
      sheet: ExcelJS.Worksheet,
      cols: ColDef[],
      title: string,
      rows: Array<Record<string, string | number>>,
    ) => {
      sheet.columns = cols.map((c) => ({ key: c.key, width: c.width }));

      sheet.mergeCells(1, 1, 1, cols.length);
      const titleCell = sheet.getCell(1, 1);
      titleCell.value = `VAKSINA · ${title}`;
      titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: brand.headerFg } };
      titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: brand.purple } };
      titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      sheet.getRow(1).height = 28;

      sheet.mergeCells(2, 1, 2, cols.length);
      const metaCell = sheet.getCell(2, 1);
      metaCell.value = `Mijozlar baholashi · ${nowLabel} · ${rows.length} ta yozuv · ${filterBits.join(" · ")}`;
      metaCell.font = { name: "Calibri", size: 10, italic: true, color: { argb: brand.muted } };
      metaCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3EDFA" } };
      metaCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      sheet.getRow(2).height = 20;

      const headerRow = sheet.getRow(3);
      headerRow.height = 22;
      cols.forEach((c, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = c.header;
        cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: brand.headerFg } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: brand.headerBg } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: brand.border } },
          left: { style: "thin", color: { argb: brand.border } },
          bottom: { style: "thin", color: { argb: brand.border } },
          right: { style: "thin", color: { argb: brand.border } },
        };
      });

      rows.forEach((r, idx) => {
        const excelRow = sheet.addRow(r);
        excelRow.height = 20;
        const stars = Number(r.stars) || 0;
        const rowBg =
          stars <= 2 ? brand.lowBg : stars >= 5 ? brand.highBg : idx % 2 === 0 ? "FFFFFFFF" : brand.altRow;
        excelRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cell.font = { name: "Calibri", size: 10, color: { argb: "FF1E293B" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowBg } };
          cell.alignment = {
            vertical: "middle",
            horizontal: cols[colNumber - 1]?.key === "comment" ? "left" : "left",
            wrapText: cols[colNumber - 1]?.key === "comment" || cols[colNumber - 1]?.key === "staff",
          };
          cell.border = {
            top: { style: "hair", color: { argb: brand.border } },
            left: { style: "hair", color: { argb: brand.border } },
            bottom: { style: "hair", color: { argb: brand.border } },
            right: { style: "hair", color: { argb: brand.border } },
          };
          if (cols[colNumber - 1]?.key === "stars") {
            cell.alignment = { vertical: "middle", horizontal: "center" };
            cell.font = {
              name: "Calibri",
              size: 11,
              bold: true,
              color: { argb: stars <= 2 ? "FFBE123C" : stars >= 4 ? "FFB45309" : "FF334155" },
            };
          }
          if (cols[colNumber - 1]?.key === "branch") {
            cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: brand.titleFg } };
          }
        });
      });

      if (rows.length) {
        sheet.autoFilter = {
          from: { row: 3, column: 1 },
          to: { row: 3 + rows.length, column: cols.length },
        };
      }

      sheet.pageSetup = {
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      };
    };

    const formatMarkedAt = (iso: string | null | undefined) => {
      if (!iso) return "";
      try {
        return new Date(iso).toLocaleString("uz-UZ", {
          timeZone: "Asia/Tashkent",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });
      } catch {
        return String(iso);
      }
    };

    const toRow = (it: (typeof filtered)[number]) => ({
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
      at: formatMarkedAt(it.createdAt),
    });

    const staffRows = filtered.filter((it) => it.rateType === "staff").map(toRow);
    const pharmRows = filtered.filter((it) => it.rateType === "pharmacy").map(toRow);
    const complaintRows = filtered.filter((it) => it.rateType === "complaint").map(toRow);

    if (rateType === "pharmacy") {
      wb.removeWorksheet(staffSheet.id);
      wb.removeWorksheet(complaintSheet.id);
      styleSheet(pharmSheet, pharmCols, "Dorixona baholari", pharmRows);
    } else if (rateType === "staff") {
      wb.removeWorksheet(pharmSheet.id);
      wb.removeWorksheet(complaintSheet.id);
      styleSheet(staffSheet, staffCols, "Xodim baholari", staffRows);
    } else if (rateType === "complaint") {
      wb.removeWorksheet(staffSheet.id);
      wb.removeWorksheet(pharmSheet.id);
      styleSheet(complaintSheet, complaintCols, "Shikoyatlar", complaintRows);
    } else {
      styleSheet(staffSheet, staffCols, "Xodim baholari", staffRows);
      styleSheet(pharmSheet, pharmCols, "Dorixona baholari", pharmRows);
      styleSheet(complaintSheet, complaintCols, "Shikoyatlar", complaintRows);
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
