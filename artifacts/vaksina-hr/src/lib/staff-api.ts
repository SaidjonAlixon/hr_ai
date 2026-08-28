import type { Employee } from "@workspace/api-client-react";

export type StaffGroup = "active" | "other";

export async function fetchStaff(
  group: StaffGroup,
  params?: { search?: string; departmentId?: string },
): Promise<Employee[]> {
  const qs = new URLSearchParams();
  qs.set("group", group);
  if (params?.search?.trim()) qs.set("search", params.search.trim());
  if (params?.departmentId && params.departmentId !== "all") {
    qs.set("departmentId", params.departmentId);
  }
  const res = await fetch(`/api/employees?${qs.toString()}`, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || "Xodimlar yuklanmadi");
  }
  return res.json() as Promise<Employee[]>;
}

export function staffQueryKey(group: StaffGroup, search: string, deptFilter: string) {
  return ["staff", group, search.trim(), deptFilter] as const;
}
