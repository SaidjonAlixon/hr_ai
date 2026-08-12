import { useQuery } from "@tanstack/react-query";

export type KuzatuvRecruiter = {
  id: number;
  fullName: string;
  login?: string;
  vacanciesTotal: number;
  vacanciesPublished: number;
  vacanciesClosed?: number;
  candidatesActive: number;
  candidatesHired: number;
  candidatesRejected?: number;
  candidatesTotal?: number;
  phoneInterviews: number;
  offlineInterviews?: number;
  tasksOpen: number;
  tasksDone: number;
  tasksTotal?: number;
};

export type KuzatuvTask = {
  id: number;
  title: string;
  status: string;
  priority: string;
  dueAt: string | null;
  assigneeName: string;
  assigneeKind: string;
  createdByName: string;
  updatedAt: string;
  description?: string | null;
  completedAt?: string | null;
  completionNote?: string | null;
  createdAt?: string;
};

export type KuzatuvResponse = {
  level: "full" | "summary";
  summary: {
    openRequests: number;
    activeVacancies: number;
    activeCandidates: number;
    hiredCandidates: number;
    phoneInterviews: number;
    onlineInterviews?: number;
    offlineInterviews?: number;
    tasksOpen: number;
    tasksDone: number;
    recruitersCount: number;
  };
  recruiters: KuzatuvRecruiter[];
  tasks: KuzatuvTask[];
  pipeline?: { stage: string; count: number }[];
};

async function fetchKuzatuv(): Promise<KuzatuvResponse> {
  const res = await fetch("/api/kuzatuv", { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string })?.error || "Kuzatuv yuklanmadi");
  }
  return res.json();
}

export function useKuzatuv(enabled = true) {
  return useQuery({
    queryKey: ["kuzatuv"],
    queryFn: fetchKuzatuv,
    enabled,
    refetchInterval: 15_000,
  });
}
