import { Router, type IRouter, type Request, type Response } from "express";
import ExcelJS from "exceljs";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { hasFullPlatformAccess } from "../lib/roles";
import { sendWorkbook } from "../lib/cred-excel";
import {
  CRITERIA,
  CRITERIA_LABEL,
  DISH_CATEGORIES,
  TAGS,
  approveMenu,
  canManageAbetMenu,
  canViewAbetAnalytics,
  cleanMenuItems,
  cleanRating,
  dayAnalytics,
  exportRatings,
  isOfficeRole,
  isYmd,
  menuFor,
  menusBetween,
  myRating,
  qrToken,
  qrUrl,
  rangeAnalytics,
  rateWindow,
  rotateQrToken,
  saveMenu,
  tokenFromScan,
  upsertRating,
} from "../lib/abet";

const router: IRouter = Router();

function originOf(req: Request): string {
  const origin = req.get("origin");
  if (origin) return origin;
  const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0]!.trim();
  return `${proto}://${req.get("x-forwarded-host") || req.get("host")}`;
}

function shiftDay(ymd: string, delta: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function fail(res: Response, err: unknown, fallback: string) {
  const msg = err instanceof Error && err.message ? err.message : fallback;
  res.status(400).json({ error: msg });
}

router.get("/abet/today", requireAuth, async (req: AuthRequest, res) => {
  try {
    const win = rateWindow();
    const role = req.userRole;
    const canMenu = canManageAbetMenu(role);
    const [menu, mine] = await Promise.all([menuFor(win.day), myRating(win.day, req.userId!)]);
    res.json({
      window: win,
      menu: menu && (menu.status === "approved" || canMenu) ? menu : null,
      myRating: mine,
      canRate: isOfficeRole(role),
      canManageMenu: canMenu,
      canViewAnalytics: canViewAbetAnalytics(role),
      categories: DISH_CATEGORIES,
      criteria: CRITERIA.map((key) => ({ key, label: CRITERIA_LABEL[key] })),
      tags: TAGS,
    });
  } catch (err) {
    fail(res, err, "Abet ma’lumotini olib bo‘lmadi");
  }
});

router.post("/abet/rate", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!isOfficeRole(req.userRole)) {
      res.status(403).json({ error: "Abetni faqat ofis xodimlari baholaydi" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const win = rateWindow();
    if (body.day != null && body.day !== win.day) {
      res.status(400).json({ error: "Faqat bugungi abetni baholash mumkin" });
      return;
    }
    if (win.state !== "open") {
      res.status(400).json({
        error:
          win.state === "before"
            ? `Baholash ${win.opensAt} da ochiladi`
            : `Baholash vaqti tugadi (${win.opensAt}–${win.closesAt})`,
        code: "WINDOW_CLOSED",
      });
      return;
    }
    let source: "qr" | "app" = "app";
    if (body.qr) {
      const token = tokenFromScan(body.qr);
      if (!token || token !== (await qrToken())) {
        res.status(400).json({ error: "QR kod noto‘g‘ri yoki eskirgan. Oshxonadagi QR kodni skaner qiling", code: "BAD_QR" });
        return;
      }
      source = "qr";
    }
    const menu = await menuFor(win.day);
    const input = cleanRating(body, menu?.status === "approved" ? menu : null);
    if (typeof input === "string") {
      res.status(400).json({ error: input });
      return;
    }
    const rating = await upsertRating(win.day, req.userId!, input, source);
    res.json({ ok: true, rating });
  } catch (err) {
    fail(res, err, "Baho saqlanmadi");
  }
});

router.post("/abet/qr/check", requireAuth, async (req: AuthRequest, res) => {
  try {
    const token = tokenFromScan((req.body as { qr?: unknown })?.qr);
    res.json({ valid: !!token && token === (await qrToken()) });
  } catch (err) {
    fail(res, err, "QR tekshirilmadi");
  }
});

router.get("/abet/menus", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!canManageAbetMenu(req.userRole) && !canViewAbetAnalytics(req.userRole)) {
      res.status(403).json({ error: "Ruxsat yo‘q" });
      return;
    }
    const today = rateWindow().day;
    const from = isYmd(req.query.from) ? req.query.from : shiftDay(today, -14);
    const to = isYmd(req.query.to) ? req.query.to : shiftDay(today, 14);
    res.json({ today, items: await menusBetween(from, to) });
  } catch (err) {
    fail(res, err, "Menyular olinmadi");
  }
});

function menuDayGuard(req: AuthRequest, res: Response): string | null {
  if (!canManageAbetMenu(req.userRole)) {
    res.status(403).json({ error: "Menyuni faqat oshpazlar kiritadi" });
    return null;
  }
  const day = String(req.params.day ?? "");
  if (!isYmd(day)) {
    res.status(400).json({ error: "Sana noto‘g‘ri" });
    return null;
  }
  const today = rateWindow().day;
  if (day < today && !hasFullPlatformAccess(req.userRole)) {
    res.status(400).json({ error: "O‘tgan kun menyusini o‘zgartirib bo‘lmaydi" });
    return null;
  }
  if (day > shiftDay(today, 30)) {
    res.status(400).json({ error: "Menyu ko‘pi bilan 30 kun oldinga kiritiladi" });
    return null;
  }
  return day;
}

