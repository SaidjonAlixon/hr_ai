import React, { useState } from "react";
import { useRoute, Link } from "wouter";
import { ArrowLeft, Shield, Smartphone, Ban } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { canViewReviziya } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useReviziyaDoc, useReviziyaMeta, useReviziyaMutations } from "@/lib/reviziya-api";
import { useI18n } from "../../i18n/I18nProvider";

const STATUS_KEYS: Record<string, string> = {
  planned: "reviziya.status.planned",
  en_route: "reviziya.status.en_route",
  inspecting: "reviziya.status.inspecting",
  reconciling: "reviziya.status.reconciling",
  signed: "reviziya.status.signed",
  accounting_approved: "reviziya.status.accounting_approved",
  closed: "reviziya.status.closed",
  awaiting_explanation: "reviziya.status.awaiting_explanation",
  sb_review: "reviziya.status.sb_review",
  recovery: "reviziya.status.recovery",
  storno: "reviziya.status.storno",
};

const FLOW = ["planned", "en_route", "inspecting", "reconciling", "signed", "accounting_approved", "closed"];

export default function ReviziyaDocPage() {
  const { t } = useI18n();
  const [, params] = useRoute("/reviziya/hujjat/:id");
  const id = Number(params?.id);
  const { user } = useAuth();
  const { toast } = useToast();
  const doc = useReviziyaDoc(id);
  const meta = useReviziyaMeta();
  const mut = useReviziyaMutations();
  const [otp, setOtp] = useState("");
  const [reason, setReason] = useState("");

  if (!canViewReviziya(user?.role)) {
    return <div className="p-8 text-muted-foreground">{t("reviziya.show.noAccess")}</div>;
  }
  const row = doc.data;
  if (doc.isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!row) return <div className="p-8 text-muted-foreground">{t("reviziya.show.notFound")}</div>;

  const typeLabel = meta.data?.docTypes?.find((dt: { value: string }) => dt.value === row.docType)?.label || row.docType;
  const perms = meta.data?.permissions || {};
  const flowIdx = FLOW.indexOf(row.status);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast({ title: ok });
    } catch (e: unknown) {
      toast({ title: e instanceof Error ? e.message : t("ui.error"), variant: "destructive" });
    }
  };

  return (
    <div className="dept-page">
      <div className="dept-hero dept-hero-violet">
        <div className="dept-hero-body">
          <div className="mx-auto max-w-3xl">
            <Link href="/reviziya">
              <span className="inline-flex items-center text-sm text-white/70 hover:text-white">
                <ArrowLeft className="mr-1 h-4 w-4" /> {t("reviziya.show.back")}
              </span>
            </Link>
            <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="dept-eyebrow">{typeLabel}</p>
                <h1 className="dept-title">{row.docNo}</h1>
                <p className="dept-desc">
                  {row.branchName || t("ui.branch")} · {row.responsibleName || t("reviziya.show.noResponsible")}
                </p>
              </div>
              <span className="dept-badge">{t(STATUS_KEYS[row.status] || row.status)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="dept-page-inner !max-w-3xl">
        <div className="dept-panel p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("reviziya.show.flow")}</p>
          <div className="flex flex-wrap gap-1.5">
            {FLOW.map((s, i) => (
              <span
                key={s}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-medium",
                  i <= flowIdx ? "bg-violet-700 text-foreground dark:text-white" : "bg-slate-100 text-muted-foreground",
                )}
              >
                {t(STATUS_KEYS[s])}
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{t("reviziya.show.shortageFlow")}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <p className="text-[11px] text-muted-foreground">{t("reviziya.show.shortageAmt")}</p>
            <p className="text-xl font-semibold tabular-nums">{Math.round(row.shortageAmount || 0)}</p>
          </div>
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <p className="text-[11px] text-muted-foreground">{t("reviziya.show.lines")}</p>
            <p className="text-xl font-semibold">{row.lines?.length || 0}</p>
          </div>
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <p className="text-[11px] text-muted-foreground">{t("reviziya.show.edit")}</p>
            <p className="text-sm font-medium">{row.status === "closed" || row.status === "storno" ? t("reviziya.show.closed") : t("reviziya.show.open")}</p>
          </div>
        </div>

        {(row.lines || []).length ? (
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="border-b px-4 py-3 text-sm font-semibold">{t("reviziya.show.invLines")}</div>
            {(row.lines as Array<Record<string, unknown>>).slice(0, 30).map((l, i) => (
              <div key={i} className="flex flex-wrap justify-between gap-2 border-b px-4 py-2.5 text-xs last:border-0">
                <span className="font-mono">{String(l.barcode || "—")}</span>
                <span>
                  {t("reviziya.show.book")} {String(l.bookQty)} / {t("reviziya.show.actual")} {String(l.actualQty)} · {t("reviziya.show.diff")} {String(l.diffQty ?? "")}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 rounded-2xl border bg-card p-4 shadow-sm">
          <Button size="sm" onClick={() => act(() => mut.advance.mutateAsync({ id }), t("reviziya.show.statusUpdated"))}>
            {t("reviziya.show.nextStatus")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => act(() => mut.advance.mutateAsync({ id, status: "awaiting_explanation" }), t("reviziya.show.explainAsked"))}>
            {t("reviziya.show.askExplain")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => act(() => mut.advance.mutateAsync({ id, status: "sb_review" }), t("reviziya.show.toSb"))}>
            {t("reviziya.status.sb_review")}
          </Button>
          {perms.storno ? (
            <div className="flex flex-wrap gap-2">
              <Input placeholder={t("reviziya.show.stornoReason")} value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 w-40" />
              <Button size="sm" variant="destructive" onClick={() => act(() => mut.storno.mutateAsync({ id, reason }), t("reviziya.status.storno"))}>
                <Ban className="h-3.5 w-3.5" /> {t("reviziya.status.storno")}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Smartphone className="h-4 w-4 text-violet-600" /> {t("reviziya.show.otpTitle")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => act(() => mut.otp.mutateAsync(id), t("reviziya.show.otpSent"))}>
              {t("reviziya.show.sendOtp")}
            </Button>
            <Input className="h-9 w-28" placeholder={t("reviziya.show.code")} value={otp} onChange={(e) => setOtp(e.target.value)} />
            <Button size="sm" onClick={() => act(() => mut.confirmOtp.mutateAsync({ id, code: otp }), t("reviziya.show.confirmed"))}>
              {t("ui.approve")}
            </Button>
          </div>
        </div>

        <div className="dept-panel p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Shield className="h-4 w-4 text-violet-600 dark:text-violet-400" /> {t("reviziya.show.audit")}
          </p>
          {(row.audit || []).length ? (
            (row.audit || []).map((a) => (
              <p key={a.id} className="border-t py-1.5 text-xs text-muted-foreground first:border-0">
                {new Date(a.createdAt).toLocaleString("uz-UZ")} · {a.action} · {a.detail || ""}
              </p>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">{t("reviziya.show.noAudit")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
