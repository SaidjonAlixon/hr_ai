import { Router, type IRouter, type Request, type Response } from "express";
import { PDFDocument } from "pdf-lib";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { hasFullPlatformAccess, isHrRole } from "../lib/roles";
import { pool } from "@workspace/db";
import {
  FINAL_STRIKE,
  LETTER_STAGES,
  REASON_MAX,
  REASON_MIN,
  REASON_MIN_WORDS,
  confirmLetter,
  createTestLetter,
  getLetterSettings,
  reasonProblem,
  reviewLetter,
  saveLetterSettings,
  deleteLetters,
  deleteTestLetters,
  explanationPunchBlock,
  issuedLetterNo,
  letterById,
  letterByNo,
  letterByToken,
  normalizeLetterNo,
  tokenFromScan,
  letterContent,
  letterImages,
  letterMonths,
  letterUserOptions,
  lettersForMonth,
  logLetterError,
  myLetters,
  signLetter,
  testLetters,
  type ExplanationLetterRow,
  type LetterSettings,
} from "../lib/explanation-letter";
import { renderExplanationLetterPdf } from "../lib/explanation-letter-pdf";
import { buildExplanationReport, reportSchedule, sendExplanationReport, sendOriginalLetterPdfs } from "../lib/explanation-letter-report";
import { freshDisciplineScan, resyncAfterLetterDelete, runDisciplineScan, todayTashkent } from "../lib/discipline";
import { coordinatorsFor } from "../lib/davomat-shift-report";
import { loadFilialBranches } from "../lib/filial-bot-data";
import { displayBranchName } from "../lib/geo-location";
import { isJarimaEnabled } from "../lib/jarima-switch";

const router: IRouter = Router();

const canManage = (role?: string | null) => hasFullPlatformAccess(role) || isHrRole(role);
const MAX_PNG = 400_000;
const isPng = (v: unknown): v is string => typeof v === "string" && v.length < MAX_PNG && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v);

function originOf(req: Request): string {
  const origin = req.get("origin");
  if (origin) return origin;
  const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0]!.trim();
  return `${proto}://${req.get("x-forwarded-host") || req.get("host")}`;
}

const BULK_MAX = 300;

/** `all` — barcha oylar */
function monthParam(v: unknown): string | null {
  const s = String(v || "");
  if (s === "all") return null;
  return /^\d{4}-\d{2}$/.test(s) ? s : todayTashkent().slice(0, 7);
}

async function sendLetterPdf(req: Request, res: Response, l: ExplanationLetterRow): Promise<void> {
  const pdf = await renderExplanationLetterPdf(letterContent(l, originOf(req), await getLetterSettings()), await letterImages(l.id));
  const safe = l.fullName.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 40);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `${req.query.download ? "attachment" : "inline"}; filename="tushuntirish_xati_${l.letterNo}.pdf"; filename*=UTF-8''${encodeURIComponent(`Tushuntirish_xati_${safe}_${l.eventDate}.pdf`)}`,
  );
  res.send(pdf);
}

type CoordinatorContact = { name: string; phone: string | null };
type LetterContacts = { employeePhone: string | null; branchPhone: string | null; branchName: string | null };

/** letterId → xodimning o‘z telefoni va filialga biriktirilgan telefon (branch_contacts.primary_phone) */
async function letterContacts(items: ExplanationLetterRow[]): Promise<Map<number, LetterContacts>> {
  const out = new Map<number, LetterContacts>();
  if (!items.length) return out;
  const userIds = [...new Set(items.map((l) => l.userId))];
  const [{ rows: users }, { rows: emps }, branches] = await Promise.all([
    pool.query(`SELECT id, phone FROM users WHERE id = ANY($1::int[])`, [userIds]),
    pool.query(
      `SELECT DISTINCT ON (user_id) user_id, id, org_role, assigned_branch_id, reports_to_id, location
         FROM employees WHERE user_id = ANY($1::int[]) ORDER BY user_id, id DESC`,
      [userIds],
    ),
    loadFilialBranches(),
  ]);
  const phoneOf = new Map(users.map((r) => [Number(r.id), (String(r.phone ?? "").trim() || null) as string | null]));
  const empOf = new Map(emps.map((r) => [Number(r.user_id), r]));
  const byId = new Map(branches.map((b) => [b.id, b]));
  const byName = new Map(branches.map((b) => [b.name.trim().toLowerCase(), b]));
  for (const l of items) {
    const e = empOf.get(l.userId);
    const branchId = e ? Number(e.assigned_branch_id || (e.org_role === "manager" ? e.id : e.reports_to_id) || 0) : 0;
    const locName = (displayBranchName(e?.location) || String(e?.location ?? "").split("|")[0] || "").trim().toLowerCase();
    const card = (branchId && byId.get(branchId)) || (locName && byName.get(locName)) || null;
    out.set(l.id, {
      employeePhone: phoneOf.get(l.userId) ?? null,
      branchPhone: card?.primaryPhone ?? null,
      branchName: card?.name ?? null,
    });
  }
  return out;
}

