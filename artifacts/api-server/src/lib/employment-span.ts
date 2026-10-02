/** Xodim davomat oynasi: tizimga kirgan kundan bo‘shatilgan kungacha. */

export type EmploymentPhase = "active" | "prehire" | "outside";

export function tashkentYmd(value: Date | string | null | undefined): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function monthStartYmd(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

/**
 * active — ish kuni, davomat hisoblanadi
 * prehire — qabul oyi ichida, qabul kunidan oldin (qizil izoh, jarimasiz)
 * outside — oldingi oy yoki bo‘shatilgandan keyin (ko‘rinmaydi, hisoblanmaydi)
 */
export function employmentPhase(
  date: string,
  hiredYmd: string | null | undefined,
  dismissedYmd: string | null | undefined,
): EmploymentPhase {
  const hired = hiredYmd && /^\d{4}-\d{2}-\d{2}/.test(hiredYmd) ? hiredYmd.slice(0, 10) : null;
  const dismissed =
    dismissedYmd && /^\d{4}-\d{2}-\d{2}/.test(dismissedYmd) ? dismissedYmd.slice(0, 10) : null;
  if (dismissed && date > dismissed) return "outside";
  if (hired && date < hired) {
    return date.slice(0, 7) === hired.slice(0, 7) ? "prehire" : "outside";
  }
  return "active";
}

/** Hisobot oralig‘i qabul oyi yoki ish davri bilan kesishadimi. */
export function employmentOverlaps(
  from: string,
  to: string,
  hiredYmd: string | null | undefined,
  dismissedYmd: string | null | undefined,
): boolean {
  const hired = hiredYmd && /^\d{4}-\d{2}-\d{2}/.test(hiredYmd) ? hiredYmd.slice(0, 10) : null;
  const dismissed =
    dismissedYmd && /^\d{4}-\d{2}-\d{2}/.test(dismissedYmd) ? dismissedYmd.slice(0, 10) : null;
  const visibleFrom = hired ? monthStartYmd(hired) : "1970-01-01";
  const visibleTo = dismissed || "2999-12-31";
  return visibleFrom <= to && visibleTo >= from;
}
