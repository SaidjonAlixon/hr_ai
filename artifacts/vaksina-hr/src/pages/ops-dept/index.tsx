import React, { useState } from "react";
import { Plus, Wrench, Cpu, AlertTriangle, CircleDot, CheckCircle2, Clock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useReviziyaBranches } from "@/lib/reviziya-api";
import { useOpsDash, useOpsMeta, useOpsMutations, useOpsTickets } from "@/lib/ops-dept-api";
import { isItRole, isTexnikRole, canAddDeptStaff } from "@/lib/roles";
import { AddDeptStaffButton } from "@/components/dept/AddDeptStaffDialog";

const STATUS_UZ: Record<string, string> = {
  new: "Yangi",
  assigned: "Biriktirilgan",
  in_progress: "Bajarilmoqda",
  waiting_parts: "Ehtiyot qism",
  done: "Bajarildi",
  closed: "Yopilgan",
};

const PRIO: Record<string, string> = {
  low: "Past",
  normal: "Oddiy",
  high: "Yuqori",
  urgent: "Shoshilinch",
};

export default function OpsDeptPage({ dept }: { dept: "it" | "texnik" }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed =
    user?.role === "admin" ||
    user?.role === "mudir" ||
    user?.role === "koordinator" ||
    (dept === "it" ? isItRole(user?.role) : isTexnikRole(user?.role));

  const meta = useOpsMeta(dept);
  const dash = useOpsDash(dept);
  const tickets = useOpsTickets(dept);
  const mut = useOpsMutations(dept);
  const branches = useReviziyaBranches();
  const [tab, setTab] = useState<"board" | "new">("board");
  const [form, setForm] = useState({
    title: "",
    category: "",
    branchName: "",
    priority: "normal",
    description: "",
    assigneeId: "",
  });

  const isIt = dept === "it";
  const title = isIt ? "IT bo‘limi" : "Texnik bo‘limi";
  const hint = isIt
    ? "Kirish huquqi, POS, tarmoq, kamera, 1C va zaxira. Rahbar: IT rahbari."
    : "Filial jihozlari: sovitgich, elektr, konditsioner, santexnika. Rahbar: Texnik rahbari.";
  const canAddStaff = canAddDeptStaff(user?.role) && (isIt ? user?.role === "it_rahbar" : user?.role === "texnik_rahbar");

  if (!allowed) {
    return <div className="p-8 text-center text-muted-foreground">Bu bo‘lim uchun ruxsat yo‘q.</div>;
  }

  const submit = async () => {
    try {
      await mut.create.mutateAsync({
        title: form.title,
        category: form.category || meta.data?.categories?.[0]?.value,
        branchName: form.branchName,
        priority: form.priority,
        description: form.description,
        assigneeId: form.assigneeId ? Number(form.assigneeId) : undefined,
      });
      toast({ title: "Ariza yaratildi" });
      setForm({ title: "", category: "", branchName: "", priority: "normal", description: "", assigneeId: "" });
      setTab("board");
    } catch (e: unknown) {
      toast({ title: e instanceof Error ? e.message : "Xatolik", variant: "destructive" });
    }
  };

  const d = dash.data;
  const cats: Array<{ value: string; label: string }> = meta.data?.categories || [];

  return (
    <div className="dept-page">
      <div className={cn("dept-hero", isIt ? "dept-hero-cyan" : "dept-hero-amber")}>
        <div className="dept-hero-glow" />
        <div className="dept-hero-body">
          <p className="dept-eyebrow">{isIt ? "Infratuzilma · dastur" : "Servis · ta’mir"}</p>
          <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="dept-title flex items-center gap-2">
                {isIt ? <Cpu className="h-6 w-6" /> : <Wrench className="h-6 w-6" />}
                {title}
              </h1>
              <p className="dept-desc">{hint}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <AddDeptStaffButton enabled={canAddStaff} size="sm" className="h-9" />
              <button
                type="button"
                onClick={() => setTab("board")}
                className={cn("dept-tab", tab === "board" ? "dept-tab--active" : "dept-tab--idle")}
              >
                Ishlar
              </button>
              <button
                type="button"
                onClick={() => setTab("new")}
                className={cn("dept-tab", tab === "new" ? "dept-tab--active" : "dept-tab--idle")}
              >
                Yangi ariza
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="dept-page-inner">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi icon={CircleDot} label="Ochiq" value={d?.open ?? "—"} />
          <Kpi icon={AlertTriangle} label="Shoshilinch" value={d?.urgent ?? "—"} warn={!!d?.urgent} />
          <Kpi icon={Clock} label="Jami" value={d?.total ?? "—"} />
          <Kpi icon={CheckCircle2} label="Yopilgan" value={d?.byStatus?.closed ?? 0} />
        </div>

        {tab === "new" ? (
          <div className="dept-form">
            <p className="mb-4 font-semibold">Yangi ish / ariza</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label className="text-xs">Sarlavha</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Masalan: POS ishlamayapti" />
              </div>
              <div>
                <Label className="text-xs">Tur</Label>
                <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {cats.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">Filial</Label>
                <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.branchName} onChange={(e) => setForm({ ...form, branchName: e.target.value })}>
                  <option value="">Tanlang</option>
                  {(branches.data || []).map((b) => (
                    <option key={b.id} value={b.branchName}>{b.branchName}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">Muhimlik</Label>
                <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  <option value="low">Past</option>
                  <option value="normal">Oddiy</option>
                  <option value="high">Yuqori</option>
                  <option value="urgent">Shoshilinch</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Ijrochi</Label>
                <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
                  <option value="">Keyinroq</option>
                  {(meta.data?.staff || []).map((s: { id: number; fullName: string }) => (
                    <option key={s.id} value={s.id}>{s.fullName}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Tavsif</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>
            <Button className="mt-4" onClick={submit} disabled={mut.create.isPending || !form.title.trim()}>
              <Plus className="h-4 w-4" /> Yuborish
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {cats.map((c) => (
                <span key={c.value} className="dept-chip">
                  {c.label}
                  {d?.byCat?.[c.value] ? ` · ${d.byCat[c.value]}` : ""}
                </span>
              ))}
            </div>
            {tickets.isLoading ? (
              <Skeleton className="h-32" />
            ) : (
              (tickets.data || []).map((t) => (
                <div key={t.id} className="dept-ticket">
                  <div>
                    <p className="text-xs font-mono text-muted-foreground">{t.ticketNo}</p>
                    <p className="font-semibold text-foreground">{t.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {cats.find((c) => c.value === t.category)?.label || t.category} · {t.branchName || "Filial"} · {PRIO[t.priority]}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="dept-status">{STATUS_UZ[t.status]}</span>
                    {meta.data?.canManage ? (
                      <select
                        className="rounded-lg border border-border bg-background px-2 py-1 text-xs"
                        value={t.status}
                        onChange={(e) => mut.patch.mutate({ id: t.id, status: e.target.value })}
                      >
                        {Object.entries(STATUS_UZ).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                </div>
              ))
            )}
            {!tickets.data?.length && !tickets.isLoading ? (
              <p className="dept-empty">Hali ariza yo‘q. «Yangi ariza»dan boshlang.</p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  warn,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  warn?: boolean;
}) {
  return (
    <div className={cn("dept-kpi", warn && "dept-kpi--warn")}>
      <span className={warn ? "dept-icon-amber" : "dept-icon-slate"}>
        <Icon className="h-4 w-4" />
      </span>
      <p className="dept-kpi-label">{label}</p>
      <p className="dept-kpi-value">{value}</p>
    </div>
  );
}