/** letterId → xodimning koordinatori (rahbarlik zanjiri bo‘yicha) va telefoni */
async function letterCoordinators(items: ExplanationLetterRow[]): Promise<Map<number, CoordinatorContact>> {
  const out = new Map<number, CoordinatorContact>();
  if (!items.length) return out;
  const empOf = new Map<number, number>();
  const missing = items.filter((l) => l.employeeId == null).map((l) => l.userId);
  if (missing.length) {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (user_id) user_id, id FROM employees WHERE user_id = ANY($1::int[]) ORDER BY user_id, id DESC`,
      [missing],
    );
    for (const r of rows) empOf.set(Number(r.user_id), Number(r.id));
  }
  const empIds = new Map<number, number>();
  for (const l of items) {
    const emp = l.employeeId ?? empOf.get(l.userId);
    if (emp) empIds.set(l.id, emp);
  }
  const hits = await coordinatorsFor([...new Set(empIds.values())]);
  const userIds = [...new Set([...hits.values()].map((h) => h.userId).filter((v): v is number => v != null))];
  const phones = new Map<number, string>();
  if (userIds.length) {
    const { rows } = await pool.query(`SELECT id, phone FROM users WHERE id = ANY($1::int[])`, [userIds]);
    for (const r of rows) if (r.phone) phones.set(Number(r.id), String(r.phone));
  }
  for (const [letterId, emp] of empIds) {
    const hit = hits.get(emp);
    if (hit) out.set(letterId, { name: hit.name, phone: hit.userId != null ? phones.get(hit.userId) ?? null : null });
  }
  return out;
}

function payload(
  l: ExplanationLetterRow,
  req: Request,
  settings: LetterSettings,
  coordinator: CoordinatorContact | null,
  contacts: LetterContacts | null,
) {
  const { verifyToken: _t, ...rest } = l;
  return {
    ...rest,
    coordinator,
    contacts,
    verifyToken: l.status === "pending" ? null : l.verifyToken,
    content: letterContent(l, originOf(req), settings),
  };
}

async function payloads(items: ExplanationLetterRow[], req: Request) {
  const [settings, coords, contacts] = await Promise.all([getLetterSettings(), letterCoordinators(items), letterContacts(items)]);
  return items.map((l) => payload(l, req, settings, coords.get(l.id) ?? null, contacts.get(l.id) ?? null));
}

async function one(l: ExplanationLetterRow, req: Request) {
  const [settings, coords, contacts] = await Promise.all([getLetterSettings(), letterCoordinators([l]), letterContacts([l])]);
  return payload(l, req, settings, coords.get(l.id) ?? null, contacts.get(l.id) ?? null);
}

async function userName(id: number): Promise<string> {
  const { rows } = await pool.query(`SELECT full_name FROM users WHERE id = $1`, [id]);
  return String(rows[0]?.full_name || "Admin");
}

const cleanLine = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

async function loadOwnedOrManaged(req: AuthRequest, res: Response): Promise<ExplanationLetterRow | null> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Noto‘g‘ri ID" });
    return null;
  }
  const letter = await letterById(id);
  if (!letter) {
    res.status(404).json({ error: "Tushuntirish xati topilmadi" });
    return null;
  }
  if (letter.userId !== req.userId && !canManage(req.userRole)) {
    res.status(403).json({ error: "Bu xat sizga tegishli emas" });
    return null;
  }
  return letter;
}

router.get("/explanation-letters/reasons", requireAuth, (_req, res) => {
  res.json({ min: REASON_MIN, max: REASON_MAX, minWords: REASON_MIN_WORDS, finalStrike: FINAL_STRIKE, stages: LETTER_STAGES });
});

router.get("/explanation-letters/settings", requireAuth, async (_req, res): Promise<void> => {
  try {
    res.json(await getLetterSettings());
  } catch (err) {
    logLetterError(err, "settings");
    res.status(503).json({ error: "Sozlamalar yuklanmadi" });
  }
});

router.put("/explanation-letters/settings", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR uchun" });
    return;
  }
  const raw: unknown[] = Array.isArray(req.body?.headerLines) ? req.body.headerLines : [];
  const headerLines = raw.map((x) => cleanLine(x, 80)).filter(Boolean);
  const companyName = cleanLine(req.body?.companyName, 120);
  if (!headerLines.length) {
    res.status(400).json({ error: "Shapkaga kamida bitta qator yozing" });
    return;
  }
  if (headerLines.length > 4) {
    res.status(400).json({ error: "Shapka 4 qatordan oshmasin" });
    return;
  }
  if (companyName.length < 3) {
    res.status(400).json({ error: "Tashkilot nomini yozing" });
    return;
  }
  try {
    res.json(await saveLetterSettings({ headerLines, companyName }, await userName(req.userId!)));
  } catch (err) {
    logLetterError(err, "settings-save");
    res.status(503).json({ error: "Saqlanmadi" });
  }
});

router.get("/explanation-letters/my", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const items = await myLetters(req.userId!);
    const enabled = await isJarimaEnabled();
    res.json({
      items: await payloads(items, req),
      enabled,
      pending: enabled ? items.filter((l) => l.status !== "signed" && l.reviewStatus !== "cancelled").length : 0,
    });
  } catch (err) {
    logLetterError(err, "my");
    res.status(503).json({ error: "Tushuntirish xatlari yuklanmadi" });
  }
});

router.get("/explanation-letters", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR uchun" });
    return;
  }
  const month = monthParam(req.query.month);
  try {
    if (month === todayTashkent().slice(0, 7) || month === null) await freshDisciplineScan();
    const [items, months] = await Promise.all([lettersForMonth(month), letterMonths()]);
    res.json({
      month: month ?? "all",
      months,
      items: await payloads(items, req),
      totals: {
        all: items.length,
        signed: items.filter((l) => l.status === "signed").length,
        waiting: items.filter((l) => l.status !== "signed").length,
      },
    });
  } catch (err) {
    logLetterError(err, "list");
    res.status(503).json({ error: "Tushuntirish xatlari yuklanmadi" });
  }
});

/** Hujjat raqami yoki QR (havola / token) bo‘yicha bazadan tekshirish */
router.get("/explanation-letters/lookup", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR uchun" });
    return;
  }
  const raw = String(req.query.q || "").slice(0, 300).trim();
  const no = normalizeLetterNo(raw);
  const token = no ? null : tokenFromScan(raw);
  if (!no && !token) {
    res.status(400).json({ error: "Hujjat raqami 4 ta harf va 5 ta raqamdan iborat bo‘lishi kerak (masalan ABCD-12345) yoki xatdagi QR kodni skanerlang" });
    return;
  }
  try {
    const l = no ? await letterByNo(no) : await letterByToken(token!);
    if (l) {
      res.json({ found: true, by: no ? "number" : "qr", query: no ?? l.letterNo, letter: await one(l, req) });
      return;
    }
    const issued = no ? await issuedLetterNo(no) : null;
    res.json({ found: false, by: no ? "number" : "qr", query: no, deleted: Boolean(issued), issuedAt: issued?.issuedAt ?? null, isTest: issued?.isTest ?? false });
  } catch (err) {
    logLetterError(err, "lookup");
    res.status(503).json({ error: "Tekshirib bo‘lmadi" });
  }
});

/** Bir nechta xat — bitta PDF (har biri alohida varaq) */
router.get("/explanation-letters/bulk.pdf", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR uchun" });
    return;
  }
  try {
    const month = monthParam(req.query.month);
    const status = String(req.query.status || "signed");
    const ids = String(req.query.ids || "")
      .split(",")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    let items = await lettersForMonth(month);
    if (ids.length) items = items.filter((l) => ids.includes(l.id));
    else if (status === "signed") items = items.filter((l) => l.status === "signed");
    else if (status === "waiting") items = items.filter((l) => l.status !== "signed");
    items = items.slice(0, BULK_MAX);
    if (!items.length) {
      res.status(404).json({ error: "Yuklash uchun xat yo‘q" });
      return;
    }
    const merged = await PDFDocument.create();
    const origin = originOf(req);
    const settings = await getLetterSettings();
    for (const l of items) {
      const doc = await PDFDocument.load(await renderExplanationLetterPdf(letterContent(l, origin, settings), await letterImages(l.id)));
      for (const page of await merged.copyPages(doc, doc.getPageIndices())) merged.addPage(page);
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="tushuntirish_xatlari_${month ?? "barchasi"}.pdf"`,
    );
    res.send(Buffer.from(await merged.save()));
  } catch (err) {
    logLetterError(err, "bulk-pdf");
    res.status(503).json({ error: "PDF tayyorlanmadi" });
  }
});

