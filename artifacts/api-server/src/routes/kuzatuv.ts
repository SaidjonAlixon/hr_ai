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
      assigneeId: t.assigneeKind === "user" ? t.assigneeId : null,
      assigneeName,
      assigneeKind: t.assigneeKind,
      createdById: t.createdById,
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

const VAC_STATUS: Record<string, string> = {
  draft: "Qoralama",
  published: "Faol",
  closed: "Yopilgan / Bajarildi",
};
const CAND_STATUS: Record<string, string> = {
  active: "Faol",
  hired: "Ishga olingan",
  rejected: "Rad etilgan",
};
const STAGE_UZ: Record<string, string> = {
  phone_interview: "Tanishuv",
  online_interview: "Onlayn suhbat",
  preboarding: "Pre-boarding",
  offline_interview: "Offline suhbat",
  final_decision: "Yakuniy qaror",
  offer: "Job offer",
  documents: "Hujjatlar",
  internship: "Stajirovka",
  hired: "Ishga qabul",
};
const TASK_STATUS: Record<string, string> = {
  todo: "Yangi",
  in_progress: "Jarayonda",
  done: "Bajarildi",
  verified: "Tasdiqlangan",
  cancelled: "Bekor",
};
const PHONE_STATUS: Record<string, string> = {
  pending: "Kutilmoqda",
  suitable: "Mos",
  not_suitable: "Mos emas",
};

