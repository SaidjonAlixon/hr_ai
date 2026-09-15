/** Soddalashtirilgan hire holati (UI) */
export type HireFlow = "yangi" | "jarayonda" | "qabul" | "rad";

export function resolveHireFlow(opts: {
  status?: string | null;
  stage?: string | null;
}): HireFlow {
  const status = String(opts.status || "").toLowerCase();
  const stage = String(opts.stage || "").toLowerCase();
  if (status === "rejected") return "rad";
  if (status === "hired" || stage === "hired") return "qabul";
  if (status === "active" && (stage === "new" || stage === "")) return "yangi";
  if (status === "active") return "jarayonda";
  if (stage === "new") return "yangi";
  return "jarayonda";
}

export type HireAiFillKind = "vacancy" | "request" | "candidate";

export type HireAiFillResult = {
  description: string;
  requirements: string;
  schedule?: string;
  benefits?: string;
  notes?: string;
  interviewQuestions?: string;
  tasks: { title: string; description: string }[];
  createdTaskIds?: number[];
  aiEnabled?: boolean;
};

export async function hireAiFill(opts: {
  kind: HireAiFillKind;
  position: string;
  context?: string;
  assigneeId?: number | null;
  candidateId?: number | null;
  createTasks?: boolean;
}): Promise<HireAiFillResult> {
  const res = await fetch("/api/hire/ai-fill", {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: opts.kind,
      position: opts.position,
      context: opts.context,
      assigneeId: opts.assigneeId ?? undefined,
      candidateId: opts.candidateId ?? undefined,
      createTasks: opts.createTasks !== false,
    }),
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
  return res.json();
}
