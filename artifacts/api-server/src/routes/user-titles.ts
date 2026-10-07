import { Router, type IRouter, type Response } from "express";
import { desc, eq, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  departmentsTable,
  userTitlesTable,
  userTitleHistoryTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { canManageUsers, isDeptHeadRole } from "../lib/roles";
import { notifyUser } from "../lib/notify";

const router: IRouter = Router();

const EMPLOYEE_TITLES = ["faol", "ishonchli", "professional", "premium", "rivojlanish"] as const;
type EmployeeTitle = (typeof EMPLOYEE_TITLES)[number];

const TITLE_LABELS: Record<EmployeeTitle, string> = {
  faol: "FAOL",
  ishonchli: "ISHONCHLI",
  professional: "PROFESSIONAL",
  premium: "PREMIUM",
  rivojlanish: "MAS’ULIYATSIZ",
};

const LEADER_EXCLUDED = new Set(["distrib_hr"]);
const LEADER_TOP = new Set([
  "asoschi",
  "director",
  "direktor_yordamchisi",
  "hr_direktor",
  "hr_menejer",
  "hr_kadr_rahbar",
]);

/** Rahbarlar avtomatik PRO belgisiga ega — ularga xodim unvoni berilmaydi. */
function isLeaderRole(role?: string | null): boolean {
  const r = (role ?? "").trim().toLowerCase();
  if (!r || LEADER_EXCLUDED.has(r)) return false;
  return LEADER_TOP.has(r) || isDeptHeadRole(r);
}

const PRO_TIERS = ["founder", "director", "hr", "lead", "master"] as const;
type ProTier = (typeof PRO_TIERS)[number];

const PRO_TIER_LABELS: Record<ProTier, string> = {
  founder: "PRO · Asoschi",
  director: "PRO · Rahbariyat",
  hr: "PRO · HR rahbariyati",
  lead: "PRO · Bo‘lim boshlig‘i",
  master: "PRO · Xodim",
};

function isProTier(v: unknown): v is ProTier {
  return typeof v === "string" && (PRO_TIERS as readonly string[]).includes(v);
}

function isEmployeeTitle(v: unknown): v is EmployeeTitle {
  return typeof v === "string" && (EMPLOYEE_TITLES as readonly string[]).includes(v);
}

function requireAdmin(req: AuthRequest, res: Response): boolean {
  if (!canManageUsers(req.userRole)) {
    res.status(403).json({ error: "Unvonlarni faqat admin boshqaradi" });
    return false;
  }
  return true;
}

function cleanNote(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, 500);
  return s || null;
}

