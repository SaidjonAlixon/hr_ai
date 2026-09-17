/** Frontend display helpers — status hisobi backenddan keladi. */

export const CYCLE_STATUS_LABEL: Record<string, string> = {
  YANGI_OCHILGAN: "Yangi ochilgan",
  REJADAGIDEK: "Rejadagidek",
  TEZ_ORADA: "Tez orada",
  MUDDATI_OTGAN: "Muddati o‘tgan",
  SIKL_OTKAZIB_YUBORILGAN: "Sikl o‘tkazib yuborilgan",
  REVIZIYA_JARAYONIDA: "Reviziya jarayonida",
  REVIZIYA_YAKUNLANGAN: "Reviziya yakunlangan",
};

export const CYCLE_STATUS_TONE: Record<string, string> = {
  YANGI_OCHILGAN: "bg-sky-100 text-sky-900",
  REJADAGIDEK: "bg-emerald-100 text-emerald-900",
  TEZ_ORADA: "bg-amber-100 text-amber-900",
  MUDDATI_OTGAN: "bg-rose-100 text-rose-900",
  SIKL_OTKAZIB_YUBORILGAN: "bg-fuchsia-100 text-fuchsia-900",
  REVIZIYA_JARAYONIDA: "bg-indigo-100 text-indigo-900",
  REVIZIYA_YAKUNLANGAN: "bg-teal-100 text-teal-900",
};

export const WORKFLOW_STATUS_LABEL: Record<string, string> = {
  ASSIGNED: "Biriktirilgan",
  ACCEPTED: "Qabul qilingan",
  IN_PROGRESS: "Jarayonda",
  COMPLETED: "Yakunlangan",
  CANCELLED: "Bekor qilingan",
};

export function moneySoum(n: number) {
  return `${new Intl.NumberFormat("uz-UZ").format(Math.round(n || 0))} so‘m`;
}

export function formatYmd(ymd?: string | null) {
  if (!ymd) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  return `${m[3]}.${m[2]}.${m[1]}`;
}
