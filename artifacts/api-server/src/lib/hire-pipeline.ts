/** Rekruter hire qadamlari (API) */

export type PipelineStep =
  | "match"
  | "recommend"
  | "questions"
  | "interview"
  | "decision"
  | "intro"
  | "done";

export type PipelineStepMeta = {
  byUserId?: number;
  byName?: string;
  byRole?: string;
};

export type PipelineData = {
  match?: { verdict: "yes" | "partial" | "no"; note: string; at: string } & PipelineStepMeta;
  recommend?: { yes: boolean; note: string; at: string } & PipelineStepMeta;
  questions?: { items: { q: string; a: string }[]; at: string } & PipelineStepMeta;
  interview?: { mode: "online" | "offline"; note: string; result: string; at: string } & PipelineStepMeta;
  decision?: { track: "intern" | "skilled" | "reject"; note: string; at: string } & PipelineStepMeta;
  intro?: {
    done: boolean;
    note: string;
    checklist: Record<string, boolean>;
    at: string;
  } & PipelineStepMeta;
};

export type PipelineActor = { id: number; name: string; role: string };

function withActor<T extends Record<string, unknown>>(row: T, actor?: PipelineActor): T & PipelineStepMeta {
  if (!actor) return row;
  return {
    ...row,
    byUserId: actor.id,
    byName: actor.name,
    byRole: actor.role,
  };
}

export const PIPELINE_ORDER: PipelineStep[] = [
  "match",
  "recommend",
  "questions",
  "interview",
  "decision",
  "intro",
  "done",
];

export function parsePipeline(raw: unknown): PipelineData {
  if (!raw || typeof raw !== "object") return {};
  return raw as PipelineData;
}

export function normalizeStep(step: string | null | undefined, status?: string | null): PipelineStep {
  const s = String(step || "").toLowerCase();
  if ((PIPELINE_ORDER as string[]).includes(s)) return s as PipelineStep;
  if (status === "hired" || s === "hired") return "done";
  return "match";
}

export function stepIndex(step: PipelineStep): number {
  return PIPELINE_ORDER.indexOf(step);
}

export function rollbackTo(data: PipelineData, target: PipelineStep): PipelineData {
  const i = stepIndex(target);
  const next = { ...data };
  if (i < stepIndex("recommend")) delete next.recommend;
  if (i < stepIndex("questions")) delete next.questions;
  if (i < stepIndex("interview")) delete next.interview;
  if (i < stepIndex("decision")) delete next.decision;
  if (i < stepIndex("intro")) delete next.intro;
  return next;
}

/** pipeline step → coarse stage/status */
export function stageStatusForStep(
  step: PipelineStep,
  data: PipelineData,
): { stage: string; status: string } {
  if (data.decision?.track === "reject" || data.recommend?.yes === false) {
    if (step !== "done" && data.decision?.track === "reject") {
      return { stage: "in_progress", status: "rejected" };
    }
    if (data.recommend?.yes === false && step === "recommend") {
      return { stage: "in_progress", status: "rejected" };
    }
  }
  if (step === "done" || data.decision?.track === "intern" || data.decision?.track === "skilled") {
    if (step === "done") return { stage: "hired", status: "hired" };
  }
  if (step === "match" && !data.match) return { stage: "new", status: "active" };
  return { stage: "in_progress", status: "active" };
}

