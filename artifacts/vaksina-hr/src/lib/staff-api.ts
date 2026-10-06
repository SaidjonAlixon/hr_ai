import type { Employee } from "@workspace/api-client-react";

export type StaffGroup = "active" | "other";

export async function fetchStaff(
  group: StaffGroup,
  params?: {
    search?: string;
    departmentId?: string;
    workplace?: string;
    role?: string;
    status?: string;
    /** Mudiri (user) yo‘q bo‘sh filial qatorlari ham kelsin — filiallar tarmog‘i uchun */
    includeVacantBranches?: boolean;
  },
): Promise<Employee[]> {
  const qs = new URLSearchParams();
  qs.set("group", group);
  if (params?.search?.trim()) qs.set("search", params.search.trim());
  if (params?.departmentId && params.departmentId !== "all") {
    qs.set("departmentId", params.departmentId);
  }
  if (params?.workplace) {
    qs.set("workplace", params.workplace);
  }
  if (params?.role && params.role !== "all") {
    qs.set("role", params.role);
  }
  if (params?.status && params.status !== "all") {
    qs.set("status", params.status);
  }
  if (params?.includeVacantBranches) qs.set("includeVacantBranches", "1");
  const res = await fetch(`/api/employees?${qs.toString()}`, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || "Xodimlar yuklanmadi");
  }
  return res.json() as Promise<Employee[]>;
}

export function staffQueryKey(
  group: StaffGroup,
  search: string,
  deptFilter: string,
  workplace: string = "ofis",
  roleFilter: string = "all",
  statusFilter: string = "all",
) {
  return ["staff", group, search.trim(), deptFilter, workplace, roleFilter, statusFilter] as const;
}
