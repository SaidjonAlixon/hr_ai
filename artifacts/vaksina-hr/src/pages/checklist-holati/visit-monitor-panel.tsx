import React, { useMemo, useState } from "react";
import { Clock3, MapPin, User, Filter, Radio, Unlock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  approvePresenceUnlock,
  forceCheckoutVisit,
  useVisitMonitor,
  type CoordinatorVisitSession,
} from "@/lib/branch-audits-api";

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtHm(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-2xl border bg-card px-3 py-3 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn("mt-1 text-xl font-bold tabular-nums", tone)}>{value}</p>
    </div>
  );
}

export function VisitMonitorPanel({ enabled }: { enabled: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [coordinatorId, setCoordinatorId] = useState("all");
  const [branchId, setBranchId] = useState("all");
  const [q, setQ] = useState("");
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [closingId, setClosingId] = useState<number | null>(null);

  const { data, isLoading } = useVisitMonitor(
    { from: from || undefined, to: to || undefined, coordinatorId, branchId },
    enabled,
  );

  const items = data?.items ?? [];
  const summary = data?.summary;

  const unlockRequests = useMemo(
    () => items.filter((v) => v.stillOpen && v.presenceBlocked && v.unlockPending),
    [items],
  );

  const approveUnlock = async (visitId: number) => {
    setApprovingId(visitId);
    try {
      const res = await approvePresenceUnlock(visitId);
      await qc.invalidateQueries({ queryKey: ["branch-audits", "visit-monitor"] });
      toast({
        title: "Ruxsat berildi",
        description: res.message || "Koordinator cheklistni ochishi mumkin",
      });
    } catch (err) {
      toast({
        title: "Xato",
        description: (err as Error)?.message || "Ruxsat berilmadi",
        variant: "destructive",
      });
    } finally {
      setApprovingId(null);
    }
  };

  const forceKetdim = async (v: CoordinatorVisitSession) => {
    const name = v.coordinatorName || "Koordinator";
    const branch = v.branchLabel || `Filial #${v.branchId}`;
    if (
      !window.confirm(
        `${name} — «${branch}» ochiq tashrifini Ketdim bilan yopasizmi?\n\nKeyin boshqa filialda Keldim qila oladi.`,
      )
    ) {
      return;
    }
    setClosingId(v.id);
    try {
      const res = await forceCheckoutVisit(v.id);
      await qc.invalidateQueries({ queryKey: ["branch-audits", "visit-monitor"] });
      toast({
        title: "Ketdim yopildi",
        description: res.message || "Koordinator endi boshqa filialga o‘ta oladi",
      });
    } catch (err) {
      toast({
        title: "Yopilmadi",
        description: (err as Error)?.message || "Qayta urinib ko‘ring",
        variant: "destructive",
      });
    } finally {
      setClosingId(null);
    }
  };

  const coordinators = useMemo(() => {
    const map = new Map<number, string>();
    for (const v of items) {
      if (v.coordinatorUserId) {
        map.set(v.coordinatorUserId, v.coordinatorName || `#${v.coordinatorUserId}`);
      }
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "uz"));
  }, [items]);

  const branches = useMemo(() => {
    const map = new Map<number, string>();
    for (const v of items) {
      map.set(v.branchId, v.branchLabel || `Filial #${v.branchId}`);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "uz"));
  }, [items]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((v) => {
      const hay = `${v.coordinatorName} ${v.branchLabel} ${v.workDate}`.toLowerCase();
      return hay.includes(s);
    });
  }, [items, q]);

  if (!enabled) {
    return (
      <p className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        Monitoring faqat rahbariyat uchun.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-gradient-to-br from-sky-50 via-card to-card p-4 shadow-sm dark:from-sky-950/30">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white">
            <Radio className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Vaqt monitoringi</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Koordinatorlar qaysi filialga kelgani, qancha vaqt qolgani va cheklistni qachon
              yakunlagani — bitta jadvalda.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Jami tashrif" value={String(summary?.total ?? 0)} />
        <Stat
          label="Hali Ketdim yo‘q"
          value={String(summary?.openCount ?? 0)}
          tone={summary?.openCount ? "text-amber-600" : undefined}
        />
        <Stat label="Cheklist bor" value={String(summary?.withChecklist ?? 0)} />
        <Stat label="O‘rtacha qolish" value={summary?.avgStayLabel || "—"} />
      </div>

      <div className="rounded-2xl border bg-card p-3 shadow-sm sm:p-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />
          Filtr
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground">Qidiruv</Label>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ism yoki filial..."
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground">Koordinator</Label>
            <Select value={coordinatorId} onValueChange={setCoordinatorId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Barchasi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha koordinatorlar</SelectItem>
                {coordinators.map(([id, name]) => (
                  <SelectItem key={id} value={String(id)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground">Filial</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Barchasi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha filiallar</SelectItem>
                {branches.map(([id, name]) => (
                  <SelectItem key={id} value={String(id)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground">Dan</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground">Gacha</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
          </div>
        </div>
      </div>

      {unlockRequests.length > 0 ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50/90 p-3 shadow-sm dark:border-amber-700 dark:bg-amber-950/40">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-950 dark:text-amber-100">
            <Unlock className="h-4 w-4" />
            Hudud bloki — ruxsat so‘rovlari ({unlockRequests.length})
          </p>
          <ul className="space-y-2">
            {unlockRequests.map((v) => (
              <li
                key={v.id}
                className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-white/80 px-3 py-2 sm:flex-row sm:items-center sm:justify-between dark:border-amber-800 dark:bg-slate-950/50"
              >
                <div className="min-w-0 text-sm">
                  <p className="font-semibold">
                    {v.coordinatorName || "Koordinator"} · {v.branchLabel || `Filial #${v.branchId}`}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    10 daqiqa ichida hududni tasdiqlamagan — cheklist bloklangan
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="shrink-0"
                  disabled={approvingId === v.id}
                  onClick={() => void approveUnlock(v.id)}
                >
                  {approvingId === v.id ? "…" : "Ruxsat berish"}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Koordinator</th>
                <th className="px-3 py-2.5 font-semibold">Filial</th>
                <th className="px-3 py-2.5 font-semibold">Keldim</th>
                <th className="px-3 py-2.5 font-semibold">Ketdim</th>
                <th className="px-3 py-2.5 font-semibold">Qolish</th>
                <th className="px-3 py-2.5 font-semibold">Cheklist</th>
                <th className="px-3 py-2.5 font-semibold">Ketdim izohi</th>
                <th className="px-3 py-2.5 font-semibold">Holat</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                    Yuklanmoqda…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                    Tashrif yozuvlari yo‘q. Koordinator filialda Keldim qilganda paydo bo‘ladi.
                  </td>
                </tr>
              ) : (
                filtered.map((v) => (
                  <VisitRow
                    key={v.id}
                    v={v}
                    approving={approvingId === v.id}
                    closing={closingId === v.id}
                    onApprove={() => void approveUnlock(v.id)}
                    onForceCheckout={() => void forceKetdim(v)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function VisitRow({
  v,
  approving,
  closing,
  onApprove,
  onForceCheckout,
}: {
  v: CoordinatorVisitSession;
  approving?: boolean;
  closing?: boolean;
  onApprove?: () => void;
  onForceCheckout?: () => void;
}) {
  return (
    <tr className="border-b border-border/60 last:border-0 hover:bg-muted/30">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5 font-medium">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
          {v.coordinatorName || "—"}
        </div>
        <p className="text-[11px] text-muted-foreground">{v.workDate}</p>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-start gap-1.5">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="font-medium leading-snug">{v.branchLabel || `#${v.branchId}`}</span>
        </div>
      </td>
      <td className="px-3 py-2.5 tabular-nums">
        <span className="font-semibold text-emerald-700 dark:text-emerald-400">{fmtHm(v.checkInAt)}</span>
        <p className="text-[10px] text-muted-foreground">{fmtTime(v.checkInAt)}</p>
      </td>
      <td className="px-3 py-2.5 tabular-nums">
        {v.checkOutAt ? (
          <>
            <span className="font-semibold text-rose-700 dark:text-rose-400">{fmtHm(v.checkOutAt)}</span>
            <p className="text-[10px] text-muted-foreground">{fmtTime(v.checkOutAt)}</p>
          </>
        ) : (
          <span className="text-amber-700 dark:text-amber-300">Hali yo‘q</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1 font-semibold tabular-nums">
          <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
          {v.durationLabel}
        </div>
      </td>
      <td className="px-3 py-2.5">
        {v.checklistAt ? (
          <>
            <span className="font-semibold text-sky-700 dark:text-sky-300">{fmtHm(v.checklistAt)}</span>
            <p className="text-[10px] text-muted-foreground">
              Keldimdan keyin: {v.checklistAfterCheckInLabel}
            </p>
          </>
        ) : (
          <span className="text-muted-foreground">Hali yo‘q</span>
        )}
      </td>
      <td className="max-w-[220px] px-3 py-2.5">
        {v.checkoutNote ? (
          <p className="line-clamp-3 text-xs leading-snug text-foreground" title={v.checkoutNote}>
            {v.checkoutNote}
          </p>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex flex-col items-start gap-1.5">
          {v.presenceBlocked ? (
            <Badge className="bg-rose-100 text-rose-900 hover:bg-rose-100">Hudud bloki</Badge>
          ) : v.stillOpen ? (
            <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Ochiq</Badge>
          ) : (
            <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">Yopiq</Badge>
          )}
          {v.presenceBlocked && v.unlockPending && onApprove ? (
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={approving} onClick={onApprove}>
              {approving ? "…" : "Ruxsat berish"}
            </Button>
          ) : null}
          {v.stillOpen && !v.checkOutAt && onForceCheckout ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 border-rose-300 text-xs text-rose-800 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300"
              disabled={closing}
              onClick={onForceCheckout}
            >
              {closing ? "…" : "Ketdim yopish"}
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
