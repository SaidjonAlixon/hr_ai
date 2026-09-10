import React, { useMemo, useState } from "react";
import {
  ChevronDown,
  GraduationCap,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useStajyorRoster,
  type StajyorRosterItem,
} from "@/lib/internships-api";

type StatusFilter = "all" | "in_progress" | "ready_for_hire" | "hired" | "not_started";

function kirishStatusLabel(status: string) {
  switch (status) {
    case "ready_for_hire":
      return "Ishga tayyor";
    case "hired":
      return "Ishga olingan";
    case "not_started":
      return "Boshlanmagan";
    case "in_progress":
      return "Jarayonda";
    default:
      return status || "—";
  }
}

function kirishStatusClass(status: string) {
  switch (status) {
    case "ready_for_hire":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "hired":
      return "bg-sky-100 text-sky-800 border-sky-200";
    case "not_started":
      return "bg-slate-100 text-slate-700 border-slate-200";
    default:
      return "bg-amber-100 text-amber-900 border-amber-200";
  }
}

function scoreTone(pct: number | null) {
  if (pct == null) return "text-muted-foreground";
  if (pct >= 70) return "text-emerald-600";
  if (pct >= 50) return "text-amber-600";
  return "text-rose-600";
}

function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className={cn(
          "h-full rounded-full transition-all",
          v >= 70 ? "bg-emerald-500" : v >= 40 ? "bg-amber-500" : "bg-rose-400",
        )}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

function StageRow({ item }: { item: StajyorRosterItem }) {
  const [open, setOpen] = useState(false);
  const k = item.kirish;

  return (
    <div className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-3 py-3 text-left transition hover:bg-muted/40 sm:items-center sm:px-4"
      >
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0b3a5c]/10 text-[#0b3a5c]">
          <UserRound className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{item.fullName}</p>
            <Badge variant="outline" className={cn("text-[10px]", kirishStatusClass(k.status))}>
              {kirishStatusLabel(k.status)}
            </Badge>
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {item.location ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {item.location}
              </span>
            ) : null}
            {item.mudirName ? <span>Mudir: {item.mudirName}</span> : null}
            {item.phone ? (
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {item.phone}
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Bosqich</p>
              <p className="text-sm font-semibold tabular-nums">
                {k.currentStage} / {k.stageCount}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Testlar</p>
              <p className="text-sm font-semibold tabular-nums">
                {k.testsPassed}/{k.testsTotal}
                <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                  ({k.testsAttempted} ishlangan)
                </span>
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">O‘rtacha ball</p>
              <p className={cn("text-sm font-semibold tabular-nums", scoreTone(k.avgScore))}>
                {k.avgScore != null ? `${k.avgScore}%` : "—"}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Progress</p>
              <p className={cn("text-sm font-semibold tabular-nums", scoreTone(k.progressPct))}>
                {k.progressPct}%
              </p>
            </div>
          </div>

          <ProgressBar value={k.progressPct} />
        </div>

        <ChevronDown
          className={cn(
            "mt-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="space-y-2 border-t bg-muted/20 px-3 py-3 sm:px-4">
          <p className="text-xs font-medium text-muted-foreground">
            Har bir bosqich — video, slayd va test (o‘tish: ≥{k.passScore}%)
          </p>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="bg-[#0b3a5c] text-white">
                <tr>
                  <th className="px-3 py-2 font-medium">Bosqich</th>
                  <th className="px-3 py-2 font-medium">Video</th>
                  <th className="px-3 py-2 font-medium">Slayd</th>
                  <th className="px-3 py-2 font-medium">Urinish</th>
                  <th className="px-3 py-2 font-medium">Ball %</th>
                  <th className="px-3 py-2 font-medium">Natija</th>
                </tr>
              </thead>
              <tbody>
                {k.stages.map((s) => (
                  <tr key={s.stage} className="border-t">
                    <td className="px-3 py-2">
                      <span className="font-medium">{s.stage}.</span>{" "}
                      <span className="text-muted-foreground">
                        {s.title.replace(/^\d+-bosqich:\s*/i, "")}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{s.videoDone ? "✓" : "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{s.slidesDone ? "✓" : "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{s.attempts || "—"}</td>
                    <td className={cn("px-3 py-2 font-semibold tabular-nums", scoreTone(s.score))}>
                      {s.score != null ? `${s.score}%` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {s.passed ? (
                        <span className="font-medium text-emerald-600">O‘tdi</span>
                      ) : s.attempts > 0 ? (
                        <span className="font-medium text-rose-600">Qayta</span>
                      ) : (
                        <span className="text-muted-foreground">Kutilmoqda</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function InternshipsPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useStajyorRoster();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const items = data?.items ?? [];
  const summary = data?.summary;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((it) => {
      const st = it.kirish.status;
      if (status === "in_progress" && st !== "in_progress" && st !== "not_started") return false;
      if (status === "ready_for_hire" && st !== "ready_for_hire") return false;
      if (status === "hired" && st !== "hired") return false;
      if (status === "not_started" && st !== "not_started") return false;

      if (!needle) return true;
      const hay = [it.fullName, it.phone, it.login, it.location, it.mudirName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [items, q, status]);

  const filters: { id: StatusFilter; label: string }[] = [
    { id: "all", label: "Hammasi" },
    { id: "in_progress", label: "Jarayonda" },
    { id: "ready_for_hire", label: "Tayyor" },
    { id: "hired", label: "Ishga olingan" },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-[#0b3a5c]" />
            <h1 className="text-xl font-semibold tracking-tight">Stajirovkalar</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Faqat stajyorlar — Kirish o‘quv bosqichlari, testlar va foizlar
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 self-start"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          Yangilash
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Stajyorlar", value: summary?.total ?? "—" },
          { label: "Jarayonda", value: summary?.inProgress ?? "—" },
          { label: "Ishga tayyor", value: summary?.ready ?? "—" },
          { label: "O‘rtacha progress", value: summary != null ? `${summary.avgProgress}%` : "—" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border bg-card p-3 shadow-sm">
            <p className="text-[11px] text-muted-foreground">{s.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ism, filial, telefon…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStatus(f.id)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                status === f.id
                  ? "border-[#0b3a5c] bg-[#0b3a5c] text-white shadow-sm"
                  : "border-border bg-card text-foreground hover:border-[#0b3a5c]/40 hover:bg-muted/50",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-800">
          {(error as Error)?.message || "Ro‘yxat yuklanmadi"}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/30 p-10 text-center">
          <GraduationCap className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Stajyor topilmadi</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Hozircha `stajyor` roli bilan foydalanuvchi yo‘q yoki filtr bo‘sh.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="border-b bg-[#0b3a5c] px-4 py-2.5 text-xs font-medium text-white">
            {filtered.length} ta stajyor
          </div>
          {filtered.map((item) => (
            <StageRow key={item.userId} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
