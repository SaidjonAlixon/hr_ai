import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  MapPin,
  RefreshCw,
  ShieldAlert,
  Trophy,
  Users,
  Wrench,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  useDavomatXatoliklar,
  fixBranchAssignment,
  setXatolikStatus,
  isXatolikBajarilgan,
  type DavomatXatolikItem,
  type DoneFilter,
} from "@/lib/davomat-xatoliklar-api";
import { useAuth } from "@/contexts/AuthContext";
import { canViewDavomat, hasFullPlatformAccess, isDirectorRole } from "@/lib/roles";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { displayBranchName } from "@/lib/pharmacy-staff-api";

function branchName(raw: string | null | undefined, fallback = "—") {
  const n = displayBranchName(raw).trim();
  return n || fallback;
}

function severityBadge(s: string) {
  if (s === "high") return "bg-rose-100 text-rose-800 border-rose-200";
  if (s === "medium") return "bg-amber-100 text-amber-900 border-amber-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function formatWhen(iso: string) {
  try {
    return new Intl.DateTimeFormat("uz-UZ", {
      timeZone: "Asia/Tashkent",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function fmtCoord(n: number) {
  return n.toFixed(5);
}

function LiveLocCell({ item }: { item: DavomatXatolikItem }) {
  const live = item.liveLocation;
  if (!live) {
    return <span className="text-xs text-muted-foreground">GPS yozilmagan</span>;
  }
  return (
    <div className="space-y-1">
      <p className="font-mono text-[11px] tabular-nums text-foreground">
        {fmtCoord(live.latitude)}, {fmtCoord(live.longitude)}
      </p>
      {live.distanceMeters != null ? (
        <p className="text-[11px] text-rose-700">
          Filialdan ~{Math.round(live.distanceMeters)} m
        </p>
      ) : null}
      <a
        href={live.mapsUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0b3a5c] hover:underline"
      >
        <MapPin className="h-3 w-3" />
        Xaritada ochish
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

function buildFixPlan(item: DavomatXatolikItem) {
  const name = item.employee?.fullName || item.user?.fullName || "Xodim";
  const assigned = branchName(
    item.assignedBranch?.label || item.employee?.location,
  );
  const scanned = branchName(item.scannedBranch?.label, "—");
  const scannedId = item.scannedBranch?.id ?? null;
  const assignedId = item.assignedBranch?.id ?? item.employee?.assignedBranchId ?? null;
  const canAssign =
    item.code === "no_assignment_today" || item.code === "branch_unassigned";

  type FixOption = {
    id: string;
    mode: "assign_branch" | "mark_done" | "rotate_today";
    label: string;
    detail: string;
    branchId?: number | null;
    note?: string;
    recommended?: boolean;
  };

  if (item.wrongBranch || item.code === "qr_wrong_branch" || item.code === "wrong_branch") {
    const options: FixOption[] = [];
    if (scannedId) {
      options.push({
        id: "rotate",
        mode: "rotate_today",
        label: `Bugun «${scanned}» ga rotatsiya`,
        detail:
          "Agar xodim haqiqatan shu filialda ishlashi kerak bo‘lsa — bugun uchun ruxsat ochiladi. Doimiy filial o‘zgarmaydi.",
        branchId: scannedId,
        note: `Rotatsiya → ${scanned}`,
        recommended: true,
      });
    }
    options.push({
      id: "keep",
      mode: "mark_done",
      label: "Filialni o‘zgartirmasdan yopish",
      detail: `Xodimga faqat o‘z filiali («${assigned}») QR ini skanerlashni ayting. Shu yozuv «Bajarilgan» bo‘ladi.`,
      note: `Boshqa filial: belgilangan=${assigned}, skaner=${scanned}`,
      recommended: !scannedId,
    });
    return {
      title: "Yechim taklifi",
      problem: `${name} boshqa filial QR skaner qilgan.`,
      facts: [
        `Belgilangan filial: ${assigned}`,
        `Skaner qilingan QR: ${scanned}`,
        item.coordinator ? `Koordinator: ${item.coordinator.fullName}` : null,
      ].filter(Boolean) as string[],
      options,
      defaultOptionId: options.find((o) => o.recommended)?.id || options[0]!.id,
    };
  }

  if (canAssign) {
    return {
      title: "Yechim taklifi",
      problem: `${name} da filial/smena biriktirilmagan.`,
      facts: [
        `Taklif etilgan filial: ${assigned !== "—" ? assigned : "mavjud biriktirma"}`,
        item.fix,
      ],
      options: [
        {
          id: "assign",
          mode: "assign_branch" as const,
          label: "Doimiy filialni biriktirish",
          detail: "Filial saqlanadi, permanent slot ochiladi, xatolik «Bajarilgan» bo‘ladi.",
          branchId: assignedId,
          recommended: true,
        },
      ],
      defaultOptionId: "assign",
    };
  }

  if (item.code === "outside_geofence" || item.code === "outside_office_geofence") {
    return {
      title: "Yechim taklifi",
      problem: `${name} GPS zonadan tashqarida edi.`,
      facts: [
        `Belgilangan joy: ${assigned}`,
        item.liveLocation
          ? `Jonli GPS: ${item.liveLocation.latitude.toFixed(5)}, ${item.liveLocation.longitude.toFixed(5)}`
          : "Jonli GPS yozilmagan",
        item.fix,
      ],
      options: [
        {
          id: "done",
          mode: "mark_done" as const,
          label: "Yozuvni bajarilgan qilish",
          detail:
            "Filial o‘zgarmaydi. Xodim binoga yaqinlashib qayta urinsin. Agar joyda xato bersa — filial GPS ni tekshiring.",
          note: "Geofence",
          recommended: true,
        },
      ],
      defaultOptionId: "done",
    };
  }

  return {
    title: "Yechim taklifi",
    problem: `${name}: ${item.title}`,
    facts: [item.meaning, `Tavsiya: ${item.fix}`],
    options: [
      {
        id: "done",
        mode: "mark_done" as const,
        label: "Shu yozuvni bajarilgan qilish",
        detail: "Sozlamalar o‘zgarmaydi — faqat holat yopiladi. Kerak bo‘lsa Smena sahifasida qo‘lda tuzating.",
        note: item.title,
        recommended: true,
      },
    ],
    defaultOptionId: "done",
  };
}

export default function DavomatXatoliklarPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const allowed =
    canViewDavomat(user?.role) ||
    hasFullPlatformAccess(user?.role) ||
    isDirectorRole(user?.role);
  const [days, setDays] = useState(7);
  const [codeFilter, setCodeFilter] = useState<string>("all");
  /** Tizim o‘zi ajratadi — default: bajarilmagan */
  const [doneFilter, setDoneFilter] = useState<DoneFilter>("bajarilmagan");
  const [onlyWrongBranch, setOnlyWrongBranch] = useState(false);
  /** null = barchasi; "none" = topilmagan; number = coordinator employeeId */
  const [coordFilter, setCoordFilter] = useState<number | "none" | null>(null);
  const search = useSearch();
  const [fixItem, setFixItem] = useState<DavomatXatolikItem | null>(null);
  const [fixOptionId, setFixOptionId] = useState<string>("");
  const [fixResult, setFixResult] = useState<{
    summary: string;
    steps: string[];
    message: string;
  } | null>(null);
  const q = useDavomatXatoliklar(days, allowed);

  useEffect(() => {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const coord = params.get("coord");
    if (coord === "none") setCoordFilter("none");
    else if (coord && Number.isFinite(Number(coord))) setCoordFilter(Number(coord));
  }, [search]);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["davomat-xatoliklar"] });

  const fixMut = useMutation({
    mutationFn: fixBranchAssignment,
    onSuccess: (r) => {
      setFixResult({
        summary: r.result?.summary || "Yechim qo‘llandi",
        steps: r.result?.steps || [r.message],
        message: r.message,
      });
      toast({ title: "Natija", description: r.message });
      invalidate();
    },
    onError: (e: Error) => {
      toast({ title: "Tiklash xato", description: e.message, variant: "destructive" });
    },
  });

  const statusMut = useMutation({
    mutationFn: setXatolikStatus,
    onSuccess: (r) => {
      toast({ title: "Holat", description: r.message });
      invalidate();
    },
    onError: (e: Error) => {
      toast({ title: "Holat xato", description: e.message, variant: "destructive" });
    },
  });

  const counts = useMemo(() => {
    const sc = q.data?.statusCounts;
    if (sc && typeof sc.bajarilmagan === "number") {
      return {
        bajarilmagan: sc.bajarilmagan,
        bajarilgan: sc.bajarilgan ?? 0,
      };
    }
    let bajarilmagan = 0;
    let bajarilgan = 0;
    for (const it of q.data?.items || []) {
      if (isXatolikBajarilgan(it.resolutionStatus)) bajarilgan += 1;
      else bajarilmagan += 1;
    }
    return { bajarilmagan, bajarilgan };
  }, [q.data]);

  const items = useMemo(() => {
    let list = q.data?.items || [];
    if (codeFilter !== "all") list = list.filter((i) => i.code === codeFilter);
    list = list.filter((i) => {
      const done = isXatolikBajarilgan(i.resolutionStatus);
      return doneFilter === "bajarilgan" ? done : !done;
    });
    if (onlyWrongBranch) list = list.filter((i) => i.wrongBranch);
    if (coordFilter === "none") {
      list = list.filter((i) => !i.coordinator?.employeeId);
    } else if (typeof coordFilter === "number") {
      list = list.filter((i) => i.coordinator?.employeeId === coordFilter);
    }
    return list;
  }, [q.data?.items, codeFilter, doneFilter, onlyWrongBranch, coordFilter]);

  const ranking = q.data?.coordinatorRanking || [];

  const fixPlan = fixItem ? buildFixPlan(fixItem) : null;
  const selectedOption =
    fixPlan?.options.find((o) => o.id === fixOptionId) ||
    fixPlan?.options.find((o) => o.id === fixPlan.defaultOptionId) ||
    fixPlan?.options[0] ||
    null;

  const openFix = (item: DavomatXatolikItem) => {
    const plan = buildFixPlan(item);
    setFixResult(null);
    setFixOptionId(plan.defaultOptionId);
    setFixItem(item);
  };

  const closeFix = () => {
    setFixItem(null);
    setFixResult(null);
    setFixOptionId("");
  };

  if (!allowed) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Bu bo‘lim faqat davomat kuzatuvchilari uchun.
      </p>
    );
  }

  return (
    <div className="w-full max-w-none space-y-4 px-1 pb-12 sm:px-2">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-[#0b3a5c] via-[#0f4a73] to-[#163a55] p-5 text-white shadow-md">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-white/15 p-2.5 ring-1 ring-white/20">
              <ShieldAlert className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-100/90">
                Davomat
              </p>
              <h1 className="text-2xl font-semibold">Xatoliklar</h1>
              <p className="mt-1 max-w-3xl text-sm text-sky-50/90">
                Har bir xatolikda koordinator ko‘rinadi. Eng ko‘p muammoli koordinatorlar
                reytingi shu sahifada.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="h-10 gap-2 rounded-xl bg-white text-[#0b3a5c] hover:bg-sky-50"
            onClick={() => void q.refetch()}
            disabled={q.isFetching}
          >
            <RefreshCw className={cn("h-4 w-4", q.isFetching && "animate-spin")} />
            Yangilash
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {[3, 7, 14, 30].map((d) => (
          <Button
            key={d}
            type="button"
            size="sm"
            variant={days === d ? "default" : "outline"}
            className={cn("h-8 rounded-lg", days === d && "bg-[#0b3a5c]")}
            onClick={() => setDays(d)}
          >
            {d} kun
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant={onlyWrongBranch ? "default" : "outline"}
          className={cn("h-8 rounded-lg", onlyWrongBranch && "bg-rose-700 hover:bg-rose-800")}
          onClick={() => setOnlyWrongBranch((v) => !v)}
        >
          Faqat boshqa filial
        </Button>
        {coordFilter != null ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg text-xs"
            onClick={() => setCoordFilter(null)}
          >
            Koordinator filtrini tozalash
          </Button>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">
          Ko‘rsatilmoqda: <strong className="text-foreground">{items.length}</strong>
        </span>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : q.isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {(q.error as Error)?.message || "Yuklanmadi"}
          <Button className="ml-3" size="sm" variant="outline" onClick={() => void q.refetch()}>
            Qayta
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:max-w-md">
            <button
              type="button"
              onClick={() => setDoneFilter("bajarilmagan")}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-left transition",
                doneFilter === "bajarilmagan"
                  ? "border-amber-600 bg-amber-50"
                  : "border-border bg-card",
              )}
            >
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                <XCircle className="h-3.5 w-3.5 text-amber-700" />
                Bajarilmagan
              </p>
              <p className="mt-0.5 text-lg font-bold tabular-nums">{counts.bajarilmagan}</p>
            </button>
            <button
              type="button"
              onClick={() => setDoneFilter("bajarilgan")}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-left transition",
                doneFilter === "bajarilgan"
                  ? "border-emerald-600 bg-emerald-50"
                  : "border-border bg-card",
              )}
            >
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                Bajarilgan
              </p>
              <p className="mt-0.5 text-lg font-bold tabular-nums">{counts.bajarilgan}</p>
            </button>
          </div>

          {ranking.length > 0 ? (
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-amber-100 p-2 text-amber-800">
                    <Trophy className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      Eng ko‘p muammoli koordinatorlar
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Xodimlar xatosi qaysi koordinator zimmasida — bosib filtrlang
                    </p>
                  </div>
                </div>
                {coordFilter != null ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-lg text-xs"
                    onClick={() => setCoordFilter(null)}
                  >
                    Filtrni tozalash
                  </Button>
                ) : null}
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {ranking.slice(0, 12).map((r, idx) => {
                  const key = r.employeeId ?? `none-${idx}`;
                  const active =
                    r.employeeId == null
                      ? coordFilter === "none"
                      : coordFilter === r.employeeId;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        setCoordFilter(
                          active ? null : r.employeeId == null ? "none" : r.employeeId,
                        )
                      }
                      className={cn(
                        "min-w-[168px] shrink-0 rounded-xl border px-3 py-2.5 text-left transition",
                        active
                          ? "border-[#0b3a5c] bg-[#0b3a5c]/10"
                          : "border-border bg-background hover:bg-muted/40",
                      )}
                    >
                      <p className="flex items-center gap-1 text-[10px] font-bold uppercase text-muted-foreground">
                        <Users className="h-3 w-3" />#{idx + 1}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-foreground">
                        {r.fullName}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Ochiq: <strong className="text-amber-800">{r.open}</strong>
                        {" · "}
                        Xodim: {r.staffWithIssues}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {(q.data?.summary?.length ?? 0) > 0 ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setCodeFilter("all")}
                className={cn(
                  "shrink-0 rounded-xl border px-3 py-2 text-left transition",
                  codeFilter === "all"
                    ? "border-[#0b3a5c] bg-[#0b3a5c]/8"
                    : "border-border bg-card",
                )}
              >
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Xato turi
                </p>
                <p className="text-lg font-bold tabular-nums">{q.data?.total ?? 0}</p>
              </button>
              {q.data!.summary.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  title={s.meaning || s.title}
                  onClick={() => setCodeFilter(s.code)}
                  className={cn(
                    "min-w-[148px] max-w-[200px] shrink-0 rounded-xl border px-3 py-2 text-left transition",
                    codeFilter === s.code
                      ? "border-[#0b3a5c] bg-[#0b3a5c]/8"
                      : "border-border bg-card",
                  )}
                >
                  <p className="line-clamp-2 text-[11px] font-semibold leading-snug text-foreground">
                    {s.title}
                  </p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums">{s.count}</p>
                </button>
              ))}
            </div>
          ) : null}

          {items.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/40 px-6 py-14 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-600" />
              <p className="mt-3 text-base font-semibold text-emerald-950">
                {doneFilter === "bajarilgan" ? "Bajarilgan yo‘q" : "Bajarilmagan yo‘q"}
              </p>
              <p className="mt-1 text-sm text-emerald-900/70">
                Tanlangan filtrda yozuv topilmadi.
              </p>
            </div>
          ) : (
            <div className="w-full overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="w-full overflow-x-auto">
                <table className="w-full min-w-[1100px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-border bg-[#0b3a5c] text-[10px] uppercase tracking-wide text-white">
                      <th className="px-3 py-2.5 font-semibold">Vaqt</th>
                      <th className="px-3 py-2.5 font-semibold">Xodim</th>
                      <th className="px-3 py-2.5 font-semibold">Koordinator</th>
                      <th className="px-3 py-2.5 font-semibold">Xato</th>
                      <th className="px-3 py-2.5 font-semibold">Holat</th>
                      <th className="px-3 py-2.5 font-semibold">Belgilangan filial</th>
                      <th className="px-3 py-2.5 font-semibold">Urinish / skaner</th>
                      <th className="px-3 py-2.5 font-semibold">Jonli lokatsiya</th>
                      <th className="px-3 py-2.5 font-semibold">Nima qilish</th>
                      <th className="px-3 py-2.5 font-semibold">Amal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => {
                      const name =
                        item.employee?.fullName || item.user?.fullName || "Noma’lum";
                      const done = isXatolikBajarilgan(item.resolutionStatus);
                      const repeats =
                        item.repeatCount && item.repeatCount > 1 ? item.repeatCount : 0;
                      return (
                        <tr
                          key={item.id}
                          className={cn(
                            "border-b border-border/70 align-top",
                            idx % 2 === 1 && "bg-slate-50/80",
                            item.wrongBranch && "bg-rose-50/50",
                            done && "opacity-80",
                          )}
                        >
                          <td className="px-3 py-3 whitespace-nowrap">
                            <p className="text-xs font-medium tabular-nums">
                              {formatWhen(item.createdAt)}
                            </p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              {item.method || "—"}
                              {item.action
                                ? ` · ${item.action === "in" ? "Keldim" : "Ketdim"}`
                                : ""}
                            </p>
                            {repeats ? (
                              <p className="mt-1 inline-flex rounded-md bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                                ×{repeats} takror (faqat oxirgisi)
                              </p>
                            ) : null}
                          </td>
                          <td className="px-3 py-3">
                            <p className="font-semibold text-foreground">{name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {item.user?.login || item.employee?.phone || "—"}
                            </p>
                          </td>
                          <td className="px-3 py-3">
                            {item.coordinator ? (
                              <div>
                                <p className="text-sm font-semibold text-foreground">
                                  {item.coordinator.fullName}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  {item.coordinator.login || "Koordinator"}
                                </p>
                              </div>
                            ) : (
                              <span className="text-xs text-amber-800">Topilmadi</span>
                            )}
                          </td>
                          <td className="px-3 py-3 max-w-[220px]">
                            <span
                              className={cn(
                                "inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-bold",
                                severityBadge(item.severity),
                              )}
                            >
                              {item.title}
                            </span>
                            <p className="mt-1.5 text-xs leading-snug text-foreground/90">
                              {item.meaning}
                            </p>
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={cn(
                                "inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-bold",
                                done
                                  ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                                  : "border-amber-200 bg-amber-50 text-amber-900",
                              )}
                            >
                              {done ? "Bajarilgan" : "Bajarilmagan"}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <p className="text-sm font-medium">
                              {branchName(
                                item.assignedBranch?.label || item.employee?.location,
                                "Biriktirilmagan",
                              )}
                            </p>
                          </td>
                          <td className="px-3 py-3">
                            {item.wrongBranch ? (
                              <div className="space-y-1">
                                <span className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">
                                  <AlertTriangle className="h-3 w-3" />
                                  Boshqa filial
                                </span>
                                <p className="text-sm font-semibold text-rose-900">
                                  {branchName(
                                    item.scannedBranch?.label,
                                    "Noma’lum QR filial",
                                  )}
                                </p>
                              </div>
                            ) : item.scannedBranch ? (
                              <p className="text-sm">
                                {branchName(item.scannedBranch.label)}
                              </p>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <LiveLocCell item={item} />
                          </td>
                          <td className="px-3 py-3 max-w-[240px]">
                            <p className="text-xs leading-snug text-emerald-900">{item.fix}</p>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex min-w-[140px] flex-col gap-1">
                              {!done ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  className="h-8 gap-1 rounded-md bg-[#0b3a5c] px-2 text-[11px]"
                                  onClick={() => openFix(item)}
                                >
                                  <Wrench className="h-3 w-3" />
                                  Tiklash
                                </Button>
                              ) : null}
                              <Button
                                type="button"
                                size="sm"
                                variant={done ? "outline" : "default"}
                                className={cn(
                                  "h-7 rounded-md px-2 text-[10px]",
                                  done
                                    ? ""
                                    : "bg-emerald-700 hover:bg-emerald-800",
                                )}
                                disabled={statusMut.isPending}
                                onClick={() =>
                                  statusMut.mutate({
                                    id: item.id,
                                    status: done ? "bajarilmagan" : "bajarilgan",
                                  })
                                }
                              >
                                {done ? "Bajarilmaganga" : "Bajarilgan"}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 rounded-md px-2 text-[10px]"
                                asChild
                              >
                                <Link href="/smena-filial">Smena</Link>
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">Qoida</p>
            <p className="mt-1">
              Holat faqat ikkita: <strong className="text-foreground">Bajarilmagan</strong> va{" "}
              <strong className="text-foreground">Bajarilgan</strong>. Tiklash yoki «Bajarilgan»
              — faqat shu yozuvga.
            </p>
          </div>
        </>
      )}

      <Dialog open={!!fixItem} onOpenChange={(o) => !o && closeFix()}>
        <DialogContent className="max-w-lg">
          {fixResult ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-emerald-800">
                  <CheckCircle2 className="h-5 w-5" />
                  {fixResult.summary}
                </DialogTitle>
                <DialogDescription asChild>
                  <div className="space-y-2 pt-2 text-sm">
                    <p className="font-medium text-foreground">{fixResult.message}</p>
                    <ul className="space-y-1.5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-foreground/90">
                      {fixResult.steps.map((s, i) => (
                        <li key={i} className="leading-snug">
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button type="button" className="w-full bg-emerald-700 hover:bg-emerald-800" onClick={closeFix}>
                  Yopish
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{fixPlan?.title || "Yechim taklifi"}</DialogTitle>
                <DialogDescription asChild>
                  <div className="space-y-3 pt-1 text-sm text-muted-foreground">
                    {fixPlan?.problem ? (
                      <p className="font-medium text-foreground">{fixPlan.problem}</p>
                    ) : null}
                    {fixPlan?.facts?.length ? (
                      <ul className="space-y-1 rounded-lg border border-border bg-muted/30 p-2.5 text-[13px] text-foreground/90">
                        {fixPlan.facts.map((f, i) => (
                          <li key={i}>• {f}</li>
                        ))}
                      </ul>
                    ) : null}
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Taklif — tanlang, keyin rozilik bering
                    </p>
                    <div className="space-y-2">
                      {fixPlan?.options.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setFixOptionId(opt.id)}
                          className={cn(
                            "w-full rounded-xl border px-3 py-2.5 text-left transition",
                            (selectedOption?.id || fixPlan.defaultOptionId) === opt.id
                              ? "border-[#0b3a5c] bg-[#0b3a5c]/8 ring-1 ring-[#0b3a5c]/30"
                              : "border-border bg-card hover:bg-muted/40",
                          )}
                        >
                          <p className="text-sm font-semibold text-foreground">
                            {opt.recommended ? "★ " : ""}
                            {opt.label}
                          </p>
                          <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                            {opt.detail}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex-col gap-2 sm:flex-col">
                {fixItem && selectedOption ? (
                  <>
                    <Button
                      type="button"
                      className="w-full bg-[#0b3a5c] hover:bg-[#0a3250]"
                      disabled={fixMut.isPending || !fixItem.employee?.id}
                      onClick={() => {
                        if (!fixItem.employee?.id || !selectedOption) return;
                        fixMut.mutate({
                          employeeId: fixItem.employee.id,
                          auditId: fixItem.id,
                          branchId:
                            selectedOption.branchId ??
                            fixItem.employee.assignedBranchId ??
                            fixItem.scannedBranch?.id ??
                            null,
                          mode: selectedOption.mode,
                          note: selectedOption.note,
                        });
                      }}
                    >
                      {fixMut.isPending
                        ? "Qo‘llanmoqda…"
                        : "Roziman — to‘liq qo‘llash"}
                    </Button>
                    <Button type="button" variant="outline" className="w-full" asChild>
                      <Link href="/smena-filial">Smena va filialga o‘tish</Link>
                    </Button>
                    <Button type="button" variant="ghost" className="w-full" onClick={closeFix}>
                      Bekor
                    </Button>
                  </>
                ) : null}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