router.get("/kuzatuv/person/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!isHrOversight(req.userRole) && req.userRole !== "admin") {
    res.status(403).json({ error: "Faqat HR Direktor yoki HR Auditor ko‘ra oladi" });
    return;
  }

  const full = isHrDirektor(req.userRole) || req.userRole === "admin";
  const personId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (!personId || Number.isNaN(personId)) {
    res.status(400).json({ error: "Noto‘g‘ri ID" });
    return;
  }

  const [person] = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      login: usersTable.login,
      role: usersTable.role,
      status: usersTable.status,
      phone: usersTable.phone,
    })
    .from(usersTable)
    .where(eq(usersTable.id, personId));

  if (!person) {
    res.status(404).json({ error: "Foydalanuvchi topilmadi" });
    return;
  }

  const vacancies = await db
    .select({
      id: vacanciesTable.id,
      title: vacanciesTable.title,
      status: vacanciesTable.status,
      location: vacanciesTable.location,
      deadline: vacanciesTable.deadline,
      publishedAt: vacanciesTable.publishedAt,
      assignedAt: vacanciesTable.assignedAt,
      acceptedAt: vacanciesTable.acceptedAt,
      createdAt: vacanciesTable.createdAt,
    })
    .from(vacanciesTable)
    .where(eq(vacanciesTable.recruiterId, personId))
    .orderBy(desc(vacanciesTable.updatedAt));

  const candidates = await db
    .select({
      id: candidatesTable.id,
      fullName: candidatesTable.fullName,
      phone: candidatesTable.phone,
      stage: candidatesTable.stage,
      status: candidatesTable.status,
      vacancyId: candidatesTable.vacancyId,
      createdAt: candidatesTable.createdAt,
      updatedAt: candidatesTable.updatedAt,
    })
    .from(candidatesTable)
    .where(eq(candidatesTable.recruiterId, personId))
    .orderBy(desc(candidatesTable.updatedAt));

  const candIds = candidates.map((c) => c.id);
  const vacTitleById = new Map(vacancies.map((v) => [v.id, v.title]));
  // titles for candidates whose vacancy not in list
  const missingVacIds = [
    ...new Set(candidates.map((c) => c.vacancyId).filter((id) => !vacTitleById.has(id))),
  ];
  if (missingVacIds.length) {
    const extraVacs = await db
      .select({ id: vacanciesTable.id, title: vacanciesTable.title })
      .from(vacanciesTable)
      .where(inArray(vacanciesTable.id, missingVacIds));
    for (const v of extraVacs) vacTitleById.set(v.id, v.title);
  }

  const phoneInterviews = await db
    .select({
      id: phoneInterviewsTable.id,
      candidateId: phoneInterviewsTable.candidateId,
      interviewDate: phoneInterviewsTable.interviewDate,
      status: phoneInterviewsTable.status,
      notes: phoneInterviewsTable.notes,
      rejectReason: phoneInterviewsTable.rejectReason,
      createdAt: phoneInterviewsTable.createdAt,
    })
    .from(phoneInterviewsTable)
    .where(eq(phoneInterviewsTable.recruiterId, personId))
    .orderBy(desc(phoneInterviewsTable.updatedAt));

  const onlineInterviews =
    candIds.length > 0
      ? await db
          .select({
            id: onlineInterviewsTable.id,
            candidateId: onlineInterviewsTable.candidateId,
            interviewDate: onlineInterviewsTable.interviewDate,
            score: onlineInterviewsTable.score,
            experienceLevel: onlineInterviewsTable.experienceLevel,
            notes: onlineInterviewsTable.notes,
            createdAt: onlineInterviewsTable.createdAt,
          })
          .from(onlineInterviewsTable)
          .where(inArray(onlineInterviewsTable.candidateId, candIds))
          .orderBy(desc(onlineInterviewsTable.updatedAt))
      : [];

  const offlineAsHr = await db
    .select({
      id: offlineInterviewsTable.id,
      candidateId: offlineInterviewsTable.candidateId,
      scheduledDate: offlineInterviewsTable.scheduledDate,
      scheduledTime: offlineInterviewsTable.scheduledTime,
      attendanceStatus: offlineInterviewsTable.attendanceStatus,
      result: offlineInterviewsTable.result,
      hrScore: offlineInterviewsTable.hrScore,
      trainerScore: offlineInterviewsTable.trainerScore,
      resultNotes: offlineInterviewsTable.resultNotes,
      createdAt: offlineInterviewsTable.createdAt,
    })
    .from(offlineInterviewsTable)
    .where(eq(offlineInterviewsTable.hrId, personId))
    .orderBy(desc(offlineInterviewsTable.updatedAt));

  const offlineAsTrainer = await db
    .select({
      id: offlineInterviewsTable.id,
      candidateId: offlineInterviewsTable.candidateId,
      scheduledDate: offlineInterviewsTable.scheduledDate,
      scheduledTime: offlineInterviewsTable.scheduledTime,
      attendanceStatus: offlineInterviewsTable.attendanceStatus,
      result: offlineInterviewsTable.result,
      hrScore: offlineInterviewsTable.hrScore,
      trainerScore: offlineInterviewsTable.trainerScore,
      resultNotes: offlineInterviewsTable.resultNotes,
      createdAt: offlineInterviewsTable.createdAt,
    })
    .from(offlineInterviewsTable)
    .where(eq(offlineInterviewsTable.trainerId, personId))
    .orderBy(desc(offlineInterviewsTable.updatedAt));

  const nameByCand = new Map(candidates.map((c) => [c.id, c.fullName]));
  const extraCandIds = [
    ...new Set(
      [
        ...phoneInterviews.map((p) => p.candidateId),
        ...onlineInterviews.map((o) => o.candidateId),
        ...offlineAsHr.map((o) => o.candidateId),
        ...offlineAsTrainer.map((o) => o.candidateId),
      ].filter((id) => !nameByCand.has(id)),
    ),
  ];
  if (extraCandIds.length) {
    const extra = await db
      .select({ id: candidatesTable.id, fullName: candidatesTable.fullName })
      .from(candidatesTable)
      .where(inArray(candidatesTable.id, extraCandIds));
    for (const c of extra) nameByCand.set(c.id, c.fullName);
  }

  const assignedTasks = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.assigneeKind, "user"), eq(tasksTable.assigneeId, personId)))
    .orderBy(desc(tasksTable.updatedAt));

  const createdTasks = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.createdById, personId))
    .orderBy(desc(tasksTable.updatedAt));

  const taskUserIds = new Set<number>();
  for (const t of [...assignedTasks, ...createdTasks]) {
    taskUserIds.add(t.createdById);
    if (t.assigneeKind === "user") taskUserIds.add(t.assigneeId);
  }
  const taskUsers =
    taskUserIds.size > 0
      ? await db
          .select({ id: usersTable.id, fullName: usersTable.fullName })
          .from(usersTable)
          .where(inArray(usersTable.id, [...taskUserIds]))
      : [];
  const taskNameById = new Map(taskUsers.map((u) => [u.id, u.fullName]));

  const mapTask = (t: typeof tasksTable.$inferSelect) => ({
    id: t.id,
    title: t.title,
    description: full ? t.description : undefined,
    status: t.status,
    statusLabel: TASK_STATUS[t.status] || t.status,
    priority: t.priority,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    assigneeName: taskNameById.get(t.assigneeId) ?? "—",
    createdByName: taskNameById.get(t.createdById) ?? "—",
    completionNote: full ? t.completionNote : undefined,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    acceptedAt: t.acceptedAt ? t.acceptedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  });

  const tasksAssigned = assignedTasks.map(mapTask);
  const tasksCreated = createdTasks
    .filter((t) => !(t.assigneeKind === "user" && t.assigneeId === personId))
    .map(mapTask);

  const summary = {
    vacanciesTotal: vacancies.length,
    vacanciesPublished: vacancies.filter((v) => v.status === "published").length,
    vacanciesClosed: vacancies.filter((v) => v.status === "closed").length,
    vacanciesDraft: vacancies.filter((v) => v.status === "draft").length,
    candidatesTotal: candidates.length,
    candidatesActive: candidates.filter((c) => c.status === "active").length,
    candidatesHired: candidates.filter((c) => c.status === "hired").length,
    candidatesRejected: candidates.filter((c) => c.status === "rejected").length,
    phoneInterviews: phoneInterviews.length,
    onlineInterviews: onlineInterviews.length,
    offlineInterviews: offlineAsHr.length + offlineAsTrainer.length,
    tasksAssignedOpen: assignedTasks.filter(
      (t) => !["done", "verified", "cancelled"].includes(t.status),
    ).length,
    tasksAssignedDone: assignedTasks.filter((t) =>
      ["done", "verified"].includes(t.status),
    ).length,
    tasksCreated: createdTasks.length,
  };

  res.json({
    level: full ? "full" : "summary",
    person: {
      id: person.id,
      fullName: person.fullName,
      login: full ? person.login : undefined,
      role: person.role,
      status: person.status,
      phone: full ? person.phone : undefined,
    },
    summary,
    vacancies: vacancies.map((v) => ({
      id: v.id,
      title: v.title,
      status: v.status,
      statusLabel: VAC_STATUS[v.status] || v.status,
      location: v.location,
      deadline: v.deadline ? v.deadline.toISOString() : null,
      publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
      assignedAt: v.assignedAt ? v.assignedAt.toISOString() : null,
      acceptedAt: v.acceptedAt ? v.acceptedAt.toISOString() : null,
      createdAt: v.createdAt.toISOString(),
    })),
    candidates: candidates.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      phone: full ? c.phone : undefined,
      stage: c.stage,
      stageLabel: STAGE_UZ[c.stage] || c.stage,
      status: c.status,
      statusLabel: CAND_STATUS[c.status] || c.status,
      vacancyTitle: vacTitleById.get(c.vacancyId) ?? `Vakansiya #${c.vacancyId}`,
      vacancyId: c.vacancyId,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
    phoneInterviews: phoneInterviews.map((p) => ({
      id: p.id,
      candidateName: nameByCand.get(p.candidateId) ?? `Nomzod #${p.candidateId}`,
      candidateId: p.candidateId,
      interviewDate: p.interviewDate,
      status: p.status,
      statusLabel: PHONE_STATUS[p.status] || p.status,
      notes: full ? p.notes : undefined,
      rejectReason: full ? p.rejectReason : undefined,
      createdAt: p.createdAt.toISOString(),
    })),
    onlineInterviews: onlineInterviews.map((o) => ({
      id: o.id,
      candidateName: nameByCand.get(o.candidateId) ?? `Nomzod #${o.candidateId}`,
      candidateId: o.candidateId,
      interviewDate: o.interviewDate,
      score: o.score,
      experienceLevel: o.experienceLevel,
      notes: full ? o.notes : undefined,
      createdAt: o.createdAt.toISOString(),
    })),
    offlineInterviews: [
      ...offlineAsHr.map((o) => ({
        id: o.id,
        roleInInterview: "hr" as const,
        candidateName: nameByCand.get(o.candidateId) ?? `Nomzod #${o.candidateId}`,
        candidateId: o.candidateId,
        scheduledDate: o.scheduledDate,
        scheduledTime: o.scheduledTime,
        attendanceStatus: o.attendanceStatus,
        result: o.result,
        hrScore: o.hrScore,
        trainerScore: full ? o.trainerScore : undefined,
        resultNotes: full ? o.resultNotes : undefined,
        createdAt: o.createdAt.toISOString(),
      })),
      ...offlineAsTrainer.map((o) => ({
        id: o.id,
        roleInInterview: "trainer" as const,
        candidateName: nameByCand.get(o.candidateId) ?? `Nomzod #${o.candidateId}`,
        candidateId: o.candidateId,
        scheduledDate: o.scheduledDate,
        scheduledTime: o.scheduledTime,
        attendanceStatus: o.attendanceStatus,
        result: o.result,
        hrScore: full ? o.hrScore : undefined,
        trainerScore: o.trainerScore,
        resultNotes: full ? o.resultNotes : undefined,
        createdAt: o.createdAt.toISOString(),
      })),
    ],
    tasksAssigned,
    tasksCreated,
  });
});

export default router;
