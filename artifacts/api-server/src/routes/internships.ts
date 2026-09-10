import { Router, type IRouter } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import {
  db,
  internshipsTable,
  employeesTable,
  usersTable,
  kirishProgressTable,
  type KirishStagesMap,
} from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import { canManageSettings, isHrRole } from "../lib/roles";
import { KIRISH_PASS_SCORE, KIRISH_STAGE_COUNT, KIRISH_STAGES } from "../lib/kirish-content";

const router: IRouter = Router();

function canViewStajirovkalar(role?: string | null) {
  return (
    canManageSettings(role) ||
    isHrRole(role) ||
    role === "director" ||
    role === "koordinator" ||
    role === "mudir" ||
    role === "trainer" ||
    role === "mentor"
  );
}

type StageState = {
  videoDone: boolean;
  slidesDone: boolean;
  score: number | null;
  attempts: number;
  passed: boolean;
  passedAt: string | null;
};

function emptyStage(): StageState {
  return {
    videoDone: false,
    slidesDone: false,
    score: null,
    attempts: 0,
    passed: false,
    passedAt: null,
  };
}

function ensureStagesMap(raw: KirishStagesMap | null | undefined): Record<string, StageState> {
  const map: Record<string, StageState> = { ...(raw || {}) };
  for (let i = 1; i <= KIRISH_STAGE_COUNT; i++) {
    const key = String(i);
    if (!map[key]) map[key] = emptyStage();
  }
  return map;
}

function stageTitle(n: number) {
  return KIRISH_STAGES.find((s) => s.stage === n)?.title || `${n}-bosqich`;
}

/** Stajyorlar + Kirish o‘quv progressi (faqat stajyor roli) */
router.get("/internships/roster", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canViewStajirovkalar(req.userRole)) {
    res.status(403).json({ error: "Stajirovkalar ro‘yxatini ko‘rish ruxsati yo‘q" });
    return;
  }

  try {
    const stajyors = await db
      .select({
        id: usersTable.id,
        fullName: usersTable.fullName,
        phone: usersTable.phone,
        login: usersTable.login,
        status: usersTable.status,
        departmentId: usersTable.departmentId,
      })
      .from(usersTable)
      .where(eq(usersTable.role, "stajyor"))
      .orderBy(asc(usersTable.fullName));

    const userIds = stajyors.map((u) => u.id);
    const empRows = userIds.length
      ? await db
          .select({
            id: employeesTable.id,
            userId: employeesTable.userId,
            position: employeesTable.position,
            location: employeesTable.location,
            employmentStatus: employeesTable.employmentStatus,
            hiredAt: employeesTable.hiredAt,
            reportsToId: employeesTable.reportsToId,
          })
          .from(employeesTable)
          .where(inArray(employeesTable.userId, userIds))
      : [];

    const empByUser = new Map<number, (typeof empRows)[0]>();
    for (const e of empRows) {
      if (e.userId != null && !empByUser.has(e.userId)) empByUser.set(e.userId, e);
    }

    const empIds = [...empByUser.values()].map((e) => e.id);
    const internshipRows = empIds.length
      ? await db.select().from(internshipsTable).where(inArray(internshipsTable.employeeId, empIds))
      : [];
    const internshipByEmp = new Map<number, (typeof internshipRows)[0]>();
    for (const row of internshipRows) {
      const prev = internshipByEmp.get(row.employeeId);
      if (!prev || (prev.createdAt?.getTime?.() ?? 0) < (row.createdAt?.getTime?.() ?? 0)) {
        internshipByEmp.set(row.employeeId, row);
      }
    }

    const progressRows = userIds.length
      ? await db.select().from(kirishProgressTable).where(inArray(kirishProgressTable.userId, userIds))
      : [];
    const progressByUser = new Map(progressRows.map((p) => [p.userId, p]));

    const managerIds = [
      ...new Set(
        [...empByUser.values()]
          .map((e) => e.reportsToId)
          .filter((id): id is number => id != null),
      ),
    ];
    const managers = managerIds.length
      ? await db
          .select({ id: employeesTable.id, fullName: employeesTable.fullName, location: employeesTable.location })
          .from(employeesTable)
          .where(inArray(employeesTable.id, managerIds))
      : [];
    const managerById = new Map(managers.map((m) => [m.id, m]));

    const items = stajyors.map((u) => {
      const emp = empByUser.get(u.id) ?? null;
      const progress = progressByUser.get(u.id);
      const stagesMap = ensureStagesMap(progress?.stagesJson as KirishStagesMap | undefined);
      const stageDetails = Array.from({ length: KIRISH_STAGE_COUNT }, (_, i) => {
        const n = i + 1;
        const st = stagesMap[String(n)] || emptyStage();
        return {
          stage: n,
          title: stageTitle(n),
          score: st.score,
          attempts: st.attempts,
          passed: Boolean(st.passed),
          videoDone: Boolean(st.videoDone),
          slidesDone: Boolean(st.slidesDone),
          passedAt: st.passedAt,
        };
      });

      const testsAttempted = stageDetails.filter((s) => s.attempts > 0 || s.score != null).length;
      const testsPassed = stageDetails.filter((s) => s.passed).length;
      const scores = stageDetails.map((s) => s.score).filter((s): s is number => s != null);
      const avgScore =
        scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
      const currentStage = progress?.currentStage ?? 1;
      const progressPct = Math.round((testsPassed / KIRISH_STAGE_COUNT) * 100);
      const kirishStatus = progress?.status ?? "not_started";
      const internship = emp ? internshipByEmp.get(emp.id) ?? null : null;
      const mgr = emp?.reportsToId != null ? managerById.get(emp.reportsToId) : null;

      return {
        userId: u.id,
        fullName: u.fullName,
        phone: u.phone,
        login: u.login,
        userStatus: u.status,
        employeeId: emp?.id ?? null,
        position: emp?.position ?? "Stajyor",
        location: emp?.location || mgr?.location || null,
        mudirName: mgr?.fullName ?? null,
        employmentStatus: emp?.employmentStatus ?? null,
        hiredAt: emp?.hiredAt ?? null,
        kirish: {
          currentStage,
          status: kirishStatus,
          stageCount: KIRISH_STAGE_COUNT,
          passScore: KIRISH_PASS_SCORE,
          testsAttempted,
          testsPassed,
          testsTotal: KIRISH_STAGE_COUNT,
          avgScore,
          progressPct,
          stages: stageDetails,
          completedAt: progress?.completedAt ? progress.completedAt.toISOString() : null,
        },
        internship: internship
          ? {
              id: internship.id,
              status: internship.status,
              startDate: internship.startDate,
              endDate: internship.endDate,
            }
          : null,
      };
    });

    const summary = {
      total: items.length,
      inProgress: items.filter((i) => i.kirish.status === "in_progress" || i.kirish.status === "not_started").length,
      ready: items.filter((i) => i.kirish.status === "ready_for_hire").length,
      hired: items.filter((i) => i.kirish.status === "hired").length,
      avgProgress:
        items.length > 0
          ? Math.round(items.reduce((s, i) => s + i.kirish.progressPct, 0) / items.length)
          : 0,
    };

    res.json({ summary, items, stageCount: KIRISH_STAGE_COUNT, passScore: KIRISH_PASS_SCORE });
  } catch (err) {
    console.error("GET /internships/roster error:", err);
    res.status(503).json({ error: "Stajyorlar ro‘yxati yuklanmadi" });
  }
});

