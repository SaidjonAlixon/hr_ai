/**
 * Dollarda belgilangan fiksa: employees.salary_usd saqlanadi, fixed_salary esa
 * Markaziy bank (cbu.uz) kursi bo‘yicha so‘mga aylantirilib turadi.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";

const CBU_URL = "https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/";

export type UsdRate = { rate: number; date: string };

let ready: Promise<void> | null = null;
function ensureTables(): Promise<void> {
  ready ??= pool
    .query(
      `ALTER TABLE employees ADD COLUMN IF NOT EXISTS salary_usd DOUBLE PRECISION;
       CREATE TABLE IF NOT EXISTS usd_rates (
         rate_date TEXT PRIMARY KEY,
         rate DOUBLE PRECISION NOT NULL,
         fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
       );`,
    )
    .then(() => undefined)
    .catch((err) => {
      ready = null;
      throw err;
    });
  return ready;
}

/** «13.10.2026» → «2026-10-13» */
function isoDate(dmy: string): string {
  const [d, m, y] = dmy.split(".");
  return y && m && d ? `${y}-${m}-${d}` : dmy;
}

async function fetchCbuRate(): Promise<UsdRate | null> {
  try {
    const res = await fetch(CBU_URL, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ Rate?: string; Date?: string }>;
    const rate = Number(data?.[0]?.Rate);
    const date = String(data?.[0]?.Date || "");
    if (!Number.isFinite(rate) || rate <= 0 || !date) return null;
    return { rate, date: isoDate(date) };
  } catch (err) {
    logger.warn({ err }, "CBU dollar kursi olinmadi");
    return null;
  }
}

/** Oxirgi saqlangan kurs (internet bo‘lmasa ham ishlaydi) */
export async function latestUsdRate(): Promise<UsdRate | null> {
  await ensureTables();
  const { rows } = await pool.query(`SELECT rate_date, rate FROM usd_rates ORDER BY rate_date DESC LIMIT 1`);
  return rows[0] ? { rate: Number(rows[0].rate), date: String(rows[0].rate_date) } : null;
}

export async function refreshUsdRate(): Promise<UsdRate | null> {
  await ensureTables();
  const fresh = await fetchCbuRate();
  if (fresh) {
    await pool.query(
      `INSERT INTO usd_rates (rate_date, rate) VALUES ($1, $2)
       ON CONFLICT (rate_date) DO UPDATE SET rate = EXCLUDED.rate, fetched_at = now()`,
      [fresh.date, fresh.rate],
    );
    return fresh;
  }
  return latestUsdRate();
}

export const usdToSom = (usd: number, rate: number) => Math.max(0, Math.round(usd * rate));

/** employeeId → dollardagi fiksa */
export async function salaryUsdByEmployee(): Promise<Map<number, number>> {
  await ensureTables();
  const { rows } = await pool.query(`SELECT id, salary_usd FROM employees WHERE salary_usd > 0`);
  return new Map(rows.map((r) => [Number(r.id), Number(r.salary_usd)]));
}

/** null — dollar fiksa olib tashlanadi (so‘mga qaytadi) */
export async function setEmployeeSalaryUsd(employeeId: number, usd: number | null): Promise<void> {
  await ensureTables();
  await pool.query(`UPDATE employees SET salary_usd = $2 WHERE id = $1`, [employeeId, usd && usd > 0 ? usd : null]);
}

/** Joriy oy: dollardagi fiksalarni bugungi kurs bo‘yicha so‘mga qayta hisoblash */
export async function syncUsdSalaries(month: string): Promise<{ rate: UsdRate | null; updated: number }> {
  const rate = await refreshUsdRate();
  if (!rate) return { rate: null, updated: 0 };
  const { rows } = await pool.query(`SELECT id, user_id, salary_usd FROM employees WHERE salary_usd > 0`);
  let updated = 0;
  for (const r of rows) {
    const som = usdToSom(Number(r.salary_usd), rate.rate);
    const res = await pool.query(`UPDATE employees SET fixed_salary = $2 WHERE id = $1 AND fixed_salary <> $2`, [r.id, som]);
    updated += res.rowCount ?? 0;
    if (r.user_id != null) {
      await pool.query(
        `UPDATE payroll_months SET fixed_salary = $3, total_amount = $3 - coalesce(jarima, 0), updated_at = now()
         WHERE user_id = $1 AND month = $2 AND status <> 'approved' AND fixed_salary <> $3`,
        [r.user_id, month, som],
      );
    }
  }
  return { rate, updated };
}
