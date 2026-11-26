import { Router } from "express";
import { and, desc, eq, gte, isNull, lte, ne, notInArray, or, sql } from "drizzle-orm";
import {
  attendanceRecordsTable,
  candidatesTable,
  db,
  departmentsTable,
  employeesTable,
  payrollMonthsTable,
  pool,
  tasksTable,
  usersTable,
  vacanciesTable,
} from "@workspace/db";
import { requireOpenApiToken, type OpenApiRequest } from "../middlewares/open-api-token";
import { OPEN_API_SCOPES } from "../lib/open-api-scopes";

const router = Router();

function clampLimit(raw: unknown, def = 50, max = 200): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(max, Math.floor(n));
}

function clampOffset(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

async function adminUserIds(): Promise<number[]> {
  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"));
  return rows.map((r) => r.id);
}

router.use(requireOpenApiToken);

router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "vaksina-open-api", version: "v1", readOnly: true });
});

router.get("/me", (req: OpenApiRequest, res) => {
  const t = req.openApiToken!;
  res.json({
    name: t.name,
    prefix: t.tokenPrefix,
    scopes: t.scopes,
    expiresAt: t.expiresAt,
    note: t.note,
    readOnly: true,
  });
});

router.get("/openapi.json", (_req, res) => {
  const paths: Record<string, unknown> = {
    "/health": {
      get: {
        summary: "Token ping",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "OK" } },
      },
    },
    "/me": {
      get: {
        summary: "Token meta",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Token info" } },
      },
    },
  };
  for (const s of OPEN_API_SCOPES) {
    paths[s.path] = {
      get: {
        summary: s.label,
        description: `${s.description}. Scope: ${s.id}`,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
          { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
        ],
        responses: { "200": { description: "Ro‘yxat" }, "401": { description: "Token yo‘q" }, "403": { description: "Scope yo‘q" } },
      },
    };
  }
  res.json({
    openapi: "3.0.3",
    info: {
      title: "VAKSINA HR Open API",
      version: "1.0.0",
      description:
        "Read-only API. Faqat GET. Authorization: Bearer <token>. Tokenni bosh admin beradi.",
    },
    servers: [{ url: "/api/open/v1" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "API Token" },
      },
    },
    security: [{ bearerAuth: [] }],
    paths,
    "x-scopes": OPEN_API_SCOPES,
  });
});

router.get("/employees", async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);
    const adminIds = await adminUserIds();
    const notAdminEmp =
      adminIds.length > 0
        ? or(isNull(employeesTable.userId), notInArray(employeesTable.userId, adminIds))
        : sql`true`;
    const rows = await db
      .select({
        id: employeesTable.id,
        fullName: employeesTable.fullName,
        position: employeesTable.position,
        departmentId: employeesTable.departmentId,
        orgRole: employeesTable.orgRole,
        location: employeesTable.location,
        branchNo: employeesTable.branchNo,
        employmentStatus: employeesTable.employmentStatus,
        userId: employeesTable.userId,
        hiredAt: employeesTable.hiredAt,
        assignedBranchId: employeesTable.assignedBranchId,
      })
      .from(employeesTable)
      .where(notAdminEmp)
      .orderBy(desc(employeesTable.id))
      .limit(limit)
      .offset(offset);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(employeesTable)
      .where(notAdminEmp);
    res.json({ data: rows, total: count, limit, offset });
  } catch (err) {
    console.error("open-api /employees", err);
    res.status(500).json({ error: "Xodimlarni olishda xato" });
  }
});

router.get("/attendance", async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const conds = [];
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) conds.push(gte(attendanceRecordsTable.workDate, from));
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) conds.push(lte(attendanceRecordsTable.workDate, to));
    const where = conds.length ? and(...conds) : undefined;
    const q = db
      .select({
        id: attendanceRecordsTable.id,
        employeeId: attendanceRecordsTable.employeeId,
        userId: attendanceRecordsTable.userId,
        workDate: attendanceRecordsTable.workDate,
        checkInAt: attendanceRecordsTable.checkInAt,
        checkOutAt: attendanceRecordsTable.checkOutAt,
        status: attendanceRecordsTable.status,
        source: attendanceRecordsTable.source,
        resolvedBranchId: attendanceRecordsTable.resolvedBranchId,
        resolvedBranchLabel: attendanceRecordsTable.resolvedBranchLabel,
        shiftPlan: attendanceRecordsTable.shiftPlan,
        checkInMethod: attendanceRecordsTable.checkInMethod,
        checkOutMethod: attendanceRecordsTable.checkOutMethod,
      })
      .from(attendanceRecordsTable)
      .orderBy(desc(attendanceRecordsTable.workDate), desc(attendanceRecordsTable.id))
      .limit(limit)
      .offset(offset);
    const rows = where ? await q.where(where) : await q;
    res.json({ data: rows, limit, offset, from: from || null, to: to || null });
  } catch (err) {
    console.error("open-api /attendance", err);
    res.status(500).json({ error: "Davomatni olishda xato" });
  }
});

router.get("/branches", async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit, 100, 300);
    const offset = clampOffset(req.query.offset);
    const rows = await db
      .select({
        id: employeesTable.id,
        fullName: employeesTable.fullName,
        location: employeesTable.location,
        branchNo: employeesTable.branchNo,
        latitude: employeesTable.latitude,
        longitude: employeesTable.longitude,
        employmentStatus: employeesTable.employmentStatus,
        userId: employeesTable.userId,
      })
      .from(employeesTable)
      .where(eq(employeesTable.orgRole, "manager"))
      .orderBy(employeesTable.branchNo, employeesTable.id)
      .limit(limit)
      .offset(offset);
    res.json({ data: rows, limit, offset });
  } catch (err) {
    console.error("open-api /branches", err);
    res.status(500).json({ error: "Filiallarni olishda xato" });
  }
});

