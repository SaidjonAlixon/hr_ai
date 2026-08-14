import React, { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { ScanFace, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Status = {
  workDate: string;
  nextAction: "in" | "out" | "done" | "unlinked";
  message: string;
  checkIn: string;
  checkOut: string;
  fullName: string | null;
  warn: boolean;
  linkUrl: string;
  siteLabel: string;
  allowedMeters: number;
};

export function DavomatAttendanceBanner() {
  const [status, setStatus] = useState<Status | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/davomat/me/status", { credentials: "include" });
      if (!res.ok) return;
      const body = (await res.json()) as Status;
      setStatus(body);
      // Yangi ogohlantirishda yana ko‘rsatish
      if (body.warn) setDismissed(false);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  if (!status || dismissed) return null;

  const done = status.nextAction === "done";
  const urgent = status.nextAction === "in" || status.nextAction === "out";

  return (
    <div
      className={cn(
        "border-b px-3 py-2.5 sm:px-4",
        done
          ? "bg-emerald-50 border-emerald-200 text-emerald-900"
          : urgent
            ? "bg-amber-50 border-amber-200 text-amber-950"
            : "bg-sky-50 border-sky-200 text-sky-950",
      )}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 text-sm">
          {done ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <div>
            <div className="font-semibold">
              Davomat · Face ID {status.fullName ? `· ${status.fullName}` : ""}
            </div>
            <p className="text-xs sm:text-sm opacity-90">{status.message}</p>
            <p className="mt-0.5 text-[11px] opacity-70">
              Hudud: {status.siteLabel} (±{status.allowedMeters} m) · Bugun: kelish{" "}
              {status.checkIn} / ketish {status.checkOut}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button asChild size="sm" className="gap-1.5 bg-[#0b3a5c] hover:bg-[#0a314d]">
            <Link href={status.linkUrl || "/davomat-face"}>
              <ScanFace className="h-4 w-4" />
              Face ID · Keldim / Ketdim
            </Link>
          </Button>
          {done ? (
            <button
              type="button"
              className="rounded p-1 opacity-60 hover:opacity-100"
              aria-label="Yopish"
              onClick={() => setDismissed(true)}
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
