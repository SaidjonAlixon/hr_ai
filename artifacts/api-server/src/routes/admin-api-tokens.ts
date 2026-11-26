import { Router } from "express";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { apiAccessLogsTable, apiAccessTokensTable, db, usersTable } from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import { isBoshAdmin } from "../lib/roles";
import { randomToken, sha256 } from "../lib/device-security";
import { ensureApiAccessSchema } from "../lib/ensure-schema";
import { isValidScope, OPEN_API_SCOPES } from "../lib/open-api-scopes";

const router = Router();

function requireBosh(req: AuthRequest, res: import("express").Response): boolean {
  if (!isBoshAdmin({ role: req.userRole, login: req.userLogin })) {
    res.status(403).json({ error: "Faqat bosh admin" });
    return false;
  }
  return true;
}

async function ensure() {
  await ensureApiAccessSchema().catch(() => undefined);
}

router.get("/admin/api-tokens/scopes", requireAuth, async (req: AuthRequest, res) => {
  if (!requireBosh(req, res)) return;
  res.json({ scopes: OPEN_API_SCOPES });
});

router.get("/admin/api-tokens", requireAuth, async (req: AuthRequest, res) => {
  if (!requireBosh(req, res)) return;
  try {
    await ensure();
    const rows = await db
      .select({
        id: apiAccessTokensTable.id,
        name: apiAccessTokensTable.name,
        tokenPrefix: apiAccessTokensTable.tokenPrefix,
        scopes: apiAccessTokensTable.scopes,
        expiresAt: apiAccessTokensTable.expiresAt,
        revokedAt: apiAccessTokensTable.revokedAt,
        createdBy: apiAccessTokensTable.createdBy,
        note: apiAccessTokensTable.note,
        lastUsedAt: apiAccessTokensTable.lastUsedAt,
        createdAt: apiAccessTokensTable.createdAt,
        creatorName: usersTable.fullName,
      })
      .from(apiAccessTokensTable)
      .leftJoin(usersTable, eq(usersTable.id, apiAccessTokensTable.createdBy))
      .orderBy(desc(apiAccessTokensTable.id))
      .limit(200);
    res.json({
      tokens: rows.map((r) => ({
        ...r,
        active: !r.revokedAt && (!r.expiresAt || r.expiresAt.getTime() > Date.now()),
      })),
    });
  } catch (err) {
    console.error("GET /admin/api-tokens", err);
    res.status(500).json({ error: "Tokenlar ro‘yxatini olishda xato" });
  }
});

router.post("/admin/api-tokens", requireAuth, async (req: AuthRequest, res) => {
  if (!requireBosh(req, res)) return;
  try {
    await ensure();
    const body = req.body || {};
    const name = String(body.name || "").trim();
    if (!name || name.length < 2) {
      res.status(400).json({ error: "Nom kerak (kamida 2 belgi)" });
      return;
    }
    const rawScopes = Array.isArray(body.scopes) ? body.scopes.map(String) : [];
    const scopes = [...new Set(rawScopes.filter(isValidScope))];
    if (!scopes.length) {
      res.status(400).json({ error: "Kamida bitta scope tanlang" });
      return;
    }
    let expiresAt: Date | null = null;
    if (body.expiresAt) {
      const d = new Date(String(body.expiresAt));
      if (Number.isNaN(d.getTime())) {
        res.status(400).json({ error: "expiresAt noto‘g‘ri" });
        return;
      }
      expiresAt = d;
    } else if (body.expiresInDays != null && body.expiresInDays !== "") {
      const days = Number(body.expiresInDays);
      if (!Number.isFinite(days) || days <= 0) {
        res.status(400).json({ error: "expiresInDays musbat son bo‘lsin" });
        return;
      }
      expiresAt = new Date(Date.now() + days * 86400000);
    }
    const plaintext = `vak_${randomToken(32)}`;
    const tokenPrefix = plaintext.slice(0, 12);
    const tokenHash = sha256(plaintext);
    const note = body.note != null ? String(body.note).slice(0, 500) : null;

    const [created] = await db
      .insert(apiAccessTokensTable)
      .values({
        name,
        tokenPrefix,
        tokenHash,
        scopes,
        expiresAt,
        createdBy: req.userId!,
        note,
      })
      .returning({
        id: apiAccessTokensTable.id,
        name: apiAccessTokensTable.name,
        tokenPrefix: apiAccessTokensTable.tokenPrefix,
        scopes: apiAccessTokensTable.scopes,
        expiresAt: apiAccessTokensTable.expiresAt,
        createdAt: apiAccessTokensTable.createdAt,
        note: apiAccessTokensTable.note,
      });

    res.status(201).json({
      token: plaintext,
      warning: "Token faqat bir marta ko‘rsatiladi — saqlab qo‘ying",
      meta: created,
    });
  } catch (err) {
    console.error("POST /admin/api-tokens", err);
    res.status(500).json({ error: "Token yaratishda xato" });
  }
});

