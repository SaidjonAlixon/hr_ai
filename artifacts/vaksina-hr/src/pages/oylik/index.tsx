import React, { useState } from "react";
import {
  Banknote,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  User,
  CalendarDays,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { currentMonthKey, shiftMonthKey, useOylikMe } from "@/lib/oylik-api";
import { userRoleLabel } from "@/lib/roles";

const STATUS_UZ: Record<string, string> = {
  present: "Kelgan",
  late: "Kech",
  incomplete: "Ketish yo‘q",
  absent: "Kelmagan",
  leave: "Ta'til",
};

function statusBadge(status: string) {
  if (status === "present") return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Kelgan</Badge>;
  if (status === "late") return <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Kech</Badge>;
  if (status === "incomplete") return <Badge className="bg-orange-100 text-orange-900 hover:bg-orange-100">Ketish yo‘q</Badge>;
  if (status === "absent") return <Badge className="bg-rose-100 text-rose-800 hover:bg-rose-100">Kelmagan</Badge>;
  return <Badge variant="secondary">{STATUS_UZ[status] || status}</Badge>;
}

export default function OylikPage() {
  const { user } = useAuth();
  const [month, setMonth] = useState(currentMonthKey());
  const { data, isLoading, error } = useOylikMe(month);

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-10">
      <div className="relative overflow-hidden rounded-2xl bg-[#0b3a5c] px-5 py-6 text-white shadow-lg">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium">
              <Banknote className="h-3.5 w-3.5" />
              Oylik
            </div>
            <h1 className="text-xl font-bold sm:text-2xl">Oylik ma'lumot</h1>
            <p className="mt-1 text-sm text-white/75">
              {user?.fullName} · {userRoleLabel(user?.role) || data?.roleLabel}
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-xl bg-white/10 p-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-white hover:bg-white/15 hover:text-white"
              onClick={() => setMonth((m) => shiftMonthKey(m, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[120px] px-2 text-center text-sm font-semibold">
              {data?.monthLabel ?? month}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-white hover:bg-white/15 hover:text-white"
              onClick={() => setMonth((m) => shiftMonthKey(m, 1))}
              disabled={month >= currentMonthKey()}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-800">
          {(error as Error).message}
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Ish kunlari" value={data.workedDays} tone="sky" />
            <StatCard label="Kechikish" value={data.lateDays} tone="amber" />
            <StatCard label="Ketish yo‘q" value={data.incompleteDays} tone="orange" />
            <StatCard label="Kelmagan" value={data.absentDays} tone="rose" />
          </div>

          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Maosh varaqasi</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{data.note}</p>
              </div>
              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-900">
                HR tasdiqlashi kutilmoqda
              </Badge>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <InfoRow icon={User} label="Lavozim" value={data.position || data.roleLabel} />
              {data.branch ? <InfoRow icon={MapPin} label="Filial" value={data.branch} /> : null}
              <InfoRow icon={Banknote} label="Asosiy maosh" value={data.baseSalary || "—"} />
              <InfoRow icon={Banknote} label="Qo‘shimcha" value={data.bonus || "—"} />
              <InfoRow icon={Banknote} label="Ushlab qolish" value={data.deduction || "—"} />
              <InfoRow
                icon={Banknote}
                label="To‘lanadigan summa"
                value={data.netSalary || "—"}
                strong
              />
            </div>
          </div>

          <div className="rounded-xl border bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <CalendarDays className="h-4 w-4 text-slate-500" />
              <p className="text-sm font-semibold">Davomat ({data.days.length} kun)</p>
            </div>
            <div className="max-h-[min(50vh,360px)] divide-y overflow-y-auto">
              {data.days.length ? (
                data.days.map((d) => (
                  <div key={d.date} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <div>
                      <p className="text-sm font-medium">{formatDateUz(d.date)}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock3 className="h-3 w-3" />
                        {formatTime(d.checkIn)} — {formatTime(d.checkOut)}
                      </p>
                    </div>
                    {statusBadge(d.status)}
                  </div>
                ))
              ) : (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Bu oy uchun davomat yozuvi yo‘q
                </p>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "sky" | "amber" | "orange" | "rose";
}) {
  const bg = {
    sky: "bg-sky-50 border-sky-100 text-sky-900",
    amber: "bg-amber-50 border-amber-100 text-amber-950",
    orange: "bg-orange-50 border-orange-100 text-orange-950",
    rose: "bg-rose-50 border-rose-100 text-rose-900",
  }[tone];
  return (
    <div className={cn("rounded-xl border p-3", bg)}>
      <p className="text-[11px] font-medium opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  strong,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-slate-50 px-3 py-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className={cn("text-sm break-words", strong ? "font-bold text-[#0b3a5c]" : "font-medium")}>
          {value}
        </p>
      </div>
    </div>
  );
}

function formatDateUz(ymd: string) {
  const [y, m, d] = ymd.split("-");
  return y && m && d ? `${d}.${m}.${y}` : ymd;
}

function formatTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
  });
}
