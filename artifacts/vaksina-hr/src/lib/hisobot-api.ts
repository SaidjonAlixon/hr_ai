import { useQuery } from "@tanstack/react-query";

export type HisobotEmployeeRow = {
  employeeId: number;
  fullName: string;
  phone: string | null;
  login: string | null;
  roleKey: "mudir" | "farmasevt" | "stajyor" | "other";
  roleLabel: string;
  branch: string;
  shiftDisplay: string;
  presentDays: number;
  absentDays: number;
  presentRate: number;
  presentDates: string[];
  absentDates: string[];
};

export type HisobotBranchBlock = {
  branch: string;
  mudir: HisobotEmployeeRow | null;
  pharmacists: HisobotEmployeeRow[];
  interns: HisobotEmployeeRow[];
  others: HisobotEmployeeRow[];
  staffCount: number;
};

export type CoordinatorHisobot = {
  generatedAt: string;
  from: string;
  to: string;
  dayCount: number;
  coordinator: {
    employeeId: number;
    fullName: string;
    phone: string | null;
    login: string | null;
  };
  summary: {
    branchCount: number;
    mudirCount: number;
    pharmacistCount: number;
    internCount: number;
    staffTotal: number;
    avgPresentRate: number;
    noShowCount: number;
  };
  branches: HisobotBranchBlock[];
  employees: HisobotEmployeeRow[];
  noShows: HisobotEmployeeRow[];
};

export async function fetchCoordinatorHisobot(opts: {
  coordinatorId: number;
  from: string;
  to: string;
}): Promise<CoordinatorHisobot> {
  const qs = new URLSearchParams({
    coordinatorId: String(opts.coordinatorId),
    from: opts.from,
    to: opts.to,
  });
  const res = await fetch(`/api/holat/coordinator-report?${qs}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    let msg = "Hisobot yuklanmadi";
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

export function useCoordinatorHisobot(
  coordinatorId: number | null,
  from: string,
  to: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ["holat-coordinator-report", coordinatorId, from, to],
    queryFn: () =>
      fetchCoordinatorHisobot({
        coordinatorId: coordinatorId!,
        from,
        to,
      }),
    enabled: enabled && coordinatorId != null && coordinatorId > 0 && Boolean(from) && Boolean(to),
    staleTime: 20_000,
  });
}
