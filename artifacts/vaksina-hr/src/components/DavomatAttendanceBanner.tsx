import React, { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { ScanFace, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

type Status = {
  nextAction: "in" | "out" | "done" | "unlinked";
  checkIn: string;
  checkOut: string;
  fullName: string | null;
  linkUrl: string;
};

const HOLAT: Record<Status["nextAction"], string> = {
  done: "Yopilgan",
  in: "Kelish kutilmoqda",
  out: "Ketish kutilmoqda",
  unlinked: "Face ID kerak",
};

export function DavomatAttendanceBanner() {
  const { isAuthenticated } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);

  const load = useCallback(async () => {
    if (!isAuthenticated) {
      setStatus(null);
      return;
    }
    try {
      const res = await fetch("/api/davomat/me/status", { credentials: "include" });
      if (!res.ok) return;
      setStatus((await res.json()) as Status);
    } catch {
      /* ignore */
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  if (!status) return null;

  const done = status.nextAction === "done";
  const urgent = status.nextAction === "in" || status.nextAction === "out";

  return (
    <div
      className={cn(
        "border-b px-3 py-2 sm:px-4 sm:py-1.5",
        done
          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
          : urgent
            ? "border-amber-500/20 bg-amber-500/10 text-amber-900 dark:text-amber-100"
            : "border-sky-500/20 bg-sky-500/10 text-sky-900 dark:text-sky-100",
      )}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="flex min-w-0 items-start gap-2 text-sm sm:items-center">
          {done ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 sm:mt-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 sm:mt-0" />
          )}
          <p className="min-w-0 leading-snug">
            <span className="font-semibold">{status.fullName || "Xodim"}</span>
            <span className="mt-0.5 block text-[11px] font-medium opacity-70 sm:mt-0 sm:ml-1.5 sm:inline">
              {HOLAT[status.nextAction]}
            </span>
            <span className="mt-0.5 block tabular-nums text-xs opacity-80 sm:ml-1.5 sm:inline">
              Kelish {status.checkIn} · Ketish {status.checkOut}
            </span>
          </p>
        </div>
        <Button asChild size="sm" className="h-8 w-full gap-1.5 rounded-lg text-xs sm:h-7 sm:w-auto sm:px-2.5">
          <Link href={status.linkUrl || "/davomat-face"}>
            <ScanFace className="h-3.5 w-3.5" />
            Davomat
          </Link>
        </Button>
      </div>
    </div>
  );
}
