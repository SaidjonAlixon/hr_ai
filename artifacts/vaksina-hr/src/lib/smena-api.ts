export type SmenaBranch = {
  id: number;
  name: string;
  managerName: string;
  hasGps: boolean;
};

export type SmenaAssignable = {
  id: number;
  fullName: string;
  orgRole: string | null;
  shiftType: string;
  assignedBranchId: number | null;
  assignedBranchName: string | null;
};

export type ShiftPick = "one" | "two" | "three" | "one+two" | "two+three";

export type SmenaMe = {
  pharmacyStaff: boolean;
  canPickShift: boolean;
  canPickOwnBranch: boolean;
  canAssignOthers: boolean;
  employee: {
    id: number;
    fullName: string;
    orgRole: string | null;
    assignedBranchId: number | null;
    assignedBranchName: string | null;
  } | null;
  shift: {
    type: string;
    types?: string[];
    label: string;
    start: string;
    end: string;
    warnHm: string;
    warnText: string;
    hoursNote: string;
    windows?: Array<{ type: string; label: string; start: string; end: string; overnight?: boolean }>;
  };
  branches: SmenaBranch[];
  assignable: SmenaAssignable[];
  rules: {
    eligible?: string;
    office?: string;
    shift1: string;
    shift2: string;
    shift3?: string;
    combo?: string;
    branch: string;
  };
};

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    ...init,
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error || "So‘rov bajarilmadi");
  return body as T;
}

export function fetchSmenaMe(): Promise<SmenaMe> {
  return apiJson<SmenaMe>("/smena/me");
}

export function saveMySmena(body: { shiftType?: ShiftPick | string; assignedBranchId?: number | null }) {
  return apiJson<{ ok: boolean }>("/smena/me", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function assignSmenaBranch(
  employeeId: number,
  assignedBranchId: number,
  shiftType?: ShiftPick | string,
) {
  return apiJson<{ ok: boolean; assignedBranchName: string }>(`/smena/assign/${employeeId}`, {
    method: "PATCH",
    body: JSON.stringify({ assignedBranchId, shiftType }),
  });
}

export function shiftLabelShort(type: string | null | undefined): string {
  const s = String(type || "").toLowerCase();
  if (s.includes("one+two") || s === "one+two") return "1+2";
  if (s.includes("two+three") || s === "two+three") return "2+3";
  if (s === "three" || s.includes("three")) return "3-smena";
  if (s === "two" || s.startsWith("two")) return "2-smena";
  if (s === "office") return "Ofis";
  return "1-smena";
}
