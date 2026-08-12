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
  assigneeId?: number | null;
  assigneeName: string;
  assigneeKind: string;
  createdById?: number;
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

export type PersonDetail = {
  level: "full" | "summary";
  person: {
    id: number;
    fullName: string;
    login?: string;
    role: string;
    status: string;
    phone?: string | null;
  };
  summary: {
    vacanciesTotal: number;
    vacanciesPublished: number;
    vacanciesClosed: number;
    vacanciesDraft: number;
    candidatesTotal: number;
    candidatesActive: number;
    candidatesHired: number;
    candidatesRejected: number;
    phoneInterviews: number;
    onlineInterviews: number;
    offlineInterviews: number;
    tasksAssignedOpen: number;
    tasksAssignedDone: number;
    tasksCreated: number;
  };
  vacancies: Array<{
    id: number;
    title: string;
    status: string;
    statusLabel: string;
    location: string | null;
    deadline: string | null;
    publishedAt: string | null;
    assignedAt: string | null;
    acceptedAt: string | null;
    createdAt: string;
  }>;
  candidates: Array<{
    id: number;
    fullName: string;
    phone?: string;
    stage: string;
    stageLabel: string;
    status: string;
    statusLabel: string;
    vacancyTitle: string;
    vacancyId: number;
    createdAt: string;
    updatedAt: string;
  }>;
  phoneInterviews: Array<{
    id: number;
    candidateName: string;
    candidateId: number;
    interviewDate: string | null;
    status: string;
    statusLabel: string;
    notes?: string | null;
    rejectReason?: string | null;
    createdAt: string;
  }>;
  onlineInterviews: Array<{
    id: number;
    candidateName: string;
    candidateId: number;
    interviewDate: string | null;
    score: number | null;
    experienceLevel: string | null;
    notes?: string | null;
    createdAt: string;
  }>;
  offlineInterviews: Array<{
    id: number;
    roleInInterview: "hr" | "trainer";
    candidateName: string;
    candidateId: number;
    scheduledDate: string;
    scheduledTime: string | null;
    attendanceStatus: string;
    result: string | null;
    hrScore?: number | null;
    trainerScore?: number | null;
    resultNotes?: string | null;
    createdAt: string;
  }>;
  tasksAssigned: Array<{
    id: number;
    title: string;
    description?: string | null;
    status: string;
    statusLabel: string;
    priority: string;
    dueAt: string | null;
    assigneeName: string;
    createdByName: string;
    completionNote?: string | null;
    completedAt: string | null;
    acceptedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  tasksCreated: Array<{
    id: number;
    title: string;
    description?: string | null;
    status: string;
    statusLabel: string;
    priority: string;
    dueAt: string | null;
    assigneeName: string;
    createdByName: string;
    completionNote?: string | null;
    completedAt: string | null;
    acceptedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
};

async function fetchKuzatuv(): Promise<KuzatuvResponse> {
  const res = await fetch("/api/kuzatuv", { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string })?.error || "Kuzatuv yuklanmadi");
  }
  return res.json();
}

async function fetchPerson(id: number): Promise<PersonDetail> {
  const res = await fetch(`/api/kuzatuv/person/${id}`, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string })?.error || "Ma'lumot yuklanmadi");
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

export function useKuzatuvPerson(personId: number | null, enabled = true) {
  return useQuery({
    queryKey: ["kuzatuv-person", personId],
    queryFn: () => fetchPerson(personId!),
    enabled: enabled && personId != null,
  });
}
