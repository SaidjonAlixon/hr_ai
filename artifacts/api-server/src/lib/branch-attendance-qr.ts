/**
 * Filial davomat QR — secure token (hash DB da).
 * Payload: VMHR1.<qrId>.<rawToken>
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, branchAttendanceQrTable } from "@workspace/db";

export const QR_PAYLOAD_PREFIX = "VMHR1";

export function hashQrToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function mintQrSecrets(): { qrId: string; rawToken: string; tokenHash: string } {
  const qrId = randomBytes(12).toString("base64url");
  const rawToken = randomBytes(24).toString("base64url");
  return { qrId, rawToken, tokenHash: hashQrToken(rawToken) };
}

export function encodeQrPayload(qrId: string, rawToken: string): string {
  return `${QR_PAYLOAD_PREFIX}.${qrId}.${rawToken}`;
}

export function parseQrPayload(raw: string): { qrId: string; rawToken: string } | null {
  const s = String(raw || "").trim();
  const parts = s.split(".");
  if (parts.length !== 3) return null;
  const [prefix, qrId, rawToken] = parts;
  if (prefix !== QR_PAYLOAD_PREFIX || !qrId || !rawToken) return null;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(qrId) || !/^[A-Za-z0-9_-]{16,128}$/.test(rawToken)) return null;
  return { qrId, rawToken };
}

export type QrVerifyOk = {
  ok: true;
  row: typeof branchAttendanceQrTable.$inferSelect;
};

export type QrVerifyFail = {
  ok: false;
  code: string;
  error: string;
};

export async function verifyBranchQrPayload(payload: string): Promise<QrVerifyOk | QrVerifyFail> {
  const parsed = parseQrPayload(payload);
  if (!parsed) {
    return { ok: false, code: "qr_invalid", error: "QR kod noto‘g‘ri formatda" };
  }
  const [row] = await db
    .select()
    .from(branchAttendanceQrTable)
    .where(eq(branchAttendanceQrTable.qrId, parsed.qrId))
    .limit(1);
  if (!row) {
    return { ok: false, code: "qr_unknown", error: "QR kod topilmadi" };
  }
  if (row.status !== "active") {
    return { ok: false, code: "qr_revoked", error: "Bu QR kod bekor qilingan" };
  }
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return { ok: false, code: "qr_expired", error: "QR kod muddati tugagan" };
  }
  if (row.tokenHash !== hashQrToken(parsed.rawToken)) {
    return { ok: false, code: "qr_token_mismatch", error: "QR token mos kelmadi" };
  }
  return { ok: true, row };
}

export async function getActiveQrForBranch(branchId: number) {
  const [row] = await db
    .select()
    .from(branchAttendanceQrTable)
    .where(
      and(eq(branchAttendanceQrTable.branchId, branchId), eq(branchAttendanceQrTable.status, "active")),
    )
    .orderBy(desc(branchAttendanceQrTable.createdAt))
    .limit(1);
  return row ?? null;
}

export async function revokeActiveQrForBranch(branchId: number) {
  await db
    .update(branchAttendanceQrTable)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(
      and(eq(branchAttendanceQrTable.branchId, branchId), eq(branchAttendanceQrTable.status, "active")),
    );
}
