import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { hasFullPlatformAccess, isHrRole } from "../lib/roles";
import {
  cancelMalumotnoma,
  createMalumotnoma,
  deleteMalumotnoma,
  getMalumotnomaSettings,
  listMalumotnomalar,
  malumotnomaById,
  malumotnomaByToken,
  malumotnomaVerifyUrl,
  saveMalumotnomaSettings,
  searchMalumotnomaStaff,
  fmtMalumotnomaDate,
  type MalumotnomaRow,
} from "../lib/malumotnoma";
import { renderMalumotnomaPdf } from "../lib/malumotnoma-pdf";

const router: IRouter = Router();

const canManage = (role?: string | null) => hasFullPlatformAccess(role) || isHrRole(role);

function originOf(req: Request): string {
  const origin = req.get("origin");
  if (origin) return origin;
  const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0]!.trim();
  return `${proto}://${req.get("x-forwarded-host") || req.get("host")}`;
}

function payload(row: MalumotnomaRow, origin: string) {
  return {
    id: row.id,
    docNo: row.docNo,
    employeeId: row.employeeId,
    fullName: row.fullName,
    position: row.position,
    branch: row.branch,
    shiftLabel: row.shiftLabel,
    workStart: row.workStart,
    workEnd: row.workEnd,
    companyName: row.companyName,
    directorName: row.directorName,
    directorTitle: row.directorTitle,
    status: row.status,
    issuedAt: row.issuedAt,
    issuedAtLabel: fmtMalumotnomaDate(row.issuedAt),
    issuedByName: row.issuedByName,
    verifyUrl: malumotnomaVerifyUrl(origin, row.verifyToken),
    pdfUrl: `/api/malumotnoma/${row.id}/pdf`,
  };
}

async function sendPdf(req: Request, res: Response, row: MalumotnomaRow): Promise<void> {
  const origin = originOf(req);
  const pdf = await renderMalumotnomaPdf(row, malumotnomaVerifyUrl(origin, row.verifyToken));
  const safe = row.fullName.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 40);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `${req.query.download ? "attachment" : "inline"}; filename="malumotnoma_${row.docNo}.pdf"; filename*=UTF-8''${encodeURIComponent(`Malumotnoma_${safe}.pdf`)}`,
  );
  res.send(pdf);
}

router.get("/malumotnoma/settings", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR uchun" });
    return;
  }
  try {
    res.json(await getMalumotnomaSettings());
  } catch {
    res.status(503).json({ error: "Sozlamalar yuklanmadi" });
  }
});

router.put("/malumotnoma/settings", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR uchun" });
    return;
  }
  try {
    const body = req.body ?? {};
    res.json(
      await saveMalumotnomaSettings({
        companyName: String(body.companyName || ""),
        directorTitle: String(body.directorTitle || ""),
        directorName: String(body.directorName || ""),
      }),
    );
  } catch {
    res.status(503).json({ error: "Saqlanmadi" });
  }
});

router.get("/malumotnoma/staff", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR uchun" });
    return;
  }
  try {
    const q = String(req.query.q || "").slice(0, 80);
    res.json({ items: await searchMalumotnomaStaff(q) });
  } catch {
    res.status(503).json({ error: "Xodimlar yuklanmadi" });
  }
});

router.get("/malumotnoma", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR uchun" });
    return;
  }
  try {
    const origin = originOf(req);
    const items = await listMalumotnomalar(80);
    res.json({ items: items.map((r) => payload(r, origin)) });
  } catch {
    res.status(503).json({ error: "Ro‘yxat yuklanmadi" });
  }
});

router.post("/malumotnoma", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR uchun" });
    return;
  }
  const employeeId = Number(req.body?.employeeId);
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    res.status(400).json({ error: "Xodimni tanlang" });
    return;
  }
  try {
    const row = await createMalumotnoma({
      employeeId,
      issuedBy: req.userId,
      issuedByName: null,
      origin: originOf(req),
    });
    res.status(201).json(payload(row, originOf(req)));
  } catch (e: any) {
    res.status(e?.status || 503).json({ error: e?.message || "Yaratilmadi" });
  }
});

router.get("/malumotnoma/:id/pdf", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR uchun" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Noto‘g‘ri id" });
    return;
  }
  try {
    const row = await malumotnomaById(id);
    if (!row) {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
    await sendPdf(req, res, row);
  } catch {
    res.status(503).json({ error: "PDF tayyorlanmadi" });
  }
});

router.post("/malumotnoma/:id/cancel", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR uchun" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Noto‘g‘ri id" });
    return;
  }
  try {
    const row = await cancelMalumotnoma(id);
    if (!row) {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
    res.json(payload(row, originOf(req)));
  } catch {
    res.status(503).json({ error: "Bekor qilinmadi" });
  }
});

router.delete("/malumotnoma/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR uchun" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Noto‘g‘ri id" });
    return;
  }
  try {
    const ok = await deleteMalumotnoma(id);
    if (!ok) {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
    res.json({ ok: true });
  } catch {
    res.status(503).json({ error: "O‘chirilmadi" });
  }
});

/** Ochiq tekshiruv — QR */
router.get("/malumotnoma/verify/:token", async (req, res): Promise<void> => {
  try {
    const row = await malumotnomaByToken(String(req.params.token || ""));
    if (!row) {
      res.status(404).json({ valid: false, error: "Hujjat topilmadi" });
      return;
    }
    const cancelled = row.status === "cancelled";
    res.json({
      valid: !cancelled,
      cancelled,
      status: row.status,
      docNo: row.docNo,
      fullName: row.fullName,
      position: row.position,
      branch: row.branch,
      shiftLabel: row.shiftLabel,
      workStart: row.workStart,
      workEnd: row.workEnd,
      companyName: row.companyName,
      issuedAt: row.issuedAt,
      issuedAtLabel: fmtMalumotnomaDate(row.issuedAt),
      pdfUrl: `/api/malumotnoma/verify/${encodeURIComponent(row.verifyToken)}/pdf`,
    });
  } catch {
    res.status(503).json({ valid: false, error: "Tekshirib bo‘lmadi" });
  }
});

router.get("/malumotnoma/verify/:token/pdf", async (req, res): Promise<void> => {
  try {
    const row = await malumotnomaByToken(String(req.params.token || ""));
    if (!row) {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
    await sendPdf(req, res, row);
  } catch {
    res.status(503).json({ error: "PDF tayyorlanmadi" });
  }
});

export default router;
