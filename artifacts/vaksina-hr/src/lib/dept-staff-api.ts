import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type DeptStaffMeta = {
  canAdd: boolean;
  departmentName: string | null;
  roles: Array<{ value: string; label: string }>;
};

export type DeptStaffResult = {
  id: number;
  fullName: string;
  role: string;
  login: string;
  phone: string | null;
  departmentName: string;
  temporaryPassword: string;
  message: string;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || "Xatolik");
  return body as T;
}

export function useDeptStaffMeta(enabled: boolean) {
  return useQuery({
    queryKey: ["dept-staff-meta"],
    queryFn: () => apiFetch<DeptStaffMeta>("/dept-staff/meta"),
    enabled,
    staleTime: 60_000,
  });
}

export function useCreateDeptStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      firstName: string;
      lastName: string;
      phone: string;
      role: string;
    }) =>
      apiFetch<DeptStaffResult>("/dept-staff", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dept-staff-meta"] });
      qc.invalidateQueries({ queryKey: ["/api/users"] });
      qc.invalidateQueries({ queryKey: ["/api/employees"] });
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({
        predicate: (q) => JSON.stringify(q.queryKey).toLowerCase().includes("employee"),
      });
    },
  });
}
