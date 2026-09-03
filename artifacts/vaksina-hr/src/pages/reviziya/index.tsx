import React, { useMemo, useState } from "react";
import {
  Plus,
  Search,
  Truck,
  AlertTriangle,
  Camera,
  MapPin,
  ScanLine,
  WifiOff,
  Shield,
  ClipboardCheck,
  LayoutDashboard,
  FileStack,
  BookOpen,
  Smartphone,
  Banknote,
  Package,
  FileText,
  ScrollText,
  Handshake,
  Building2,
  Landmark,
  MessageSquareWarning,
  Gavel,
  Clock,
  CheckCircle2,
  Users,
  Trophy,
  CalendarDays,
  Lock,
  ArrowRight,
  Ban,
  CircleDot,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { canViewReviziya, isReviziyaRole, userRoleLabel, canAddDeptStaff } from "@/lib/roles";
import { AddDeptStaffButton } from "@/components/dept/AddDeptStaffDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Link, useLocation } from "wouter";
import {
  flushOffline,
  peekOfflineCount,
  enqueueOffline,
  useReviziyaBranches,
  useReviziyaDashboard,
  useReviziyaDocs,
  useReviziyaMeta,
  useReviziyaMutations,
  useReviziyaTransit,
} from "@/lib/reviziya-api";
import { useI18n } from "../../i18n/I18nProvider";

const TABS = [
  { id: "dash", labelKey: "reviziya.tab.dash", icon: LayoutDashboard },
  { id: "docs", labelKey: "reviziya.tab.docs", icon: FileStack },
  { id: "new", labelKey: "reviziya.tab.new", icon: Plus },
  { id: "cash", labelKey: "reviziya.tab.cash", icon: Truck },
  { id: "dict", labelKey: "reviziya.tab.dict", icon: BookOpen },
  { id: "mobile", labelKey: "reviziya.tab.mobile", icon: Smartphone },
] as const;

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

const STATUS_TONE: Record<string, string> = {
  planned: "bg-slate-100 text-foreground",
  en_route: "bg-sky-100 text-sky-800",
  inspecting: "bg-indigo-100 text-indigo-800",
  reconciling: "bg-violet-100 text-violet-800",
  signed: "bg-emerald-100 text-emerald-800",
  accounting_approved: "bg-teal-100 text-teal-800",
  closed: "bg-muted dark:bg-slate-800 text-foreground dark:text-white",
  awaiting_explanation: "bg-amber-100 text-amber-900",
  sb_review: "bg-rose-100 text-rose-800",
  recovery: "bg-orange-100 text-orange-900",
  storno: "bg-zinc-200 text-zinc-700",
};

const DOC_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  assignment: ClipboardCheck,
  inventory_act: Package,
  cash_act: Banknote,
  cash_receipt: Handshake,
  cash_handover: Landmark,
  goods_transfer: Building2,
  explanation: MessageSquareWarning,
  protocol: Gavel,
};

const DOC_HINT_KEYS: Record<string, string> = {
  assignment: "reviziya.hint.assignment",
  inventory_act: "reviziya.hint.inventory_act",
  cash_act: "reviziya.hint.cash_act",
  cash_receipt: "reviziya.hint.cash_receipt",
  cash_handover: "reviziya.hint.cash_handover",
  goods_transfer: "reviziya.hint.goods_transfer",
  explanation: "reviziya.hint.explanation",
  protocol: "reviziya.hint.protocol",
};

function money(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(Math.round(n || 0));
}

