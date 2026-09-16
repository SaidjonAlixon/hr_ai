import React, { useMemo } from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { pipelineHistoryFromJson, type Translate } from "@/lib/hire-pipeline-history-blocks";

export function HirePipelineHistory({
  pipelineJson,
  t,
}: {
  pipelineJson?: unknown;
  t: Translate;
}) {
  const blocks = useMemo(() => pipelineHistoryFromJson(pipelineJson, t), [pipelineJson, t]);

  if (!blocks.length) return null;

  return (
    <div className="space-y-4 border-t border-dashed pt-5">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        <p className="text-sm font-semibold">{t("hire.pipe.historyTitle")}</p>
      </div>
      <div className="space-y-3">
        {blocks.map((block, idx) => (
          <div
            key={`${block.step}-${idx}`}
            className={cn(
              "rounded-xl border bg-muted/25 p-4",
              "border-l-4",
              block.step === "no_answer" ? "border-l-amber-500" : "border-l-sky-500",
            )}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-bold text-foreground">{block.title}</p>
              {block.at ? (
                <p className="text-[11px] text-muted-foreground">{block.at}</p>
              ) : null}
            </div>
            <div className="mt-2 space-y-2 text-sm">
              {block.lines.map((line, li) => (
                <div key={li}>
                  {line.label ? (
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {line.label}
                    </p>
                  ) : null}
                  <p className={cn("whitespace-pre-wrap", line.label && "mt-0.5 font-medium")}>
                    {line.value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
