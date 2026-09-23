import React, { useMemo, useState } from "react";
import { Unlock, MapPin, User, Clock3, ShieldAlert, RefreshCw, LogOut } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  approvePresenceUnlock,
  forceCheckoutVisit,
  useVisitMonitor,
  type CoordinatorVisitSession,
} from "@/lib/branch-audits-api";

function fmtWhen(iso: string | null | undefined) {
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

/**
 * Admin — hudud bloki ruxsatlari + ochiq (Keldim bor, Ketdim yo‘q) tashriflarni yopish.
 */
export function PresenceUnlockPanel({ enabled }: { enabled: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [closingId, setClosingId] = useState<number | null>(null);

  const { data, isLoading, refetch, isFetching } = useVisitMonitor({}, enabled);

  const items = data?.items ?? [];

  const pending = useMemo(
    () =>
      items.filter(
        (v) => v.stillOpen && (v.presenceBlocked || v.unlockPending) && !v.checkOutAt,
      ),
    [items],
  );

  const waitingUnlock = useMemo(
    () => pending.filter((v) => v.unlockPending || v.presenceUnlockRequestAt),
    [pending],
  );

  const blockedOnly = useMemo(
    () => pending.filter((v) => v.presenceBlocked && !v.unlockPending),
    [pending],
  );

  /** Keldim bor, Ketdim yo‘q — hozir ochiq qolib ketganlar */
  const openStuck = useMemo(
    () => items.filter((v) => v.stillOpen && !v.checkOutAt),
    [items],
  );

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["branch-audits", "visit-monitor"] });
    await qc.invalidateQueries({ queryKey: ["branch-audits", "my-visit"] });
  };

  const approve = async (v: CoordinatorVisitSession) => {
    setApprovingId(v.id);
    try {
      const res = await approvePresenceUnlock(v.id);
      await invalidate();
      toast({
        title: "Ruxsat berildi",
        description:
          res.message ||
          `${v.coordinatorName || "Koordinator"} cheklistni davom ettirishi mumkin`,
      });
    } catch (err) {
      toast({
        title: "Berilmadi",
        description: (err as Error)?.message || "Qayta urinib ko‘ring",
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
        `${name} — «${branch}» ochiq tashrifini Ketdim bilan yopasizmi?\n\nKeyin koordinator boshqa filialda yangi Keldim qila oladi.`,
      )
    ) {
      return;
    }
    setClosingId(v.id);
    try {
      const res = await forceCheckoutVisit(v.id);
      await invalidate();
      toast({
        title: "Ketdim yopildi",
        description: res.message || `${name} endi boshqa filialga o‘ta oladi`,
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

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-rose-200/80 bg-gradient-to-br from-rose-50 via-white to-amber-50 shadow-sm dark:border-rose-900/50 dark:from-rose-950/40 dark:via-slate-950 dark:to-amber-950/30">
        <div className="flex flex-col gap-3 border-b border-rose-100/80 px-4 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-rose-900/40">
          <div className="min-w-0">
            <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              <Unlock className="h-3 w-3" />
              Admin ruxsati
            </div>
            <h2 className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
              Hudud bloki — ruxsat berish
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
              Koordinator 30 daqiqalik eslatmadan keyin 10 daqiqa ichida hududini
              tasdiqlamasa cheklist bloklanadi. Bu yerda so‘rovlarni ko‘rib «Ruxsat
              berish» bosing. Keldim qilib Ketdim qilmagan ochiq tashriflarni ham
              «Ketdim bilan yopish» orqali yopishingiz mumkin.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            Yangilash
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
          <div className="rounded-xl border bg-white/80 px-3 py-3 dark:bg-slate-950/50">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              So‘rov kutayotgan
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-amber-700 dark:text-amber-300">
              {waitingUnlock.length}
            </p>
          </div>
          <div className="rounded-xl border bg-white/80 px-3 py-3 dark:bg-slate-950/50">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Blok (so‘rovsiz)
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-rose-700 dark:text-rose-300">
              {blockedOnly.length}
            </p>
          </div>
          <div className="rounded-xl border bg-white/80 px-3 py-3 dark:bg-slate-950/50">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Jami bloklangan
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
              {pending.length}
            </p>
          </div>
          <div className="rounded-xl border bg-white/80 px-3 py-3 dark:bg-slate-950/50">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Ochiq (Ketdim yo‘q)
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-sky-800 dark:text-sky-300">
              {openStuck.length}
            </p>
          </div>
        </div>
      </div>

      {/* Ochiq tashriflar — Ketdim bilan yopish */}
      <div className="overflow-hidden rounded-2xl border border-sky-200/80 bg-card shadow-sm dark:border-sky-900/40">
        <div className="border-b border-sky-100 px-4 py-3 dark:border-sky-900/40">
          <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <LogOut className="h-4 w-4 text-sky-600" />
            Ochiq tashriflar — Ketdim bilan yopish
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Koordinator Keldim qilib Ketdim qilmasa boshqa filialga o‘ta olmaydi. Bu yerda
            ochiq sessionni yopsangiz — u yangi filialda Keldim/Ketdim qila oladi.
          </p>
        </div>
        {isLoading ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : openStuck.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Hozir ochiq qolib ketgan tashrif yo‘q.
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {openStuck.map((v) => (
              <li
                key={`open-${v.id}`}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Ochiq</Badge>
                    {v.presenceBlocked ? (
                      <Badge className="bg-rose-100 text-rose-900 hover:bg-rose-100">Hudud bloki</Badge>
                    ) : null}
                    <span className="text-[11px] text-muted-foreground">#{v.id}</span>
                  </div>
                  <p className="flex items-center gap-1.5 font-semibold text-foreground">
                    <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {v.coordinatorName || `Koordinator #${v.coordinatorUserId}`}
                  </p>
                  <p className="flex items-start gap-1.5 text-sm text-foreground">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{v.branchLabel || `Filial #${v.branchId}`}</span>
                  </p>
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock3 className="h-3 w-3" />
                    Keldim: {fmtWhen(v.checkInAt)}
                    {v.durationLabel ? ` · ${v.durationLabel}` : null}
                    {!v.checklistAt ? " · Cheklist yo‘q" : " · Cheklist bor"}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="w-full shrink-0 gap-1.5 bg-rose-600 text-white hover:bg-rose-700 sm:w-auto"
                  disabled={closingId === v.id}
                  onClick={() => void forceKetdim(v)}
                >
                  <LogOut className="h-3.5 w-3.5" />
                  {closingId === v.id ? "Yopilmoqda…" : "Ketdim bilan yopish"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {isLoading ? (
        <div className="rounded-2xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Yuklanmoqda…
        </div>
      ) : pending.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card px-4 py-12 text-center">
          <Unlock className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-semibold text-foreground">Hozircha so‘rov yo‘q</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Koordinator bloklansa va «Ruxsat olish» bossа, bu yerda chiqadi.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {pending.map((v) => {
            const needsAction = Boolean(v.unlockPending || v.presenceUnlockRequestAt);
            return (
              <li
                key={v.id}
                className={cn(
                  "rounded-2xl border bg-card p-4 shadow-sm",
                  needsAction
                    ? "border-amber-300 ring-1 ring-amber-200/80 dark:border-amber-700 dark:ring-amber-900/40"
                    : "border-rose-200 dark:border-rose-900/50",
                )}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {needsAction ? (
                        <Badge className="bg-amber-500 text-white hover:bg-amber-500">
                          Ruxsat so‘ralgan
                        </Badge>
                      ) : (
                        <Badge className="bg-rose-600 text-white hover:bg-rose-600">
                          Bloklangan
                        </Badge>
                      )}
                      <span className="text-[11px] text-muted-foreground">#{v.id}</span>
                    </div>
                    <p className="flex items-center gap-1.5 text-base font-bold text-foreground">
                      <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                      {v.coordinatorName || `Koordinator #${v.coordinatorUserId}`}
                    </p>
                    <p className="flex items-start gap-1.5 text-sm text-foreground">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>{v.branchLabel || `Filial #${v.branchId}`}</span>
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-3 w-3" />
                        Keldim: {fmtWhen(v.checkInAt)}
                      </span>
                      {v.presenceBlockedAt ? (
                        <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-300">
                          <ShieldAlert className="h-3 w-3" />
                          Blok: {fmtWhen(v.presenceBlockedAt)}
                        </span>
                      ) : null}
                      {v.presenceUnlockRequestAt ? (
                        <span className="inline-flex items-center gap-1 text-amber-800 dark:text-amber-300">
                          So‘rov: {fmtWhen(v.presenceUnlockRequestAt)}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Sabab: 10 daqiqa ichida yashil hududni tasdiqlamagan — cheklist
                      yopilgan.
                    </p>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[160px]">
                    <Button
                      type="button"
                      size="lg"
                      className="w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                      disabled={approvingId === v.id}
                      onClick={() => void approve(v)}
                    >
                      <Unlock className="h-4 w-4" />
                      {approvingId === v.id ? "Berilmoqda…" : "Ruxsat berish"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-full gap-1.5 border-rose-300 text-rose-800 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300"
                      disabled={closingId === v.id}
                      onClick={() => void forceKetdim(v)}
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      {closingId === v.id ? "Yopilmoqda…" : "Ketdim bilan yopish"}
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
