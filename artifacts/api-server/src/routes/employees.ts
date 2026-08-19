import { Router, type IRouter } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db, employeesTable, departmentsTable, usersTable, candidatesTable } from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import { syncStaffingAlertForEmployee } from "../lib/staffing-alert";
import { HR_ROLES, isHrManager } from "../lib/roles";
import { saveManagerBranchLocation } from "../lib/branch-gps";

const router: IRouter = Router();

const VALID_EMP_STATUS = new Set(["working", "new", "dismissed", "need_hire", "searching", "no_manager"]);

const FULL_NETWORK_ROLES = new Set([
  "admin",
  ...HR_ROLES,
  "director",
  "recruiter",
  "department_head",
  "sb",
  "sb_boshliq",
]);

const ORG_ROLE_UZ: Record<string, string> = {
  coordinator: "Koordinator",
  manager: "Mudir",
  pharmacist: "Farmasevt",
  intern: "Stajyor",
  supervisor: "Nazoratchi",
};

const STATUS_UZ: Record<string, string> = {
  working: "Ishlayapti",
  new: "Yangi",
  dismissed: "Bo‘shagan",
  need_hire: "Yollash kerak",
  searching: "Qidiruvda",
  no_manager: "Mudir yo‘q",
};

const SHIFT_UZ: Record<string, string> = {
  one: "1 smena",
  two: "2 smena",
  custom: "Maxsus",
};

