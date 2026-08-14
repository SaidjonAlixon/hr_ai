import React, { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { ScanFace, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  const [status, setStatus] = useState<Status | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/davomat/me/status", { credentials: "include" });
      if (!res.ok) return;
      setStatus((await res.json()) as Status);
    } catch {
      /* ignore */
    }
  }, []);

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
        "border-b px-3 py-1.5 sm:px-4",
        done
          ? "bg-emerald-50 border-emerald-200 text-emerald-900"
          : urgent
            ? "bg-amber-50 border-amber-200 text-amber-950"
            : "bg-sky-50 border-sky-200 text-sky-950",
      )}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          {done ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          )}
          <p className="min-w-0 truncate">
            <span className="font-semibold">{status.fullName || "Xodim"}</span>
            <span className="mx-1.5 text-[11px] font-medium opacity-70">{HOLAT[status.nextAction]}</span>
            <span className="tabular-nums text-xs">
              Kelish {status.checkIn} · Ketish {status.checkOut}
            </span>
          </p>
        </div>
        <Button asChild size="sm" className="h-7 shrink-0 gap-1 bg-[#0b3a5c] px-2.5 text-xs hover:bg-[#0a314d]">
          <Link href={status.linkUrl || "/davomat-face"}>
            <ScanFace className="h-3.5 w-3.5" />
            Davomat
          </Link>
        </Button>
      </div>
    </div>
  );
}
