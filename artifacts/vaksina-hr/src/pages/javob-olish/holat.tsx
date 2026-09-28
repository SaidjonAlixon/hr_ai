import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Eye,
  FileDown,
  FileSpreadsheet,
  Loader2,
  PhoneCall,
  Search,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useToast } from "../../hooks/use-toast";
import { useI18n } from "../../i18n/I18nProvider";
import { useAuth } from "../../contexts/AuthContext";
import { cn } from "../../lib/utils";
import { isDirectorRole } from "../../lib/roles";
import { JavobRequestCard } from "../../components/javob/JavobRequestCard";
import {
  approveJavobRequest,
  fetchJavobRequests,
  rejectJavobRequest,
} from "../../lib/javob-olish-api";
import {
  buildJavobApprovedExport,
  exportJavobApprovedExcel,
  exportJavobApprovedPdf,
} from "../../lib/javob-olish-export";

type StatusFilter = "all" | "pending_coord" | "pending_hr" | "approved" | "rejected" | "cancelled";

function canAccessJavobHolat(role: string) {
  return (
    role === "hr_menejer" ||
    role === "hr_direktor" ||
    role === "hr" ||
    role === "hr_kadr_rahbar" ||
    role === "hr_auditor" ||
    role === "admin" ||
    isDirectorRole(role)
  );
}

export default function JavobOlishHolatPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const role = user?.role || "";
  const allowed = canAccessJavobHolat(role);
  const canDecide =
    role === "hr_menejer" ||
    role === "hr_direktor" ||
    role === "hr" ||
    role === "hr_kadr_rahbar" ||
    role === "admin" ||
    isDirectorRole(role);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [q, setQ] = useState("");
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);

  const allQ = useQuery({
    queryKey: ["javob-olish", "all", "holat"],
    queryFn: () => fetchJavobRequests("all"),
    enabled: allowed,
  });

  const decideMut = useMutation({
    mutationFn: (p: { id: number; action: "approve" | "reject" }) =>
      p.action === "approve" ? approveJavobRequest(p.id) : rejectJavobRequest(p.id),
    onSuccess: (_, p) => {
      toast({ title: p.action === "approve" ? t("javob.approved") : t("javob.rejected") });
      void qc.invalidateQueries({ queryKey: ["javob-olish"] });
    },
    onError: (e: Error) => toast({ title: t("javob.decideFail"), description: e.message, variant: "destructive" }),
  });

  const items = allQ.data?.items ?? [];

  const stats = useMemo(() => {
    let pendingCoord = 0;
    let pendingHr = 0;
    let approved = 0;
    let rejected = 0;
    for (const it of items) {
      if (it.status === "pending" || it.status === "pending_coord") pendingCoord += 1;
      else if (it.status === "pending_hr") pendingHr += 1;
      else if (it.status === "approved") approved += 1;
      else if (it.status === "rejected") rejected += 1;
    }
    return { total: items.length, pendingCoord, pendingHr, approved, rejected };
  }, [items]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return items.filter((it) => {
      if (statusFilter === "pending_coord") {
        if (it.status !== "pending" && it.status !== "pending_coord") return false;
      } else if (statusFilter !== "all" && it.status !== statusFilter) {
        return false;
      }
      if (!qq) return true;
      const hay =
        `${it.fullName || ""} ${it.note || ""} ${it.workDate} ${it.branchLabel || ""} ${it.coordinatorName || ""}`.toLowerCase();
      return hay.includes(qq);
    });
  }, [items, statusFilter, q]);

  async function runExport(kind: "excel" | "pdf") {
    if (!filtered.length) {
      toast({ title: t("javob.exportEmpty"), variant: "destructive" });
      return;
    }
    setExporting(kind);
    try {
      const payload = buildJavobApprovedExport(filtered, t("javob.holatExportTitle"));
      if (kind === "excel") await exportJavobApprovedExcel(payload);
      else await exportJavobApprovedPdf(payload);
      toast({ title: t("javob.exportOk") });
    } catch (e) {
      toast({
        title: t("javob.exportFail"),
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setExporting(null);
    }
  }

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg p-6 text-center text-sm text-muted-foreground">
        {t("javob.holatNoAccess")}
      </div>
    );
  }

  const filters: { id: StatusFilter; label: string; count?: number }[] = [
    { id: "all", label: t("javob.holatFilterAll"), count: stats.total },
    { id: "pending_coord", label: t("javob.statusPendingCoord"), count: stats.pendingCoord },
    { id: "pending_hr", label: t("javob.statusPendingHr"), count: stats.pendingHr },
    { id: "approved", label: t("javob.holatFilterApproved"), count: stats.approved },
    { id: "rejected", label: t("javob.holatFilterRejected"), count: stats.rejected },
    { id: "cancelled", label: t("javob.statusCancelled") },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
            <Eye className="h-5 w-5 text-primary" />
            {t("javob.holatTitle")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("javob.holatSubtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 gap-1.5"
            disabled={exporting !== null || !filtered.length}
            onClick={() => void runExport("excel")}
          >
            {exporting === "excel" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
            )}
            {t("javob.exportExcel")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 gap-1.5"
            disabled={exporting !== null || !filtered.length}
            onClick={() => void runExport("pdf")}
          >
            {exporting === "pdf" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileDown className="h-3.5 w-3.5 text-rose-700" />
            )}
            {t("javob.exportPdf")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: t("javob.holatStatTotal"), value: stats.total },
          { label: t("javob.statusPendingCoord"), value: stats.pendingCoord },
          { label: t("javob.statusPendingHr"), value: stats.pendingHr },
          { label: t("javob.holatFilterApproved"), value: stats.approved },
        ].map((s) => (
          <Card key={s.label} className="shadow-sm">
            <CardContent className="p-3">
              <div className="text-2xl font-bold tabular-nums">{s.value}</div>
              <div className="text-[11px] font-medium text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={t("javob.holatSearch")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setStatusFilter(f.id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
              statusFilter === f.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
            {typeof f.count === "number" ? ` · ${f.count}` : ""}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PhoneCall className="h-4 w-4 text-primary" />
            {t("javob.holatListTitle")}
            <span className="text-sm font-normal text-muted-foreground">({filtered.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {allQ.isLoading ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              …
            </p>
          ) : filtered.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
              {t("javob.holatEmpty")}
            </p>
          ) : (
            filtered.map((item) => {
              const needsHr = canDecide && item.status === "pending_hr";
              return (
                <JavobRequestCard
                  key={item.id}
                  item={item}
                  t={t}
                  actions={
                    needsHr ? (
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="border-rose-200 text-rose-700 hover:bg-rose-50"
                          disabled={decideMut.isPending}
                          onClick={() => decideMut.mutate({ id: item.id, action: "reject" })}
                        >
                          <XCircle className="mr-1.5 h-4 w-4" />
                          {t("javob.reject")}
                        </Button>
                        <Button
                          type="button"
                          disabled={decideMut.isPending}
                          onClick={() => decideMut.mutate({ id: item.id, action: "approve" })}
                        >
                          <CheckCircle2 className="mr-1.5 h-4 w-4" />
                          {t("javob.approveFinal")}
                        </Button>
                      </div>
                    ) : null
                  }
                />
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
