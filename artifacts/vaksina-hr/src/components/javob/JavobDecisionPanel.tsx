import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  FileDown,
  FileSpreadsheet,
  Hourglass,
  Inbox,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { useToast } from "../../hooks/use-toast";
import { cn } from "../../lib/utils";
import {
  approveJavobRequest,
  fetchJavobRequests,
  groupConsecutiveJavob,
  rejectJavobRequest,
  type JavobRequestGroup,
} from "../../lib/javob-olish-api";
import {
  buildJavobApprovedExport,
  exportJavobApprovedExcel,
  exportJavobApprovedPdf,
} from "../../lib/javob-olish-export";
import { JavobRequestCard } from "./JavobRequestCard";

type Tab = "hr" | "coord" | "decided";
type DecidedFilter = "all" | "approved" | "rejected";
type PendingData = Awaited<ReturnType<typeof fetchJavobRequests>>;

const PENDING_KEY = ["javob-olish", "pending"] as const;
const DECIDED_KEY = ["javob-olish", "decided"] as const;

type Props = {
  t: (k: string) => string;
  isHr: boolean;
  isCoord: boolean;
  isDept?: boolean;
  userId: number | null;
};

export function JavobDecisionPanel({ t, isHr, isCoord, isDept = false, userId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const hrView = isHr && !isCoord;

  const [tab, setTab] = useState<Tab>(hrView ? "hr" : "coord");
  const [decidedFilter, setDecidedFilter] = useState<DecidedFilter>("all");
  const [busy, setBusy] = useState<Record<number, "approve" | "reject">>({});
  const [rejectFor, setRejectFor] = useState<JavobRequestGroup | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);

  const pendingQ = useQuery({
    queryKey: PENDING_KEY,
    queryFn: () => fetchJavobRequests("pending"),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const decidedQ = useQuery({
    queryKey: DECIDED_KEY,
    queryFn: () => fetchJavobRequests("decided"),
    refetchInterval: tab === "decided" ? 60_000 : false,
  });

  const pending = pendingQ.data?.items ?? [];
  const hrItems = useMemo(() => pending.filter((i) => i.status === "pending_hr"), [pending]);
  const coordItems = useMemo(
    () =>
      pending.filter(
        (i) => i.status === "pending_coord" || i.status === "pending" || i.status === "pending_dept",
      ),
    [pending],
  );
  const decided = decidedQ.data?.items ?? [];
  const decidedFiltered = useMemo(() => {
    if (decidedFilter === "all") return decided;
    if (decidedFilter === "approved") return decided.filter((i) => i.status === "approved" || i.status === "pending_hr");
    return decided.filter((i) => i.status === "rejected");
  }, [decided, decidedFilter]);
  const approvedByMe = useMemo(
    () => decided.filter((i) => i.status === "approved" && userId != null && i.decidedById === userId),
    [decided, userId],
  );

  const decideMut = useMutation({
    mutationFn: (p: { group: JavobRequestGroup; action: "approve" | "reject"; note?: string }) =>
      p.action === "approve" ? approveJavobRequest(p.group.id, p.note) : rejectJavobRequest(p.group.id, p.note),
    onMutate: async (p) => {
      const ids = new Set(p.group.items.map((i) => i.id));
      setBusy((b) => ({ ...b, [p.group.id]: p.action }));
      await qc.cancelQueries({ queryKey: PENDING_KEY });
      const snapshot = qc.getQueryData<PendingData>(PENDING_KEY);
      qc.setQueryData<PendingData>(PENDING_KEY, (old) =>
        old ? { ...old, items: old.items.filter((i) => !ids.has(i.id)) } : old,
      );
      return { snapshot };
    },
    onSuccess: (res, p) => {
      const ids = new Set(p.group.items.map((i) => i.id));
      qc.setQueryData<PendingData>(PENDING_KEY, (old) =>
        old ? { ...old, items: old.items.filter((i) => !ids.has(i.id)) } : old,
      );
      const movedToHr = res.item.status === "pending_hr";
      toast({
        title: p.action === "approve" ? (movedToHr ? "Tasdiqlandi — HR ga yuborildi" : t("javob.approved")) : t("javob.rejected"),
        description: `${p.group.head.fullName || "Xodim"} · ${p.group.datesLabel}. «Javob berilganlar» bo‘limiga o‘tdi.`,
      });
      void qc.invalidateQueries({ queryKey: ["javob-olish"] });
    },
    onError: (e: Error, _p, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(PENDING_KEY, ctx.snapshot);
      toast({ title: t("javob.decideFail"), description: e.message, variant: "destructive" });
      void qc.invalidateQueries({ queryKey: PENDING_KEY });
    },
    onSettled: (_r, _e, p) =>
      setBusy((b) => {
        const next = { ...b };
        delete next[p.group.id];
        return next;
      }),
  });

  const confirmReject = () => {
    if (!rejectFor) return;
    decideMut.mutate({ group: rejectFor, action: "reject", note: rejectNote.trim() || undefined });
    setRejectFor(null);
    setRejectNote("");
  };

  async function runExport(kind: "excel" | "pdf") {
    if (!approvedByMe.length) {
      toast({ title: t("javob.exportEmpty"), variant: "destructive" });
      return;
    }
    setExporting(kind);
    try {
      const payload = buildJavobApprovedExport(approvedByMe);
      if (kind === "excel") await exportJavobApprovedExcel(payload);
      else await exportJavobApprovedPdf(payload);
      toast({ title: t("javob.exportOk") });
    } catch (e) {
      toast({ title: t("javob.exportFail"), description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setExporting(null);
    }
  }

  const renderActions = (group: JavobRequestGroup) => {
    const item = group.head;
    if (!item.canAct) {
      return (
        <p className="flex items-center gap-1.5 rounded-xl bg-muted/60 px-3 py-2 text-[11px] text-muted-foreground">
          <Hourglass className="h-3.5 w-3.5 shrink-0" />
          {item.status === "pending_dept"
            ? "Avval bo‘lim boshlig‘i javob beradi — faqat kuzatish"
            : "Avval koordinator javob beradi — faqat kuzatish"}
        </p>
      );
    }
    const state = busy[group.id];
    const approveLabel =
      item.status === "pending_hr"
        ? t("javob.approveFinal")
        : item.status === "pending_dept" || isDept
          ? "Tasdiqlash — HR ga"
          : isCoord
            ? t("javob.approve")
            : t("javob.approveFinal");
    return (
      <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 min-w-0 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:border-rose-500/40 dark:hover:bg-rose-500/10"
          disabled={Boolean(state)}
          onClick={() => {
            setRejectNote("");
            setRejectFor(group);
          }}
        >
          {state === "reject" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <XCircle className="mr-1.5 h-4 w-4 shrink-0" />}
          <span className="truncate">{t("javob.reject")}</span>
        </Button>
        <Button
          type="button"
          className="h-11 min-w-0 bg-emerald-600 text-white hover:bg-emerald-700"
          disabled={Boolean(state)}
          onClick={() => decideMut.mutate({ group, action: "approve" })}
        >
          {state === "approve" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4 shrink-0" />}
          <span className="truncate">{approveLabel}</span>
        </Button>
      </div>
    );
  };

  const hrGroups = useMemo(() => groupConsecutiveJavob(hrItems), [hrItems]);
  const coordGroups = useMemo(() => groupConsecutiveJavob(coordItems), [coordItems]);
  const decidedGroupsAll = useMemo(() => groupConsecutiveJavob(decided), [decided]);
  const decidedGroups = useMemo(() => groupConsecutiveJavob(decidedFiltered), [decidedFiltered]);

  const tabs: Array<{ key: Tab; label: string; count: number; icon: typeof Inbox }> = hrView
    ? [
        { key: "hr", label: "HR kutmoqda", count: hrGroups.length, icon: ShieldCheck },
        { key: "coord", label: "Koordinatorda", count: coordGroups.length, icon: Hourglass },
        { key: "decided", label: "Javob berilganlar", count: decidedGroupsAll.length, icon: CheckCircle2 },
      ]
    : [
        { key: "coord", label: "Kutilayotgan", count: coordGroups.length, icon: Inbox },
        { key: "decided", label: "Javob berilganlar", count: decidedGroupsAll.length, icon: CheckCircle2 },
      ];

  const list = tab === "hr" ? hrGroups : tab === "coord" ? coordGroups : decidedGroups;
  const loading = tab === "decided" ? decidedQ.isLoading : pendingQ.isLoading;
  const error = tab === "decided" ? decidedQ.error : pendingQ.error;
  const refreshing = tab === "decided" ? decidedQ.isFetching : pendingQ.isFetching;

  const emptyText =
    tab === "hr"
      ? "HR ruxsatini kutayotgan so‘rov yo‘q"
      : tab === "coord"
        ? hrView
          ? "Koordinator javobini kutayotgan so‘rov yo‘q"
          : t("javob.noPending")
        : "Hali javob berilgan so‘rov yo‘q";

  return (
    <Card className="overflow-hidden shadow-sm">
      <CardHeader className="space-y-3 border-b bg-gradient-to-br from-primary/10 via-card to-card py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
              {hrView ? t("javob.hrTitle") : isDept ? "Bo‘lim so‘rovlari" : t("javob.coordTitle")}
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{hrView ? t("javob.hrHint") : t("javob.coordHint")}</p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-9 w-9 shrink-0"
            aria-label="Yangilash"
            onClick={() => {
              void pendingQ.refetch();
              void decidedQ.refetch();
            }}
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </Button>
        </div>

        <div className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((x) => (
            <button
              key={x.key}
              type="button"
              onClick={() => setTab(x.key)}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-2 text-[11px] font-semibold transition sm:flex-row sm:gap-1.5 sm:text-sm",
                tab === x.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="flex max-w-full items-center gap-1">
                <x.icon className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
                <span className="truncate">{x.label}</span>
              </span>
              <span
                className={cn(
                  "min-w-[1.5rem] rounded-full px-1.5 text-[10px] tabular-nums sm:text-xs",
                  x.count > 0 && x.key !== "decided" ? "bg-primary text-primary-foreground" : "bg-background/70 text-muted-foreground",
                )}
              >
                {x.count}
              </span>
            </button>
          ))}
        </div>

        {tab === "decided" ? (
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { key: "all", label: "Hammasi" },
                { key: "approved", label: "Tasdiqlangan" },
                { key: "rejected", label: "Rad etilgan" },
              ] as const
            ).map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setDecidedFilter(f.key)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold transition",
                  decidedFilter === f.key
                    ? "bg-foreground text-background"
                    : "bg-card text-muted-foreground ring-1 ring-border hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
            {isHr ? (
              <div className="ml-auto flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5"
                  disabled={exporting !== null || !approvedByMe.length}
                  onClick={() => void runExport("excel")}
                  title={t("javob.approvedByMeHint")}
                >
                  {exporting === "excel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />}
                  {t("javob.exportExcel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5"
                  disabled={exporting !== null || !approvedByMe.length}
                  onClick={() => void runExport("pdf")}
                  title={t("javob.approvedByMeHint")}
                >
                  {exporting === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5 text-rose-700" />}
                  {t("javob.exportPdf")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="pt-4">
        {loading ? (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
          </p>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-6 text-center text-sm text-rose-800">
            {(error as Error).message}
            <Button size="sm" variant="outline" onClick={() => void (tab === "decided" ? decidedQ.refetch() : pendingQ.refetch())}>
              Qayta urinish
            </Button>
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-3 py-10 text-center text-sm text-muted-foreground">
            <Inbox className="h-8 w-8 opacity-40" />
            {emptyText}
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {list.map((group) => (
              <JavobRequestCard
                key={group.id}
                item={group.head}
                datesLabel={group.datesLabel}
                dayCount={group.dayCount}
                t={t}
                busy={Boolean(busy[group.id])}
                actions={tab === "decided" ? undefined : renderActions(group)}
              />
            ))}
          </div>
        )}
      </CardContent>

      <AlertDialog open={Boolean(rejectFor)} onOpenChange={(o) => !o && setRejectFor(null)}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>So‘rovni rad etasizmi?</AlertDialogTitle>
            <AlertDialogDescription>
              {rejectFor
                ? `${rejectFor.head.fullName || "Xodim"} · ${rejectFor.datesLabel} · ${rejectFor.head.fromHm}–${rejectFor.head.toHm}. Ketma-ket kunlarning hammasi birga rad etiladi.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="Rad etish sababi (ixtiyoriy)…"
            maxLength={400}
            className="min-h-[88px]"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Bekor qilish</AlertDialogCancel>
            <Button type="button" className="bg-rose-600 text-white hover:bg-rose-700" onClick={confirmReject}>
              <XCircle className="mr-1.5 h-4 w-4" /> Rad etish
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