// ---------------------------------------------------------------- 3 kunlik hisobot va o‘chirish

router.get("/explanation-letters/report", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR uchun" });
    return;
  }
  try {
    res.json(await reportSchedule());
  } catch (err) {
    logLetterError(err, "report-status");
    res.status(503).json({ error: "Hisobot holati yuklanmadi" });
  }
});

router.get("/explanation-letters/report.xlsx", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR uchun" });
    return;
  }
  try {
    const report = await buildExplanationReport();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${report.filename}"`);
    res.send(report.buffer);
  } catch (err) {
    logLetterError(err, "report-xlsx");
    res.status(503).json({ error: "Excel tayyorlanmadi" });
  }
});

router.post("/explanation-letters/report/send", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR uchun" });
    return;
  }
  try {
    const totals = await sendExplanationReport();
    void sendOriginalLetterPdfs().catch((err) => logLetterError(err, "report-pdfs"));
    res.json({ ok: true, totals });
  } catch (err) {
    logLetterError(err, "report-send");
    res.status(503).json({ error: err instanceof Error ? err.message : "Telegramga yuborilmadi" });
  }
});

/** Admin: bir nechta xatni tizimdan butunlay o‘chirish */
router.post("/explanation-letters/delete", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!hasFullPlatformAccess(req.userRole)) {
    res.status(403).json({ error: "Xatlarni faqat admin o‘chiradi" });
    return;
  }
  const ids: number[] = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).slice(0, 2000);
  if (!ids.length) {
    res.status(400).json({ error: "O‘chirish uchun xat tanlang" });
    return;
  }
  try {
    const result = await deleteLetters(ids, { id: req.userId!, name: await userName(req.userId!) });
    await resyncAfterLetterDelete(result.months).catch((err) => logLetterError(err, "delete-resync"));
    res.json({ ok: true, deleted: result.deleted });
  } catch (err) {
    logLetterError(err, "delete-bulk");
    res.status(503).json({ error: "O‘chirilmadi" });
  }
});