type EmpRow = {
  id: number;
  fullName: string;
  position: string;
  departmentId: number;
  mentorId: number | null;
  hiredAt: string;
  candidateId: number | null;
  orgRole: string | null;
  reportsToId: number | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  shiftType: string | null;
  shiftLabel: string | null;
  employmentStatus: string | null;
  userId: number | null;
  photoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type EmpEnriched = EmpRow & {
  departmentName: string | null;
  mentorName: string | null;
};

const EMP_LIST_SELECT = {
  id: employeesTable.id,
  fullName: employeesTable.fullName,
  position: employeesTable.position,
  departmentId: employeesTable.departmentId,
  mentorId: employeesTable.mentorId,
  hiredAt: employeesTable.hiredAt,
  candidateId: employeesTable.candidateId,
  orgRole: employeesTable.orgRole,
  reportsToId: employeesTable.reportsToId,
  location: employeesTable.location,
  latitude: employeesTable.latitude,
  longitude: employeesTable.longitude,
  shiftType: employeesTable.shiftType,
  shiftLabel: employeesTable.shiftLabel,
  employmentStatus: employeesTable.employmentStatus,
  userId: employeesTable.userId,
  photoUrl: employeesTable.photoUrl,
  createdAt: employeesTable.createdAt,
  updatedAt: employeesTable.updatedAt,
};

const EMP_CORE_SELECT = {
  id: employeesTable.id,
  fullName: employeesTable.fullName,
  position: employeesTable.position,
  departmentId: employeesTable.departmentId,
  mentorId: employeesTable.mentorId,
  hiredAt: employeesTable.hiredAt,
  candidateId: employeesTable.candidateId,
  createdAt: employeesTable.createdAt,
  updatedAt: employeesTable.updatedAt,
};

async function loadEmployees(): Promise<EmpRow[]> {
  try {
    return (await db
      .select(EMP_LIST_SELECT)
      .from(employeesTable)
      .orderBy(asc(employeesTable.fullName))) as EmpRow[];
  } catch (err) {
    console.error("employees list select fallback (missing columns?):", err);
    const core = await db
      .select(EMP_CORE_SELECT)
      .from(employeesTable)
      .orderBy(asc(employeesTable.fullName));
    return core.map((r) => ({
      ...r,
      orgRole: null,
      reportsToId: null,
      location: null,
      latitude: null,
      longitude: null,
      shiftType: "one",
      shiftLabel: null,
      employmentStatus: "working",
      userId: null,
      photoUrl: null,
    }));
  }
}

async function enrichMany(rows: EmpRow[]): Promise<EmpEnriched[]> {
  if (!rows.length) return [];
  const deptIds = [...new Set(rows.map((r) => r.departmentId))];
  const mentorIds = [...new Set(rows.map((r) => r.mentorId).filter((id): id is number => id != null))];

  const [depts, mentors] = await Promise.all([
    deptIds.length
      ? db
          .select({ id: departmentsTable.id, name: departmentsTable.name })
          .from(departmentsTable)
          .where(inArray(departmentsTable.id, deptIds))
      : Promise.resolve([] as { id: number; name: string }[]),
    mentorIds.length
      ? db
          .select({ id: usersTable.id, fullName: usersTable.fullName })
          .from(usersTable)
          .where(inArray(usersTable.id, mentorIds))
      : Promise.resolve([] as { id: number; fullName: string }[]),
  ]);

  const deptMap = new Map(depts.map((d) => [d.id, d.name]));
  const mentorMap = new Map(mentors.map((m) => [m.id, m.fullName]));

  return rows.map((r) => ({
    ...r,
    departmentName: deptMap.get(r.departmentId) ?? null,
    mentorName: r.mentorId != null ? mentorMap.get(r.mentorId) ?? null : null,
  }));
}

async function enrichEmployee(r: EmpRow | typeof employeesTable.$inferSelect) {
  const [enriched] = await enrichMany([r as EmpRow]);
  return enriched;
}

function scopeEmployees(
  rows: EmpRow[],
  role: string,
  userId: number | undefined,
  filters: { departmentId?: string; mentorId?: string; search?: string },
): EmpRow[] {
  let filtered = rows.filter((r) => {
    if (filters.departmentId && r.departmentId !== parseInt(filters.departmentId, 10)) return false;
    if (filters.mentorId && r.mentorId !== parseInt(filters.mentorId, 10)) return false;
    if (filters.search && !r.fullName.toLowerCase().includes(filters.search.toLowerCase())) return false;
    return true;
  });

  if (role === "mudir" && userId) {
    const myBranch = filtered.find((e) => e.orgRole === "manager" && e.userId === userId);
    if (!myBranch) return [];
    filtered = filtered.filter(
      (e) =>
        e.id === myBranch.id ||
        ((e.orgRole === "pharmacist" || e.orgRole === "intern" || e.orgRole === "supervisor") &&
          e.reportsToId === myBranch.id) ||
        (e.orgRole === "coordinator" &&
          myBranch.reportsToId != null &&
          e.id === myBranch.reportsToId),
    );
  } else if (role === "koordinator" && userId) {
    const myCoord = filtered.find((e) => e.orgRole === "coordinator" && e.userId === userId);
    if (!myCoord) return [];
    const myManagerIds = new Set(
      filtered.filter((e) => e.orgRole === "manager" && e.reportsToId === myCoord.id).map((e) => e.id),
    );
    filtered = filtered.filter(
      (e) =>
        e.id === myCoord.id ||
        myManagerIds.has(e.id) ||
        ((e.orgRole === "pharmacist" || e.orgRole === "intern" || e.orgRole === "supervisor") &&
          e.reportsToId != null &&
          myManagerIds.has(e.reportsToId)),
    );
  } else if (!FULL_NETWORK_ROLES.has(role)) {
    filtered = filtered.filter((e) => !!e.orgRole);
  }

  return filtered;
}

router.get("/employees", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const { departmentId, mentorId, search } = req.query as Record<string, string>;
    const role = req.userRole ?? "";
    const userId = req.userId;

    const rows = await loadEmployees();
    const filtered = scopeEmployees(rows, role, userId, { departmentId, mentorId, search });
    res.json(await enrichMany(filtered));
  } catch (err) {
    console.error("GET /employees error:", err);
    res.status(503).json({ error: "Xodimlar ro‘yxati yuklanmadi — birozdan keyin qayta urinib ko‘ring" });
  }
});

