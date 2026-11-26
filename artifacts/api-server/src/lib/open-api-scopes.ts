/** Tashqi read-only API scope katalogi */
export type OpenApiScopeDef = {
  id: string;
  label: string;
  description: string;
  path: string;
};

export const OPEN_API_SCOPES: OpenApiScopeDef[] = [
  {
    id: "employees.read",
    label: "Xodimlar",
    description: "Xodimlar ro‘yxati (F.I.Sh, lavozim, filial, holat)",
    path: "/employees",
  },
  {
    id: "attendance.read",
    label: "Davomat",
    description: "Kunlik kelish–ketish yozuvlari",
    path: "/attendance",
  },
  {
    id: "branches.read",
    label: "Filiallar",
    description: "Dorixona / filial mudirlari va joylashuv",
    path: "/branches",
  },
  {
    id: "departments.read",
    label: "Bo‘limlar",
    description: "Tashkilot bo‘limlari",
    path: "/departments",
  },
  {
    id: "payroll.read",
    label: "Oylik",
    description: "Oylik hisob-kitob oylari (snapshot)",
    path: "/payroll",
  },
  {
    id: "candidates.read",
    label: "Nomzodlar",
    description: "Ishga olish nomzodlari",
    path: "/candidates",
  },
  {
    id: "vacancies.read",
    label: "Vakansiyalar",
    description: "Ochiq va yopiq vakansiyalar",
    path: "/vacancies",
  },
  {
    id: "tasks.read",
    label: "Vazifalar",
    description: "Topshiriqlar ro‘yxati",
    path: "/tasks",
  },
  {
    id: "users.read",
    label: "Foydalanuvchilar",
    description: "Platforma akkauntlari (login/parol/admin yo‘q)",
    path: "/users",
  },
  {
    id: "discipline.read",
    label: "Intizom",
    description: "Intizom hodisalari (oylik)",
    path: "/discipline",
  },
];

export const OPEN_API_SCOPE_IDS = OPEN_API_SCOPES.map((s) => s.id);

export function isValidScope(id: string): boolean {
  return OPEN_API_SCOPE_IDS.includes(id);
}

export function scopeForPath(pathname: string): string | null {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const hit = OPEN_API_SCOPES.find((s) => clean === s.path || clean.endsWith(s.path));
  return hit?.id ?? null;
}
