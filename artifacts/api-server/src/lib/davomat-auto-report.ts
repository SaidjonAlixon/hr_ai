/**
 * Avtomatik «Hisobot yuborish»: HR tanlagan sozlama bilan belgilangan oraliqda har N daqiqada.
 * Vaqtlar «dan» soatidan boshlab sanaladi: 09:00, har 60 daqiqa → 09:00, 10:00, 11:00 …
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";
import {
  parseShiftBuckets,
  sendCoordinatorReportsNow,
  type ReportSendMode,
} from "./davomat-coordinator-send";
import { tashkentNow } from "./davomat-shift-report";
import type { ReportListKind } from "./davomat-shift-report-pdf";
import type { ShiftBucket } from "./davomat-shift-report";

export type AutoReportSettings = {
  mode: ReportSendMode;
  lists: ReportListKind[];
  coordinatorIds: number[];
  buckets: ShiftBucket[];
  toPersonal: boolean;
  toGroup: boolean;
};

export type AutoReportConfig = {
  enabled: boolean;
  intervalMin: number;
  fromHm: string;
  toHm: string;
  settings: AutoReportSettings;
  lastSentAt: string | null;
  nextAt: string | null;
  updatedBy: string | null;
};

const DEFAULT_SETTINGS: AutoReportSettings = {
  mode: "coordinators",
  lists: ["absent", "late"],
  coordinatorIds: [],
  buckets: [],
  toPersonal: true,
  toGroup: true,
};

let schemaReady: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = pool
      .query(`
CREATE TABLE IF NOT EXISTS davomat_auto_report (
  id INTEGER PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  interval_min INTEGER NOT NULL DEFAULT 60,
  from_hm TEXT NOT NULL DEFAULT '09:00',
  to_hm TEXT NOT NULL DEFAULT '21:00',
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_sent_at TIMESTAMPTZ,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`)
      .then(() => undefined)
      .catch((err) => {
        schemaReady = null;
        throw err;
      });
  }
  return schemaReady;
}

const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function toMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h! * 60 + m!;
}

function fromMin(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function normalizeSettings(raw: unknown): AutoReportSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const lists = (Array.isArray(s.lists) ? s.lists : DEFAULT_SETTINGS.lists).filter(
    (k): k is ReportListKind => k === "absent" || k === "late" || k === "present",
  );
  return {
    mode: s.mode === "director" ? "director" : "coordinators",
    lists: lists.length ? lists : DEFAULT_SETTINGS.lists,
    coordinatorIds: (Array.isArray(s.coordinatorIds) ? s.coordinatorIds : [])
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 500),
    buckets: parseShiftBuckets(s.buckets),
    toPersonal: s.toPersonal !== false,
    toGroup: s.toGroup !== false,
  };
}

/** Joriy vaqtgacha bo‘lgan oxirgi slot (bugun), oraliqdan tashqarida — null */
function currentSlot(cfg: { intervalMin: number; fromHm: string; toHm: string }, nowMin: number): number | null {
  const from = toMin(cfg.fromHm);
  const to = toMin(cfg.toHm);
  if (nowMin < from || nowMin > to) return null;
  return from + Math.floor((nowMin - from) / cfg.intervalMin) * cfg.intervalMin;
}

function nextSlot(cfg: { enabled: boolean; intervalMin: number; fromHm: string; toHm: string }): string | null {
  if (!cfg.enabled) return null;
  const now = tashkentNow();
  const nowMin = now.hour * 60 + now.minute;
  const from = toMin(cfg.fromHm);
  const to = toMin(cfg.toHm);
  if (nowMin < from) return `bugun ${cfg.fromHm}`;
  const next = from + (Math.floor((nowMin - from) / cfg.intervalMin) + 1) * cfg.intervalMin;
  if (next <= to) return `bugun ${fromMin(next)}`;
  return `ertaga ${cfg.fromHm}`;
}

export async function getAutoReportConfig(): Promise<AutoReportConfig> {
  await ensureSchema();
  const { rows } = await pool.query(`SELECT * FROM davomat_auto_report WHERE id = 1`);
  const r = rows[0];
  const base = {
    enabled: Boolean(r?.enabled),
    intervalMin: Number(r?.interval_min) || 60,
    fromHm: String(r?.from_hm || "09:00"),
    toHm: String(r?.to_hm || "21:00"),
  };
  return {
    ...base,
    settings: r ? normalizeSettings(r.settings) : DEFAULT_SETTINGS,
    lastSentAt: r?.last_sent_at ? new Date(r.last_sent_at).toISOString() : null,
    nextAt: nextSlot(base),
    updatedBy: r?.updated_by ?? null,
  };
}

export async function saveAutoReportConfig(
  input: { enabled: unknown; intervalMin: unknown; fromHm: unknown; toHm: unknown; settings: unknown },
  actor: string,
): Promise<AutoReportConfig> {
  await ensureSchema();
  const intervalMin = Math.round(Number(input.intervalMin));
  if (!Number.isFinite(intervalMin) || intervalMin < 15 || intervalMin > 720) {
    throw new Error("Oraliq 15 daqiqadan 12 soatgacha bo‘lishi kerak");
  }
  const fromHm = String(input.fromHm || "");
  const toHm = String(input.toHm || "");
  if (!HM_RE.test(fromHm) || !HM_RE.test(toHm)) throw new Error("Vaqt noto‘g‘ri (SS:DD)");
  if (toMin(toHm) <= toMin(fromHm)) throw new Error("Tugash vaqti boshlanishdan keyin bo‘lishi kerak");
  const settings = normalizeSettings(input.settings);
  if (!settings.toPersonal && !settings.toGroup) throw new Error("Qayerga yuborishni tanlang");
  await pool.query(
    `INSERT INTO davomat_auto_report (id, enabled, interval_min, from_hm, to_hm, settings, updated_by, updated_at, last_sent_at)
     VALUES (1, $1, $2, $3, $4, $5::jsonb, $6, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled, interval_min = EXCLUDED.interval_min,
       from_hm = EXCLUDED.from_hm, to_hm = EXCLUDED.to_hm, settings = EXCLUDED.settings,
       updated_by = EXCLUDED.updated_by, updated_at = NOW(), last_sent_at = NOW()`,
    [Boolean(input.enabled), intervalMin, fromHm, toHm, JSON.stringify(settings), actor],
  );
  logger.info({ enabled: Boolean(input.enabled), intervalMin, fromHm, toHm, actor }, "Davomat avto-hisobot sozlandi");
  return getAutoReportConfig();
}

/** Har daqiqada: joriy slot hali yuborilmagan bo‘lsa — bitta jarayon band qilib yuboradi */
export async function autoReportTick(): Promise<void> {
  const cfg = await getAutoReportConfig();
  if (!cfg.enabled) return;
  const now = tashkentNow();
  const slot = currentSlot(cfg, now.hour * 60 + now.minute);
  if (slot == null) return;
  const slotAt = new Date(`${now.ymd}T${fromMin(slot)}:00+05:00`);
  const { rowCount } = await pool.query(
    `UPDATE davomat_auto_report SET last_sent_at = NOW()
      WHERE id = 1 AND enabled AND (last_sent_at IS NULL OR last_sent_at < $1)`,
    [slotAt],
  );
  if (!rowCount) return;
  const result = await sendCoordinatorReportsNow({ ...cfg.settings, actorName: "Avtomatik" });
  logger.info({ slot: fromMin(slot), ...result }, "Davomat avto-hisobot yuborildi");
}
