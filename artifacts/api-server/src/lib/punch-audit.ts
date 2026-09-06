/** Davomat punch audit — har urinish */
import { db, attendancePunchAuditTable } from "@workspace/db";

export type PunchAuditInput = {
  employeeId?: number | null;
  userId?: number | null;
  branchId?: number | null;
  verificationMethod?: "FACE_ID" | "QR" | null;
  action?: "in" | "out" | null;
  gpsResult?: string | null;
  gpsDistance?: number | null;
  faceResult?: string | null;
  qrResult?: string | null;
  finalResult: "success" | "denied" | "error";
  failureReason?: string | null;
  deviceId?: string | null;
  ipAddress?: string | null;
  meta?: Record<string, unknown>;
};

export async function writePunchAudit(input: PunchAuditInput): Promise<void> {
  try {
    await db.insert(attendancePunchAuditTable).values({
      employeeId: input.employeeId ?? null,
      userId: input.userId ?? null,
      branchId: input.branchId ?? null,
      verificationMethod: input.verificationMethod ?? null,
      action: input.action ?? null,
      gpsResult: input.gpsResult ?? null,
      gpsDistance: input.gpsDistance ?? null,
      faceResult: input.faceResult ?? null,
      qrResult: input.qrResult ?? null,
      finalResult: input.finalResult,
      failureReason: input.failureReason ?? null,
      deviceId: input.deviceId ?? null,
      ipAddress: input.ipAddress ?? null,
      meta: input.meta ?? null,
    });
  } catch (err) {
    console.warn("punch audit write failed:", err);
  }
}

export function clientIp(req: { headers?: Record<string, unknown>; ip?: string; socket?: { remoteAddress?: string } }): string | null {
  const xf = req.headers?.["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0]!.trim();
  if (Array.isArray(xf) && xf[0]) return String(xf[0]).split(",")[0]!.trim();
  return req.ip || req.socket?.remoteAddress || null;
}
