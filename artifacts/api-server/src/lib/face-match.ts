import { eq } from "drizzle-orm";
import { db, faceProfilesTable, usersTable } from "@workspace/db";

export const FACE_DESCRIPTOR_LEN = 128;
export const FACE_MATCH_MAX = 0.48;

export function parseFaceDescriptor(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length !== FACE_DESCRIPTOR_LEN) return null;
  const out: number[] = [];
  for (const n of raw) {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    out.push(n);
  }
  return out;
}

export function euclidean(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return Math.sqrt(s);
}

type FaceHit = { id: number; userId: number; dist: number };

async function loadFaceRows() {
  return db
    .select({
      id: faceProfilesTable.id,
      userId: faceProfilesTable.userId,
      descriptor: faceProfilesTable.descriptor,
    })
    .from(faceProfilesTable);
}

function parseStored(raw: string): number[] | null {
  try {
    const stored = JSON.parse(raw) as number[];
    if (!Array.isArray(stored) || stored.length !== FACE_DESCRIPTOR_LEN) return null;
    return stored;
  } catch {
    return null;
  }
}

/** Eng yaqin yuz (ixtiyoriy: boshqa userlarni qidirish) */
export async function findClosestFace(
  descriptor: number[],
  opts?: { excludeUserId?: number },
): Promise<FaceHit | null> {
  const rows = await loadFaceRows();
  let best: FaceHit | null = null;
  for (const row of rows) {
    if (opts?.excludeUserId != null && row.userId === opts.excludeUserId) continue;
    const stored = parseStored(row.descriptor);
    if (!stored) continue;
    const dist = euclidean(descriptor, stored);
    if (!best || dist < best.dist) best = { id: row.id, userId: row.userId, dist };
  }
  if (!best || best.dist > FACE_MATCH_MAX) return null;
  return best;
}

export async function ownerNameOfUser(userId: number): Promise<string | null> {
  const [u] = await db
    .select({ fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return u?.fullName ?? null;
}

/** Login / davomat: bitta aniq egasi bo‘lishi shart */
export async function matchFaceForAuth(
  descriptor: number[],
): Promise<
  | { ok: true; id: number; userId: number }
  | { ok: false; error: string; code: string }
> {
  const rows = await loadFaceRows();
  let best: FaceHit | null = null;
  let second = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const stored = parseStored(row.descriptor);
    if (!stored) continue;
    const dist = euclidean(descriptor, stored);
    if (!best || dist < best.dist) {
      second = best?.dist ?? Number.POSITIVE_INFINITY;
      best = { id: row.id, userId: row.userId, dist };
    } else if (dist < second) {
      second = dist;
    }
  }

  if (!best || best.dist > FACE_MATCH_MAX) {
    return {
      ok: false,
      error: "Bu yuz aniqlanmadi. Avval tizimga kirib Face ID ni ro‘yxatdan o‘tkazing.",
      code: "face_not_registered",
    };
  }
  if (second - best.dist < 0.06 && second <= FACE_MATCH_MAX) {
    return {
      ok: false,
      error: "Bu yuz bir nechta profilga o‘xshaydi — Face ID faqat bitta xodimga birikadi.",
      code: "face_ambiguous",
    };
  }
  return { ok: true, id: best.id, userId: best.userId };
}
