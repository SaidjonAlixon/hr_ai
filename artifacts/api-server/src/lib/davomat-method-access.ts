import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

export type DavomatMethod = "FACE_ID" | "QR";

export function effectiveDavomatAccess(
  role: string | null | undefined,
  face: boolean | null | undefined,
  qr: boolean | null | undefined,
) {
  const faceOn = face !== false;
  const qrOn = qr === true ? true : qr === false ? false : role !== "koordinator";
  const methods: DavomatMethod[] = [];
  if (faceOn) methods.push("FACE_ID");
  if (qrOn) methods.push("QR");
  return { face: faceOn, qr: qrOn, methods };
}

export async function readDavomatAccess(userId: number) {
  const [row] = await db
    .select({
      role: usersTable.role,
      face: usersTable.davomatFaceAllowed,
      qr: usersTable.davomatQrAllowed,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!row) return effectiveDavomatAccess("", true, true);
  return effectiveDavomatAccess(row.role, row.face, row.qr);
}

export const METHOD_FORBIDDEN = "Aynan sizga ruxsat yo‘q";
