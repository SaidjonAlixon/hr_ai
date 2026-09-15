import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, tasksTable, candidatesTable } from "@workspace/db";
import { HR_ROLES } from "./roles";

/** Offline / yakuniy / ishga qabul — shu HR rollariga (legacy) */
export const PIPELINE_HR_ROLES = [...HR_ROLES] as const;

/** Shu nomzod + bosqichdagi ochiq pipeline vazifalarini yopish */
export async function completePipelineStageTasks(opts: {
  candidateId: number;
  stage: string;
  status?: "done" | "cancelled" | "verified";
}): Promise<void> {
  const status = opts.status ?? "done";
  const open = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.candidateId, opts.candidateId),
        eq(tasksTable.pipelineStage, opts.stage),
        inArray(tasksTable.status, ["todo", "in_progress"]),
      ),
    );
  if (!open.length) return;
  const now = new Date();
  await db
    .update(tasksTable)
    .set({
      status,
      completedAt: status === "cancelled" ? null : now,
      updatedAt: now,
    })
    .where(
      inArray(
        tasksTable.id,
        open.map((r) => r.id),
      ),
    );
}

/**
 * Pipeline topshirig‘i yaratish o‘chirilgan.
 * Nomzod qadamlari Topshiriqlar doskasiga tushmasligi kerak —
 * faqat Topshiriqlar modulida qo‘lda yaratilgan vazifalar ko‘rinadi.
 */
export async function createPipelineTasks(_opts: {
  candidateId: number;
  candidateName: string;
  stage: string;
  createdById: number;
  roles?: string[];
  userIds?: number[];
  dueAt?: Date | null;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: string;
  extraNote?: string;
}): Promise<number[]> {
  return [];
}

export async function assignOfflineInterviewToHrs(opts: {
  candidateId: number;
  candidateName: string;
  createdById: number;
  scheduledDate: string;
  scheduledTime?: string | null;
}): Promise<void> {
  await createPipelineTasks({
    candidateId: opts.candidateId,
    candidateName: opts.candidateName,
    stage: "offline_interview",
    createdById: opts.createdById,
    roles: [...PIPELINE_HR_ROLES],
    dueDate: opts.scheduledDate,
    dueTime: opts.scheduledTime,
    priority: "urgent",
  });
}

export async function assignFinalDecisionToHrs(opts: {
  candidateId: number;
  candidateName: string;
  createdById: number;
}): Promise<void> {
  await completePipelineStageTasks({
    candidateId: opts.candidateId,
    stage: "offline_interview",
  });
  await createPipelineTasks({
    candidateId: opts.candidateId,
    candidateName: opts.candidateName,
    stage: "final_decision",
    createdById: opts.createdById,
    roles: [...PIPELINE_HR_ROLES],
    priority: "high",
  });
}

export async function assignOfferToRecruiter(opts: {
  candidateId: number;
  candidateName: string;
  recruiterId: number | null | undefined;
  createdById: number;
}): Promise<void> {
  await completePipelineStageTasks({
    candidateId: opts.candidateId,
    stage: "final_decision",
  });
  if (!opts.recruiterId) return;
  await createPipelineTasks({
    candidateId: opts.candidateId,
    candidateName: opts.candidateName,
    stage: "offer",
    createdById: opts.createdById,
    userIds: [opts.recruiterId],
    priority: "high",
  });
}

export async function assignDocumentsToRecruiter(opts: {
  candidateId: number;
  candidateName: string;
  recruiterId: number | null | undefined;
  createdById: number;
}): Promise<void> {
  await completePipelineStageTasks({
    candidateId: opts.candidateId,
    stage: "offer",
  });
  if (!opts.recruiterId) return;
  await createPipelineTasks({
    candidateId: opts.candidateId,
    candidateName: opts.candidateName,
    stage: "documents",
    createdById: opts.createdById,
    userIds: [opts.recruiterId],
    priority: "high",
  });
}

export async function assignInternshipToTrainers(opts: {
  candidateId: number;
  candidateName: string;
  createdById: number;
  trainerId?: number | null;
}): Promise<void> {
  await completePipelineStageTasks({
    candidateId: opts.candidateId,
    stage: "documents",
  });
  if (opts.trainerId) {
    await createPipelineTasks({
      candidateId: opts.candidateId,
      candidateName: opts.candidateName,
      stage: "internship",
      createdById: opts.createdById,
      userIds: [opts.trainerId],
      priority: "high",
    });
    return;
  }
  await createPipelineTasks({
    candidateId: opts.candidateId,
    candidateName: opts.candidateName,
    stage: "internship",
    createdById: opts.createdById,
    roles: ["trainer"],
    priority: "high",
  });
}

export async function assignHireToHrs(opts: {
  candidateId: number;
  candidateName: string;
  createdById: number;
}): Promise<void> {
  await completePipelineStageTasks({
    candidateId: opts.candidateId,
    stage: "internship",
  });
  await createPipelineTasks({
    candidateId: opts.candidateId,
    candidateName: opts.candidateName,
    stage: "hired",
    createdById: opts.createdById,
    roles: [...PIPELINE_HR_ROLES],
    priority: "urgent",
  });
}

export async function getCandidateBrief(candidateId: number) {
  const [row] = await db
    .select({
      id: candidatesTable.id,
      fullName: candidatesTable.fullName,
      recruiterId: candidatesTable.recruiterId,
    })
    .from(candidatesTable)
    .where(eq(candidatesTable.id, candidateId))
    .limit(1);
  return row ?? null;
}

/** Rejected bo‘lsa ochiq pipeline vazifalarini bekor qilish */
export async function cancelOpenPipelineTasks(candidateId: number): Promise<void> {
  await db
    .update(tasksTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(tasksTable.candidateId, candidateId),
        isNotNull(tasksTable.pipelineStage),
        inArray(tasksTable.status, ["todo", "in_progress"]),
      ),
    );
}

/** Barcha ochiq nomzod-qadam topshiriqlarini yopish */
export async function cancelAllOpenPipelineTasks(): Promise<number> {
  const open = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(
      and(
        isNotNull(tasksTable.pipelineStage),
        inArray(tasksTable.status, ["todo", "in_progress"]),
      ),
    );
  if (!open.length) return 0;
  await db
    .update(tasksTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      inArray(
        tasksTable.id,
        open.map((r) => r.id),
      ),
    );
  return open.length;
}
