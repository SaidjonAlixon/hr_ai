import express, { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { pool, db, usersTable } from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import {
  deleteStoredUpload,
  MAX_BYTES,
  storeUploadBuffer,
  readBlobUpload,
  readLocalUpload,
} from "../lib/blob-storage";
import { ensureScannerDocsSchema } from "../lib/ensure-schema";
import { isHrRole, hasFullPlatformAccess } from "../lib/roles";
import { escapeHtml, isTelegramConfigured, sendDocument } from "../lib/telegram";
import { REPORT_CHAT_ID } from "../lib/explanation-letter-report";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const TTL_MS = 60 * 60 * 1000;

function decodeFileName(raw: string | undefined): string {
  if (!raw) return "skaner.pdf";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function canViewTxInbox(role?: string | null) {
  return hasFullPlatformAccess(role) || isHrRole(role);
}

async function purgeExpired(): Promise<number> {
  await ensureScannerDocsSchema();
  const { rows } = await pool.query<{ id: number; file_key: string | null }>(
    `SELECT id, file_key FROM scanner_docs WHERE expires_at < NOW()`,
  );
  for (const row of rows) {
    if (row.file_key) {
      try {
        await deleteStoredUpload(row.file_key);
      } catch (err) {
        logger.warn({ err, id: row.id }, "Scanner file delete failed");
      }
    }
  }
  if (rows.length) {
    await pool.query(`DELETE FROM scanner_docs WHERE expires_at < NOW()`);
  }
  return rows.length;
}

/** Muddati o‘tganlarni tozalash — job ham chaqiradi */
export async function sweepExpiredScannerDocs(): Promise<number> {
  try {
    return await purgeExpired();
  } catch (err) {
    logger.warn({ err }, "Scanner docs sweep failed");
    return 0;
  }
}

function mapRow(r: Record<string, unknown>) {
  const expiresAt = new Date(String(r.expires_at));
  const leftMs = Math.max(0, expiresAt.getTime() - Date.now());
  return {
    id: r.id as number,
    userId: r.user_id as number,
    userName: (r.user_name as string) || null,
    userRole: (r.user_role as string) || null,
    filename: r.filename as string,
    fileUrl: r.file_url as string,
    size: Number(r.size) || 0,
    pageCount: Number(r.page_count) || 1,
    sentToTx: Boolean(r.sent_to_tx),
    createdAt: new Date(String(r.created_at)).toISOString(),
    expiresAt: expiresAt.toISOString(),
    expiresInSec: Math.floor(leftMs / 1000),
  };
}

/**
 * POST /api/scanner-docs
 * Body: PDF bytes
 * Headers: Content-Type, X-File-Name, X-Page-Count (ixtiyoriy)
 * 1 soat saqlanadi, TX bo‘limiga (Telegram) yuboriladi.
 */
router.post(
  "/scanner-docs",
  requireAuth,
  express.raw({ type: () => true, limit: MAX_BYTES }),
  async (req: AuthRequest, res): Promise<void> => {
    try {
      await ensureScannerDocsSchema();
      await purgeExpired();

      const buffer = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(req.body ?? []);
      if (!buffer.length) {
        res.status(400).json({ error: "PDF yuborilmadi" });
        return;
      }

      const fileName = decodeFileName(
        (req.headers["x-file-name"] as string | undefined) || "skaner.pdf",
      ).replace(/[^\w.\-()\s'а-яА-ЯёЁўқғҳЎҚҒҲ\-]/giu, "_") || "skaner.pdf";
      const pageCount = Math.max(
        1,
        parseInt(String(req.headers["x-page-count"] || "1"), 10) || 1,
      );

      const stored = await storeUploadBuffer({
        buffer,
        fileName: fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`,
        mimeType: "application/pdf",
        folder: "scans",
      });

      const expiresAt = new Date(Date.now() + TTL_MS);
      let userName = `User #${req.userId}`;
      try {
        const [u] = await db
          .select({ fullName: usersTable.fullName, login: usersTable.login })
          .from(usersTable)
          .where(eq(usersTable.id, req.userId!));
        userName = u?.fullName || u?.login || userName;
      } catch {
        /* ignore */
      }
      const userRole = req.userRole || null;

      let sentToTx = false;
      if (isTelegramConfigured()) {
        try {
          const caption = [
            `📄 <b>Tizim skaneri</b>`,
            `Kim: ${escapeHtml(String(userName))}${userRole ? ` (${escapeHtml(userRole)})` : ""}`,
            `Fayl: ${escapeHtml(stored.url ? fileName : fileName)}`,
            `Sahifa: ${pageCount}`,
            `Muddati: 1 soat (keyin bazadan o‘chiriladi)`,
          ].join("\n");
          await sendDocument(REPORT_CHAT_ID, buffer, fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`, {
            mimeType: "application/pdf",
            caption,
            parseMode: "HTML",
          });
          sentToTx = true;
        } catch (err) {
          logger.warn({ err }, "Scanner → TX telegram yuborilmadi");
        }
      }

      const { rows } = await pool.query(
        `INSERT INTO scanner_docs
          (user_id, user_name, user_role, filename, file_url, file_key, size, page_count, sent_to_tx, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          req.userId!,
          userName,
          userRole,
          fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`,
          stored.url,
          stored.key,
          stored.size,
          pageCount,
          sentToTx,
          expiresAt.toISOString(),
        ],
      );

      res.status(201).json({
        ...mapRow(rows[0]!),
        ttlHours: 1,
        message: sentToTx
          ? "PDF saqlandi (1 soat). Tushuntirish xatlari bo‘limiga yuborildi."
          : "PDF saqlandi (1 soat). Telegramga yuborish keyinroq uriniladi.",
      });
    } catch (err: any) {
      const msg = err?.message || "Skaner saqlash xatosi";
      res.status(msg.includes("10 MB") ? 413 : 500).json({ error: msg });
    }
  },
);

/** Faol skanerlar — TX/HR */
router.get("/scanner-docs", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  await ensureScannerDocsSchema();
  await purgeExpired();
  if (!canViewTxInbox(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yoʻq" });
    return;
  }
  const { rows } = await pool.query(
    `SELECT * FROM scanner_docs WHERE expires_at > NOW() ORDER BY created_at DESC LIMIT 200`,
  );
  res.json(rows.map(mapRow));
});

/** Barcha skaner PDF larini bazadan va saqlashdan tozalash — TX/HR */
router.delete("/scanner-docs", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  await ensureScannerDocsSchema();
  if (!canViewTxInbox(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yoʻq" });
    return;
  }
  try {
    const { rows } = await pool.query<{ id: number; file_key: string | null }>(
      `SELECT id, file_key FROM scanner_docs`,
    );
    for (const row of rows) {
      if (row.file_key) {
        try {
          await deleteStoredUpload(row.file_key);
        } catch (err) {
          logger.warn({ err, id: row.id }, "Scanner bulk file delete failed");
        }
      }
    }
    const del = await pool.query(`DELETE FROM scanner_docs`);
    res.json({ ok: true, deleted: del.rowCount ?? rows.length });
  } catch (err: any) {
    logger.error({ err }, "Scanner docs clear failed");
    res.status(500).json({ error: err?.message || "Tozalash xatosi" });
  }
});

/** Mening faol skanerlarim */
router.get("/scanner-docs/mine", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  await ensureScannerDocsSchema();
  await purgeExpired();
  const { rows } = await pool.query(
    `SELECT * FROM scanner_docs WHERE user_id = $1 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 50`,
    [req.userId!],
  );
  res.json(rows.map(mapRow));
});

/** Yuklab olish — muddati ichida */
router.get("/scanner-docs/:id/file", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  await ensureScannerDocsSchema();
  await purgeExpired();
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Noto‘g‘ri id" });
    return;
  }
  const { rows } = await pool.query(`SELECT * FROM scanner_docs WHERE id = $1`, [id]);
  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: "Topilmadi yoki muddati tugagan" });
    return;
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    res.status(410).json({ error: "1 soatlik muddat tugadi — fayl o‘chirilgan" });
    return;
  }
  const mine = row.user_id === req.userId;
  if (!mine && !canViewTxInbox(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yoʻq" });
    return;
  }

  let buffer: Buffer | null = null;
  if (row.file_key && String(row.file_key).startsWith("scans/")) {
    const remote = await readBlobUpload(String(row.file_key));
    buffer = remote?.buffer ?? null;
  }
  if (!buffer && row.file_key) {
    buffer = await readLocalUpload(String(row.file_key).split("/").pop() || String(row.file_key));
  }
  if (!buffer) {
    res.status(404).json({ error: "Fayl topilmadi" });
    return;
  }

  const name = encodeURIComponent(String(row.filename || "skaner.pdf"));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${name}`);
  res.setHeader("Cache-Control", "private, max-age=60");
  res.send(buffer);
});

export default router;
