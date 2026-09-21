import { useQuery } from "@tanstack/react-query";

/** open = bajarilmagan; bajarilgan (+ eski bartaraf/yechim) = bajarilgan */
export type ResolutionStatus = "open" | "bajarilgan" | "bartaraf" | "yechim";

export type DoneFilter = "bajarilmagan" | "bajarilgan";

export function isXatolikBajarilgan(status?: string | null): boolean {
  const s = String(status || "open");
  return s === "bajarilgan" || s === "bartaraf" || s === "yechim";
}

export type DavomatXatolikItem = {
  id: number;
  createdAt: string;
  method: string | null;
  action: string | null;
  code: string;
  title: string;
  meaning: string;
  fix: string;
  severity: "high" | "medium" | "low";
  failureReason: string | null;
  gpsDistance: number | null;
  branchId: number | null;
  wrongBranch?: boolean;
  assignedBranch?: { id: number | null; label: string | null } | null;
  scannedBranch?: { id: number; label: string | null } | null;
  allowedBranchIds?: number[] | null;
  liveLocation?: {
    latitude: number;
    longitude: number;
    mapsUrl: string;
    distanceMeters: number | null;
  } | null;
  workplace?: {
    label: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
  employee: {
    id: number;
    fullName: string;
    location: string | null;
    assignedBranchId: number | null;
    phone: string | null;
  } | null;
  user: {
    id: number;
    fullName: string;
    role: string | null;
    login: string | null;
    phone?: string | null;
  } | null;
  coordinator?: {
    employeeId: number;
    userId: number | null;
    fullName: string;
    login: string | null;
    phone: string | null;
  } | null;
  resolutionStatus?: ResolutionStatus;
  resolvedAt?: string | null;
  resolvedByUserId?: number | null;
  resolutionNote?: string | null;
  repeatCount?: number;
  meta: Record<string, unknown> | null;
};

export type CoordinatorRankingItem = {
  employeeId: number | null;
  userId: number | null;
  fullName: string;
  login: string | null;
  total: number;
  open: number;
  staffWithIssues: number;
};

export type DavomatXatoliklarResponse = {
  generatedAt: string;
  days: number;
  total: number;
  rawTotal?: number;
  statusCounts?: {
    bajarilmagan: number;
    bajarilgan: number;
    open?: number;
    bartaraf?: number;
    yechim?: number;
  };
  coordinatorRanking?: CoordinatorRankingItem[];
  summary: Array<{
    code: string;
    count: number;
    title: string;
    meaning: string;
    fix: string;
    severity: string;
  }>;
  items: DavomatXatolikItem[];
};

export async function fetchDavomatXatoliklar(days = 7): Promise<DavomatXatoliklarResponse> {
  const res = await fetch(`/api/davomat/xatoliklar?days=${days}&limit=150`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    let msg = "Xatoliklar yuklanmadi";
    try {
      const b = await res.json();
      if (b?.error) msg = b.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

export function useDavomatXatoliklar(days: number, enabled = true) {
  return useQuery({
    queryKey: ["davomat-xatoliklar", days],
    queryFn: () => fetchDavomatXatoliklar(days),
    enabled,
    staleTime: 15_000,
  });
}

export async function fixBranchAssignment(body: {
  employeeId: number;
  branchId?: number | null;
  auditId: number;
  mode?: "assign_branch" | "mark_yechim" | "mark_done" | "rotate_today";
  note?: string;
}) {
  const res = await fetch("/api/davomat/xatoliklar/fix-branch", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Tiklash amalga oshmadi");
  return data as {
    ok: boolean;
    message: string;
    branchLabel?: string;
    mode?: string;
    result?: { summary: string; steps: string[] };
  };
}

export async function setXatolikStatus(body: {
  id: number;
  status: "open" | "bajarilgan" | "bajarilmagan";
  note?: string;
}) {
  const res = await fetch(`/api/davomat/xatoliklar/${body.id}/status`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ status: body.status, note: body.note }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Holat saqlanmadi");
  return data as { ok: boolean; message: string; status: string };
}
