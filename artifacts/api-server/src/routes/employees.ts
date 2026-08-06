import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, employeesTable, departmentsTable, usersTable, candidatesTable } from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import { syncStaffingAlertForEmployee } from "../lib/staffing-alert";

const router: IRouter = Router();

const VALID_EMP_STATUS = new Set(["working", "new", "dismissed", "need_hire", "searching"]);

const FULL_NETWORK_ROLES = new Set([
  "admin",
  "hr",
  "director",
  "recruiter",
  "koordinator",
  "department_head",
]);

async function enrichEmployee(r: typeof employeesTable.$inferSelect) {
  const [dept] = await db
    .select({ name: departmentsTable.name })
    .from(departmentsTable)
    .where(eq(departmentsTable.id, r.departmentId));
  const [mentor] = r.mentorId
    ? await db.select({ fullName: usersTable.fullName }).from(usersTable).where(eq(usersTable.id, r.mentorId))
    : [null];
  return {
    ...r,
    departmentName: dept?.name ?? null,
    mentorName: mentor?.fullName ?? null,
  };
}

router.get("/employees", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { departmentId, mentorId, search } = req.query as Record<string, string>;
  const role = req.userRole ?? "";
  const userId = req.userId;

  const rows = await db.select().from(employeesTable).orderBy(employeesTable.createdAt);
  let filtered = rows.filter((r) => {
    if (departmentId && r.departmentId !== parseInt(departmentId, 10)) return false;
    if (mentorId && r.mentorId !== parseInt(mentorId, 10)) return false;
    if (search && !r.fullName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Mudir: o‘z koordinatorini + o‘z filiali (o‘zi + farmatsevtlari)
  if (role === "mudir" && userId) {
    const myBranch = filtered.find((e) => e.orgRole === "manager" && e.userId === userId);
    if (!myBranch) {
      res.json([]);
      return;
    }
    filtered = filtered.filter(
      (e) =>
        e.id === myBranch.id ||
        (e.orgRole === "pharmacist" && e.reportsToId === myBranch.id) ||
        (e.orgRole === "coordinator" && myBranch.reportsToId != null && e.id === myBranch.reportsToId),
    );
  } else if (!FULL_NETWORK_ROLES.has(role)) {
    // Boshqa rollar tarmoqni to‘liq ko‘rmaydi
    filtered = filtered.filter((e) => !!e.orgRole);
  }

  res.json(await Promise.all(filtered.map(enrichEmployee)));
});

router.post("/employees", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const {
    fullName,
    position,
    departmentId,
    mentorId,
    hiredAt,
    candidateId,
    orgRole,
    reportsToId,
    location,
    shiftType,
    shiftLabel,
    photoUrl,
    employmentStatus,
    userId,
  } = req.body ?? {};

  if (!fullName || !position || !departmentId || !hiredAt) {
    res.status(400).json({ error: "Majburiy maydonlar to'ldirilmagan" });
    return;
  }

  const status =
    employmentStatus && VALID_EMP_STATUS.has(employmentStatus) ? employmentStatus : "working";

  const [created] = await db
    .insert(employeesTable)
    .values({
      fullName,
      position,
      departmentId: parseInt(departmentId, 10),
      mentorId: mentorId ? parseInt(mentorId, 10) : null,
      hiredAt,
      candidateId: candidateId ? parseInt(candidateId, 10) : null,
      orgRole: orgRole ?? null,
      reportsToId: reportsToId ? parseInt(reportsToId, 10) : null,
      location: location ?? null,
      shiftType: shiftType ?? "one",
      shiftLabel: shiftLabel ?? null,
      photoUrl: photoUrl ?? null,
      employmentStatus: status,
      userId: userId ? parseInt(String(userId), 10) : null,
    })
    .returning();

  if (candidateId) {
    await db
      .update(candidatesTable)
      .set({ stage: "internship", status: "active" })
      .where(eq(candidatesTable.id, parseInt(candidateId, 10)));
  }

  res.status(201).json(await enrichEmployee(created));
});

router.get("/employees/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [row] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  res.json(await enrichEmployee(row));
});

router.patch("/employees/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [before] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
  if (!before) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }

  const role = req.userRole ?? "";
  const canEditShift = ["hr", "director", "admin", "department_head", "mudir", "koordinator"].includes(role);
  const canEditStatus = ["mudir", "hr", "admin", "director", "koordinator"].includes(role);

  // Mudir faqat o‘z filiali xodimlarini o‘zgartira oladi
  if (role === "mudir" && req.userId) {
    const myBranch = before.orgRole === "manager" && before.userId === req.userId
      ? before
      : (
          await db.select().from(employeesTable).where(eq(employeesTable.userId, req.userId))
        ).find((e) => e.orgRole === "manager");
    const allowed =
      myBranch &&
      (before.id === myBranch.id ||
        (before.orgRole === "pharmacist" && before.reportsToId === myBranch.id));
    if (!allowed) {
      res.status(403).json({ error: "Faqat o‘z filialingizni tahrirlashingiz mumkin" });
      return;
    }
  }

  const allowed = [
    "fullName",
    "position",
    "departmentId",
    "mentorId",
    "orgRole",
    "reportsToId",
    "location",
    "shiftType",
    "shiftLabel",
    "photoUrl",
    "employmentStatus",
    "userId",
  ];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] === undefined) continue;
    if ((key === "shiftType" || key === "shiftLabel") && !canEditShift) continue;
    if (key === "employmentStatus") {
      if (!canEditStatus) continue;
      if (!VALID_EMP_STATUS.has(req.body[key])) {
        res.status(400).json({ error: "Noto‘g‘ri xodim holati" });
        return;
      }
    }
    if (key === "userId" && role !== "admin" && role !== "hr") continue;
    updates[key] = req.body[key];
  }

  if (!Object.keys(updates).length) {
    res.status(400).json({ error: "Yangilash uchun maydon yo‘q" });
    return;
  }

  const [updated] = await db.update(employeesTable).set(updates).where(eq(employeesTable.id, id)).returning();
  if (!updated) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }

  if (typeof updates.employmentStatus === "string") {
    await syncStaffingAlertForEmployee({
      employee: updated,
      previousStatus: before.employmentStatus,
      newStatus: updates.employmentStatus,
      userId: req.userId,
    });
  }

  res.json(await enrichEmployee(updated));
});

export default router;