// ---------------------------------------------------------------- admin test

router.get("/explanation-letters/test", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR uchun" });
    return;
  }
  try {
    res.json({ items: await payloads(await testLetters(), req) });
  } catch (err) {
    logLetterError(err, "test-list");
    res.status(503).json({ error: "Test xatlari yuklanmadi" });
  }
});

router.get("/explanation-letters/test/users", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR uchun" });
    return;
  }
  try {
    res.json({ items: await letterUserOptions(String(req.query.q || "").slice(0, 60)) });
  } catch (err) {
    logLetterError(err, "test-users");
    res.status(503).json({ error: "Xodimlar yuklanmadi" });
  }
});

/** Davomat «Keldim» shu xodim uchun hozir bloklanadimi */
router.get("/explanation-letters/test/gate", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR uchun" });
    return;
  }
  const userId = Number(req.query.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(400).json({ error: "Xodim tanlanmagan" });
    return;
  }
  const block = await explanationPunchBlock(userId);
  res.json({ blocked: Boolean(block), block });
});

router.post("/explanation-letters/test", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR uchun" });
    return;
  }
  const userId = Number(req.body?.userId || req.userId);
  const kind = req.body?.kind === "absent" ? "absent" : "late";
  const strikeN = Math.round(Number(req.body?.strikeN) || 1);
  const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.eventDate || "")) ? String(req.body.eventDate) : todayTashkent();
  const lateMinutes = req.body?.lateMinutes == null ? null : Math.min(600, Math.max(1, Math.round(Number(req.body.lateMinutes) || 25)));
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(400).json({ error: "Xodim tanlanmagan" });
    return;
  }
  try {
    const out = await createTestLetter({ userId, kind, strikeN, eventDate, lateMinutes });
    if ("error" in out) {
      res.status(409).json({ error: out.error });
      return;
    }
    res.json(await one(out, req));
  } catch (err) {
    logLetterError(err, "test-create");
    res.status(503).json({ error: "Test xati yaratilmadi" });
  }
});