async function actorName(userId?: number): Promise<string | null> {
  if (!userId) return null;
  const [u] = await db
    .select({ fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return u?.fullName ?? null;
}

/** Barcha foydalanuvchilar uchun: belgini to‘g‘ri ko‘rsatish xaritasi. */
router.get("/titles/map", requireAuth, async (_req: AuthRequest, res): Promise<void> => {
  const rows = await db
    .select({
      userId: userTitlesTable.userId,
      title: userTitlesTable.title,
      proHidden: userTitlesTable.proHidden,
      proTier: userTitlesTable.proTier,
    })
    .from(userTitlesTable);
  const map: Record<number, { title: string | null; proHidden: boolean; proTier: string | null }> = {};
  for (const r of rows) {
    const proTier = isProTier(r.proTier) ? r.proTier : null;
    if (!r.title && !r.proHidden && !proTier) continue;
    map[r.userId] = { title: r.title, proHidden: r.proHidden, proTier };
  }
  res.json({ titles: map });
});

router.get("/titles/admin", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const users = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      role: usersTable.role,
      status: usersTable.status,
      departmentId: usersTable.departmentId,
      departmentName: departmentsTable.name,
    })
    .from(usersTable)
    .leftJoin(departmentsTable, eq(departmentsTable.id, usersTable.departmentId))
    .where(inArray(usersTable.status, ["active", "on_leave"]));

  const titles = await db.select().from(userTitlesTable);
  const byUser = new Map(titles.map((t) => [t.userId, t]));
  const assignerIds = [...new Set(titles.map((t) => t.assignedById).filter((x): x is number => !!x))];
  const assigners = assignerIds.length
    ? await db
        .select({ id: usersTable.id, fullName: usersTable.fullName })
        .from(usersTable)
        .where(inArray(usersTable.id, assignerIds))
    : [];
  const assignerName = new Map(assigners.map((a) => [a.id, a.fullName]));

  const people = users
    .filter((u) => (u.role ?? "").toLowerCase() !== "admin")
    .map((u) => {
      const t = byUser.get(u.id);
      return {
        userId: u.id,
        fullName: u.fullName,
        role: u.role,
        status: u.status,
        departmentId: u.departmentId,
        departmentName: u.departmentName ?? null,
        isLeader: isLeaderRole(u.role),
        title: t?.title ?? null,
        note: t?.note ?? null,
        proHidden: t?.proHidden ?? false,
        proNote: t?.proNote ?? null,
        proTier: isProTier(t?.proTier) ? t.proTier : null,
        assignedAt: t?.assignedAt ?? null,
        assignedByName: t?.assignedById ? assignerName.get(t.assignedById) ?? null : null,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  res.json({ people });
});

router.put("/titles/:userId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const userId = Number(req.params.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    res.status(400).json({ error: "Noto‘g‘ri foydalanuvchi" });
    return;
  }
  const raw: unknown = (req.body ?? {}).title;
  if (raw != null && raw !== "" && !isEmployeeTitle(raw)) {
    res.status(400).json({ error: "Noma’lum unvon" });
    return;
  }
  const title: EmployeeTitle | null = isEmployeeTitle(raw) ? raw : null;
  const note = cleanNote((req.body ?? {}).note);

  const [target] = await db
    .select({ id: usersTable.id, role: usersTable.role, fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Foydalanuvchi topilmadi" });
    return;
  }
  if (title && isLeaderRole(target.role)) {
    res.status(400).json({ error: "Rahbarlarga xodim unvoni berilmaydi — ularda PRO belgisi bor" });
    return;
  }

  const [prev] = await db
    .select()
    .from(userTitlesTable)
    .where(eq(userTitlesTable.userId, userId))
    .limit(1);
  if (title && isProTier(prev?.proTier)) {
    res.status(400).json({ error: "Bu xodimda PRO belgisi bor — avval PRO’dan chiqaring" });
    return;
  }
  const prevTitle = prev?.title ?? null;
  const now = new Date();

  await db
    .insert(userTitlesTable)
    .values({
      userId,
      title,
      note: title ? note : null,
      assignedById: title ? req.userId ?? null : null,
      assignedAt: title ? now : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userTitlesTable.userId,
      set: {
        title,
        note: title ? note : null,
        assignedById: title ? req.userId ?? null : null,
        assignedAt: title ? now : null,
        updatedAt: now,
      },
    });

  await db.insert(userTitleHistoryTable).values({
    userId,
    action: title ? "assign" : "remove",
    title,
    prevTitle,
    note,
    actorId: req.userId ?? null,
    actorName: await actorName(req.userId),
  });

  if (title && title !== prevTitle) {
    const label = TITLE_LABELS[title];
    const text =
      title === "rivojlanish"
        ? `Sizga «${label}» ogohlantirish belgisi berildi.${note ? ` Sabab: ${note}.` : ""} Xulqingiz tuzalsa, belgi olib tashlanadi.`
        : `Tabriklaymiz! Sizga «${label}» unvoni berildi.${note ? ` Izoh: ${note}` : ""}`;
    void notifyUser({
      userId,
      title: title === "rivojlanish" ? "Ogohlantirish belgisi" : "Yangi unvon",
      text,
      type: "title",
      linkUrl: "/",
    }).catch(() => {});
  }

  res.json({ ok: true });
});

router.put("/titles/:userId/pro", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const userId = Number(req.params.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    res.status(400).json({ error: "Noto‘g‘ri foydalanuvchi" });
    return;
  }
  const hidden = !!(req.body ?? {}).hidden;
  const note = cleanNote((req.body ?? {}).note);
  const now = new Date();

  await db
    .insert(userTitlesTable)
    .values({ userId, proHidden: hidden, proNote: hidden ? note : null, updatedAt: now })
    .onConflictDoUpdate({
      target: userTitlesTable.userId,
      set: { proHidden: hidden, proNote: hidden ? note : null, updatedAt: now },
    });

  await db.insert(userTitleHistoryTable).values({
    userId,
    action: hidden ? "pro_hide" : "pro_show",
    title: "pro",
    note,
    actorId: req.userId ?? null,
    actorName: await actorName(req.userId),
  });

  res.json({ ok: true });
});

