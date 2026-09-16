/** Rekruter hire qadamlari — sodda, orqaga qaytish mumkin */

export type PipelineStep =
  | "match"
  | "recommend"
  | "questions"
  | "interview"
  | "decision"
  | "intro"
  | "done";

export type MatchVerdict = "yes" | "partial" | "no";
export type InterviewMode = "online" | "offline";
export type HireTrack = "intern" | "skilled" | "reject";

export type PipelineQuestion = { q: string; a: string };

export type PipelineStepMeta = {
  byUserId?: number;
  byName?: string;
  byRole?: string;
};

export type PipelineData = {
  match?: { verdict: MatchVerdict; note: string; at: string } & PipelineStepMeta;
  recommend?: { yes: boolean; note: string; at: string } & PipelineStepMeta;
  questions?: { items: PipelineQuestion[]; at: string } & PipelineStepMeta;
  interview?: { mode: InterviewMode; note: string; result: string; at: string } & PipelineStepMeta;
  decision?: { track: HireTrack; note: string; at: string } & PipelineStepMeta;
  intro?: {
    done: boolean;
    note: string;
    checklist: Record<string, boolean>;
    at: string;
  } & PipelineStepMeta;
};

export const PIPELINE_ORDER: PipelineStep[] = [
  "match",
  "recommend",
  "questions",
  "interview",
  "decision",
  "intro",
  "done",
];

export const INTRO_CHECKLIST_KEYS = [
  "role",
  "schedule",
  "team",
  "docs",
  "contacts",
] as const;

export function emptyPipeline(): PipelineData {
  return {};
}

export function parsePipeline(raw: unknown): PipelineData {
  if (!raw || typeof raw !== "object") return emptyPipeline();
  return raw as PipelineData;
}

export function normalizeStep(step: string | null | undefined, status?: string | null): PipelineStep {
  const s = String(step || "").toLowerCase();
  if ((PIPELINE_ORDER as string[]).includes(s)) return s as PipelineStep;
  if (status === "hired" || s === "hired") return "done";
  if (s === "new" || !s) return "match";
  return "match";
}

/** API qaytgan pipeline_step + pipeline_json bo‘yicha joriy qadam */
export function resolvePipelineStep(candidate: {
  pipelineStep?: string | null;
  pipelineJson?: unknown;
  status?: string | null;
  stage?: string | null;
}): PipelineStep {
  const explicit = String(candidate.pipelineStep || "").toLowerCase();
  if ((PIPELINE_ORDER as string[]).includes(explicit)) return explicit as PipelineStep;

  const data = parsePipeline(candidate.pipelineJson);
  if (candidate.status === "hired") return "done";
  if (data.intro?.done) return "done";
  if (data.decision?.track === "intern" || data.decision?.track === "skilled") {
    return "intro";
  }
  if (data.decision?.track === "reject") return "decision";
  if (data.interview?.mode) return "decision";
  if (data.questions?.items?.length) return "interview";
  if (data.recommend) return data.recommend.yes ? "questions" : "recommend";
  if (data.match?.verdict) return "recommend";
  return "match";
}

export async function patchCandidatePipeline(
  id: number,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/candidates/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let payload: Record<string, unknown> = {};
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const msg =
      (typeof payload.error === "string" && payload.error) ||
      (typeof payload.message === "string" && payload.message) ||
      res.statusText;
    throw new Error(msg || `Xato ${res.status}`);
  }
  if (body.pipelineAction && !payload.pipelineStep && !payload.pipelineJson) {
    throw new Error(
      "Server pipeline qadamlarini qo‘llab-quvvatlamaydi — API ni qayta ishga tushiring",
    );
  }
  return payload;
}

export function stepIndex(step: PipelineStep): number {
  return PIPELINE_ORDER.indexOf(step);
}

export function prevStep(step: PipelineStep): PipelineStep | null {
  const i = stepIndex(step);
  if (i <= 0) return null;
  return PIPELINE_ORDER[i - 1]!;
}

export function nextAfter(step: PipelineStep): PipelineStep | null {
  const i = stepIndex(step);
  if (i < 0 || i >= PIPELINE_ORDER.length - 1) return null;
  return PIPELINE_ORDER[i + 1]!;
}

/** Orqaga: keyingi qadamlar ma’lumotini tozalash */
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

/** Lavozim bo‘yicha tayyor savollar */
export function defaultQuestionsForPosition(position: string): string[] {
  const p = position.toLowerCase();
  const common = [
    "Nega aynan shu lavozimni tanladingiz?",
    "Ish grafigi / smena sharoitiga tayyormisiz?",
    "Qancha maosh kutayapsiz?",
  ];
  if (/farm|apteka|provizor|фарма/.test(p)) {
    return [
      "Retsept va OTCni farqlay olasizmi? Qisqa misol.",
      "Mijozga maslahat berish tajribangiz qanday?",
      "Kassa / 1C yoki apteka dasturi bilan ishlaganmisiz?",
      ...common,
    ];
  }
  if (/kassir|sotuv|продаж/.test(p)) {
    return [
      "Mijoz bilan gaplashish tajribangiz?",
      "Kassa apparati / terminal bilan ishlaganmisiz?",
      "Konfliktli vaziyatni qanday hal qilasiz?",
      ...common,
    ];
  }
  if (/haydov|logist|yetkaz|водител|достав/.test(p)) {
    return [
      "Haydovchilik guvohnomasi va tajriba?",
      "Shahar ichida marshrut bilasizmi?",
      "Yuk / hujjat bilan ishlash tajribasi?",
      ...common,
    ];
  }
  if (/ombor|sklad|склад/.test(p)) {
    return [
      "Ombor hisobi / invertarizatsiya tajribasi?",
      "Og‘ir jismoniy ishga tayyormisiz?",
      "Tovar qabul-chiqarish tartibini bilasizmi?",
      ...common,
    ];
  }
  return [
    "Shu sohada tajribangiz qanday?",
    "Asosiy kuchli tomonlaringiz?",
    "Qachon ishga chiqa olasiz?",
    ...common,
  ];
}

export function defaultIntroChecklist(): Record<string, boolean> {
  return Object.fromEntries(INTRO_CHECKLIST_KEYS.map((k) => [k, false]));
}

export function stampNow(): string {
  return new Date().toISOString();
}
