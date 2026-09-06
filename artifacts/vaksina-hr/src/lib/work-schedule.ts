/** Ish vaqti — backend shift-hours / attendance-engine bilan mos */

export type WorkShiftInfo = {
  type: "one" | "two" | "three" | "office" | string;
  label: string;
  start: string;
  end: string;
  warnHm?: string;
  warnText?: string;
  overnight?: boolean;
  graceMinutes?: number;
};

const PHARMACY_USER_ROLES = new Set(["mudir", "farmasevt", "stajyor"]);

export function normalizeShiftType(
  raw?: string | null,
  shiftLabel?: string | null,
): "one" | "two" | "three" {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (s.includes("three") || s === "3" || s.includes("one+two+three")) return "three";
  if (s === "two" || s === "2" || s.startsWith("two+") || s.includes("+two")) {
    if (s.includes("three")) return "three";
    return "two";
  }
  if (s === "three" || s.startsWith("three")) return "three";
  const lab = String(shiftLabel || "").toLowerCase();
  if (lab.includes("3-smena") || lab.includes("3 smena") || lab.includes("tungi")) return "three";
  if (lab.includes("2-smena") || lab.includes("2 smena")) return "two";
  return "one";
}

export function parseShiftKeys(raw?: string | null): Array<"one" | "two" | "three"> {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return ["one"];
  const parts = s.split(/[+|,/\s]+/).filter(Boolean);
  const out: Array<"one" | "two" | "three"> = [];
  for (const p of parts) {
    if (p === "one" || p === "1") out.push("one");
    else if (p === "two" || p === "2") out.push("two");
    else if (p === "three" || p === "3") out.push("three");
  }
  return out.length ? Array.from(new Set(out)) : ["one"];
}

export function isPharmacyShiftRole(userRole?: string | null): boolean {
  return PHARMACY_USER_ROLES.has(userRole || "");
}

export function workShiftForUserRole(
  userRole?: string | null,
  shiftType?: string | null,
): WorkShiftInfo {
  if (isPharmacyShiftRole(userRole)) {
    const keys = parseShiftKeys(shiftType);
    const primary = keys[0] || normalizeShiftType(shiftType);
    if (primary === "three") {
      return {
        type: "three",
        label: keys.length > 1 ? keys.map((k) => `${k === "three" ? "3" : k === "two" ? "2" : "1"}-smena`).join("+") : "3-smena",
        start: "23:00",
        end: "07:00",
        overnight: true,
        warnHm: "22:45",
        graceMinutes: 15,
      };
    }
    if (primary === "two") {
      return {
        type: keys.length > 1 ? keys.join("+") : "two",
        label: keys.length > 1 ? "2+3 smena" : "2-smena",
        start: "17:00",
        end: keys.includes("three") ? "07:00" : "23:45",
        overnight: keys.includes("three"),
        warnHm: "16:45",
        graceMinutes: 15,
      };
    }
    return {
      type: keys.length > 1 ? keys.join("+") : "one",
      label: keys.length > 1 ? "1+2 smena" : "1-smena",
      start: "08:00",
      end: keys.includes("two") ? "23:45" : "17:00",
      warnHm: "07:45",
      graceMinutes: 15,
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
  labels?: { mainOffice?: string; branchUnset?: string },
): string {
  if (!isPharmacyShiftRole(userRole)) return labels?.mainOffice || "Asosiy Ofis";
  const raw =
    (site?.kind === "branch" ? site.label : null) || employeeLocation || site?.label || "";
  const cleaned = raw.split("·")[0].split("|")[0].trim();
  return cleaned || labels?.branchUnset || "Filial belgilanmagan";
}

export const PUNCH_FINE_HINT =
  "Oldin kelib, keyin ketsangiz jarima olmaysiz — aks holda jarima tushadi.";

export function punchPlanLabel(kind: "in" | "out", time: string): string {
  return kind === "in" ? `${time} dan oldin keling` : `${time} dan keyin keting!`;
}