router.patch("/admin/api-tokens/:id", requireAuth, async (req: AuthRequest, res) => {
  if (!requireBosh(req, res)) return;
  try {
    await ensure();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "id noto‘g‘ri" });
      return;
    }
    const body = req.body || {};
    const patch: Partial<typeof apiAccessTokensTable.$inferInsert> = {};
    if (body.name != null) {
      const name = String(body.name).trim();
      if (name.length < 2) {
        res.status(400).json({ error: "Nom juda qisqa" });
        return;
      }
      patch.name = name;
    }
    if (body.note !== undefined) patch.note = body.note == null ? null : String(body.note).slice(0, 500);
    if (Array.isArray(body.scopes)) {
      const scopes = [...new Set(body.scopes.map(String).filter(isValidScope))];
      if (!scopes.length) {
        res.status(400).json({ error: "Kamida bitta scope" });
        return;
      }
      patch.scopes = scopes;
    }
    if (body.expiresAt === null) patch.expiresAt = null;
    else if (body.expiresAt != null) {
      const d = new Date(String(body.expiresAt));
      if (Number.isNaN(d.getTime())) {
        res.status(400).json({ error: "expiresAt noto‘g‘ri" });
        return;
      }
      patch.expiresAt = d;
    }
    if (!Object.keys(patch).length) {
      res.status(400).json({ error: "O‘zgarish yo‘q" });
      return;
    }
    const [updated] = await db
      .update(apiAccessTokensTable)
      .set(patch)
      .where(eq(apiAccessTokensTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Token topilmadi" });
      return;
    }
    res.json({ token: updated });
  } catch (err) {
    console.error("PATCH /admin/api-tokens/:id", err);
    res.status(500).json({ error: "Yangilashda xato" });
  }
});

router.post("/admin/api-tokens/:id/revoke", requireAuth, async (req: AuthRequest, res) => {
  if (!requireBosh(req, res)) return;
  try {
    await ensure();
    const id = Number(req.params.id);
    // revokedAt + hashni buzish — eski plaintext shu zahoti hech qachon mos kelmasin
    const deadHash = sha256(`revoked_${id}_${randomToken(24)}_${Date.now()}`);
    const [updated] = await db
      .update(apiAccessTokensTable)
      .set({ revokedAt: new Date(), tokenHash: deadHash })
      .where(eq(apiAccessTokensTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Token topilmadi" });
      return;
    }
    res.json({
      ok: true,
      token: updated,
      message: "Token shu zahoti o‘chirildi — endi ma’lumot tortib bo‘lmaydi",
    });
  } catch (err) {
    console.error("POST /admin/api-tokens/:id/revoke", err);
    res.status(500).json({ error: "Bekor qilishda xato" });
  }
});

/** Tokenni butunlay o‘chirish (jurnal yozuvlari bilan) */
router.delete("/admin/api-tokens/:id", requireAuth, async (req: AuthRequest, res) => {
  if (!requireBosh(req, res)) return;
  try {
    await ensure();
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "ID noto‘g‘ri" });
      return;
    }
    await db.delete(apiAccessLogsTable).where(eq(apiAccessLogsTable.tokenId, id));
    const [removed] = await db
      .delete(apiAccessTokensTable)
      .where(eq(apiAccessTokensTable.id, id))
      .returning({ id: apiAccessTokensTable.id, name: apiAccessTokensTable.name });
    if (!removed) {
      res.status(404).json({ error: "Token topilmadi" });
      return;
    }
    res.json({ ok: true, deleted: removed });
  } catch (err) {
    console.error("DELETE /admin/api-tokens/:id", err);
    res.status(500).json({ error: "O‘chirishda xato" });
  }
});

router.get("/admin/api-tokens/logs", requireAuth, async (req: AuthRequest, res) => {
  if (!requireBosh(req, res)) return;
  try {
    await ensure();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const tokenId = req.query.tokenId ? Number(req.query.tokenId) : null;
    const pathQ = String(req.query.path || "").trim();
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();

    const conds = [];
    if (Number.isFinite(tokenId) && tokenId! > 0) conds.push(eq(apiAccessLogsTable.tokenId, tokenId!));
    if (pathQ) conds.push(sql`${apiAccessLogsTable.path} ILIKE ${"%" + pathQ + "%"}`);
    if (from) {
      const d = new Date(from);
      if (!Number.isNaN(d.getTime())) conds.push(gte(apiAccessLogsTable.createdAt, d));
    }
    if (to) {
      const d = new Date(to);
      if (!Number.isNaN(d.getTime())) conds.push(lte(apiAccessLogsTable.createdAt, d));
    }
    const where = conds.length ? and(...conds) : undefined;

    const base = db
      .select({
        id: apiAccessLogsTable.id,
        tokenId: apiAccessLogsTable.tokenId,
        method: apiAccessLogsTable.method,
        path: apiAccessLogsTable.path,
        status: apiAccessLogsTable.status,
        ip: apiAccessLogsTable.ip,
        userAgent: apiAccessLogsTable.userAgent,
        deviceLabel: apiAccessLogsTable.deviceLabel,
        querySummary: apiAccessLogsTable.querySummary,
        durationMs: apiAccessLogsTable.durationMs,
        createdAt: apiAccessLogsTable.createdAt,
        tokenName: apiAccessTokensTable.name,
        tokenPrefix: apiAccessTokensTable.tokenPrefix,
      })
      .from(apiAccessLogsTable)
      .leftJoin(apiAccessTokensTable, eq(apiAccessTokensTable.id, apiAccessLogsTable.tokenId))
      .orderBy(desc(apiAccessLogsTable.id))
      .limit(limit);

    const rows = where ? await base.where(where) : await base;
    res.json({ logs: rows });
  } catch (err) {
    console.error("GET /admin/api-tokens/logs", err);
    res.status(500).json({ error: "Loglarni olishda xato" });
  }
});

export default router;
