import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type BranchNeedStatus =
  | "pending"
  | "assigned"
  | "in_progress"
  | "done"
  | "verified"
  | "closed";

export type BranchNeed = {
  id: number;
  needType: string;
  branchLocation: string | null;
  managerEmployeeId: number | null;
  managerName: string | null;
  note: string | null;
  status: BranchNeedStatus | string;
  createdById: number | null;
  createdByName: string | null;
  createdByRole: string | null;
  confirmedById: number | null;
  confirmedByName: string | null;
  confirmedAt: string | null;
  assignedUserId: number | null;
  assignedUserName: string | null;
  assignedUserRole: string | null;
  assignedAt: string | null;
  acceptedAt: string | null;
  completedAt: string | null;
  verifiedById: number | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
  taskId: number | null;
  closedById: number | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BranchNeedAssignee = {
  id: number;
  fullName: string;
  role: string;
  login: string;
};

export type NeedAssigneeGroup = "it" | "komunal" | "hudud";

export const NEED_ASSIGNEE_GROUPS: Array<{ key: NeedAssigneeGroup; label: string }> = [
  { key: "it", label: "IT bo‘limi" },
  { key: "komunal", label: "Kommunal" },
  { key: "hudud", label: "Hudud mas’ullari" },
];

const NEED_ASSIGNEE_ROLE_GROUP: Record<string, NeedAssigneeGroup> = {
  it_rahbar: "it",
  it: "it",
  it_tarmoq: "it",
  texnik: "it",
  mamuriy_rahbar: "komunal",
  komunalniy: "komunal",
  koordinator: "hudud",
};

export function needAssigneeGroup(role?: string | null): NeedAssigneeGroup | null {
  return NEED_ASSIGNEE_ROLE_GROUP[String(role || "")] ?? null;
}

export function needLabel(needType: string): string {
  if (needType === "mudir") return "Mudirga ehtiyoj";
  if (needType === "computer") return "Kompyuterga ehtiyoj";
  return needType;
}

export function roleLabel(role?: string | null): string {
  switch (role) {
    case "texnik":
      return "Texnik";
    case "it_rahbar":
      return "IT bo‘limi rahbari";
    case "it":
      return "IT mutaxassis";
    case "it_tarmoq":
      return "IT · tarmoq mutaxassisi";
    case "mamuriy_rahbar":
      return "Ma’muriy-xo‘jalik rahbari";
    case "komunalniy":
      return "Kommunal xizmat";
    case "ombor":
      return "Ombor";
    case "mudir":
      return "Mudir";
    case "koordinator":
      return "Koordinator";
    case "hr":
    case "hr_direktor":
    case "hr_kadr_rahbar":
    case "hr_auditor":
    case "hr_menejer":
      return "HR";
    case "admin":
      return "Admin";
    default:
      return role || "Xodim";
  }
}

export function formatNeedDt(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("uz-UZ", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    let message = "Xatolik";
    try {
      const body = await res.json();
      message = body?.error || message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function useBranchNeeds(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["branch-needs", "active"],
    queryFn: () => apiFetch<BranchNeed[]>(`/branch-needs?status=active`),
    refetchInterval: 30_000,
    enabled: options?.enabled ?? true,
  });
}

export function useBranchNeedsHistory() {
  return useQuery({
    queryKey: ["branch-needs", "history"],
    queryFn: () => apiFetch<BranchNeed[]>(`/branch-needs?status=history`),
    refetchInterval: 60_000,
  });
}

export type MyNeedBranch = {
  managerEmployeeId: number;
  branchName: string;
  managerName: string | null;
  coordinatorName: string | null;
};

export function useMyNeedBranch(enabled: boolean) {
  return useQuery({
    queryKey: ["branch-needs", "my-branch"],
    queryFn: async () => (await apiFetch<{ branch: MyNeedBranch | null }>(`/branch-needs/my-branch`)).branch,
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useBranchNeedAssignees(enabled: boolean) {
  return useQuery({
    queryKey: ["branch-needs", "assignees"],
    queryFn: async () => {
      const order = NEED_ASSIGNEE_GROUPS.map((g) => g.key);
      const list = await apiFetch<BranchNeedAssignee[]>(`/branch-needs/assignees`);
      return list
        .filter((a) => needAssigneeGroup(a.role))
        .sort(
          (a, b) =>
            order.indexOf(needAssigneeGroup(a.role)!) - order.indexOf(needAssigneeGroup(b.role)!) ||
            a.fullName.localeCompare(b.fullName, "uz"),
        );
    },
    enabled,
  });
}

export function useCreateBranchNeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      needType: string;
      branchLocation?: string;
      managerEmployeeId?: number | null;
      note?: string;
      assigneeUserId?: number | null;
    }) =>
      apiFetch<BranchNeed>("/branch-needs", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branch-needs"] });
    },
  });
}

export function useConfirmBranchNeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, assigneeUserId }: { id: number; assigneeUserId: number }) =>
      apiFetch<{ need: BranchNeed; taskId: number }>(`/branch-needs/${id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ assigneeUserId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branch-needs"] });
    },
  });
}

export function useVerifyBranchNeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<BranchNeed>(`/branch-needs/${id}/verify`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branch-needs"] });
    },
  });
}

export function useCloseBranchNeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<BranchNeed>(`/branch-needs/${id}/close`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branch-needs"] });
    },
  });
}