export default function ReviziyaPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const allowed = canViewReviziya(user?.role);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("dash");
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const dash = useReviziyaDashboard();
  const meta = useReviziyaMeta();
  const docs = useReviziyaDocs({ q, type: type || undefined });
  const branches = useReviziyaBranches();
  const transit = useReviziyaTransit();
  const mut = useReviziyaMutations();

  const [form, setForm] = useState({
    docType: "assignment",
    branchName: "",
    plannedDate: "",
    responsibleName: "",
    assignmentKind: "planned",
    amount: "",
    route: "",
    barcode: "",
    bookQty: "",
    actualQty: "",
    costPrice: "",
    salePrice: "",
    reasonCode: "count_error",
    note: "",
    systemCash: "",
    actualCash: "",
    handedBy: "",
    receivedBy: "",
  });

  const dicts = meta.data?.dicts || [];
  const reasons = dicts.filter((d: { kind: string }) => d.kind === "shortage_reason");
  const d = dash.data;
  const openTransit = (transit.data || []).filter((t: { status: string }) => t.status === "open");
  const overdueTransit = openTransit.filter((t: { overdue?: boolean }) => t.overdue);

  if (!allowed) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-8">
        <div className="max-w-sm rounded-2xl border bg-card p-8 text-center shadow-sm">
          <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-semibold text-foreground">{t("reviziya.noAccess")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("reviziya.noAccessHint")}</p>
        </div>
      </div>
    );
  }

  const createDoc = async () => {
    const payload: Record<string, unknown> = {
      assignmentKind: form.assignmentKind,
      amount: Number(form.amount) || 0,
      route: form.route,
      handedBy: form.handedBy,
      receivedBy: form.receivedBy,
      systemCash: Number(form.systemCash) || 0,
      actualCash: Number(form.actualCash) || 0,
      cashDiff: (Number(form.actualCash) || 0) - (Number(form.systemCash) || 0),
      note: form.note,
    };
    const lines =
      form.docType === "inventory_act" || form.docType === "goods_transfer"
        ? [
            {
              barcode: form.barcode,
              bookQty: Number(form.bookQty) || 0,
              actualQty: Number(form.actualQty) || 0,
              costPrice: Number(form.costPrice) || 0,
              salePrice: Number(form.salePrice) || 0,
              reasonCode: form.reasonCode,
              note: form.note,
            },
          ]
        : [];
    const body = {
      docType: form.docType,
      branchName: form.branchName,
      plannedDate: form.plannedDate,
      responsibleName: form.responsibleName,
      payload,
      lines,
    };
    try {
      if (!navigator.onLine) {
        enqueueOffline(body);
        toast({ title: t("reviziya.offlineQueued") });
        return;
      }
      const created: { docNo?: string; id?: number } = await mut.create.mutateAsync(body);
      toast({ title: t("reviziya.docCreated"), description: created.docNo });
      if (created.id) setLocation(`/reviziya/hujjat/${created.id}`);
    } catch (e: unknown) {
      toast({ title: e instanceof Error ? e.message : t("ui.error"), variant: "destructive" });
    }
  };

  const invDiff = (Number(form.actualQty) || 0) - (Number(form.bookQty) || 0);
  const cashDiff = (Number(form.actualCash) || 0) - (Number(form.systemCash) || 0);

  return (
    <div className="dept-page">
      <div className="dept-hero dept-hero-violet">
        <div className="dept-hero-glow" />
        <div className="dept-hero-glow2" />
        <div className="dept-hero-body">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="dept-eyebrow">{t("reviziya.eyebrow")}</p>
              <h1 className="dept-title">{t("reviziya.title")}</h1>
              <p className="dept-desc">
                {t("reviziya.desc")}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex flex-wrap items-center justify-end gap-2">
                {canAddDeptStaff(user?.role) && user?.role === "reviziya_rahbar" ? (
                  <AddDeptStaffButton enabled className="h-9 bg-white text-slate-900 hover:bg-white/90" />
                ) : null}
                <span className="dept-badge">
                {isReviziyaRole(user?.role)
                  ? user?.role === "reviziya_rahbar"
                    ? t("reviziya.role.head")
                    : t("reviziya.role.revizor")
                  : userRoleLabel(user?.role)}
              </span>
              </div>
              <div className="flex gap-2 text-[11px] text-white/70">
                <span className="rounded-md bg-black/25 px-2 py-1 backdrop-blur-sm">{t("reviziya.badge.delete")}</span>
                <span className="rounded-md bg-black/25 px-2 py-1 backdrop-blur-sm">{t("reviziya.badge.storno")}</span>
              </div>
            </div>
          </div>

          <div className="dept-tabs">
            {TABS.map((tabItem) => (
              <button
                key={tabItem.id}
                type="button"
                onClick={() => setTab(tabItem.id)}
                className={cn("dept-tab", tab === tabItem.id ? "dept-tab--active" : "dept-tab--idle")}
              >
                <tabItem.icon className="h-3.5 w-3.5" />
                {t(tabItem.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="dept-page-inner">
        {tab === "dash" && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <MetricCard
                label={t("reviziya.metric.closedToday")}
                value={dash.isLoading ? null : d?.daily?.closedCount ?? 0}
                hint={t("reviziya.metric.inspections")}
                icon={CheckCircle2}
                tone="emerald"
              />
              <MetricCard
                label={t("reviziya.metric.collected")}
                value={dash.isLoading ? null : money(d?.daily?.collected || 0)}
                hint={t("reviziya.metric.som")}
                icon={Banknote}
                tone="sky"
              />
              <MetricCard
                label={t("reviziya.metric.inTransit")}
                value={dash.isLoading ? null : money(d?.inTransit?.amount || 0)}
                hint={d?.inTransit?.overdue ? `${d.inTransit.overdue} ${t("reviziya.metric.overdue")}` : t("reviziya.metric.onBalance")}
                icon={Truck}
                tone={d?.inTransit?.overdue ? "amber" : "violet"}
                warn={!!d?.inTransit?.overdue}
                onClick={() => setTab("cash")}
              />
              <MetricCard
                label={t("reviziya.metric.watch")}
                value={dash.isLoading ? null : d?.watchlist?.length ?? 0}
                hint={t("reviziya.metric.watchHint")}
                icon={AlertTriangle}
                tone="rose"
              />
              <MetricCard
                label={t("reviziya.metric.expiry")}
                value={dash.isLoading ? null : `${d?.expiry?.d90 ?? 0} / ${d?.expiry?.d60 ?? 0} / ${d?.expiry?.d30 ?? 0}`}
                hint={t("reviziya.metric.expiryHint")}
                icon={CalendarDays}
                tone="indigo"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <MiniStat icon={Clock} title={t("reviziya.mini.inspecting")} value={d?.daily?.inspecting ?? 0} />
              <MiniStat icon={FileText} title={t("reviziya.mini.weekly")} value={d?.weekly?.docs ?? 0} />
              <MiniStat icon={Ban} title={t("reviziya.mini.missed")} value={d?.missedPlan ?? 0} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel
                title={t("reviziya.panel.ranking")}
                subtitle={t("reviziya.panel.rankingSub")}
                icon={Trophy}
              >
                {dash.isLoading ? (
                  <Skeleton className="h-32" />
                ) : (d?.monthly?.ranking || []).length ? (
                  <div className="space-y-2">
                    {(d.monthly.ranking as Array<{ branch: string; shortage: number; count: number }>).slice(0, 8).map((r, i) => {
                      const max = Math.max(...d.monthly.ranking.map((x: { shortage: number }) => x.shortage), 1);
                      return (
                        <div key={r.branch}>
                          <div className="mb-0.5 flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2">
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-800 dark:bg-violet-500/20 dark:text-violet-300">
                                {i + 1}
                              </span>
                              {r.branch}
                            </span>
                            <span className="tabular-nums font-semibold text-foreground">{money(r.shortage)}</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted dark:bg-slate-800">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500"
                              style={{ width: `${Math.min(100, (r.shortage / max) * 100)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <Empty hint={t("reviziya.panel.rankingEmpty")} />
                )}
              </Panel>
              <Panel title={t("reviziya.panel.load")} subtitle={t("reviziya.panel.loadSub")} icon={Users}>
                {dash.isLoading ? (
                  <Skeleton className="h-32" />
                ) : (d?.revizorLoad || []).length ? (
                  <div className="space-y-3">
                    {(d.revizorLoad as Array<{ id: number; name: string; count: number }>).map((r) => (
                      <div key={r.id} className="flex items-center justify-between rounded-xl bg-muted px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-foreground dark:text-white">
                            {r.name.slice(0, 1)}
                          </span>
                          <span className="text-sm font-medium">{r.name}</span>
                        </div>
                        <span className="rounded-full bg-card px-2.5 py-0.5 text-xs font-semibold shadow-sm">{r.count} ta</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty hint={t("reviziya.panel.loadEmpty")} />
                )}
              </Panel>
            </div>

            <Panel title={t("reviziya.panel.watch")} subtitle={t("reviziya.panel.watchSub")} icon={AlertTriangle}>
              {(d?.watchlist || []).length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {(d.watchlist as Array<{ id: number; branchName: string; reason: string }>).map((w) => (
                    <div key={w.id} className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/80 p-3">
                      <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
                      <div>
                        <p className="text-sm font-semibold text-amber-950">{w.branchName}</p>
                        <p className="text-xs text-amber-800">{w.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty hint={t("reviziya.panel.watchEmpty")} />
              )}
            </Panel>

            <div className="rounded-2xl border border-violet-100 bg-gradient-to-r from-violet-50 to-slate-50 p-4">
              <p className="text-sm font-semibold text-foreground">{t("reviziya.flowTitle")}</p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                {[t("reviziya.status.planned"), t("reviziya.status.en_route"), t("reviziya.status.inspecting"), t("reviziya.status.reconciling"), t("reviziya.status.signed"), t("reviziya.flow.accounting"), t("reviziya.status.closed")].map((s, i) => (
                  <React.Fragment key={s}>
                    {i > 0 ? <ArrowRight className="h-3 w-3 text-muted-foreground" /> : null}
                    <span className="rounded-full bg-card px-2.5 py-1 font-medium text-foreground shadow-sm">{s}</span>
                  </React.Fragment>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{t("reviziya.flowShortage")}</p>
            </div>
          </div>
        )}

        {tab === "docs" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 rounded-2xl border bg-card p-3 shadow-sm">
              <div className="relative min-w-[200px] flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="border-border pl-9" placeholder={t("reviziya.searchDocs")} value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <select
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                <option value="">{t("reviziya.allTypes")}</option>
                {(meta.data?.docTypes || []).map((dt: { value: string; label: string }) => (
                  <option key={dt.value} value={dt.value}>
                    {dt.label}
                  </option>
                ))}
              </select>
              <Button onClick={() => setTab("new")}>
                <Plus className="h-4 w-4" /> {t("reviziya.new")}
              </Button>
            </div>
            <div className="grid gap-3">
              {(docs.data || []).map((row) => {
                const Icon = DOC_ICONS[row.docType] || FileText;
                return (
                  <Link key={row.id} href={`/reviziya/hujjat/${row.id}`}>
                    <div className="group flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
                          <Icon className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground">{row.docNo}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {meta.data?.docTypes?.find((dt: { value: string }) => dt.value === row.docType)?.label || row.docType}
                            {" · "}
                            {row.branchName || t("reviziya.noBranch")}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {row.shortageAmount > 0 ? (
                          <span className="hidden text-xs font-medium text-rose-600 sm:block">{money(row.shortageAmount)}</span>
                        ) : null}
                        <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", STATUS_TONE[row.status] || "bg-slate-100")}>
                          {t(STATUS_KEYS[row.status] || row.status)}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
              {!docs.data?.length ? (
                <Empty hint={t("reviziya.docsEmpty")} />
              ) : null}
            </div>
          </div>
        )}

        {tab === "new" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("reviziya.pickType")}</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(meta.data?.docTypes || []).map((dt: { value: string; label: string }) => {
                const Icon = DOC_ICONS[dt.value] || FileText;
                const active = form.docType === dt.value;
                return (
                  <button
                    key={dt.value}
                    type="button"
                    onClick={() => setForm({ ...form, docType: dt.value })}
                    className={cn(
                      "rounded-2xl border p-3 text-left transition",
                      active
                        ? "border-violet-500 bg-violet-50 shadow-md ring-1 ring-violet-200"
                        : "border-border bg-card hover:border-violet-200 hover:shadow-sm",
                    )}
                  >
                    <Icon className={cn("h-5 w-5", active ? "text-violet-700" : "text-muted-foreground")} />
                    <p className="mt-2 text-[13px] font-semibold leading-snug text-foreground">{dt.label}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{t(DOC_HINT_KEYS[dt.value] || "")}</p>
                  </button>
                );
              })}
            </div>

            <div className="rounded-2xl border bg-card p-5 shadow-sm">
              <p className="mb-4 text-sm font-semibold text-foreground">{t("reviziya.mainFields")}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("reviziya.field.branch")}>
                  <select
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    value={form.branchName}
                    onChange={(e) => setForm({ ...form, branchName: e.target.value })}
                  >
                    <option value="">{t("reviziya.pick")}</option>
                    {(branches.data || []).map((b) => (
                      <option key={b.id} value={b.branchName}>
                        {b.branchName}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("reviziya.field.date")}>
                  <Input type="date" value={form.plannedDate} onChange={(e) => setForm({ ...form, plannedDate: e.target.value })} />
                </Field>
                <Field label={t("reviziya.field.responsible")}>
                  <Input value={form.responsibleName} onChange={(e) => setForm({ ...form, responsibleName: e.target.value })} placeholder={t("reviziya.ph.manager")} />
                </Field>
                {form.docType === "assignment" && (
                  <Field label={t("reviziya.field.planKind")}>
                    <select
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                      value={form.assignmentKind}
                      onChange={(e) => setForm({ ...form, assignmentKind: e.target.value })}
                    >
                      <option value="planned">{t("reviziya.plan.planned")}</option>
                      <option value="unplanned">{t("reviziya.plan.unplanned")}</option>
                    </select>
                  </Field>
                )}
                {(form.docType === "inventory_act" || form.docType === "goods_transfer") && (
                  <>
                    <Field label={t("reviziya.field.barcode")}>
                      <Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
                    </Field>
                    <Field label={t("reviziya.field.bookQty")}>
                      <Input value={form.bookQty} onChange={(e) => setForm({ ...form, bookQty: e.target.value })} />
                    </Field>
                    <Field label={t("reviziya.field.actualQty")}>
                      <Input value={form.actualQty} onChange={(e) => setForm({ ...form, actualQty: e.target.value })} />
                    </Field>
                    <Field label={t("reviziya.field.cost")}>
                      <Input value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} />
                    </Field>
                    <Field label={t("reviziya.field.sale")}>
                      <Input value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} />
                    </Field>
                    <Field label={t("reviziya.field.reason")}>
                      <select
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        value={form.reasonCode}
                        onChange={(e) => setForm({ ...form, reasonCode: e.target.value })}
                      >
                        {reasons.map((r: { code: string; label: string }) => (
                          <option key={r.code} value={r.code}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className="rounded-xl bg-muted p-3 text-sm sm:col-span-2">
                      {t("reviziya.diff")} <b>{invDiff}</b> {t("reviziya.diffPcs")}{" "}
                      <b>{money(invDiff * (Number(form.salePrice) || 0))}</b> {t("reviziya.diffCost")}{" "}
                      <b>{money(invDiff * (Number(form.costPrice) || 0))}</b>
                    </div>
                  </>
                )}
                {form.docType === "cash_act" && (
                  <>
                    <Field label={t("reviziya.field.systemCash")}>
                      <Input value={form.systemCash} onChange={(e) => setForm({ ...form, systemCash: e.target.value })} />
                    </Field>
                    <Field label={t("reviziya.field.actualCash")}>
                      <Input value={form.actualCash} onChange={(e) => setForm({ ...form, actualCash: e.target.value })} />
                    </Field>
                    <div className="rounded-xl bg-muted p-3 text-sm sm:col-span-2">
                      {t("reviziya.cashDiff")} <b className={cashDiff < 0 ? "text-rose-600" : "text-emerald-700"}>{money(cashDiff)}</b> {t("reviziya.metric.som")}
                    </div>
                  </>
                )}
                {(form.docType === "cash_receipt" || form.docType === "cash_handover") && (
                  <>
                    <Field label={t("reviziya.field.amount")}>
                      <Input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                    </Field>
                    <Field label={t("reviziya.field.route")}>
                      <Input value={form.route} onChange={(e) => setForm({ ...form, route: e.target.value })} />
                    </Field>
                    <Field label={t("reviziya.field.handed")}>
                      <Input value={form.handedBy} onChange={(e) => setForm({ ...form, handedBy: e.target.value })} />
                    </Field>
                    <Field label={t("reviziya.field.received")}>
                      <Input value={form.receivedBy} onChange={(e) => setForm({ ...form, receivedBy: e.target.value })} />
                    </Field>
                    {form.docType === "cash_receipt" ? (
                      <p className="text-xs text-amber-800 sm:col-span-2">
                        {t("reviziya.cashReceiptHint")}
                      </p>
                    ) : null}
                  </>
                )}
                <Field label={t("reviziya.field.note")} className="sm:col-span-2">
                  <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                </Field>
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">{t("reviziya.saveHint")}</p>
                <Button onClick={createDoc} disabled={mut.create.isPending} className="bg-violet-700 hover:bg-violet-800">
                  <Plus className="h-4 w-4" />
                  {t("reviziya.saveDoc")}
                </Button>
              </div>
            </div>
          </div>
        )}

        {tab === "cash" && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard label={t("reviziya.cash.open")} value={openTransit.length} hint={t("reviziya.cash.openHint")} icon={CircleDot} tone="violet" />
              <MetricCard label={t("reviziya.cash.total")} value={money(openTransit.reduce((s: number, t: { amount?: number }) => s + Number(t.amount || 0), 0))} hint={t("reviziya.metric.som")} icon={Banknote} tone="sky" />
              <MetricCard label={t("reviziya.cash.over4")} value={overdueTransit.length} hint={t("reviziya.cash.over4Hint")} icon={Clock} tone="amber" warn={overdueTransit.length > 0} />
            </div>
            <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              <div className="flex items-center gap-3 border-b bg-gradient-to-r from-violet-50 to-white px-5 py-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-foreground dark:text-white">
                  <Truck className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-semibold text-foreground">{t("reviziya.cash.title")}</p>
                  <p className="text-xs text-muted-foreground">{t("reviziya.cash.sub")}</p>
                </div>
              </div>
              {(transit.data || []).length ? (
                <div className="divide-y">
                  {(transit.data as Array<{
                    id: number;
                    amount: number;
                    branchName?: string;
                    hoursOpen: number;
                    status: string;
                    overdue?: boolean;
                    routeNote?: string;
                  }>).map((tr) => (
                    <div key={tr.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                      <div>
                        <p className="text-lg font-semibold tabular-nums text-foreground">{money(tr.amount)} <span className="text-sm font-normal text-muted-foreground">{t("reviziya.metric.som")}</span></p>
                        <p className="text-xs text-muted-foreground">
                          {tr.branchName || t("ui.branch")} · {tr.hoursOpen} {t("reviziya.cash.hours")} · {tr.routeNote || t("reviziya.cash.route")}
                        </p>
                        <div className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={cn("h-full rounded-full", tr.overdue ? "bg-amber-500" : "bg-violet-500")}
                            style={{ width: `${Math.min(100, (tr.hoursOpen / 4) * 100)}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">{t("reviziya.cash.limit")}</p>
                      </div>
                      {tr.status === "open" ? (
                        <Button size="sm" className="bg-violet-700" onClick={() => mut.handover.mutate(tr.id)}>
                          {t("reviziya.cash.handover")}
                        </Button>
                      ) : (
                        <Badge className="bg-emerald-100 text-emerald-800">{t("reviziya.cash.atCenter")}</Badge>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-5 py-14 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-50">
                    <Truck className="h-8 w-8 text-violet-400" />
                  </div>
                  <p className="mt-4 font-semibold text-foreground">{t("reviziya.cash.emptyTitle")}</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                    {t("reviziya.cash.emptyHint")}
                  </p>
                  <Button className="mt-4" variant="secondary" onClick={() => { setForm((f) => ({ ...f, docType: "cash_receipt" })); setTab("new"); }}>
                    {t("reviziya.cash.openReceipt")}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "dict" && (
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { kind: "shortage_reason", title: t("reviziya.dict.shortage"), desc: t("reviziya.dict.shortageDesc") },
              { kind: "violation", title: t("reviziya.dict.violation"), desc: t("reviziya.dict.violationDesc") },
              { kind: "product_category", title: t("reviziya.dict.category"), desc: t("reviziya.dict.categoryDesc") },
            ].map((block) => (
              <Panel key={block.kind} title={block.title} subtitle={block.desc} icon={BookOpen}>
                <div className="space-y-1.5">
                  {dicts
                    .filter((x: { kind: string }) => x.kind === block.kind)
                    .map((x: { id: number; code: string; label: string }) => (
                      <div key={x.id} className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
                        <span>{x.label}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">{x.code}</span>
                      </div>
                    ))}
                </div>
              </Panel>
            ))}
          </div>
        )}

        {tab === "mobile" && (
          <MobileTools
            onScan={(code) => {
              setForm((f) => ({ ...f, barcode: code, docType: "inventory_act" }));
              setTab("new");
            }}
            onGps={() => {
              if (!navigator.geolocation) {
                toast({ title: t("reviziya.gpsMissing"), variant: "destructive" });
                return;
              }
              navigator.geolocation.getCurrentPosition(
                (p) => toast({ title: t("reviziya.gpsOk"), description: `${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}` }),
                () => toast({ title: t("reviziya.gpsFail"), variant: "destructive" }),
              );
            }}
            onFlush={async () => {
              try {
                const n = await flushOffline();
                toast({ title: `${n} ${t("reviziya.offlineSynced")}` });
              } catch (e: unknown) {
                toast({ title: e instanceof Error ? e.message : t("ui.error"), variant: "destructive" });
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  warn,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "emerald" | "sky" | "violet" | "rose" | "indigo" | "amber";
  warn?: boolean;
  onClick?: () => void;
}) {
  const iconTone: Record<typeof tone, string> = {
    emerald: "dept-icon-emerald",
    sky: "dept-icon-sky",
    violet: "dept-icon-violet",
    rose: "dept-icon-rose",
    indigo: "dept-icon-indigo",
    amber: "dept-icon-amber",
  };
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn("dept-kpi", warn && "dept-kpi--warn", onClick && "cursor-pointer")}
    >
      <span className={iconTone[tone]}>
        <Icon className="h-4 w-4" />
      </span>
      <p className="dept-kpi-label">{label}</p>
      {value == null ? <Skeleton className="mt-1 h-7 w-16" /> : <p className="dept-kpi-value">{value}</p>}
      {hint ? <p className="dept-kpi-hint">{hint}</p> : null}
    </Tag>
  );
}

function MiniStat({ icon: Icon, title, value }: { icon: React.ComponentType<{ className?: string }>; title: string; value: number }) {
  return (
    <div className="dept-mini">
      <span className="dept-icon-slate">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <p className="text-xs text-muted-foreground">{title}</p>
        <p className="text-lg font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  icon: Icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="dept-panel">
      <div className="mb-4 flex items-start gap-3">
        <span className="dept-panel-icon">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <p className="font-semibold text-foreground">{title}</p>
          {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </div>
  );
}

function Empty({ hint }: { hint: string }) {
  return <p className="dept-empty">{hint}</p>;
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="mb-1 block text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function MobileTools({
  onScan,
  onGps,
  onFlush,
}: {
  onScan: (code: string) => void;
  onGps: () => void;
  onFlush: () => void;
}) {
  const { t } = useI18n();
  const [manual, setManual] = useState("");
  const offline = useMemo(() => peekOfflineCount(), []);
  const tiles = [
    { id: "barcode", title: t("reviziya.mobile.barcode"), desc: t("reviziya.mobile.barcodeDesc"), icon: ScanLine },
    { id: "gps", title: t("reviziya.mobile.gps"), desc: t("reviziya.mobile.gpsDesc"), icon: MapPin },
    { id: "photo", title: t("reviziya.mobile.photo"), desc: t("reviziya.mobile.photoDesc"), icon: Camera },
    { id: "offline", title: t("reviziya.mobile.offline"), desc: t("reviziya.mobile.offlineDesc").replace("{n}", String(offline)), icon: WifiOff },
    { id: "integ", title: t("reviziya.mobile.integ"), desc: t("reviziya.mobile.integDesc"), icon: Shield },
    { id: "otp", title: t("reviziya.mobile.otp"), desc: t("reviziya.mobile.otpDesc"), icon: ScrollText },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((tile) => (
        <div key={tile.id} className="dept-panel">
          <span className="dept-panel-icon">
            <tile.icon className="h-5 w-5" />
          </span>
          <p className="mt-3 font-semibold">{tile.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{tile.desc}</p>
          {tile.id === "barcode" ? (
            <div className="mt-3 flex gap-2">
              <Input placeholder={t("reviziya.mobile.code")} value={manual} onChange={(e) => setManual(e.target.value)} />
              <Button variant="secondary" onClick={() => manual && onScan(manual)}>OK</Button>
            </div>
          ) : null}
          {tile.id === "gps" ? (
            <Button className="mt-3" variant="secondary" onClick={onGps}>{t("reviziya.mobile.arrived")}</Button>
          ) : null}
          {tile.id === "photo" ? (
            <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <Camera className="h-4 w-4" /> {t("reviziya.mobile.upload")}
              <input type="file" accept="image/*" capture="environment" className="hidden" />
            </label>
          ) : null}
          {tile.id === "offline" ? (
            <Button className="mt-3" variant="secondary" onClick={onFlush}>{t("reviziya.mobile.sync")}</Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
