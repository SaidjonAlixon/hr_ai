import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db, employeesTable, departmentsTable, usersTable, candidatesTable } from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import { syncStaffingAlertForEmployee } from "../lib/staffing-alert";
import { HR_ROLES, isHrManager } from "../lib/roles";

const router: IRouter = Router();

const VALID_EMP_STATUS = new Set(["working", "new", "dismissed", "need_hire", "searching"]);

const FULL_NETWORK_ROLES = new Set([
  "admin",
  ...HR_ROLES,
  "director",
  "recruiter",
  "department_head",
]);

const ORG_ROLE_UZ: Record<string, string> = {
  coordinator: "Koordinator",
  manager: "Mudir",
  pharmacist: "Farmasevt",
  intern: "Stajor",
  supervisor: "Nazoratchi",
};

const STATUS_UZ: Record<string, string> = {
  working: "Ishlayapti",
  new: "Yangi",
  dismissed: "Bo‘shagan",
  need_hire: "Yollash kerak",
  searching: "Qidiruvda",
};

const SHIFT_UZ: Record<string, string> = {
  one: "1 smena",
  two: "2 smena",
  custom: "Maxsus",
};

type EmpRow = typeof employeesTable.$inferSelect;

async function enrichEmployee(r: EmpRow) {
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

function scopeEmployees(
  rows: EmpRow[],
  role: string,
  userId: number | undefined,
  filters: { departmentId?: string; mentorId?: string; search?: string },
): EmpRow[] | null {
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
  const { departmentId, mentorId, search } = req.query as Record<string, string>;
  const role = req.userRole ?? "";
  const userId = req.userId;

  const rows = await db.select().from(employeesTable).orderBy(asc(employeesTable.fullName));
  const filtered = scopeEmployees(rows, role, userId, { departmentId, mentorId, search });
  if (!filtered) {
    res.json([]);
    return;
  }

  res.json(await Promise.all(filtered.map(enrichEmployee)));
});

/** Xodimlar to‘liq ro‘yxati — Excel */
router.get("/employees/export", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole ?? "";
  const userId = req.userId;
  const { departmentId, mentorId, search } = req.query as Record<string, string>;

  const rows = await db.select().from(employeesTable).orderBy(asc(employeesTable.fullName));
  const filtered = scopeEmployees(rows, role, userId, { departmentId, mentorId, search }) ?? [];
  const enriched = await Promise.all(filtered.map(enrichEmployee));

  const userIds = [...new Set(enriched.map((e) => e.userId).filter((id): id is number => id != null))];
  const userMap = new Map<number, { phone: string | null; login: string }>();
  if (userIds.length) {
    const users = await db
      .select({ id: usersTable.id, phone: usersTable.phone, login: usersTable.login })
      .from(usersTable);
    for (const u of users) {
      if (userIds.includes(u.id)) userMap.set(u.id, { phone: u.phone, login: u.login });
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
