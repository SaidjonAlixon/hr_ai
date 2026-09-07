/**
 * Ofis bo‘limi davomat QR — VMHR1 payload (filial QR bilan bir xil format).
 */
import { and, desc, eq } from "drizzle-orm";
import { db, departmentAttendanceQrTable } from "@workspace/db";
import {
  encodeQrPayload,
  hashQrToken,
  mintQrSecrets,
  parseQrPayload,
} from "./branch-attendance-qr";

export { encodeQrPayload, mintQrSecrets, parseQrPayload, hashQrToken };

export type DeptQrVerifyOk = {
  ok: true;
  row: typeof departmentAttendanceQrTable.$inferSelect;
};

export type DeptQrVerifyFail = {
  ok: false;
  code: string;
  error: string;
};

export async function verifyDepartmentQrPayload(
  payload: string,
): Promise<DeptQrVerifyOk | DeptQrVerifyFail> {
  const parsed = parseQrPayload(payload);
  if (!parsed) {
    return { ok: false, code: "qr_invalid", error: "QR kod noto‘g‘ri formatda" };
  }
  const [row] = await db
    .select()
    .from(departmentAttendanceQrTable)
    .where(eq(departmentAttendanceQrTable.qrId, parsed.qrId))
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

export async function getActiveQrForDepartment(departmentId: number) {
  const [row] = await db
    .select()
    .from(departmentAttendanceQrTable)
    .where(
      and(
        eq(departmentAttendanceQrTable.departmentId, departmentId),
        eq(departmentAttendanceQrTable.status, "active"),
      ),
    )
    .orderBy(desc(departmentAttendanceQrTable.createdAt))
    .limit(1);
  return row ?? null;
}

export async function revokeActiveQrForDepartment(departmentId: number) {
  await db
    .update(departmentAttendanceQrTable)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(
      and(
        eq(departmentAttendanceQrTable.departmentId, departmentId),
        eq(departmentAttendanceQrTable.status, "active"),
      ),
    );
}