export function applyPipelineAction(opts: {
  currentStep: PipelineStep;
  currentData: PipelineData;
  action: "advance" | "back" | "set";
  step?: PipelineStep;
  patch?: Partial<PipelineData>;
  actor?: PipelineActor;
}): { step: PipelineStep; data: PipelineData; stage: string; status: string; error?: string } {
  const actor = opts.actor;
  let step = opts.currentStep;
  let data = { ...opts.currentData };

  if (opts.action === "back") {
    const i = stepIndex(step);
    if (i <= 0) return { step, data, ...stageStatusForStep(step, data), error: "Birinchi qadam" };
    const target = PIPELINE_ORDER[i - 1]!;
    data = rollbackTo(data, target);
    step = target;
    // Orqaga — rad holatini bekor qilish
    return { step, data, stage: step === "match" && !data.match ? "new" : "in_progress", status: "active" };
  }

  if (opts.action === "set" && opts.step) {
    const target = normalizeStep(opts.step);
    if (stepIndex(target) > stepIndex(step)) {
      return { step, data, ...stageStatusForStep(step, data), error: "Faqat orqaga yoki joriy qadam" };
    }
    data = rollbackTo(data, target);
    step = target;
    return { step, data, stage: step === "match" && !data.match ? "new" : "in_progress", status: "active" };
  }

  // advance + patch
  const patch = opts.patch || {};
  if (step === "match") {
    if (!patch.match?.verdict) return { step, data, ...stageStatusForStep(step, data), error: "Moslikni tanlang" };
    data.match = withActor(
      {
        verdict: patch.match.verdict,
        note: String(patch.match.note || "").trim(),
        at: new Date().toISOString(),
      },
      actor,
    );
    step = "recommend";
  } else if (step === "recommend") {
    if (typeof patch.recommend?.yes !== "boolean") {
      return { step, data, ...stageStatusForStep(step, data), error: "Tavsiyani tanlang" };
    }
    data.recommend = withActor(
      {
        yes: patch.recommend.yes,
        note: String(patch.recommend.note || "").trim(),
        at: new Date().toISOString(),
      },
      actor,
    );
    if (!patch.recommend.yes) {
      // Tavsiya yo‘q = rad
      data.decision = withActor(
        {
          track: "reject" as const,
          note: data.recommend.note || "Suhbatga tavsiya etilmadi",
          at: new Date().toISOString(),
        },
        actor,
      );
      return { step: "recommend", data, stage: "in_progress", status: "rejected" };
    }
    step = "questions";
  } else if (step === "questions") {
    const items = Array.isArray(patch.questions?.items) ? patch.questions!.items : [];
    const filled = items.filter((x) => String(x.q || "").trim() && String(x.a || "").trim());
    if (filled.length < 1) {
      return { step, data, ...stageStatusForStep(step, data), error: "Kamida 1 ta savol-javob kiriting" };
    }
    data.questions = withActor(
      {
        items: filled.map((x) => ({ q: String(x.q).trim(), a: String(x.a).trim() })),
        at: new Date().toISOString(),
      },
      actor,
    );
    step = "interview";
  } else if (step === "interview") {
    if (!patch.interview?.mode || !["online", "offline"].includes(patch.interview.mode)) {
      return { step, data, ...stageStatusForStep(step, data), error: "Suhbat turini tanlang" };
    }
    data.interview = withActor(
      {
        mode: patch.interview.mode,
        note: String(patch.interview.note || "").trim(),
        result: String(patch.interview.result || "").trim(),
        at: new Date().toISOString(),
      },
      actor,
    );
    step = "decision";
  } else if (step === "decision") {
    if (!patch.decision?.track || !["intern", "skilled", "reject"].includes(patch.decision.track)) {
      return { step, data, ...stageStatusForStep(step, data), error: "Qarorni tanlang" };
    }
    data.decision = withActor(
      {
        track: patch.decision.track,
        note: String(patch.decision.note || "").trim(),
        at: new Date().toISOString(),
      },
      actor,
    );
    if (patch.decision.track === "reject") {
      return { step: "decision", data, stage: "in_progress", status: "rejected" };
    }
    step = "intro";
  } else if (step === "intro") {
    const checklist = patch.intro?.checklist || data.intro?.checklist || {};
    data.intro = withActor(
      {
        done: true,
        note: String(patch.intro?.note || "").trim(),
        checklist,
        at: new Date().toISOString(),
      },
      actor,
    );
    step = "done";
    return { step, data, stage: "hired", status: "hired" };
  } else if (step === "done") {
    return { step, data, stage: "hired", status: "hired" };
  }

  return { step, data, stage: "in_progress", status: "active" };
}
