import { roleLabel } from "@/lib/candidate-access";
import {
  INTRO_CHECKLIST_KEYS,
  parsePipeline,
  type PipelineData,
  type PipelineStep,
  type PipelineStepMeta,
} from "@/lib/hire-pipeline";

export type Translate = (key: string, fallback?: string) => string;

export function fmtPipelineAt(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" });
  } catch {
    return iso;
  }
}

export type HistoryBlock = {
  step: PipelineStep;
  title: string;
  at: string;
  lines: { label?: string; value: string }[];
};

function actorLines(
  meta: PipelineStepMeta | undefined,
  actorLabelKey: string,
  t: Translate,
): { label?: string; value: string }[] {
  if (!meta?.byName?.trim()) return [];
  const role = meta.byRole ? roleLabel(meta.byRole) : "";
  return [
    {
      label: t(actorLabelKey),
      value: role ? `${meta.byName.trim()} (${role})` : meta.byName.trim(),
    },
  ];
}

export function buildPipelineHistoryBlocks(data: PipelineData, t: Translate): HistoryBlock[] {
  const out: HistoryBlock[] = [];

  if (data.match?.verdict) {
    const verdict =
      data.match.verdict === "yes"
        ? t("hire.pipe.matchYes")
        : data.match.verdict === "partial"
          ? t("hire.pipe.matchPartial")
          : t("hire.pipe.matchNo");
    out.push({
      step: "match",
      title: t("hire.pipe.match"),
      at: fmtPipelineAt(data.match.at),
      lines: [
        ...actorLines(data.match, "hire.pipe.historyFilledBy", t),
        { label: t("hire.pipe.historyVerdict"), value: verdict },
        ...(data.match.note?.trim() ? [{ value: data.match.note.trim() }] : []),
      ],
    });
  }

  if (data.recommend && typeof data.recommend.yes === "boolean") {
    out.push({
      step: "recommend",
      title: t("hire.pipe.recommend"),
      at: fmtPipelineAt(data.recommend.at),
      lines: [
        ...actorLines(data.recommend, "hire.pipe.historyFilledBy", t),
        {
          label: t("hire.pipe.historyVerdict"),
          value: data.recommend.yes ? t("hire.pipe.recommendYes") : t("hire.pipe.recommendNo"),
        },
        ...(data.recommend.note?.trim() ? [{ value: data.recommend.note.trim() }] : []),
      ],
    });
  }

  if (data.questions?.items?.length) {
    out.push({
      step: "questions",
      title: t("hire.pipe.questions"),
      at: fmtPipelineAt(data.questions.at),
      lines: [
        ...actorLines(data.questions, "hire.pipe.historyFilledBy", t),
        ...data.questions.items.flatMap((item, i) => {
          if (!item.q?.trim() && !item.a?.trim()) return [];
          return [{ label: `${i + 1}. ${item.q?.trim() || "—"}`, value: item.a?.trim() || "—" }];
        }),
      ],
    });
  }

  if (data.interview?.mode) {
    out.push({
      step: "interview",
      title: t("hire.pipe.interview"),
      at: fmtPipelineAt(data.interview.at),
      lines: [
        ...actorLines(data.interview, "hire.pipe.historyInterviewBy", t),
        {
          label: t("hire.pipe.historyType"),
          value:
            data.interview.mode === "offline"
              ? t("hire.pipe.interviewOffline")
              : t("hire.pipe.interviewOnline"),
        },
        ...(data.interview.note?.trim()
          ? [{ label: t("hire.pipe.historyWhenWhere"), value: data.interview.note.trim() }]
          : []),
        ...(data.interview.result?.trim()
          ? [{ label: t("hire.pipe.interviewResultPh"), value: data.interview.result.trim() }]
          : []),
      ],
    });
  }

  if (data.decision?.track) {
    const trackLabel =
      data.decision.track === "intern"
        ? t("hire.pipe.trackIntern")
        : data.decision.track === "skilled"
          ? t("hire.pipe.trackSkilled")
          : t("hire.pipe.trackReject");
    out.push({
      step: "decision",
      title: t("hire.pipe.decision"),
      at: fmtPipelineAt(data.decision.at),
      lines: [
        ...actorLines(data.decision, "hire.pipe.historyDecisionBy", t),
        { label: t("hire.pipe.historyVerdict"), value: trackLabel },
        ...(data.decision.note?.trim() ? [{ value: data.decision.note.trim() }] : []),
      ],
    });
  }

  if (data.intro?.done || data.intro?.note || data.intro?.checklist) {
    const checked = INTRO_CHECKLIST_KEYS.filter((k) => data.intro?.checklist?.[k]);
    out.push({
      step: "intro",
      title: t("hire.pipe.intro"),
      at: fmtPipelineAt(data.intro?.at),
      lines: [
        ...actorLines(data.intro, "hire.pipe.historyIntroBy", t),
        ...(checked.length
          ? [
              {
                label: t("hire.pipe.historyChecklist"),
                value: checked.map((k) => t(`hire.pipe.intro.${k}`)).join(" · "),
              },
            ]
          : []),
        ...(data.intro?.note?.trim() ? [{ value: data.intro.note.trim() }] : []),
      ],
    });
  }

  return out;
}

export function pipelineHistoryFromJson(raw: unknown, t: Translate): HistoryBlock[] {
  return buildPipelineHistoryBlocks(parsePipeline(raw), t);
}