router.get("/internships", async (req, res): Promise<void> => {
  const { employeeId, trainerId, status } = req.query as Record<string, string>;

  const rows = await db.select().from(internshipsTable).orderBy(internshipsTable.createdAt);
  const filtered = rows.filter((r) => {
    if (employeeId && r.employeeId !== parseInt(employeeId, 10)) return false;
    if (trainerId && r.trainerId !== parseInt(trainerId, 10)) return false;
    if (status && r.status !== status) return false;
    return true;
  });

  const enriched = await Promise.all(
    filtered.map(async (r) => {
      const [emp] = await db
        .select({ fullName: employeesTable.fullName })
        .from(employeesTable)
        .where(eq(employeesTable.id, r.employeeId));
      const [trainer] = r.trainerId
        ? await db
            .select({ fullName: usersTable.fullName })
            .from(usersTable)
            .where(eq(usersTable.id, r.trainerId))
        : [null];
      return {
        ...r,
        employeeName: emp?.fullName ?? null,
        trainerName: trainer?.fullName ?? null,
      };
    }),
  );

  res.json(enriched);
});

router.post("/internships", async (req, res): Promise<void> => {
  const { employeeId, trainerId, startDate, endDate, tasks } = req.body ?? {};
  if (!employeeId || !startDate) {
    res.status(400).json({ error: "Majburiy maydonlar to'ldirilmagan" });
    return;
  }

  const [created] = await db
    .insert(internshipsTable)
    .values({
      employeeId: parseInt(employeeId, 10),
      trainerId: trainerId ? parseInt(trainerId, 10) : null,
      startDate,
      endDate: endDate ?? null,
      tasks: tasks ?? [],
      evaluations: [],
      status: "ongoing",
    })
    .returning();

  const [emp] = await db
    .select({ fullName: employeesTable.fullName })
    .from(employeesTable)
    .where(eq(employeesTable.id, parseInt(employeeId, 10)));
  res.status(201).json({ ...created, employeeName: emp?.fullName ?? null, trainerName: null });
});

router.get("/internships/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(String(rawId ?? ""), 10);
  if (!Number.isFinite(id)) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  const [row] = await db.select().from(internshipsTable).where(eq(internshipsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  const [emp] = await db
    .select({ fullName: employeesTable.fullName })
    .from(employeesTable)
    .where(eq(employeesTable.id, row.employeeId));
  const [trainer] = row.trainerId
    ? await db.select({ fullName: usersTable.fullName }).from(usersTable).where(eq(usersTable.id, row.trainerId))
    : [null];
  res.json({ ...row, employeeName: emp?.fullName ?? null, trainerName: trainer?.fullName ?? null });
});

router.patch("/internships/:id", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const allowed = ["trainerId", "endDate", "tasks", "evaluations", "status"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  const [existing] = await db.select().from(internshipsTable).where(eq(internshipsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }

  const [updated] = await db.update(internshipsTable).set(updates).where(eq(internshipsTable.id, id)).returning();
  if (!updated) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }

  if (updates.status === "completed") {
    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, existing.employeeId));
    if (emp?.candidateId) {
      const { candidatesTable } = await import("@workspace/db");
      await db
        .update(candidatesTable)
        .set({ stage: "hired", status: "hired" })
        .where(eq(candidatesTable.id, emp.candidateId));
      const { resolveStaffingHireByCandidateId } = await import("../lib/staffing-alert");
      await resolveStaffingHireByCandidateId(emp.candidateId);
      const [cand] = await db
        .select({ fullName: candidatesTable.fullName })
        .from(candidatesTable)
        .where(eq(candidatesTable.id, emp.candidateId));
      const { assignHireToHrs } = await import("../lib/pipeline-tasks");
      await assignHireToHrs({
        candidateId: emp.candidateId,
        candidateName: cand?.fullName ?? emp.fullName ?? "Nomzod",
        createdById: (req as AuthRequest).userId ?? existing.trainerId ?? 1,
      });
    }
  }

  res.json({ ...updated, employeeName: null, trainerName: null });
});

export default router;
