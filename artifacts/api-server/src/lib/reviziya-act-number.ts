import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db, revisionVisitsTable } from "@workspace/db";
import { tashkentYmd } from "./reviziya-cycle";

/** Takrorlanmas akt raqami: AKT-YYYYMMDD-XXXXXX */
export async function generateUniqueActNumber(): Promise<string> {
  const ymd = tashkentYmd().replace(/-/g, "");
  for (let attempt = 0; attempt < 16; attempt++) {
    const rand = randomBytes(3).toString("hex").toUpperCase();
    const code = `AKT-${ymd}-${rand}`;
    const [dup] = await db
      .select({ id: revisionVisitsTable.id })
      .from(revisionVisitsTable)
      .where(eq(revisionVisitsTable.actNumber, code))
      .limit(1);
    if (!dup) return code;
  }
  return `AKT-${ymd}-${randomBytes(5).toString("hex").toUpperCase()}`;
}

/** Bo‘sh yoki berilgan — har holda unique saqlanadi */
export async function resolveActNumber(raw?: string | null): Promise<string> {
  const trimmed = String(raw || "").trim();
  if (trimmed) {
    const [dup] = await db
      .select({ id: revisionVisitsTable.id })
      .from(revisionVisitsTable)
      .where(eq(revisionVisitsTable.actNumber, trimmed))
      .limit(1);
    if (!dup) return trimmed;
  }
  return generateUniqueActNumber();
}