router.get("/departments", async (req, res) => {
  try {
    const rows = await db
      .select({
        id: departmentsTable.id,
        name: departmentsTable.name,
        headId: departmentsTable.headId,
        createdAt: departmentsTable.createdAt,
      })
      .from(departmentsTable)
      .orderBy(departmentsTable.id)
      .limit(clampLimit(req.query.limit, 100, 300));
    res.json({ data: rows });
  } catch (err) {
    console.error("open-api /departments", err);
    res.status(500).json({ error: "Bo‘limlarni olishda xato" });
  }
});

router.get("/payroll", async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);
    const month = String(req.query.month || "").trim();
    const conds = [];
    if (/^\d{4}-\d{2}$/.test(month)) conds.push(eq(payrollMonthsTable.month, month));
    const where = conds.length ? and(...conds) : undefined;
    const base = db
      .select({
        id: payrollMonthsTable.id,
        userId: payrollMonthsTable.userId,
        employeeId: payrollMonthsTable.employeeId,
        month: payrollMonthsTable.month,
        fixedSalary: payrollMonthsTable.fixedSalary,
        bonusPercent: payrollMonthsTable.bonusPercent,
        kpiPercent: payrollMonthsTable.kpiPercent,
        bonusAmount: payrollMonthsTable.bonusAmount,
        totalAmount: payrollMonthsTable.totalAmount,
        status: payrollMonthsTable.status,
        jarima: payrollMonthsTable.jarima,
      })
      .from(payrollMonthsTable)
      .orderBy(desc(payrollMonthsTable.month), desc(payrollMonthsTable.id))
      .limit(limit)
      .offset(offset);
    const rows = where ? await base.where(where) : await base;
    res.json({ data: rows, limit, offset, month: month || null });
  } catch (err) {
    console.error("open-api /payroll", err);
    res.status(500).json({ error: "Oylikni olishda xato" });
  }
});

router.get("/candidates", async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);
    const rows = await db
      .select({
        id: candidatesTable.id,
        fullName: candidatesTable.fullName,
        phone: candidatesTable.phone,
        vacancyId: candidatesTable.vacancyId,
        stage: candidatesTable.stage,
        status: candidatesTable.status,
        pipelineStep: candidatesTable.pipelineStep,
        createdAt: candidatesTable.createdAt,
      })
      .from(candidatesTable)
      .orderBy(desc(candidatesTable.id))
      .limit(limit)
      .offset(offset);
    res.json({ data: rows, limit, offset });
  } catch (err) {
    console.error("open-api /candidates", err);
    res.status(500).json({ error: "Nomzodlarni olishda xato" });
  }
});

router.get("/vacancies", async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);
    const rows = await db
      .select({
        id: vacanciesTable.id,
        title: vacanciesTable.title,
        status: vacanciesTable.status,
        location: vacanciesTable.location,
        requestId: vacanciesTable.requestId,
        recruiterId: vacanciesTable.recruiterId,
        createdAt: vacanciesTable.createdAt,
      })
      .from(vacanciesTable)
      .orderBy(desc(vacanciesTable.id))
      .limit(limit)
      .offset(offset);
    res.json({ data: rows, limit, offset });
  } catch (err) {
    console.error("open-api /vacancies", err);
    res.status(500).json({ error: "Vakansiyalarni olishda xato" });
  }
});

router.get("/tasks", async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);
    const rows = await db
      .select({
        id: tasksTable.id,
        title: tasksTable.title,
        status: tasksTable.status,
        priority: tasksTable.priority,
        dueAt: tasksTable.dueAt,
        assigneeKind: tasksTable.assigneeKind,
        assigneeId: tasksTable.assigneeId,
        createdById: tasksTable.createdById,
        createdAt: tasksTable.createdAt,
      })
      .from(tasksTable)
      .orderBy(desc(tasksTable.id))
      .limit(limit)
      .offset(offset);
    res.json({ data: rows, limit, offset });
  } catch (err) {
    console.error("open-api /tasks", err);
    res.status(500).json({ error: "Vazifalarni olishda xato" });
  }
});

router.get("/users", async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);
    // login / password / telegram / admin — hech qachon
    const rows = await db
      .select({
        id: usersTable.id,
        fullName: usersTable.fullName,
        role: usersTable.role,
        phone: usersTable.phone,
        status: usersTable.status,
        departmentId: usersTable.departmentId,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(ne(usersTable.role, "admin"))
      .orderBy(desc(usersTable.id))
      .limit(limit)
      .offset(offset);
    res.json({ data: rows, limit, offset });
  } catch (err) {
    console.error("open-api /users", err);
    res.status(500).json({ error: "Foydalanuvchilarni olishda xato" });
  }
});

router.get("/discipline", async (req, res) => {
  try {
    const month = String(req.query.month || "").trim();
    const limit = clampLimit(req.query.limit, 100, 500);
    const params: unknown[] = [];
    let where = "";
    if (/^\d{4}-\d{2}$/.test(month)) {
      params.push(month);
      where = `WHERE month = $1`;
    }
    params.push(limit);
    const limPh = `$${params.length}`;
    const { rows } = await pool.query(
      `SELECT id, user_id, month, n, event_date, kind, position, branch, shift
       FROM discipline_events
       ${where}
       ORDER BY month DESC, n DESC, id DESC
       LIMIT ${limPh}`,
      params,
    );
    res.json({ data: rows, month: month || null, limit });
  } catch (err) {
    console.error("open-api /discipline", err);
    res.status(500).json({ error: "Intizom ma’lumotini olishda xato" });
  }
});

export default router;