/** PRO berish / turini o‘zgartirish (tier) yoki admin bergan PRO’ni olib tashlash (tier: null). */
router.put("/titles/:userId/pro-tier", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const userId = Number(req.params.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    res.status(400).json({ error: "Noto‘g‘ri foydalanuvchi" });
    return;
  }
  const raw: unknown = (req.body ?? {}).tier;
  if (raw != null && raw !== "" && !isProTier(raw)) {
    res.status(400).json({ error: "Noma’lum PRO turi" });
    return;
  }
  const tier: ProTier | null = isProTier(raw) ? raw : null;
  const note = cleanNote((req.body ?? {}).note);

  const [target] = await db
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Foydalanuvchi topilmadi" });
    return;
  }
  if ((target.role ?? "").toLowerCase() === "admin") {
    res.status(400).json({ error: "Adminga PRO berilmaydi" });
    return;
  }

  const [prev] = await db
    .select({ proTier: userTitlesTable.proTier })
    .from(userTitlesTable)
    .where(eq(userTitlesTable.userId, userId))
    .limit(1);
  const prevTier = isProTier(prev?.proTier) ? prev.proTier : null;
  const now = new Date();

  const set = tier
    ? { proTier: tier, proHidden: false, proNote: null, title: null, note: null, updatedAt: now }
    : { proTier: null, updatedAt: now };
  await db
    .insert(userTitlesTable)
    .values({ userId, ...set })
    .onConflictDoUpdate({ target: userTitlesTable.userId, set });

  await db.insert(userTitleHistoryTable).values({
    userId,
    action: tier ? "pro_grant" : "pro_revoke",
    title: tier,
    prevTitle: prevTier,
    note,
    actorId: req.userId ?? null,
    actorName: await actorName(req.userId),
  });

  if (tier && tier !== prevTier) {
    void notifyUser({
      userId,
      title: "PRO belgisi",
      text: `Tabriklaymiz! Sizga «${PRO_TIER_LABELS[tier]}» belgisi berildi.${note ? ` Izoh: ${note}` : ""}`,
      type: "title",
      linkUrl: "/",
    }).catch(() => {});
  }

  res.json({ ok: true });
});

router.get("/titles/history", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const rows = await db
    .select({
      id: userTitleHistoryTable.id,
      userId: userTitleHistoryTable.userId,
      action: userTitleHistoryTable.action,
      title: userTitleHistoryTable.title,
      prevTitle: userTitleHistoryTable.prevTitle,
      note: userTitleHistoryTable.note,
      actorName: userTitleHistoryTable.actorName,
      createdAt: userTitleHistoryTable.createdAt,
      fullName: usersTable.fullName,
      role: usersTable.role,
    })
    .from(userTitleHistoryTable)
    .leftJoin(usersTable, eq(usersTable.id, userTitleHistoryTable.userId))
    .orderBy(desc(userTitleHistoryTable.createdAt))
    .limit(300);
  res.json({ history: rows });
});

export default router;
