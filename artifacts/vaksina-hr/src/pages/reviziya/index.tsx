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
import { canViewReviziya, isReviziyaRole, userRoleLabel } from "@/lib/roles";
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

const TABS = [
  { id: "dash", label: "Boshqaruv", icon: LayoutDashboard },
  { id: "docs", label: "Hujjatlar", icon: FileStack },
  { id: "new", label: "Yangi forma", icon: Plus },
  { id: "cash", label: "Yo‘ldagi pul", icon: Truck },
  { id: "dict", label: "Spravochnik", icon: BookOpen },
  { id: "mobile", label: "Mobil", icon: Smartphone },
] as const;

const STATUS_UZ: Record<string, string> = {
  planned: "Rejalashtirilgan",
  en_route: "Yo‘lda",
  inspecting: "Tekshiruvda",
  reconciling: "Solishtirish",
  signed: "Imzolangan",
  accounting_approved: "Buxgalteriya tasdig‘i",
  closed: "Yopilgan",
  awaiting_explanation: "Tushuntirish kutilmoqda",
  sb_review: "SB tekshiruvi",
  recovery: "Undirish",
  storno: "Storno",
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

const DOC_HINT: Record<string, string> = {
  assignment: "Rejali yoki navbatdan tashqari topshiriq",
  inventory_act: "Tovar: shtrix, hisob vs haqiqiy, farq",
  cash_act: "Smena tushumi, kupyuralar, farq",
  cash_receipt: "Filialdan revizor balansiga",
  cash_handover: "Markaziy kassa / bankka",
  goods_transfer: "Muddati o‘tgan va brak",
  explanation: "Filial mas’ulidan tushuntirish",
  protocol: "Yakuniy bayonnoma",
};

function money(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(Math.round(n || 0));
}

export default function ReviziyaPage() {
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
          <p className="mt-3 font-semibold text-foreground">Kirish cheklangan</p>
          <p className="mt-1 text-sm text-muted-foreground">Reviziya bo‘limi faqat tegishli rollar uchun.</p>
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
        toast({ title: "Offline navbatga qo‘yildi" });
        return;
      }
      const created: { docNo?: string; id?: number } = await mut.create.mutateAsync(body);
      toast({ title: "Hujjat yaratildi", description: created.docNo });
      if (created.id) setLocation(`/reviziya/hujjat/${created.id}`);
    } catch (e: unknown) {
      toast({ title: e instanceof Error ? e.message : "Xatolik", variant: "destructive" });
    }
  };

  const invDiff = (Number(form.actualQty) || 0) - (Number(form.bookQty) || 0);
  const cashDiff = (Number(form.actualCash) || 0) - (Number(form.systemCash) || 0);

  return (
    <div className="min-h-full bg-gradient-to-b from-slate-50 to-white">
      <div className="relative overflow-hidden bg-gradient-to-br from-[#2e1065] via-[#4c1d95] to-[#0b3a5c] px-4 py-6 text-foreground dark:text-white md:px-6 md:py-8">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 left-1/3 h-40 w-40 rounded-full bg-fuchsia-400/20 blur-2xl" />
        <div className="relative mx-auto max-w-6xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-200">Ichki audit · yig‘uv</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-[28px]">Reviziya bo‘limi</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-violet-100/90">
                Filial qoldig‘i, inventarizatsiya, kassa va inkassatsiya. Hujjatlar: rahbar → bosh buxgalter.
                Taqiq: narx, vozvrat, qo‘lda qoldiq, o‘chirish — faqat storno.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium backdrop-blur">
                {isReviziyaRole(user?.role)
                  ? user?.role === "reviziya_rahbar"
                    ? "Bo‘lim rahbari"
                    : "Revizor-yig‘uvchi"
                  : userRoleLabel(user?.role)}
              </span>
              <div className="flex gap-2 text-[11px] text-violet-100">
                <span className="rounded-md bg-black/20 px-2 py-1">O‘chirish ✕</span>
                <span className="rounded-md bg-black/20 px-2 py-1">Storno ✓</span>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-1.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-medium transition",
                  tab === t.id
                    ? "bg-card text-violet-900 shadow-lg shadow-black/10"
                    : "bg-white/10 text-white/85 hover:bg-white/20",
                )}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-5 px-4 py-5 md:px-6 md:py-6">
        {tab === "dash" && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <MetricCard
                label="Bugun yopilgan"
                value={dash.isLoading ? null : d?.daily?.closedCount ?? 0}
                hint="Tekshiruvlar"
                icon={CheckCircle2}
                tone="emerald"
              />
              <MetricCard
                label="Yig‘ilgan (kun)"
                value={dash.isLoading ? null : money(d?.daily?.collected || 0)}
                hint="so‘m"
                icon={Banknote}
                tone="sky"
              />
              <MetricCard
                label="Yo‘ldagi pul"
                value={dash.isLoading ? null : money(d?.inTransit?.amount || 0)}
                hint={d?.inTransit?.overdue ? `${d.inTransit.overdue} ta 4 soatdan oshgan` : "revizor balansida"}
                icon={Truck}
                tone={d?.inTransit?.overdue ? "amber" : "violet"}
                warn={!!d?.inTransit?.overdue}
                onClick={() => setTab("cash")}
              />
              <MetricCard
                label="Nazorat"
                value={dash.isLoading ? null : d?.watchlist?.length ?? 0}
                hint="ketma-ket kamomad"
                icon={AlertTriangle}
                tone="rose"
              />
              <MetricCard
                label="Yaroqlilik 90/60/30"
                value={dash.isLoading ? null : `${d?.expiry?.d90 ?? 0} / ${d?.expiry?.d60 ?? 0} / ${d?.expiry?.d30 ?? 0}`}
                hint="kun qolgan tovar"
                icon={CalendarDays}
                tone="indigo"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <MiniStat icon={Clock} title="Tekshiruvda" value={d?.daily?.inspecting ?? 0} />
              <MiniStat icon={FileText} title="Haftalik hujjat" value={d?.weekly?.docs ?? 0} />
              <MiniStat icon={Ban} title="O‘tkazilmagan reja" value={d?.missedPlan ?? 0} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel
                title="Filiallar reytingi"
                subtitle="Kamomad summasi — oylik"
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
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-800">
                                {i + 1}
                              </span>
                              {r.branch}
                            </span>
                            <span className="tabular-nums font-semibold text-foreground">{money(r.shortage)}</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
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
                  <Empty hint="Hali kamomad statistikasi yo‘q" />
                )}
              </Panel>
              <Panel title="Revizorlar yuklamasi" subtitle="Hujjat soni" icon={Users}>
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
                  <Empty hint="Hali yuklama yo‘q" />
                )}
              </Panel>
            </div>

            <Panel title="Ketma-ket kamomad — alohida nazorat" subtitle="Bir filialda 2 marta ketma-ket" icon={AlertTriangle}>
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
                <Empty hint="Nazorat ro‘yxati hozircha bo‘sh — bu yaxshi belgi." />
              )}
            </Panel>

            <div className="rounded-2xl border border-violet-100 bg-gradient-to-r from-violet-50 to-slate-50 p-4">
              <p className="text-sm font-semibold text-foreground">Status oqimi</p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                {["Rejalashtirilgan", "Yo‘lda", "Tekshiruvda", "Solishtirish", "Imzolangan", "Buxgalteriya", "Yopilgan"].map((s, i) => (
                  <React.Fragment key={s}>
                    {i > 0 ? <ArrowRight className="h-3 w-3 text-muted-foreground" /> : null}
                    <span className="rounded-full bg-card px-2.5 py-1 font-medium text-foreground shadow-sm">{s}</span>
                  </React.Fragment>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Kamomad: Tushuntirish kutilmoqda → SB tekshiruvi → Undirish / hisobdan chiqarish</p>
            </div>
          </div>
        )}

        {tab === "docs" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 rounded-2xl border bg-card p-3 shadow-sm">
              <div className="relative min-w-[200px] flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="border-border pl-9" placeholder="Raqam, filial, mas’ul…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <select
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                <option value="">Barcha turlar</option>
                {(meta.data?.docTypes || []).map((t: { value: string; label: string }) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <Button onClick={() => setTab("new")}>
                <Plus className="h-4 w-4" /> Yangi
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
                            {meta.data?.docTypes?.find((t: { value: string }) => t.value === row.docType)?.label || row.docType}
                            {" · "}
                            {row.branchName || "Filial belgilanmagan"}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {row.shortageAmount > 0 ? (
                          <span className="hidden text-xs font-medium text-rose-600 sm:block">{money(row.shortageAmount)}</span>
                        ) : null}
                        <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", STATUS_TONE[row.status] || "bg-slate-100")}>
                          {STATUS_UZ[row.status] || row.status}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
              {!docs.data?.length ? (
                <Empty hint="Hujjat yo‘q. «Yangi forma»dan birinchi dalolatnomani oching." />
              ) : null}
            </div>
          </div>
        )}

        {tab === "new" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Hujjat turini tanlang — har biri alohida forma.</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(meta.data?.docTypes || []).map((t: { value: string; label: string }) => {
                const Icon = DOC_ICONS[t.value] || FileText;
                const active = form.docType === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setForm({ ...form, docType: t.value })}
                    className={cn(
                      "rounded-2xl border p-3 text-left transition",
                      active
                        ? "border-violet-500 bg-violet-50 shadow-md ring-1 ring-violet-200"
                        : "border-border bg-card hover:border-violet-200 hover:shadow-sm",
                    )}
                  >
                    <Icon className={cn("h-5 w-5", active ? "text-violet-700" : "text-muted-foreground")} />
                    <p className="mt-2 text-[13px] font-semibold leading-snug text-foreground">{t.label}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{DOC_HINT[t.value]}</p>
                  </button>
                );
              })}
            </div>

            <div className="rounded-2xl border bg-card p-5 shadow-sm">
              <p className="mb-4 text-sm font-semibold text-foreground">Asosiy maydonlar</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Filial">
                  <select
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    value={form.branchName}
                    onChange={(e) => setForm({ ...form, branchName: e.target.value })}
                  >
                    <option value="">Tanlang</option>
                    {(branches.data || []).map((b) => (
                      <option key={b.id} value={b.branchName}>
                        {b.branchName}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Sana / vaqt">
                  <Input type="date" value={form.plannedDate} onChange={(e) => setForm({ ...form, plannedDate: e.target.value })} />
                </Field>
                <Field label="Ishtirokchi mas’ul">
                  <Input value={form.responsibleName} onChange={(e) => setForm({ ...form, responsibleName: e.target.value })} placeholder="Filial mudiri" />
                </Field>
                {form.docType === "assignment" && (
                  <Field label="Reja turi">
                    <select
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                      value={form.assignmentKind}
                      onChange={(e) => setForm({ ...form, assignmentKind: e.target.value })}
                    >
                      <option value="planned">Rejali</option>
                      <option value="unplanned">Navbatdan tashqari</option>
                    </select>
                  </Field>
                )}
                {(form.docType === "inventory_act" || form.docType === "goods_transfer") && (
                  <>
                    <Field label="Shtrix-kod">
                      <Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
                    </Field>
                    <Field label="Hisobdagi qoldiq">
                      <Input value={form.bookQty} onChange={(e) => setForm({ ...form, bookQty: e.target.value })} />
                    </Field>
                    <Field label="Haqiqiy qoldiq">
                      <Input value={form.actualQty} onChange={(e) => setForm({ ...form, actualQty: e.target.value })} />
                    </Field>
                    <Field label="Tan narx (faqat o‘qish)">
                      <Input value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} />
                    </Field>
                    <Field label="Sotuv narxi (o‘zgarmaydi)">
                      <Input value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} />
                    </Field>
                    <Field label="Sabab kodi">
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
                      Farq: <b>{invDiff}</b> dona · summa (sotuv):{" "}
                      <b>{money(invDiff * (Number(form.salePrice) || 0))}</b> · tan:{" "}
                      <b>{money(invDiff * (Number(form.costPrice) || 0))}</b>
                    </div>
                  </>
                )}
                {form.docType === "cash_act" && (
                  <>
                    <Field label="Tizim bo‘yicha tushum">
                      <Input value={form.systemCash} onChange={(e) => setForm({ ...form, systemCash: e.target.value })} />
                    </Field>
                    <Field label="Kassadagi naqd">
                      <Input value={form.actualCash} onChange={(e) => setForm({ ...form, actualCash: e.target.value })} />
                    </Field>
                    <div className="rounded-xl bg-muted p-3 text-sm sm:col-span-2">
                      Kassa farqi: <b className={cashDiff < 0 ? "text-rose-600" : "text-emerald-700"}>{money(cashDiff)}</b> so‘m
                    </div>
                  </>
                )}
                {(form.docType === "cash_receipt" || form.docType === "cash_handover") && (
                  <>
                    <Field label="Summa">
                      <Input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                    </Field>
                    <Field label="Marshrut">
                      <Input value={form.route} onChange={(e) => setForm({ ...form, route: e.target.value })} />
                    </Field>
                    <Field label="Kim topshirdi">
                      <Input value={form.handedBy} onChange={(e) => setForm({ ...form, handedBy: e.target.value })} />
                    </Field>
                    <Field label="Kim qabul qildi">
                      <Input value={form.receivedBy} onChange={(e) => setForm({ ...form, receivedBy: e.target.value })} />
                    </Field>
                    {form.docType === "cash_receipt" ? (
                      <p className="text-xs text-amber-800 sm:col-span-2">
                        Bu summa filial kassasidan chiqib, markazga yetmaguncha <b>revizor balansida</b> («yo‘ldagi pul») turadi.
                      </p>
                    ) : null}
                  </>
                )}
                <Field label="Izoh" className="sm:col-span-2">
                  <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                </Field>
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">Yopilgandan keyin tahrir imkonsiz. O‘chirish o‘rniga storno.</p>
                <Button onClick={createDoc} disabled={mut.create.isPending} className="bg-violet-700 hover:bg-violet-800">
                  <Plus className="h-4 w-4" />
                  Hujjatni saqlash
                </Button>
              </div>
            </div>
          </div>
        )}

        {tab === "cash" && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard label="Ochiq" value={openTransit.length} hint="revizor zimmasida" icon={CircleDot} tone="violet" />
              <MetricCard label="Jami yo‘lda" value={money(openTransit.reduce((s: number, t: { amount?: number }) => s + Number(t.amount || 0), 0))} hint="so‘m" icon={Banknote} tone="sky" />
              <MetricCard label="4 soatdan oshgan" value={overdueTransit.length} hint="rahbariyat ogohlantiriladi" icon={Clock} tone="amber" warn={overdueTransit.length > 0} />
            </div>
            <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              <div className="flex items-center gap-3 border-b bg-gradient-to-r from-violet-50 to-white px-5 py-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-foreground dark:text-white">
                  <Truck className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-semibold text-foreground">Yo‘ldagi pul hisobi</p>
                  <p className="text-xs text-muted-foreground">Filial kassasi → revizor → markaziy kassa. Oraliqda mas’uliyat aniq.</p>
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
                  }>).map((t) => (
                    <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                      <div>
                        <p className="text-lg font-semibold tabular-nums text-foreground">{money(t.amount)} <span className="text-sm font-normal text-muted-foreground">so‘m</span></p>
                        <p className="text-xs text-muted-foreground">
                          {t.branchName || "Filial"} · {t.hoursOpen} soat · {t.routeNote || "marshrut"}
                        </p>
                        <div className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={cn("h-full rounded-full", t.overdue ? "bg-amber-500" : "bg-violet-500")}
                            style={{ width: `${Math.min(100, (t.hoursOpen / 4) * 100)}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">4 soatlik limit</p>
                      </div>
                      {t.status === "open" ? (
                        <Button size="sm" className="bg-violet-700" onClick={() => mut.handover.mutate(t.id)}>
                          Markazga topshirildi
                        </Button>
                      ) : (
                        <Badge className="bg-emerald-100 text-emerald-800">Markazda</Badge>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-5 py-14 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-50">
                    <Truck className="h-8 w-8 text-violet-400" />
                  </div>
                  <p className="mt-4 font-semibold text-foreground">Ochiq qoldiq yo‘q</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                    Naqd qabul qilish hujjati yaratilganda pul avtomatik revizor balansiga tushadi. Markazga topshirilguncha shu yerda turadi.
                  </p>
                  <Button className="mt-4" variant="secondary" onClick={() => { setForm((f) => ({ ...f, docType: "cash_receipt" })); setTab("new"); }}>
                    Qabul hujjati ochish
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "dict" && (
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { kind: "shortage_reason", title: "Kamomad sabablari", desc: "Sanoq, sotuv, o‘g‘irlik, brak, muddat, hujjatsiz" },
              { kind: "violation", title: "Buzilish turlari", desc: "Statistika klassifikatori" },
              { kind: "product_category", title: "Tovar kategoriyalari", desc: "Hisobot kesimi" },
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
                toast({ title: "GPS yo‘q", variant: "destructive" });
                return;
              }
              navigator.geolocation.getCurrentPosition(
                (p) => toast({ title: "GPS check-in", description: `${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}` }),
                () => toast({ title: "GPS olinmadi", variant: "destructive" }),
              );
            }}
            onFlush={async () => {
              try {
                const n = await flushOffline();
                toast({ title: `${n} ta offline hujjat sinxronlandi` });
              } catch (e: unknown) {
                toast({ title: e instanceof Error ? e.message : "Xatolik", variant: "destructive" });
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
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700",
    sky: "bg-sky-50 text-sky-700",
    violet: "bg-violet-50 text-violet-700",
    rose: "bg-rose-50 text-rose-700",
    indigo: "bg-indigo-50 text-indigo-700",
    amber: "bg-amber-50 text-amber-700",
  };
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "rounded-2xl border bg-card p-4 text-left shadow-sm",
        warn && "border-amber-300 ring-1 ring-amber-200",
        onClick && "cursor-pointer hover:shadow-md",
      )}
    >
      <span className={cn("inline-flex rounded-xl p-2", tones[tone])}>
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {value == null ? <Skeleton className="mt-1 h-7 w-16" /> : <p className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">{value}</p>}
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </Tag>
  );
}

function MiniStat({ icon: Icon, title, value }: { icon: React.ComponentType<{ className?: string }>; title: string; value: number }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3 shadow-sm">
      <span className="rounded-lg bg-slate-100 p-2 text-muted-foreground">
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
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <span className="rounded-xl bg-violet-50 p-2 text-violet-700">
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
  return <p className="rounded-xl bg-muted px-3 py-6 text-center text-sm text-muted-foreground">{hint}</p>;
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
  const [manual, setManual] = useState("");
  const offline = useMemo(() => peekOfflineCount(), []);
  const tiles = [
    { title: "Shtrix-kod", desc: "Kamera yoki qo‘lda — inventarizatsiyaga", icon: ScanLine },
    { title: "GPS check-in", desc: "Filialga kelganda joylashuv", icon: MapPin },
    { title: "Foto", desc: "Muddat, kassa, javon", icon: Camera },
    { title: "Offline", desc: `Navbat: ${offline} ta — keyin sinxron`, icon: WifiOff },
    { title: "Integratsiya", desc: "1C, ombor, POS, HR, SB — eksport rahbariyatda", icon: Shield },
    { title: "OTP / imzo", desc: "Hujjat sahifasida SMS-OTP", icon: ScrollText },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((t) => (
        <div key={t.title} className="rounded-2xl border bg-card p-4 shadow-sm">
          <span className="inline-flex rounded-xl bg-violet-50 p-2 text-violet-700">
            <t.icon className="h-5 w-5" />
          </span>
          <p className="mt-3 font-semibold">{t.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t.desc}</p>
          {t.title === "Shtrix-kod" ? (
            <div className="mt-3 flex gap-2">
              <Input placeholder="Kod" value={manual} onChange={(e) => setManual(e.target.value)} />
              <Button variant="secondary" onClick={() => manual && onScan(manual)}>OK</Button>
            </div>
          ) : null}
          {t.title === "GPS check-in" ? (
            <Button className="mt-3" variant="secondary" onClick={onGps}>Filialga keldim</Button>
          ) : null}
          {t.title === "Foto" ? (
            <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <Camera className="h-4 w-4" /> Yuklash
              <input type="file" accept="image/*" capture="environment" className="hidden" />
            </label>
          ) : null}
          {t.title === "Offline" ? (
            <Button className="mt-3" variant="secondary" onClick={onFlush}>Sinxronlash</Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
