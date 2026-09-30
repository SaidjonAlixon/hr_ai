/** «2-smena — xodim kerak» kabi bo‘sh o‘rin. Haqiqiy xodim emas. */
export function isVacancyPlaceholder(p: {
  fullName?: string | null;
  userId?: number | null;
  employmentStatus?: string | null;
}): boolean {
  if (/xodim kerak/i.test(String(p.fullName || ""))) return true;
  return p.employmentStatus === "need_hire" && (p.userId == null || p.userId === 0);
}