router.delete("/explanation-letters/test", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR uchun" });
    return;
  }
  const ids = String(req.query.ids || "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  try {
    res.json({ deleted: await deleteTestLetters(ids) });
  } catch (err) {
    logLetterError(err, "test-delete");
    res.status(503).json({ error: "O‘chirilmadi" });
  }
});

/** QR orqali ochiladi — kirish shart emas, faqat tasdiqlash uchun qisqa ma’lumot */
router.get("/explanation-letters/verify/:token", async (req, res): Promise<void> => {
  const token = String(req.params.token || "").slice(0, 80);
  try {
    const l = token ? await letterByToken(token) : null;
    if (!l) {
      res.status(404).json({ valid: false, error: "Hujjat topilmadi" });
      return;
    }
    res.json({
      valid: l.status === "signed",
      status: l.status,
      letterNo: l.letterNo,
      fullName: l.fullName,
      position: l.position,
      branch: l.branch,
      eventDate: l.eventDate,
      kind: l.kind,
      strikeN: l.strikeN,
      lateMinutes: l.lateMinutes,
      signedAt: l.signedAt,
      isTest: l.isTest,
      final: l.strikeN >= FINAL_STRIKE,
      reviewStatus: l.reviewStatus,
      pdf: l.status === "signed",
    });
  } catch (err) {
    logLetterError(err, "verify");
    res.status(503).json({ valid: false, error: "Tekshirib bo‘lmadi" });
  }
});

/** QR egasi imzolangan xatni yuklab oladi — token xatning o‘zi uchun kalit */
router.get("/explanation-letters/verify/:token/pdf", async (req, res): Promise<void> => {
  const token = String(req.params.token || "").slice(0, 80);
  try {
    const l = token ? await letterByToken(token) : null;
    if (!l || l.status !== "signed") {
      res.status(404).json({ error: "Imzolangan hujjat topilmadi" });
      return;
    }
    await sendLetterPdf(req, res, l);
  } catch (err) {
    logLetterError(err, "verify-pdf");
    res.status(503).json({ error: "PDF tayyorlanmadi" });
  }
});

router.get("/explanation-letters/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const l = await loadOwnedOrManaged(req, res);
    if (!l) return;
    const images = l.status === "signed" ? await letterImages(l.id) : { qr: null, signature: null };
    res.json({ ...(await one(l, req)), signaturePng: images.signature, qrPng: images.qr });
  } catch (err) {
    logLetterError(err, "get");
    res.status(503).json({ error: "Xat yuklanmadi" });
  }
});

router.get("/explanation-letters/:id/pdf", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const l = await loadOwnedOrManaged(req, res);
    if (!l) return;
    await sendLetterPdf(req, res, l);
  } catch (err) {
    logLetterError(err, "pdf");
    res.status(503).json({ error: "PDF tayyorlanmadi" });
  }
});

router.delete("/explanation-letters/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!hasFullPlatformAccess(req.userRole)) {
    res.status(403).json({ error: "Xatlarni faqat admin o‘chiradi" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Noto‘g‘ri ID" });
    return;
  }
  try {
    const result = await deleteLetters([id], { id: req.userId!, name: await userName(req.userId!) });
    if (!result.deleted) {
      res.status(404).json({ error: "Tushuntirish xati topilmadi" });
      return;
    }
    await resyncAfterLetterDelete(result.months).catch((err) => logLetterError(err, "delete-resync"));
    res.json({ ok: true, deleted: result.deleted });
  } catch (err) {
    logLetterError(err, "delete");
    res.status(503).json({ error: "O‘chirilmadi" });
  }
});

