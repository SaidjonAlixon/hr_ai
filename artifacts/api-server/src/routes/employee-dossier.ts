import express, { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { dismissedStaffTable, employeesTable, usersTable } from "@workspace/db/schema";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { MAX_BYTES, storeUploadBuffer } from "../lib/blob-storage";
import {
  getEmployeeDossier,
  isDocKey,
  upsertEmployeeDossier,
  type DocKey,
} from "../lib/employee-dossier";

const router: IRouter = Router();

const EDIT_ROLES = new Set([
  "admin",
  "asoschi",
  "director",
  "hr",
  "hr_menejer",
  "hr_direktor",
  "hr_kadr_rahbar",
  "hr_auditor",
  "recruiter",
  "sb",
  "sb_rahbar",
]);

function canEditDossier(role?: string | null) {
  return Boolean(role && EDIT_ROLES.has(role));
}

async function employeeExists(id: number) {
  const [row] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(eq(employeesTable.id, id));
  return Boolean(row);
}

async function employmentMeta(employeeId: number) {
  const [emp] = await db
    .select({
      hiredAt: employeesTable.hiredAt,
      employmentStatus: employeesTable.employmentStatus,
      fullName: employeesTable.fullName,
      position: employeesTable.position,
      userId: employeesTable.userId,
      updatedAt: employeesTable.updatedAt,
    })
    .from(employeesTable)
    .where(eq(employeesTable.id, employeeId))
    .limit(1);

  let dismissedAt: string | null = null;
  if (emp) {
    const [arch] = await db
      .select({ dismissedAt: dismissedStaffTable.dismissedAt })
      .from(dismissedStaffTable)
      .where(eq(dismissedStaffTable.formerEmployeeId, employeeId))
      .orderBy(desc(dismissedStaffTable.dismissedAt))
      .limit(1);
    if (arch?.dismissedAt) {
      dismissedAt = new Date(arch.dismissedAt).toISOString();
    } else if (emp.employmentStatus === "dismissed" && emp.updatedAt) {
      dismissedAt = new Date(emp.updatedAt).toISOString();
    }
  }

  return {
    hiredAt: emp?.hiredAt ?? null,
    employmentStatus: emp?.employmentStatus ?? null,
    dismissedAt,
    fullName: emp?.fullName ?? null,
    position: emp?.position ?? null,
  };
}

async function actorName(req: AuthRequest): Promise<string | null> {
  if (!req.userId) return null;
  const [u] = await db
    .select({ fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId))
    .limit(1);
  return u?.fullName || null;
}

router.get(
  "/employees/:id/dossier",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const id = parseInt(
        Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
        10,
      );
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Noto‘g‘ri id" });
        return;
      }
      if (!(await employeeExists(id))) {
        res.status(404).json({ error: "Xodim topilmadi" });
        return;
      }
      const [dossier, employment] = await Promise.all([
        getEmployeeDossier(id),
        employmentMeta(id),
      ]);
      res.json({ ...dossier, employment });
    } catch (err: any) {
      console.error("GET /employees/:id/dossier", err);
      res.status(500).json({ error: err?.message || "Xatolik" });
    }
  },
);

router.patch(
  "/employees/:id/dossier",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    try {
      if (!canEditDossier(req.userRole)) {
        res.status(403).json({ error: "Tahrirlash ruxsati yo‘q" });
        return;
      }
      const id = parseInt(
        Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
        10,
      );
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Noto‘g‘ri id" });
        return;
      }
      if (!(await employeeExists(id))) {
        res.status(404).json({ error: "Xodim topilmadi" });
        return;
      }

      const body = req.body || {};
      const dossier = await upsertEmployeeDossier(
        id,
        {
          documents: body.documents,
          family: body.family,
        },
        await actorName(req),
      );
      res.json(dossier);
    } catch (err: any) {
      console.error("PATCH /employees/:id/dossier", err);
      res.status(500).json({ error: err?.message || "Xatolik" });
    }
  },
);

/** PDF/fayl yuklash → slotga biriktirish */
router.post(
  "/employees/:id/dossier/:docKey/file",
  requireAuth,
  express.raw({ type: () => true, limit: MAX_BYTES }),
  async (req: AuthRequest, res): Promise<void> => {
    try {
      if (!canEditDossier(req.userRole)) {
        res.status(403).json({ error: "Tahrirlash ruxsati yo‘q" });
        return;
      }
      const id = parseInt(
        Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
        10,
      );
      const docKey = String(
        Array.isArray(req.params.docKey) ? req.params.docKey[0] : req.params.docKey,
      );
      if (!Number.isFinite(id) || !isDocKey(docKey)) {
        res.status(400).json({ error: "Noto‘g‘ri parametr" });
        return;
      }
      if (!(await employeeExists(id))) {
        res.status(404).json({ error: "Xodim topilmadi" });
        return;
      }

      const buffer = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(req.body ?? []);
      if (!buffer.length) {
        res.status(400).json({ error: "Fayl bo‘sh" });
        return;
      }

      let rawName = "hujjat.pdf";
      try {
        rawName = decodeURIComponent(String(req.headers["x-file-name"] || "hujjat.pdf"));
      } catch {
        rawName = String(req.headers["x-file-name"] || "hujjat.pdf");
      }
      const mimeType = String(req.headers["content-type"] || "application/pdf").split(";")[0];
      const isPdf = mimeType.includes("pdf") || rawName.toLowerCase().endsWith(".pdf");
      if (!isPdf && !mimeType.startsWith("image/")) {
        res.status(400).json({ error: "Faqat PDF yoki rasm yuklash mumkin" });
        return;
      }
      const stored = await storeUploadBuffer({
        buffer,
        fileName: rawName,
        mimeType: isPdf ? "application/pdf" : mimeType,
      });

      const dossier = await upsertEmployeeDossier(
        id,
        {
          documents: {
            [docKey as DocKey]: {
              file: {
                url: stored.url,
                name: rawName,
                mimeType: isPdf ? "application/pdf" : mimeType,
                size: stored.size,
                uploadedAt: new Date().toISOString(),
              },
            },
          },
        },
        await actorName(req),
      );

      res.json(dossier);
    } catch (err: any) {
      console.error("POST dossier file", err);
      res.status(500).json({ error: err?.message || "Yuklash xatosi" });
    }
  },
);

router.delete(
  "/employees/:id/dossier/:docKey/file",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    try {
      if (!canEditDossier(req.userRole)) {
        res.status(403).json({ error: "Tahrirlash ruxsati yo‘q" });
        return;
      }
      const id = parseInt(
        Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
        10,
      );
      const docKey = String(
        Array.isArray(req.params.docKey) ? req.params.docKey[0] : req.params.docKey,
      );
      if (!Number.isFinite(id) || !isDocKey(docKey)) {
        res.status(400).json({ error: "Noto‘g‘ri parametr" });
        return;
      }
      const dossier = await upsertEmployeeDossier(
        id,
        { documents: { [docKey as DocKey]: { file: null } } },
        await actorName(req),
      );
      res.json(dossier);
    } catch (err: any) {
      console.error("DELETE dossier file", err);
      res.status(500).json({ error: err?.message || "Xatolik" });
    }
  },
);

export default router;
