import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Building2,
  Clock3,
  LogIn,
  LogOut,
  MapPin,
  RefreshCw,
  History,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  finishCoordinatorVisit,
  useMyOfficeStays,
  type CoordinatorVisitSession,
} from "@/lib/branch-audits-api";
import {
  DAVOMAT_OFFICE_GEOFENCE_METERS,
  DAVOMAT_SITE_LAT,
  DAVOMAT_SITE_LNG,
  haversineMeters,
} from "@/lib/davomat-api";
import { FinishVisitDialog } from "@/pages/checklist/finish-visit-dialog";
import { useQueryClient } from "@tanstack/react-query";

function fmtHm(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDate(ymd?: string | null) {
  if (!ymd) return "—";
  try {
    return new Date(`${ymd}T12:00:00+05:00`).toLocaleDateString("uz-UZ", {
      timeZone: "Asia/Tashkent",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return ymd;
  }
}

function liveDurationLabel(checkInAt: string, nowMs: number) {
  const start = new Date(checkInAt).getTime();
  if (!Number.isFinite(start)) return "—";
  const mins = Math.max(0, Math.round((nowMs - start) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m} daq`;
  if (m === 0) return `${h} soat`;
  return `${h} soat ${m} daq`;
}

function todayYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

function daysAgoYmd(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

export default function DavomatOfisdaPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const from = daysAgoYmd(30);
  const to = todayYmd();
  const isCoord = user?.role === "koordinator" || user?.role === "admin";
  const { data, isLoading, refetch, isFetching } = useMyOfficeStays({
    from,
    to,
    enabled: isCoord,
  });

  const [nowTick, setNowTick] = useState(() => Date.now());
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError("GPS yo‘q");
      return;
    }
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsError(null);
      },
      (err) => setGpsError(err.message || "GPS ruxsat berilmadi"),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, []);

  const open = data?.open ?? null;
  const items = data?.items ?? [];
  const summary = data?.summary;

  const distanceMeters = useMemo(() => {
    if (!gps) return null;
    return haversineMeters(gps.lat, gps.lng, DAVOMAT_SITE_LAT, DAVOMAT_SITE_LNG);
  }, [gps]);

  const withinOffice =
    distanceMeters != null && distanceMeters <= DAVOMAT_OFFICE_GEOFENCE_METERS;

  const todayItems = items.filter((i) => i.workDate === to);
  const historyItems = items.filter((i) => !i.stillOpen);

  const onFinish = async (note: string) => {
    if (!open) return;
    setFinishing(true);
    try {
      const res = await finishCoordinatorVisit({
        note,
        latitude: gps?.lat ?? null,
        longitude: gps?.lng ?? null,
      });
      toast({
        title: "Ketdim qabul qilindi",
        description: res.message,
      });
      setFinishOpen(false);
      await qc.invalidateQueries({ queryKey: ["branch-audits"] });
      await refetch();
    } catch (e: unknown) {
      toast({
        title: "Ketdim yozilmadi",
        description: (e as Error)?.message || "Xatolik",
        variant: "destructive",
      });
    } finally {
      setFinishing(false);
    }
  };

  if (!isCoord) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border bg-card p-8 text-center shadow-sm">
        <Building2 className="mx-auto h-10 w-10 text-muted-foreground" />
        <h2 className="mt-3 text-lg font-semibold">Faqat koordinatorlar uchun</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Asosiy ofisda qolish — koordinator davomati va Keldim/Ketdim bilan bog‘liq.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-24 sm:space-y-6 sm:pb-10">
      <div className="relative overflow-hidden rounded-2xl bg-[#0b1a2e] px-4 py-5 text-white shadow-lg sm:px-6 sm:py-7">
        <div className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-emerald-400/15 blur-2xl" />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-emerald-100">
              <Building2 className="h-3.5 w-3.5" />
              Asosiy ofis
            </div>
            <h1 className="text-xl font-bold tracking-tight sm:text-3xl">
              Asosiy ofisda qolish
            </h1>
            <p className="mt-1.5 text-xs leading-relaxed text-white/70 sm:max-w-xl sm:text-sm">
              Ofisga kelib Face ID bilan «Keldim» — bu yerda kelgan soat, qancha vaqt
              qolganingiz va Ketdim yoziladi. Ochiq Keldim bo‘lsa filial cheklistiga
              o‘ta olmaysiz.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0 gap-1.5"
            disabled={isFetching}
            onClick={() => refetch()}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            Yangilash
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <StatCard
          icon={<Timer className="h-4 w-4" />}
          label="Hozir"
          value={open ? liveDurationLabel(open.checkInAt, nowTick) : "—"}
          accent={open ? "emerald" : undefined}
        />
        <StatCard
          icon={<LogIn className="h-4 w-4" />}
          label="Keldim"
          value={open ? fmtHm(open.checkInAt) : "yo‘q"}
        />
        <StatCard
          icon={<History className="h-4 w-4" />}
          label="30 kun"
          value={String(summary?.total ?? (isLoading ? "…" : 0))}
        />
        <StatCard
          icon={<Clock3 className="h-4 w-4" />}
          label="O‘rtacha"
          value={summary?.avgStayLabel || "—"}
        />
      </div>

      <div
        className={cn(
          "rounded-2xl border px-4 py-4 sm:px-5",
          open
            ? "border-emerald-300/80 bg-emerald-50/90 dark:border-emerald-500/30 dark:bg-emerald-950/40"
            : "border-border bg-card",
        )}
      >
        {open ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Ochiq</Badge>
              <span className="text-sm font-semibold">Hozir asosiy ofisdasiz</span>
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-3">
              <InfoLine label="Sana" value={fmtDate(open.workDate)} />
              <InfoLine label="Keldim" value={fmtHm(open.checkInAt)} />
              <InfoLine
                label="Qancha vaqt"
                value={liveDurationLabel(open.checkInAt, nowTick)}
                strong
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Ketdim qilmaguncha filial cheklistiga yoki boshqa joyga yangi Keldim
              ochilmaydi.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                className="bg-rose-600 text-white hover:bg-rose-700"
                disabled={!withinOffice}
                title={
                  withinOffice
                    ? "Ofis zonasida Ketdim"
                    : `Ofisga ${DAVOMAT_OFFICE_GEOFENCE_METERS} m ichida kiring`
                }
                onClick={() => setFinishOpen(true)}
              >
                <LogOut className="mr-1.5 h-4 w-4" />
                Ketdim
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation("/davomat-face")}
              >
                Davomat (Face ID)
              </Button>
            </div>
            {!withinOffice ? (
              <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-200">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {gpsError
                  ? gpsError
                  : distanceMeters != null
                    ? `Ofis zonasidan tashqaridasiz (${distanceMeters} m). Ketdim uchun ${DAVOMAT_OFFICE_GEOFENCE_METERS} m ichida bo‘ling.`
                    : "GPS kutilmoqda…"}
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-emerald-800 dark:text-emerald-200">
                <MapPin className="h-3.5 w-3.5" />
                Ofis zonasidasiz ({distanceMeters} m)
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-semibold">Hozir ochiq ofis qolishi yo‘q</p>
            <p className="text-xs text-muted-foreground">
              Asosiy ofis yashil zonasida ({DAVOMAT_OFFICE_GEOFENCE_METERS} m) Face ID
              bilan «Keldim» qiling — kelgan soat va qolish vaqti shu yerda ko‘rinadi.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" onClick={() => setLocation("/davomat-face")}>
                <LogIn className="mr-1.5 h-4 w-4" />
                Face ID — Keldim
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation("/checklist")}
              >
                Filial cheklist
              </Button>
            </div>
            {distanceMeters != null ? (
              <p
                className={cn(
                  "text-xs",
                  withinOffice
                    ? "text-emerald-800 dark:text-emerald-200"
                    : "text-muted-foreground",
                )}
              >
                Ofisgacha: {distanceMeters} m
                {withinOffice ? " — zonadasiz" : ""}
              </p>
            ) : null}
          </div>
        )}
      </div>

      {todayItems.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-tight">Bugungi ofis tashriflari</h2>
          <div className="space-y-2">
            {todayItems.map((v) => (
              <StayRow key={v.id} visit={v} nowMs={nowTick} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold tracking-tight">Oxirgi 30 kun</h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Yuklanmoqda…</p>
        ) : historyItems.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            Hali ofisda qolish tarixi yo‘q
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border divide-y">
            {historyItems.slice(0, 40).map((v) => (
              <StayRow key={v.id} visit={v} nowMs={nowTick} compact />
            ))}
          </div>
        )}
      </section>

      <FinishVisitDialog
        open={finishOpen}
        onOpenChange={setFinishOpen}
        branchLabel="Asosiy ofis"
        checkInAt={open?.checkInAt}
        checklistAt={null}
        submitting={finishing}
        withinGeofence={withinOffice}
        geofenceMeters={DAVOMAT_OFFICE_GEOFENCE_METERS}
        onFinish={onFinish}
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: "emerald";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card px-3 py-3 shadow-sm",
        accent === "emerald" &&
          "border-emerald-300/70 bg-emerald-50/80 dark:border-emerald-500/30 dark:bg-emerald-950/30",
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function InfoLine({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 tabular-nums", strong ? "text-base font-bold" : "font-medium")}>
        {value}
      </p>
    </div>
  );
}

function StayRow({
  visit,
  nowMs,
  compact,
}: {
  visit: CoordinatorVisitSession;
  nowMs: number;
  compact?: boolean;
}) {
  const duration = visit.stillOpen
    ? liveDurationLabel(visit.checkInAt, nowMs)
    : visit.durationLabel || "—";
  return (
    <div
      className={cn(
        "flex flex-col gap-1 bg-card px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4",
        !compact && "rounded-xl border",
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{fmtDate(visit.workDate)}</span>
          {visit.stillOpen ? (
            <Badge variant="outline" className="border-emerald-500 text-emerald-700">
              Ochiq
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Keldim {fmtHm(visit.checkInAt)}
          {visit.checkOutAt ? ` · Ketdim ${fmtHm(visit.checkOutAt)}` : " · Ketdim yo‘q"}
          {visit.checkoutNote ? ` · ${visit.checkoutNote.slice(0, 80)}${visit.checkoutNote.length > 80 ? "…" : ""}` : ""}
        </p>
      </div>
      <p className="shrink-0 text-sm font-semibold tabular-nums">{duration}</p>
    </div>
  );
}