router.post("/explanation-letters/:id/confirm", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const l = await loadOwnedOrManaged(req, res);
    if (!l) return;
    if (l.userId !== req.userId) {
      res.status(403).json({ error: "Tushuntirish xatini faqat xodimning o‘zi tasdiqlaydi" });
      return;
    }
    if (l.status === "signed") {
      res.status(409).json({ error: "Xat allaqachon imzolangan" });
      return;
    }
    if (l.reviewStatus === "cancelled") {
      res.status(409).json({ error: "Bu xat rahbariyat tomonidan bekor qilingan" });
      return;
    }
    const text = String(req.body?.reasonText || "").trim().replace(/\s+/g, " ");
    const problem = reasonProblem(text);
    if (problem) {
      res.status(400).json({ error: problem });
      return;
    }
    const finalConsent = req.body?.finalConsent === true;
    if (l.strikeN >= FINAL_STRIKE && !finalConsent) {
      res.status(400).json({ error: "Oxirgi ogohlantirish: ishdan bo‘shatish sharti bilan roziligingizni belgilang" });
      return;
    }
    const saved = await confirmLetter(l.id, text, l.strikeN >= FINAL_STRIKE && finalConsent);
    res.json(saved ? await one(saved, req) : null);
  } catch (err) {
    logLetterError(err, "confirm");
    res.status(503).json({ error: "Tasdiqlanmadi" });
  }
});

router.post("/explanation-letters/:id/sign", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const l = await loadOwnedOrManaged(req, res);
    if (!l) return;
    if (l.userId !== req.userId) {
      res.status(403).json({ error: "Imzoni faqat xodimning o‘zi qo‘yadi" });
      return;
    }
    if (l.status !== "confirmed") {
      res.status(409).json({ error: l.status === "signed" ? "Xat allaqachon imzolangan" : "Avval xatni o‘qib tasdiqlang" });
      return;
    }
    const signature = req.body?.signature;
    const qr = req.body?.qr;
    if (!isPng(signature)) {
      res.status(400).json({ error: "Imzo topilmadi — qaytadan chizing" });
      return;
    }
    const ip = (req.get("x-forwarded-for") || req.socket.remoteAddress || "").split(",")[0]!.trim() || null;
    const saved = await signLetter(l.id, signature, isPng(qr) ? qr : null, { ip, ua: req.get("user-agent") || null });
    if (!saved) {
      res.status(409).json({ error: "Imzolanmadi — sahifani yangilang" });
      return;
    }
    res.json(await one(saved, req));
  } catch (err) {
    logLetterError(err, "sign");
    res.status(503).json({ error: "Imzolanmadi" });
  }
});

/** Rahbariyat qarori: tasdiqlash (jarima qoladi), bekor qilish (holat hisobdan chiqadi), qaytarish */
router.post("/explanation-letters/:id/review", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR uchun" });
    return;
  }
  try {
    const l = await loadOwnedOrManaged(req, res);
    if (!l) return;
    const action = String(req.body?.action || "");
    if (action !== "approve" && action !== "cancel" && action !== "reset") {
      res.status(400).json({ error: "Noto‘g‘ri amal" });
      return;
    }
    const note = cleanLine(req.body?.note, 500);
    if (action === "cancel" && note.length < 10) {
      res.status(400).json({ error: "Bekor qilish sababini yozing (kamida 10 belgi)" });
      return;
    }
    if (action === "approve" && l.status !== "signed") {
      res.status(409).json({ error: "Faqat imzolangan xat tasdiqlanadi" });
      return;
    }
    const saved = await reviewLetter(l.id, action, note || null, { id: req.userId!, name: await userName(req.userId!) });
    if (!l.isTest && (action === "cancel" || l.reviewStatus === "cancelled")) {
      void runDisciplineScan();
    }
    res.json(saved ? await one(saved, req) : null);
  } catch (err) {
    logLetterError(err, "review");
    res.status(503).json({ error: "Qaror saqlanmadi" });
  }
});

export default router;
