import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type DepartmentJobTitle = {
  id: number;
  /** null = hech qaysi bo‘limga bog‘lanmagan umumiy lavozim/rol */
  departmentId: number | null;
  title: string;
  sortOrder: number;
  active: boolean;
  staffCount: number;
  createdAt: string;
};

export type DepartmentTitlesData = {
  titles: DepartmentJobTitle[];
  staffByDepartment: Record<string, number>;
};

/** Har yangi bo‘limga avtomatik ochiladigan lavozimlar (backend bilan bir xil) */
export const DEFAULT_DEPARTMENT_TITLES = ["Bo‘lim boshlig‘i", "Bo‘lim xodimi"];

export const TITLE_SUGGESTIONS = [
  "Bo‘lim boshlig‘i o‘rinbosari",
  "Bosh mutaxassis",
  "Yetakchi mutaxassis",
  "Mutaxassis",
  "Menejer",
  "Operator",
  "Stajyor",
];

export const GLOBAL_TITLE_SUGGESTIONS = [
  "Direktor",
  "Direktor o‘rinbosari",
  "HR menejer",
  "Trener",
  "Koordinator",
  "Haydovchi",
  "Omborchi",
];

const KEY = ["department-job-titles"] as const;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let message = "Xatolik";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json();
}

export function useDepartmentTitles() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => json<DepartmentTitlesData>("/api/department-job-titles"),
    staleTime: 30_000,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: KEY });
}

export function useAddDepartmentTitle() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (p: { departmentId: number; title?: string; defaults?: boolean }) =>
      json<{ ok: boolean; reactivated?: boolean }>(`/api/departments/${p.departmentId}/job-titles`, {
        method: "POST",
        body: JSON.stringify(p.defaults ? { defaults: true } : { title: p.title }),
      }),
    onSuccess: invalidate,
  });
}

/** Bo‘limga bog‘lanmagan umumiy lavozim/rol */
export function useAddGlobalJobTitle() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (p: { title: string }) =>
      json<{ ok: boolean; reactivated?: boolean }>("/api/job-titles", {
        method: "POST",
        body: JSON.stringify({ title: p.title }),
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateDepartmentTitle() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (p: { departmentId: number | null; id: number; title?: string; active?: boolean }) => {
      if (p.departmentId == null) {
        return json<{ ok: boolean }>(`/api/job-titles/${p.id}`, {
          method: "PATCH",
          body: JSON.stringify({ title: p.title, active: p.active }),
        });
      }
      return json<{ ok: boolean }>(`/api/departments/${p.departmentId}/job-titles/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: p.title, active: p.active }),
      });
    },
    onSuccess: invalidate,
  });
}

export function useRemoveDepartmentTitle() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (p: { departmentId: number | null; id: number }) => {
      if (p.departmentId == null) {
        return json<{ ok: boolean; deleted?: boolean; deactivated?: boolean; staff?: number }>(`/api/job-titles/${p.id}`, {
          method: "DELETE",
        });
      }
      return json<{ ok: boolean; deleted?: boolean; deactivated?: boolean; staff?: number }>(
        `/api/departments/${p.departmentId}/job-titles/${p.id}`,
        { method: "DELETE" },
      );
    },
    onSuccess: invalidate,
  });
}

export function invalidateDepartmentTitles(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: KEY });
}
