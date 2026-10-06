import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

export type DavomatMethod = "FACE_ID" | "QR" | "FINGERPRINT";

export function effectiveDavomatAccess(
  role: string | null | undefined,
  face: boolean | null | undefined,
  qr: boolean | null | undefined,
  finger?: boolean | null,
) {
  const faceOn = face !== false;
  const qrOn = qr === true ? true : qr === false ? false : role !== "koordinator";
  const fingerOn = finger === true;
  const methods: DavomatMethod[] = [];
  if (faceOn) methods.push("FACE_ID");
  if (qrOn) methods.push("QR");
  if (fingerOn) methods.push("FINGERPRINT");
  return { face: faceOn, qr: qrOn, finger: fingerOn, methods };
}

export async function readDavomatAccess(userId: number) {
  const [row] = await db
    .select({
      role: usersTable.role,
      face: usersTable.davomatFaceAllowed,
      qr: usersTable.davomatQrAllowed,
      finger: usersTable.davomatFingerAllowed,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!row) return effectiveDavomatAccess("", true, true, false);
  return effectiveDavomatAccess(row.role, row.face, row.qr, row.finger);
}

export const METHOD_FORBIDDEN = "Aynan sizga ruxsat yo‘q";
