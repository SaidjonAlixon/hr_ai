import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, userGoalsTable, goalDailyLogsTable } from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

/** Topshiriq egalari + bo‘lim boshlig‘i */
export const GOAL_ROLES = new Set([
  "admin",
  "hr",
  "director",
  "department_head",
  "recruiter",
  "trainer",
  "mudir",
  "koordinator",
  "texnik",
  "ombor",
]);

function requireGoalRole(req: AuthRequest, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  if (!req.userRole || !GOAL_ROLES.has(req.userRole)) {
    res.status(403).json({ error: "Bu bo‘lim sizga ochiq emas" });
    return false;
  }
  return true;
}

function todayLocalYmd(offsetMinutes = 5 * 60) {
  // Default Asia/Tashkent UTC+5 — client can override with ?date=
  const now = new Date();
  const local = new Date(now.getTime() + offsetMinutes * 60_000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function getActiveGoal(userId: number) {
  const [goal] = await db
    .select()
    .from(userGoalsTable)
    .where(and(eq(userGoalsTable.userId, userId), eq(userGoalsTable.status, "active")))
    .orderBy(desc(userGoalsTable.createdAt))
    .limit(1);
  return goal ?? null;
}

router.get("/goals/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireGoalRole(req, res)) return;
  const userId = req.userId!;
  const workDate = String(req.query.date || todayLocalYmd());
  const goal = await getActiveGoal(userId);

  const logs = goal
    ? await db
        .select()
        .from(goalDailyLogsTable)
        .where(eq(goalDailyLogsTable.userId, userId))
        .orderBy(desc(goalDailyLogsTable.workDate))
        .limit(60)
    : [];

  const todayLog = logs.find((l) => String(l.workDate) === workDate) ?? null;

  res.json({
    goal,
    todayLog,
    workDate,
    todaySubmitted: !!todayLog,
    logs,
  });
});

router.put("/goals/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireGoalRole(req, res)) return;
  const userId = req.userId!;
  const { title, description } = req.body ?? {};
  if (!title || !String(title).trim()) {
    res.status(400).json({ error: "Oliy maqsad sarlavhasi majburiy" });
    return;
  }

  const existing = await getActiveGoal(userId);
  if (existing) {
    const [updated] = await db
      .update(userGoalsTable)
      .set({
        title: String(title).trim(),
        description: description != null ? String(description) : null,
        updatedAt: new Date(),
      })
      .where(eq(userGoalsTable.id, existing.id))
      .returning();
    res.json(updated);
    return;
  }

  const [created] = await db
    .insert(userGoalsTable)
    .values({
      userId,
      title: String(title).trim(),
      description: description != null ? String(description) : null,
      status: "active",
    })
    .returning();
  res.status(201).json(created);
});

router.post("/goals/me/daily", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireGoalRole(req, res)) return;
  const userId = req.userId!;
  const { content, workDate: rawDate } = req.body ?? {};
  if (!content || !String(content).trim()) {
    res.status(400).json({ error: "Bugun nima qilganingizni yozing" });
    return;
  }

  let goal = await getActiveGoal(userId);
  if (!goal) {
    res.status(400).json({ error: "Avval oliy maqsadni belgilang" });
    return;
  }

  const workDate = rawDate ? String(rawDate) : todayLocalYmd();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    res.status(400).json({ error: "Sana noto‘g‘ri" });
    return;
  }

  const [existing] = await db
    .select()
    .from(goalDailyLogsTable)
    .where(and(eq(goalDailyLogsTable.userId, userId), eq(goalDailyLogsTable.workDate, workDate)));

  if (existing) {
    const [updated] = await db
      .update(goalDailyLogsTable)
      .set({
        content: String(content).trim(),
        goalId: goal.id,
        updatedAt: new Date(),
      })
      .where(eq(goalDailyLogsTable.id, existing.id))
      .returning();
    res.json(updated);
    return;
  }

  const [created] = await db
    .insert(goalDailyLogsTable)
    .values({
      goalId: goal.id,
      userId,
      workDate,
      content: String(content).trim(),
    })
    .returning();
  res.status(201).json(created);
});

router.get("/goals/me/prompt-status", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!GOAL_ROLES.has(req.userRole || "")) {
    res.json({ eligible: false, mustPrompt: false });
    return;
  }
  const userId = req.userId!;
  const workDate = String(req.query.date || todayLocalYmd());
  const goal = await getActiveGoal(userId);
  const [todayLog] = await db
    .select({ id: goalDailyLogsTable.id })
    .from(goalDailyLogsTable)
    .where(and(eq(goalDailyLogsTable.userId, userId), eq(goalDailyLogsTable.workDate, workDate)))
    .limit(1);

  res.json({
    eligible: true,
    workDate,
    hasGoal: !!goal,
    goal,
    todaySubmitted: !!todayLog,
    mustPrompt: !todayLog,
  });
});

export default router;
