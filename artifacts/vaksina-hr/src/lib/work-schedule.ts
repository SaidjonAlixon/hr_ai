/** Ish vaqti — backend shift-hours.ts bilan mos */

export type WorkShiftInfo = {
  type: "one" | "two" | "office";
  label: string;
  start: string;
  end: string;
  warnHm?: string;
  warnText?: string;
};

const PHARMACY_USER_ROLES = new Set(["mudir", "farmasevt", "stajyor"]);

export function normalizeShiftType(raw?: string | null, shiftLabel?: string | null): "one" | "two" {
  const s = (raw || "").trim().toLowerCase();
  if (s === "two" || s === "2") return "two";
  const lab = (shiftLabel || "").toLowerCase();
  if (lab.includes("2-smena") || lab.includes("2 smena")) return "two";
  return "one";
}

export function isPharmacyShiftRole(userRole?: string | null): boolean {
  return PHARMACY_USER_ROLES.has(userRole || "");
}

export function workShiftForUserRole(
  userRole?: string | null,
  shiftType?: string | null,
): WorkShiftInfo {
  if (isPharmacyShiftRole(userRole)) {
    if (normalizeShiftType(shiftType) === "two") {
      return {
        type: "two",
        label: "2-smena",
        start: "17:00",
        end: "23:45",
        warnHm: "16:45",
      };
    }
    return {
      type: "one",
      label: "1-smena",
      start: "08:00",
      end: "17:00",
      warnHm: "07:45",
    };
  }
  return {
    type: "office",
    label: "Asosiy Ofis",
    start: "09:00",
    end: "18:00",
    warnHm: "08:45",
  };
}

/** Hero kartochkada «Ish joyi» ostidagi nom */
export function workplaceDisplayTitle(
  userRole?: string | null,
  site?: { kind?: "branch" | "office"; label?: string } | null,
  employeeLocation?: string | null,
): string {
  if (!isPharmacyShiftRole(userRole)) return "Asosiy Ofis";
  const raw =
    (site?.kind === "branch" ? site.label : null) || employeeLocation || site?.label || "";
  const cleaned = raw.split("·")[0].split("|")[0].trim();
  return cleaned || "Filial belgilanmagan";
}

export const PUNCH_FINE_HINT =
  "Oldin kelib, keyin ketsangiz jarima olmaysiz — aks holda jarima tushadi.";

export function punchPlanLabel(kind: "in" | "out", time: string): string {
  return kind === "in" ? `${time} dan oldin keling` : `${time} dan keyin keting!`;
}