/** Xodimlar to‘liq ro‘yxati — Excel */
router.get("/employees/export", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
  const role = req.userRole ?? "";
  const userId = req.userId;
  const { departmentId, mentorId, search } = req.query as Record<string, string>;

  const rows = await loadEmployees();
  const filtered = scopeEmployees(rows, role, userId, { departmentId, mentorId, search });
  const enriched = await enrichMany(filtered);

  const userIds = [...new Set(enriched.map((e) => e.userId).filter((id): id is number => id != null))];
  const userMap = new Map<number, { phone: string | null; login: string }>();
  if (userIds.length) {
    const users = await db
      .select({ id: usersTable.id, phone: usersTable.phone, login: usersTable.login })
      .from(usersTable)
      .where(inArray(usersTable.id, userIds));
    for (const u of users) {
      userMap.set(u.id, { phone: u.phone, login: u.login });
    }
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "VAKSINA MED HR";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Xodimlar", {
    views: [{ state: "frozen", ySplit: 2 }],
    properties: { defaultRowHeight: 20 },
  });

  sheet.mergeCells("A1:K1");
  const title = sheet.getCell("A1");
  title.value = "VAKSINA MED — Xodimlar to‘liq ro‘yxati";
  title.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3A5C" } };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  sheet.getRow(1).height = 32;

  const headers = [
    "№",
    "F.I.Sh.",
    "Lavozim",
    "Tarmoq roli",
    "Bo‘lim",
    "Filial / joy",
    "Mentor",
    "Holat",
    "Smena",
    "Ishga olingan",
    "Telefon",
  ];
  const headerRow = sheet.getRow(2);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A5F8A" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FF0B3A5C" } },
      left: { style: "thin", color: { argb: "FF0B3A5C" } },
      bottom: { style: "thin", color: { argb: "FF0B3A5C" } },
      right: { style: "thin", color: { argb: "FF0B3A5C" } },
    };
  });
  headerRow.height = 24;

  sheet.columns = [
    { key: "n", width: 5 },
    { key: "fullName", width: 28 },
    { key: "position", width: 18 },
    { key: "orgRole", width: 14 },
    { key: "department", width: 18 },
    { key: "location", width: 20 },
    { key: "mentor", width: 18 },
    { key: "status", width: 12 },
    { key: "shift", width: 12 },
    { key: "hiredAt", width: 12 },
    { key: "phone", width: 16 },
  ];

  enriched.forEach((e, idx) => {
    const linked = e.userId != null ? userMap.get(e.userId) : undefined;
    const shift =
      e.shiftType === "custom" && e.shiftLabel
        ? e.shiftLabel
        : SHIFT_UZ[e.shiftType || ""] || e.shiftType || "—";
    const row = sheet.addRow({
      n: idx + 1,
      fullName: e.fullName,
      position: e.position,
      orgRole: (e.orgRole && ORG_ROLE_UZ[e.orgRole]) || e.orgRole || "—",
      department: e.departmentName || "—",
      location: e.location || "—",
      mentor: e.mentorName || "—",
      status: STATUS_UZ[e.employmentStatus || ""] || e.employmentStatus || "—",
      shift,
      hiredAt: e.hiredAt || "—",
      phone: linked?.phone || "—",
    });
    const zebra = idx % 2 === 0 ? "FFF7FAFC" : "FFFFFFFF";
    row.eachCell((cell, colNumber) => {
      cell.font = { name: "Calibri", size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };
      cell.alignment = {
        vertical: "middle",
        horizontal: colNumber === 1 || colNumber === 8 || colNumber === 10 ? "center" : "left",
        wrapText: true,
      };
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
    });
    row.height = 20;
  });

  const footerRow = sheet.addRow([]);
  sheet.mergeCells(`A${footerRow.number}:K${footerRow.number}`);
  const footer = sheet.getCell(`A${footerRow.number}`);
  footer.value = `Jami: ${enriched.length} ta xodim · ${new Date().toLocaleString("uz-UZ")}`;
  footer.font = { name: "Calibri", size: 9, italic: true, color: { argb: "FF64748B" } };
  footer.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  sheet.getRow(footerRow.number).height = 20;

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="xodimlar_${stamp}.xlsx"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(buffer);
  } catch (err) {
    console.error("GET /employees/export error:", err);
    res.status(503).json({ error: "Excel yuklanmadi — birozdan keyin qayta urinib ko‘ring" });
  }
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
      createdById: req.userId ?? null,
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

  const coordinates = String(req.body?.coordinates || "").trim();
  if (coordinates && req.userId) {
    const gps = await saveManagerBranchLocation({
      actorRole: req.userRole ?? "",
      actorUserId: req.userId,
      employeeId: id,
      coordinates,
    });
    if (!gps.ok) {
      res.status(gps.status).json({ error: gps.error });
      return;
    }
    const [row] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
    res.json(await enrichEmployee(row ?? before));
    return;
  }

  const role = req.userRole ?? "";
  const canEditShift = [
    ...HR_ROLES,
    "director",
    "admin",
    "department_head",
    "mudir",
    "koordinator",
  ].includes(role);
  const canEditStatus = ["mudir", ...HR_ROLES, "admin", "director", "koordinator"].includes(role);

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
    "latitude",
    "longitude",
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
      if (req.body[key] === "no_manager") {
        if (role === "mudir") {
          res.status(400).json({ error: "Mudir yo‘q holatini faqat koordinator belgilaydi" });
          return;
        }
        if (before.orgRole !== "manager") {
          res.status(400).json({ error: "Mudir yo‘q faqat mudir kartasiga qo‘yiladi" });
          return;
        }
      }
    }
    if (key === "userId" && !isHrManager(role)) continue;
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
