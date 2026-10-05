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

  const deleteTitle = useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ ok: boolean }>(`/distribyutsiya/job-titles/${id}?permanent=1`, { method: "DELETE" }),
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

  return { createTitle, updateTitle, deactivateTitle, deleteTitle, createStaff };
}

export type TamojniSite = {
  departmentId: number;
  name: string;
  latitude: number;
  longitude: number;
  radiusM: number;
};

export type TamojniStaffRow = {
  userId: number;
  fullName: string;
  role: string;
  login: string;
  phone: string | null;
  status: string | null;
  employeeId: number | null;
  position: string | null;
  shiftKey: string;
  startHm: string;
  endHm: string;
  shiftTitle: string;
};

export function useTamojniDesk(enabled = true) {
  return useQuery({
    queryKey: ["distribyutsiya", "tamojni"],
    queryFn: () =>
      apiFetch<{
        departmentId: number;
        departmentName: string;
        canManage: boolean;
        creatableRoles: string[];
        site: TamojniSite | null;
        staff: TamojniStaffRow[];
      }>("/distribyutsiya/tamojni"),
    enabled,
  });
}

export function useTamojniMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["distribyutsiya", "tamojni"] });
  };
  const saveSite = useMutation({
    mutationFn: (body: { name: string; latitude: number; longitude: number; radiusM: number }) =>
      apiFetch<{ ok: boolean; site: TamojniSite | null }>("/distribyutsiya/tamojni/site", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
  });
  const createStaff = useMutation({
    mutationFn: (body: { firstName: string; lastName: string; phone?: string; position?: string; role: string }) =>
      apiFetch<{
        ok: boolean;
        login: string;
        temporaryPassword: string;
        fullName: string;
        position: string;
        message: string;
      }>("/distribyutsiya/tamojni/staff", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
  });
  const saveShift = useMutation({
    mutationFn: (body: { employeeId: number; shiftKey: string; startHm: string; endHm: string }) =>
      apiFetch<{ ok: boolean; shiftTitle: string }>("/distribyutsiya/tamojni/shift", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
  });
  return { saveSite, createStaff, saveShift };
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
