import React, { useMemo, useState } from "react";
import { CheckCircle2, Clock3, Hand, Lock, LogOut, MapPin, RefreshCw, ShieldCheck, Unlock, User } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  approveAllPresenceUnlocks,
  approvePresenceUnlock,
  forceCheckoutVisit,
  useVisitMonitor,
  type CoordinatorVisitSession,
} from "@/lib/branch-audits-api";
import { PHASE_META, PhaseBadge, fmtHm, phaseOf } from "./visit-phase";

function minutesSince(iso: string | null | undefined) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 60_000) : null;
}

function agoLabel(iso: string | null | undefined) {
  const m = minutesSince(iso);
  if (m == null) return "";
  if (m < 1) return "hozirgina";
  if (m < 60) return `${m} daq oldin`;
  const h = Math.floor(m / 60);
  return `${h} soat ${m % 60} daq oldin`;
}

/**
 * Admin — hudud bloki ruxsatlari + ochiq (Keldim bor, Ketdim yo‘q) tashriflarni yopish.
 */
export function PresenceUnlockPanel({ enabled }: { enabled: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const [closingId, setClosingId] = useState<number | null>(null);

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
  const { data, isLoading, refetch, isFetching } = useVisitMonitor({}, enabled);
  const items = data?.items ?? [];

  const urgent = useMemo(
    () =>
      items
        .filter((v) => PHASE_META[phaseOf(v)].urgent)
        .sort((a, b) => Number(phaseOf(b) === "unlock_requested") - Number(phaseOf(a) === "unlock_requested")),
    [items],
  );
  const requested = urgent.filter((v) => phaseOf(v) === "unlock_requested").length;
  const openNow = useMemo(
    () => items.filter((v) => v.stillOpen && !v.checkOutAt && !PHASE_META[phaseOf(v)].urgent),
    [items],
  );
  const approvedToday = useMemo(
    () =>
      items.filter(
        (v) =>
          v.presenceUnlockedAt &&
          new Date(v.presenceUnlockedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" }) === today,
      ).length,
    [items, today],
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
        description: res.message || `${v.coordinatorName || "Koordinator"} cheklistni davom ettira oladi`,
      });
    } catch (err) {
      toast({ title: "Berilmadi", description: (err as Error)?.message || "Qayta urinib ko‘ring", variant: "destructive" });
    } finally {
      setApprovingId(null);
    }
  };

  const approveAll = async () => {
    if (!window.confirm(`${urgent.length} ta koordinatorning hammasiga ruxsat berasizmi?`)) return;
    setApprovingAll(true);
    try {
      const res = await approveAllPresenceUnlocks();
      await invalidate();
      toast({ title: "Ruxsat berildi", description: res.message });
    } catch (err) {
      toast({ title: "Berilmadi", description: (err as Error)?.message || "Qayta urinib ko‘ring", variant: "destructive" });
    } finally {
      setApprovingAll(false);
    }
  };

  const forceKetdim = async (v: CoordinatorVisitSession) => {
    const name = v.coordinatorName || "Koordinator";
    const branch = v.branchLabel || `Filial #${v.branchId}`;
    if (
      !window.confirm(
        `${name} — «${branch}» tashrifini Ketdim bilan yopasizmi?\n\nKeyin koordinator boshqa filialda yangi Keldim qila oladi.`,
      )
    ) {
      return;
    }
    setClosingId(v.id);
    try {
      const res = await forceCheckoutVisit(v.id);
      await invalidate();
      toast({ title: "Ketdim yopildi", description: res.message || `${name} endi boshqa filialga o‘ta oladi` });
    } catch (err) {
      toast({ title: "Yopilmadi", description: (err as Error)?.message || "Qayta urinib ko‘ring", variant: "destructive" });
    } finally {
      setClosingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Qanday ishlaydi */}
      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              Ruxsat berish
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Koordinator filialda ekanini har 30 daqiqada telefonidan tasdiqlaydi. Tasdiqlamasa — tizim
              cheklistni yopadi va siz shu yerdan bir bosishda qayta ochasiz.
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
        <ol className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          {[
            { icon: Clock3, t: "30 daqiqa", d: "Koordinatorga «hududni tasdiqlang» xabari boradi" },
            { icon: Lock, t: "+10 daqiqa", d: "Tasdiqlamasa cheklist bloklanadi, u «Ruxsat olish» bosadi" },
            { icon: Unlock, t: "Siz", d: "«Ruxsat berish» bosasiz — u darhol davom etadi" },
          ].map((s, i) => (
            <li key={i} className="flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-bold ring-1 ring-border">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1 font-semibold text-foreground">
                  <s.icon className="h-3.5 w-3.5" />
                  {s.t}
                </p>
                <p className="text-[11px] leading-snug text-muted-foreground">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Count label="Ruxsat so‘ragan" value={requested} tone="text-amber-600" />
        <Count label="Bloklangan (jami)" value={urgent.length} tone="text-rose-600" />
        <Count label="Hozir filialda" value={openNow.length} tone="text-sky-700" />
        <Count label="Bugun ruxsat berildi" value={approvedToday} tone="text-emerald-600" />
      </div>

      {/* Ruxsat kutayotganlar */}
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <Hand className="h-4 w-4 text-amber-600" />
            Ruxsat kutayotganlar
            <span className="rounded-full bg-muted px-2 text-xs tabular-nums">{urgent.length}</span>
          </h3>
          {urgent.length > 1 ? (
            <Button
              type="button"
              size="sm"
              className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={approvingAll}
              onClick={() => void approveAll()}
            >
              <Unlock className="h-3.5 w-3.5" />
              {approvingAll ? "Berilmoqda…" : `Hammasiga ruxsat (${urgent.length})`}
            </Button>
          ) : null}
        </div>
        {isLoading ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">Yuklanmoqda…</p>
        ) : urgent.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500/70" />
            <p className="mt-2 text-sm font-semibold text-foreground">Hamma joyida — so‘rov yo‘q</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Koordinator bloklansa shu yerda chiqadi, sizga Telegram/bildirishnoma ham keladi.
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {urgent.map((v) => (
              <li
                key={v.id}
                className={cn(
                  "flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
                  phaseOf(v) === "unlock_requested" && "bg-amber-50/70 dark:bg-amber-950/20",
                )}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <PhaseBadge phase={phaseOf(v)} />
                    {v.presenceUnlockRequestAt ? (
                      <span className="text-[11px] font-medium text-amber-800 dark:text-amber-300">
                        so‘rov {agoLabel(v.presenceUnlockRequestAt)}
                      </span>
                    ) : null}
                  </div>
                  <p className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                    <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {v.coordinatorName || `Koordinator #${v.coordinatorUserId}`}
                  </p>
                  <p className="flex items-start gap-1.5 text-sm text-foreground">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {v.branchLabel || `Filial #${v.branchId}`}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Keldim {fmtHm(v.checkInAt)} · filialda {v.durationLabel}
                    {v.presenceBlockedAt ? ` · bloklandi ${fmtHm(v.presenceBlockedAt)}` : ""}
                    {v.checklistAt ? ` · cheklist ${fmtHm(v.checklistAt)}` : " · cheklist hali yo‘q"}
                  </p>
                </div>
                <div className="flex w-full gap-2 sm:w-auto">
                  <Button
                    type="button"
                    className="flex-1 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 sm:flex-none"
                    disabled={approvingId === v.id || approvingAll}
                    onClick={() => void approve(v)}
                  >
                    <Unlock className="h-4 w-4" />
                    {approvingId === v.id ? "Berilmoqda…" : "Ruxsat berish"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-1.5 border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300"
                    disabled={closingId === v.id}
                    onClick={() => void forceKetdim(v)}
                    title="Tashrifni yopish — boshqa filialga o‘ta oladi"
                  >
                    <LogOut className="h-4 w-4" />
                    {closingId === v.id ? "…" : "Ketdim"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Hozir filialda */}
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="border-b px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <MapPin className="h-4 w-4 text-sky-600" />
            Hozir filialda / ofisda
            <span className="rounded-full bg-muted px-2 text-xs tabular-nums">{openNow.length}</span>
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Ketdim qilishni unutgan bo‘lsa — yoping, shunda boshqa filialda Keldim qila oladi. Kun tugagach
            ochiq qolganlarni tizim o‘zi yopadi.
          </p>
        </div>
        {isLoading ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Yuklanmoqda…</p>
        ) : openNow.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Hozir ochiq tashrif yo‘q.</p>
        ) : (
          <ul className="divide-y">
            {openNow.map((v) => (
              <li key={v.id} className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {v.coordinatorName || `#${v.coordinatorUserId}`}
                    <span className="font-normal text-muted-foreground">·</span>
                    <span className="font-medium">{v.branchLabel || `Filial #${v.branchId}`}</span>
                    <PhaseBadge phase={phaseOf(v)} />
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Keldim {fmtHm(v.checkInAt)} · {v.durationLabel}
                    {v.checklistAt ? ` · cheklist ${fmtHm(v.checklistAt)}` : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1.5 border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300"
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
      </section>
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-2xl border bg-card px-3.5 py-3 shadow-sm">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-2xl font-bold tabular-nums", value ? tone : "text-foreground")}>{value}</p>
    </div>
  );
}
