import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type DistribJobTitle = {
  id: number;
  title: string;
  sortOrder: number;
  active: boolean;
};

export type DistribStaffRow = {
  userId: number;
  fullName: string;
  role: string;
  login: string;
  phone: string | null;
  status: string | null;
  employeeId: number | null;
  position: string | null;
  hiredAt: string | null;
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

export function useDistribMeta(enabled = true) {
  return useQuery({
    queryKey: ["distribyutsiya", "meta"],
    queryFn: () =>
      apiFetch<{
        departmentId: number;
        departmentName: string;
        canManage: boolean;
        canAddStaff: boolean;
        titles: DistribJobTitle[];
      }>("/distribyutsiya/meta"),
    enabled,
  });
}

export function useDistribStaff(enabled = true) {
  return useQuery({
    queryKey: ["distribyutsiya", "staff"],
    queryFn: () =>
      apiFetch<{
        departmentId: number;
        departmentName: string;
        staff: DistribStaffRow[];
      }>("/distribyutsiya/staff"),
    enabled,
  });
}

export function useDistribJobTitles(enabled = true) {
  return useQuery({
    queryKey: ["distribyutsiya", "job-titles"],
    queryFn: () =>
      apiFetch<{ departmentId: number; titles: DistribJobTitle[] }>("/distribyutsiya/job-titles"),
    enabled,
  });
}

export function useDistribMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["distribyutsiya"] });
  };

  const createTitle = useMutation({
    mutationFn: (title: string) =>
      apiFetch<{ title: DistribJobTitle }>("/distribyutsiya/job-titles", {
        method: "POST",
        body: JSON.stringify({ title }),
      }),
    onSuccess: invalidate,
  });

  const updateTitle = useMutation({
    mutationFn: (payload: { id: number; title?: string; active?: boolean; sortOrder?: number }) =>
      apiFetch<{ title: DistribJobTitle }>(`/distribyutsiya/job-titles/${payload.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: invalidate,
  });

  const deactivateTitle = useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ ok: boolean }>(`/distribyutsiya/job-titles/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const createStaff = useMutation({
    mutationFn: (payload: {
      firstName: string;
      lastName: string;
      phone?: string;
      jobTitleId?: number | null;
      role?: "distrib" | "distrib_hr" | "distrib_rahbar";
    }) =>
      apiFetch<{
        ok: boolean;
        login: string;
        temporaryPassword: string;
        fullName: string;
        position: string;
        message: string;
      }>("/distribyutsiya/staff", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: invalidate,
  });

  return { createTitle, updateTitle, deactivateTitle, createStaff };
}

export async function downloadDistribStaffExcel() {
  const res = await fetch("/api/distribyutsiya/staff/export", { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || "Excel yuklanmadi");
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const match = /filename="?([^"]+)"?/i.exec(cd);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = match?.[1] || `distribyutsiya-login-${stamp}.xlsx`;
  const { deliverFile } = await import("./tg-download");
  await deliverFile(blob, filename);
}