router.put("/abet/menu/:day", requireAuth, async (req: AuthRequest, res) => {
  try {
    const day = menuDayGuard(req, res);
    if (!day) return;
    const body = (req.body ?? {}) as { items?: unknown; note?: unknown };
    const items = cleanMenuItems(body.items);
    if (!items.length) {
      res.status(400).json({ error: "Kamida bitta taom kiriting" });
      return;
    }
    const note = String(body.note ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || null;
    res.json({ menu: await saveMenu(day, items, note, req.userId!) });
  } catch (err) {
    fail(res, err, "Menyu saqlanmadi");
  }
});

router.post("/abet/menu/:day/approve", requireAuth, async (req: AuthRequest, res) => {
  try {
    const day = menuDayGuard(req, res);
    if (!day) return;
    res.json(await approveMenu(day, req.userId!));
  } catch (err) {
    fail(res, err, "Menyu tasdiqlanmadi");
  }
});

function analyticsGuard(req: AuthRequest, res: Response): boolean {
  if (canViewAbetAnalytics(req.userRole)) return true;
  res.status(403).json({ error: "Abet tahlili faqat admin va HR uchun" });
  return false;
}

router.get("/abet/analytics/day", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!analyticsGuard(req, res)) return;
    const day = isYmd(req.query.day) ? req.query.day : rateWindow().day;
    res.json(await dayAnalytics(day));
  } catch (err) {
    fail(res, err, "Tahlil olinmadi");
  }
});

router.get("/abet/analytics/range", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!analyticsGuard(req, res)) return;
    const today = rateWindow().day;
    const to = isYmd(req.query.to) ? req.query.to : today;
    const from = isYmd(req.query.from) ? req.query.from : shiftDay(to, -29);
    if (from > to) {
      res.status(400).json({ error: "Sana oralig‘i noto‘g‘ri" });
      return;
    }
    res.json(await rangeAnalytics(from, to));
  } catch (err) {
    fail(res, err, "Tahlil olinmadi");
  }
});

router.get("/abet/export", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!analyticsGuard(req, res)) return;
    const today = rateWindow().day;
    const to = isYmd(req.query.to) ? req.query.to : today;
    const from = isYmd(req.query.from) ? req.query.from : to;
    const { menus, ratings } = await exportRatings(from, to);

    const wb = new ExcelJS.Workbook();
    const head = (ws: ExcelJS.Worksheet) => {
      const row = ws.getRow(1);
      row.font = { bold: true, color: { argb: "FFFFFFFF" } };
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
      row.alignment = { vertical: "middle", wrapText: true };
      ws.views = [{ state: "frozen", ySplit: 1 }];
    };

    const byDay = new Map<string, typeof ratings>();
    for (const r of ratings) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
    const summary = wb.addWorksheet("Kunlar");
    summary.columns = [
      { header: "Sana", key: "day", width: 12 },
      { header: "Menyu", key: "menu", width: 50 },
      { header: "Holat", key: "status", width: 12 },
      { header: "Baholaganlar", key: "count", width: 13 },
      { header: "O‘rtacha baho", key: "avg", width: 13 },
      ...[5, 4, 3, 2, 1].map((s) => ({ header: `${s}★`, key: `s${s}`, width: 7 })),
    ];
    const days = [...new Set([...menus.map((m) => m.day), ...byDay.keys()])].sort((a, b) => b.localeCompare(a));
    for (const day of days) {
      const m = menus.find((x) => x.day === day);
      const rs = byDay.get(day) ?? [];
      const row: Record<string, unknown> = {
        day,
        menu: (m?.items ?? []).map((i) => i.name).join(", "),
        status: m ? (m.status === "approved" ? "Tasdiqlangan" : "Qoralama") : "—",
        count: rs.length,
        avg: rs.length ? Math.round((rs.reduce((s, r) => s + r.overall, 0) / rs.length) * 100) / 100 : null,
      };
      for (const s of [5, 4, 3, 2, 1]) row[`s${s}`] = rs.filter((r) => r.overall === s).length;
      summary.addRow(row);
    }
    head(summary);

    const detail = wb.addWorksheet("Baholar");
    detail.columns = [
      { header: "Sana", key: "day", width: 12 },
      { header: "Vaqt", key: "time", width: 8 },
      { header: "Xodim", key: "name", width: 30 },
      { header: "Bo‘lim", key: "dept", width: 22 },
      { header: "Umumiy", key: "overall", width: 9 },
      ...CRITERIA.map((c) => ({ header: CRITERIA_LABEL[c], key: c, width: 10 })),
      { header: "Taomlar bahosi", key: "dishes", width: 40 },
      { header: "Belgilar", key: "tags", width: 30 },
      { header: "Izoh", key: "comment", width: 50 },
      { header: "Usul", key: "source", width: 8 },
    ];
    for (const r of ratings) {
      const row: Record<string, unknown> = {
        day: r.day,
        time: new Date(r.createdAt).toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" }),
        name: r.fullName,
        dept: r.department ?? "",
        overall: r.overall,
        dishes: Object.entries(r.dishes).map(([n, s]) => `${n}: ${s}`).join("; "),
        tags: r.tags.join(", "),
        comment: r.comment ?? "",
        source: r.source === "qr" ? "QR" : "Ilova",
      };
      for (const c of CRITERIA) row[c] = r.criteria[c] ?? null;
      detail.addRow(row);
    }
    head(detail);

    await sendWorkbook(res, wb, from === to ? `abet_${from}.xlsx` : `abet_${from}_${to}.xlsx`);
  } catch (err) {
    fail(res, err, "Excel tayyorlanmadi");
  }
});

router.get("/abet/qr", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!analyticsGuard(req, res)) return;
    const token = await qrToken();
    res.json({ token, url: qrUrl(token, originOf(req)) });
  } catch (err) {
    fail(res, err, "QR olinmadi");
  }
});

router.post("/abet/qr/rotate", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!analyticsGuard(req, res)) return;
    const token = await rotateQrToken();
    res.json({ token, url: qrUrl(token, originOf(req)) });
  } catch (err) {
    fail(res, err, "QR yangilanmadi");
  }
});

export default router;
