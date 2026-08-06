import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  preboardingsTable,
  candidatesTable,
  offlineInterviewsTable,
} from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import { ensureCanManageCandidate, isRecruiterScoped } from "../lib/candidate-access";
import { notifyActiveHrs, notifyUser } from "../lib/notify";

const router: IRouter = Router();

router.get("/preboarding", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { candidateId } = req.query as Record<string, string>;
  const conditions = [];
  if (candidateId) conditions.push(eq(preboardingsTable.candidateId, parseInt(candidateId, 10)));
  if (isRecruiterScoped(req.userRole) && req.userId) {
    conditions.push(eq(candidatesTable.recruiterId, req.userId));
  }

  const baseQuery = db
    .select({
      id: preboardingsTable.id,
      candidateId: preboardingsTable.candidateId,
      checklist: preboardingsTable.checklist,
      notes: preboardingsTable.notes,
      completedAt: preboardingsTable.completedAt,
      createdAt: preboardingsTable.createdAt,
    })
    .from(preboardingsTable)
    .leftJoin(candidatesTable, eq(preboardingsTable.candidateId, candidatesTable.id));

  const rows = conditions.length
    ? await baseQuery.where(and(...conditions))
    : await baseQuery;
  res.json(rows);
});

router.post("/preboarding", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { candidateId, checklist, notes } = req.body ?? {};
  if (!candidateId) { res.status(400).json({ error: "candidateId kerak" }); return; }

  const candId = parseInt(candidateId, 10);
  const allowed = await ensureCanManageCandidate(req, res, candId);
  if (!allowed) return;

  const defaultChecklist = [
    { label: "Lavozim vazifalari bilan tanishtirish", completed: false },
    { label: "Ish tartibi va qoidalar", completed: false },
    { label: "Kompaniya qadriyatlari", completed: false },
    { label: "Xavfsizlik qoidalari", completed: false },
    { label: "Jamoaviy tuzilma", completed: false },
  ];

  const [created] = await db
    .insert(preboardingsTable)
    .values({
      candidateId: candId,
      checklist: checklist ?? defaultChecklist,
      notes: notes ?? null,
    })
    .returning();

  await db.update(candidatesTable)
    .set({ stage: "offline_interview" })
    .where(eq(candidatesTable.id, candId));

  const [candidate] = await db
    .select({ fullName: candidatesTable.fullName, recruiterId: candidatesTable.recruiterId })
    .from(candidatesTable)
    .where(eq(candidatesTable.id, candId));

  // Suhbatlarda chiqishi uchun kutayotgan offline yozuvi
  const existingOffline = await db
    .select({ id: offlineInterviewsTable.id })
    .from(offlineInterviewsTable)
    .where(eq(offlineInterviewsTable.candidateId, candId));

  if (existingOffline.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    await db.insert(offlineInterviewsTable).values({
      candidateId: candId,
      scheduledDate: today,
      scheduledTime: null,
      attendanceStatus: "pending",
      result: null,
    });
  }

  const linkUrl = `/candidates/${candId}/offline-interview`;
  const text = `Offline suhbat navbati: "${candidate?.fullName ?? "Nomzod"}". Pre-boarding tugadi — suhbatni rejalashtiring.`;

  await notifyActiveHrs({
    text,
    type: "interview_reminder",
    linkUrl,
  });
  await notifyUser({
    userId: candidate?.recruiterId,
    text,
    type: "interview_reminder",
    linkUrl,
  });

  res.status(201).json(created);
});

router.patch("/preboarding/:id", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const allowed = ["checklist", "notes", "completedAt"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  const [updated] = await db.update(preboardingsTable).set(updates).where(eq(preboardingsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Topilmadi" }); return; }
  res.json(updated);
});

export default router;
