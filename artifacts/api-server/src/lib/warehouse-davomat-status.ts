/**
 * Omborxona kunlik davomat — «Kelmagan» o‘rniga smena holati.
 *
 * ≤09:30 kelgan → Ertalabki smena
 * Kelmagan / 09:30 dan keyin → Kechgi smena (Kelmagan emas)
 * ≥18:00 kelgan → Ishda
 * Omborxona uchun Kelmagan hisobi 0 qoladi.
 */

export const WAREHOUSE_MORNING_CUTOFF_HM = "09:30";
export const WAREHOUSE_EVENING_ARRIVAL_HM = "18:00";

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export const WH_STATUS_MORNING = "wh_morning";
export const WH_STATUS_EVENING = "wh_evening";
export const WH_STATUS_ONDUTY = "wh_onduty";

export const WH_LABEL_MORNING = "Ertalabki smena";
export const WH_LABEL_EVENING = "Kechgi smena";
export const WH_LABEL_ONDUTY = "Ishda";

const WH_STATUSES = new Set([WH_STATUS_MORNING, WH_STATUS_EVENING, WH_STATUS_ONDUTY]);

export function isWarehouseDavomatStatus(status?: string | null): boolean {
  return WH_STATUSES.has(String(status || "").trim());
}

/** Kelmagan deb hisoblanmasin (filtr / KPI) */
export function isWarehouseNonAbsentStatus(status?: string | null): boolean {
  return isWarehouseDavomatStatus(status);
}

export function warehouseStatusLabel(status?: string | null): string | null {
  const st = String(status || "").trim();
  if (st === WH_STATUS_MORNING) return WH_LABEL_MORNING;
  if (st === WH_STATUS_EVENING) return WH_LABEL_EVENING;
  if (st === WH_STATUS_ONDUTY) return WH_LABEL_ONDUTY;
  return null;
}

/** Kelish HH:mm (yoki null) → omborxona holati */
export function resolveWarehouseDavomatStatus(checkInHm: string | null | undefined): {
  status: typeof WH_STATUS_MORNING | typeof WH_STATUS_EVENING | typeof WH_STATUS_ONDUTY;
  label: string;
  shiftLabel: string;
} {
  const hm = String(checkInHm || "").trim();
  if (!hm || hm === "—" || !/^\d{1,2}:\d{2}$/.test(hm)) {
    return {
      status: WH_STATUS_EVENING,
      label: WH_LABEL_EVENING,
      shiftLabel: WH_LABEL_EVENING,
    };
  }
  const arrived = hmToMinutes(hm);
  if (arrived <= hmToMinutes(WAREHOUSE_MORNING_CUTOFF_HM)) {
    return {
      status: WH_STATUS_MORNING,
      label: WH_LABEL_MORNING,
      shiftLabel: WH_LABEL_MORNING,
    };
  }
  if (arrived >= hmToMinutes(WAREHOUSE_EVENING_ARRIVAL_HM)) {
    return {
      status: WH_STATUS_ONDUTY,
      label: WH_LABEL_ONDUTY,
      shiftLabel: WH_LABEL_EVENING,
    };
  }
  return {
    status: WH_STATUS_EVENING,
    label: WH_LABEL_EVENING,
    shiftLabel: WH_LABEL_EVENING,
  };
}

export function formatHmFromDate(
  d: Date | null | undefined,
  fmt: (d: Date) => string,
): string | null {
  if (!d) return null;
  try {
    return fmt(d);
  } catch {
    return null;
  }
}
