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
  davomatSite: DavomatSite;
  employmentStatus?: string | null;
  commentCount?: number;
  lastComment?: { text: string; createdAt: string; authorName: string | null } | null;
};

export type DistribEmploymentStatus = "working" | "on_leave" | "dismissed";

export const DISTRIB_STATUS_LABEL: Record<DistribEmploymentStatus, string> = {
  working: "Ishlayapti",
  on_leave: "Ta’tilda",
  dismissed: "Bo‘shatilgan",
};

export type StaffCommentKind = "note" | "late" | "early" | "warning" | "praise";

export const STAFF_COMMENT_KIND_LABEL: Record<StaffCommentKind, string> = {
  note: "Izoh",
  late: "Kech kelish",
  early: "Erta ketish",
  warning: "Ogohlantirish",
  praise: "Rag‘bat",
};

export type StaffComment = {
  id: number;
  userId: number;
  kind: StaffCommentKind;
  relatedDate: string | null;
  text: string;
  authorName: string | null;
  createdAt: string;
  canDelete?: boolean;
};

export type AttendanceIncident = {
  key: string;
  date: string;
  type: "late" | "early" | "absent" | "incomplete";
  userId: number;
  fullName: string;
  position: string | null;
  minutes: number;
  checkIn: string | null;
  checkOut: string | null;
  planStart: string | null;
  planEnd: string | null;
  excused: boolean;
  excuseNote: string | null;
  comments: Array<{ id: number; kind: StaffCommentKind; text: string; authorName: string | null; createdAt: string }>;
};

export type DistribAttendanceResponse = {
  from: string;
  to: string;
  today: string;
  staffCount: number;
  canComment: boolean;
  counts: { late: number; early: number; absent: number; incomplete: number };
  incidents: AttendanceIncident[];
  summary: Array<{
    userId: number;
    fullName: string;
    position: string | null;
    late: number;
    lateMinutes: number;
    early: number;
    earlyMinutes: number;
    absent: number;
  }>;
};

export function useDistribAttendance(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ["distribyutsiya", "attendance", from, to],
    queryFn: () =>
      apiFetch<DistribAttendanceResponse>(
        `/distribyutsiya/attendance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useStaffComments(userId: number | null) {
  return useQuery({
    queryKey: ["distribyutsiya", "comments", userId],
    queryFn: () => apiFetch<{ items: StaffComment[] }>(`/distribyutsiya/staff/${userId}/comments`),
    enabled: !!userId,
  });
}

export function useDistribStaffActions() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["distribyutsiya"] });
  };
  const setStatus = useMutation({
    mutationFn: (body: { userId: number; status: DistribEmploymentStatus; reason?: string }) =>
      apiFetch<{ ok: boolean; removed: boolean; message: string }>(`/distribyutsiya/staff/${body.userId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: body.status, reason: body.reason }),
      }),
    onSuccess: invalidate,
  });
  const removeStaff = useMutation({
    mutationFn: (body: { userId: number; reason: string }) =>
      apiFetch<{ ok: boolean; message: string }>(
        `/distribyutsiya/staff/${body.userId}?reason=${encodeURIComponent(body.reason)}`,
        { method: "DELETE" },
      ),
    onSuccess: invalidate,
  });
  const addComment = useMutation({
    mutationFn: (body: { userId: number; text: string; kind: StaffCommentKind; relatedDate?: string; notify?: boolean }) =>
      apiFetch<{ ok: boolean }>(`/distribyutsiya/staff/${body.userId}/comments`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
  });
  const deleteComment = useMutation({
    mutationFn: (id: number) => apiFetch<{ ok: boolean }>(`/distribyutsiya/comments/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  return { setStatus, removeStaff, addComment, deleteComment };
}

export type DavomatSite = "office" | "tamojni";

export const DAVOMAT_SITE_LABEL: Record<DavomatSite, string> = {
  office: "Asosiy ofis",
  tamojni: "Tamojni sklad",
};

/** Davomat joyini o‘zgartirish — Distribyutsiya va Tamojni ro‘yxatlari birga yangilanadi */
export function useDavomatSiteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { userId: number; site: DavomatSite }) =>
      apiFetch<{ ok: boolean; davomatSite: DavomatSite; label: string }>(
        `/distribyutsiya/staff/${body.userId}/davomat-site`,
        { method: "PATCH", body: JSON.stringify({ site: body.site }) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["distribyutsiya"] });
    },
  });
}

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
        canChangeSite?: boolean;
        canManageStaff?: boolean;
        myUserId?: number | null;
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
  davomatSite: DavomatSite;
};

export function useTamojniDesk(enabled = true) {
  return useQuery({
    queryKey: ["distribyutsiya", "tamojni"],
    queryFn: () =>
      apiFetch<{
        departmentId: number;
        departmentName: string;
        canManage: boolean;
        canChangeSite?: boolean;
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
