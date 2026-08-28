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
import { isItRole, isTexnikRole } from "@/lib/roles";

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
    user?.role === "director" ||
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

  if (!allowed) {
    return <div className="p-8 text-center text-slate-500">Bu bo‘lim uchun ruxsat yo‘q.</div>;
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
    <div className="min-h-full bg-gradient-to-b from-slate-50 to-white">
      <div
        className={cn(
          "relative overflow-hidden px-4 py-6 text-white md:px-6",
          isIt ? "bg-gradient-to-br from-cyan-900 via-teal-800 to-[#0b3a5c]" : "bg-gradient-to-br from-amber-900 via-orange-800 to-[#0b3a5c]",
        )}
      >
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <div className="relative mx-auto max-w-6xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
            {isIt ? "Infratuzilma · dastur" : "Servis · ta’mir"}
          </p>
          <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-semibold">
                {isIt ? <Cpu className="h-6 w-6" /> : <Wrench className="h-6 w-6" />}
                {title}
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-white/80">{hint}</p>
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setTab("board")}
                className={cn("rounded-xl px-3 py-2 text-sm font-medium", tab === "board" ? "bg-white text-slate-900" : "bg-white/15")}
              >
                Ishlar
              </button>
              <button
                type="button"
                onClick={() => setTab("new")}
                className={cn("rounded-xl px-3 py-2 text-sm font-medium", tab === "new" ? "bg-white text-slate-900" : "bg-white/15")}
              >
                Yangi ariza
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-4 px-4 py-5 md:px-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi icon={CircleDot} label="Ochiq" value={d?.open ?? "—"} />
          <Kpi icon={AlertTriangle} label="Shoshilinch" value={d?.urgent ?? "—"} warn={!!d?.urgent} />
          <Kpi icon={Clock} label="Jami" value={d?.total ?? "—"} />
          <Kpi icon={CheckCircle2} label="Yopilgan" value={d?.byStatus?.closed ?? 0} />
        </div>

        {tab === "new" ? (
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="mb-4 font-semibold">Yangi ish / ariza</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label className="text-xs">Sarlavha</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Masalan: POS ishlamayapti" />
              </div>
              <div>
                <Label className="text-xs">Tur</Label>
                <select className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {cats.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">Filial</Label>
                <select className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={form.branchName} onChange={(e) => setForm({ ...form, branchName: e.target.value })}>
                  <option value="">Tanlang</option>
                  {(branches.data || []).map((b) => (
                    <option key={b.id} value={b.branchName}>{b.branchName}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">Muhimlik</Label>
                <select className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  <option value="low">Past</option>
                  <option value="normal">Oddiy</option>
                  <option value="high">Yuqori</option>
                  <option value="urgent">Shoshilinch</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Ijrochi</Label>
                <select className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
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
                <span key={c.value} className="rounded-full border bg-white px-3 py-1 text-xs text-slate-600 shadow-sm">
                  {c.label}
                  {d?.byCat?.[c.value] ? ` · ${d.byCat[c.value]}` : ""}
                </span>
              ))}
            </div>
            {tickets.isLoading ? (
              <Skeleton className="h-32" />
            ) : (
              (tickets.data || []).map((t) => (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-4 shadow-sm">
                  <div>
                    <p className="text-xs font-mono text-slate-400">{t.ticketNo}</p>
                    <p className="font-semibold text-slate-900">{t.title}</p>
                    <p className="text-xs text-slate-500">
                      {cats.find((c) => c.value === t.category)?.label || t.category} · {t.branchName || "Filial"} · {PRIO[t.priority]}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold">{STATUS_UZ[t.status]}</span>
                    {meta.data?.canManage ? (
                      <select
                        className="rounded-lg border px-2 py-1 text-xs"
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
              <p className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-500">Hali ariza yo‘q. «Yangi ariza»dan boshlang.</p>
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
    <div className={cn("rounded-2xl border bg-white p-4 shadow-sm", warn && "border-amber-300")}>
      <Icon className="h-4 w-4 text-slate-400" />
      <p className="mt-2 text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
