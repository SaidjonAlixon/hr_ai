import { useQuery } from "@tanstack/react-query";

export type KirishStageDetail = {
  stage: number;
  title: string;
  score: number | null;
  attempts: number;
  passed: boolean;
  videoDone: boolean;
  slidesDone: boolean;
  passedAt: string | null;
};

export type StajyorRosterItem = {
  userId: number;
  fullName: string;
  phone: string | null;
  login: string | null;
  userStatus: string;
  employeeId: number | null;
  position: string;
  location: string | null;
  mudirName: string | null;
  employmentStatus: string | null;
  hiredAt: string | null;
  kirish: {
    currentStage: number;
    status: string;
    stageCount: number;
    passScore: number;
    testsAttempted: number;
    testsPassed: number;
    testsTotal: number;
    avgScore: number | null;
    progressPct: number;
    stages: KirishStageDetail[];
    completedAt: string | null;
  };
  internship: {
    id: number;
    status: string;
    startDate: string;
    endDate: string | null;
  } | null;
};

export type StajyorRosterResponse = {
  summary: {
    total: number;
    inProgress: number;
    ready: number;
    hired: number;
    avgProgress: number;
  };
  items: StajyorRosterItem[];
  stageCount: number;
  passScore: number;
};

async function json<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message || `Xato ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function useStajyorRoster(enabled = true) {
  return useQuery({
    queryKey: ["internships", "roster"],
    queryFn: () => json<StajyorRosterResponse>("/internships/roster"),
    enabled,
    staleTime: 30_000,
  });
}
