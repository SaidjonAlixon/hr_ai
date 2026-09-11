import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { acceptDeadlineAt, isAcceptOverdue } from "@/lib/vazifalar-permissions";

type TaskLike = {
  status: string;
  createdAt: string;
  priority?: string | null;
  acceptedAt?: string | null;
  meta?: { acceptDeadlineBase?: string } | null;
};

type Props = {
  task: TaskLike;
  className?: string;
  compact?: boolean;
};

function formatAcceptLeft(ms: number): string {
  if (ms <= 0) return "0";
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hours > 0) return `${hours} soat ${mins} daq`;
  if (mins > 0) return `${mins} daq ${secs.toString().padStart(2, "0")} sek`;
  return `${secs} sek`;
}

/** Qabul muddati taymeri — faqat hali qabul qilinmagan (todo) vazifalar */
export function AcceptWindowCountdown({ task, className, compact }: Props) {
  const [, setTick] = useState(0);

  const awaitingAccept =
    task.status === "todo" && !task.acceptedAt;

  const deadline = awaitingAccept ? acceptDeadlineAt(task as any) : null;
  const expired = awaitingAccept && isAcceptOverdue(task as any);

  useEffect(() => {
    if (!awaitingAccept || !deadline) return;
    let timeoutId = 0;
    const schedule = () => {
      const left = deadline.getTime() - Date.now();
      const interval = left > 0 && left < 3_600_000 ? 1_000 : 15_000;
      timeoutId = window.setTimeout(() => {
        setTick((t) => t + 1);
        schedule();
      }, interval);
    };
    schedule();
    return () => window.clearTimeout(timeoutId);
  }, [awaitingAccept, deadline?.getTime()]);

  if (!awaitingAccept || !deadline) return null;

  const left = deadline.getTime() - Date.now();
  const isLate = expired || left <= 0;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-2 py-1.5",
        isLate
          ? "border-rose-400/80 bg-rose-500/15 text-rose-700 dark:border-rose-500/50 dark:bg-rose-950/40 dark:text-rose-200"
          : left < 15 * 60 * 1000
            ? "border-amber-400/80 bg-amber-500/15 text-amber-900 animate-pulse dark:border-amber-500/50 dark:bg-amber-950/40 dark:text-amber-100"
            : "border-sky-400/70 bg-sky-500/10 text-sky-900 dark:border-sky-500/40 dark:bg-sky-950/40 dark:text-sky-100",
        className,
      )}
    >
      <Clock className={cn("shrink-0", compact ? "h-3 w-3" : "h-3.5 w-3.5")} />
      <div className="min-w-0 flex-1 leading-tight">
        {isLate ? (
          <>
            <p className={cn("font-bold", compact ? "text-[10px]" : "text-[11px]")}>
              Kechikkanga o‘tdi
            </p>
            <p className="text-[9px] opacity-90">Qabul qilinmadi</p>
          </>
        ) : (
          <>
            <p className={cn("font-bold tabular-nums", compact ? "text-[10px]" : "text-[11px]")}>
              Qabul: {formatAcceptLeft(left)}
            </p>
            <p className="text-[9px] opacity-90">
              Tugasa — Kechikkanga o‘tadi
            </p>
          </>
        )}
      </div>
    </div>
  );
}
