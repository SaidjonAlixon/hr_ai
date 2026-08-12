import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  tasksTable,
  usersTable,
  employeesTable,
  vacanciesTable,
  candidatesTable,
  phoneInterviewsTable,
  offlineInterviewsTable,
  onlineInterviewsTable,
  requestsTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { isHrDirektor, isHrOversight } from "../lib/roles";

const router: IRouter = Router();

router.get("/kuzatuv", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!isHrOversight(req.userRole) && req.userRole !== "admin") {
    res.status(403).json({ error: "Faqat HR Direktor yoki HR Auditor ko‘ra oladi" });
    return;
  }

  const full = isHrDirektor(req.userRole) || req.userRole === "admin";

  const recruiters = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      login: usersTable.login,
      status: usersTable.status,
    })
    .from(usersTable)
    .where(and(eq(usersTable.role, "recruiter"), eq(usersTable.status, "active")));

  const recruiterIds = recruiters.map((r) => r.id);

  const vacRows =
    recruiterIds.length > 0
      ? await db
          .select({
            recruiterId: vacanciesTable.recruiterId,
            status: vacanciesTable.status,
            count: sql<number>`count(*)::int`,
          })
          .from(vacanciesTable)
          .where(inArray(vacanciesTable.recruiterId, recruiterIds))
          .groupBy(vacanciesTable.recruiterId, vacanciesTable.status)
      : [];

  const candRows =
    recruiterIds.length > 0
      ? await db
          .select({
            recruiterId: candidatesTable.recruiterId,
            status: candidatesTable.status,
            count: sql<number>`count(*)::int`,
          })
          .from(candidatesTable)
          .where(inArray(candidatesTable.recruiterId, recruiterIds))
          .groupBy(candidatesTable.recruiterId, candidatesTable.status)
      : [];

  const phoneRows =
    recruiterIds.length > 0
      ? await db
          .select({
            recruiterId: phoneInterviewsTable.recruiterId,
            count: sql<number>`count(*)::int`,
          })
          .from(phoneInterviewsTable)
          .where(inArray(phoneInterviewsTable.recruiterId, recruiterIds))
          .groupBy(phoneInterviewsTable.recruiterId)
      : [];

  const offlineByHr =
    recruiterIds.length > 0
      ? await db
          .select({
            hrId: offlineInterviewsTable.hrId,
            count: sql<number>`count(*)::int`,
          })
          .from(offlineInterviewsTable)
          .where(inArray(offlineInterviewsTable.hrId, recruiterIds))
          .groupBy(offlineInterviewsTable.hrId)
      : [];

  const tasksByAssignee =
    recruiterIds.length > 0
      ? await db
          .select({
            assigneeId: tasksTable.assigneeId,
            status: tasksTable.status,
            count: sql<number>`count(*)::int`,
          })
          .from(tasksTable)
          .where(
            and(
              eq(tasksTable.assigneeKind, "user"),
              inArray(tasksTable.assigneeId, recruiterIds),
            ),
          )
          .groupBy(tasksTable.assigneeId, tasksTable.status)
      : [];

  const vacMap = new Map<number, { total: number; published: number; closed: number }>();
  for (const row of vacRows) {
    if (row.recruiterId == null) continue;
    const cur = vacMap.get(row.recruiterId) ?? { total: 0, published: 0, closed: 0 };
    cur.total += row.count;
    if (row.status === "published") cur.published += row.count;
    if (row.status === "closed") cur.closed += row.count;
    vacMap.set(row.recruiterId, cur);
  }

  const candMap = new Map<
    number,
    { active: number; hired: number; rejected: number; total: number }
  >();
  for (const row of candRows) {
    if (row.recruiterId == null) continue;
    const cur = candMap.get(row.recruiterId) ?? {
      active: 0,
      hired: 0,
      rejected: 0,
      total: 0,
    };
    cur.total += row.count;
    if (row.status === "active") cur.active += row.count;
    if (row.status === "hired") cur.hired += row.count;
    if (row.status === "rejected") cur.rejected += row.count;
    candMap.set(row.recruiterId, cur);
  }

  const phoneMap = new Map(phoneRows.map((r) => [r.recruiterId ?? 0, r.count]));
  const offlineMap = new Map(offlineByHr.map((r) => [r.hrId ?? 0, r.count]));

  const taskMap = new Map<number, { open: number; done: number; total: number }>();
  for (const row of tasksByAssignee) {
    const cur = taskMap.get(row.assigneeId) ?? { open: 0, done: 0, total: 0 };
    cur.total += row.count;
    if (row.status === "done" || row.status === "verified") cur.done += row.count;
    else if (row.status !== "cancelled") cur.open += row.count;
    taskMap.set(row.assigneeId, cur);
  }

  const recruiterStats = recruiters.map((r) => {
    const vac = vacMap.get(r.id) ?? { total: 0, published: 0, closed: 0 };
    const cand = candMap.get(r.id) ?? { active: 0, hired: 0, rejected: 0, total: 0 };
    const tasks = taskMap.get(r.id) ?? { open: 0, done: 0, total: 0 };
    const base = {
      id: r.id,
      fullName: r.fullName,
      vacanciesTotal: vac.total,
      vacanciesPublished: vac.published,
      candidatesActive: cand.active,
      candidatesHired: cand.hired,
      phoneInterviews: phoneMap.get(r.id) ?? 0,
      tasksOpen: tasks.open,
      tasksDone: tasks.done,
    };
    if (!full) return base;
    return {
      ...base,
      login: r.login,
      vacanciesClosed: vac.closed,
      candidatesRejected: cand.rejected,
      candidatesTotal: cand.total,
      offlineInterviews: offlineMap.get(r.id) ?? 0,
      tasksTotal: tasks.total,
    };
  });

  const [openReqs] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(requestsTable)
    .where(sql`status NOT IN ('closed')`);

  const [activeVacs] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(vacanciesTable)
    .where(eq(vacanciesTable.status, "published"));

  const [activeCands] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(candidatesTable)
    .where(eq(candidatesTable.status, "active"));

  const [hiredCands] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(candidatesTable)
    .where(eq(candidatesTable.status, "hired"));

  const [phoneTotal] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(phoneInterviewsTable);

  const [onlineTotal] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(onlineInterviewsTable);

  const [offlineTotal] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(offlineInterviewsTable);

  const [tasksOpen] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasksTable)
    .where(sql`status NOT IN ('done', 'verified', 'cancelled')`);

  const [tasksDone] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasksTable)
    .where(sql`status IN ('done', 'verified')`);

  const taskRows = await db
    .select()
    .from(tasksTable)
    .orderBy(desc(tasksTable.updatedAt))
    .limit(full ? 80 : 25);

  const userIds = new Set<number>();
  for (const t of taskRows) {
    userIds.add(t.createdById);
    if (t.assigneeKind === "user") userIds.add(t.assigneeId);
  }
  const idList = [...userIds];
  const userNameRows =
    idList.length > 0
      ? await db
          .select({ id: usersTable.id, fullName: usersTable.fullName })
          .from(usersTable)
          .where(inArray(usersTable.id, idList))
      : [];
  const nameById = new Map(userNameRows.map((u) => [u.id, u.fullName]));

  const empIds = [
    ...new Set(
      taskRows.filter((t) => t.assigneeKind === "employee").map((t) => t.assigneeId),
    ),
  ];
  const empRows =
    empIds.length > 0
      ? await db
          .select({ id: employeesTable.id, fullName: employeesTable.fullName })
          .from(employeesTable)
          .where(inArray(employeesTable.id, empIds))
      : [];
  const empNameById = new Map(empRows.map((e) => [e.id, e.fullName]));

  const tasks = taskRows.map((t) => {
    const assigneeName =
      t.assigneeKind === "employee"
        ? empNameById.get(t.assigneeId) ?? "—"
        : nameById.get(t.assigneeId) ?? "—";
    const base = {
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueAt: t.dueAt ? t.dueAt.toISOString() : null,
      assigneeName,
      assigneeKind: t.assigneeKind,
      createdByName: nameById.get(t.createdById) ?? "—",
      updatedAt: t.updatedAt.toISOString(),
    };
    if (!full) return base;
    return {
      ...base,
      description: t.description,
      completedAt: t.completedAt ? t.completedAt.toISOString() : null,
      completionNote: t.completionNote,
      createdAt: t.createdAt.toISOString(),
    };
  });

  const pipeline =
    full
      ? await db
          .select({
            stage: candidatesTable.stage,
            count: sql<number>`count(*)::int`,
          })
          .from(candidatesTable)
          .where(eq(candidatesTable.status, "active"))
          .groupBy(candidatesTable.stage)
      : [];

  res.json({
    level: full ? "full" : "summary",
    summary: {
      openRequests: openReqs?.count ?? 0,
      activeVacancies: activeVacs?.count ?? 0,
      activeCandidates: activeCands?.count ?? 0,
      hiredCandidates: hiredCands?.count ?? 0,
      phoneInterviews: phoneTotal?.count ?? 0,
      onlineInterviews: full ? (onlineTotal?.count ?? 0) : undefined,
      offlineInterviews: full ? (offlineTotal?.count ?? 0) : undefined,
      tasksOpen: tasksOpen?.count ?? 0,
      tasksDone: tasksDone?.count ?? 0,
      recruitersCount: recruiters.length,
    },
    recruiters: recruiterStats.sort(
      (a, b) => b.vacanciesPublished + b.phoneInterviews - (a.vacanciesPublished + a.phoneInterviews),
    ),
    tasks,
    pipeline: full
      ? pipeline.map((p) => ({ stage: p.stage || "noma'lum", count: p.count }))
      : undefined,
  });
});

export default router;
