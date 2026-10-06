import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { canViewKochmaAdmin } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  MobileRouteMap,
  OFFICE_MAP_PLACE,
  formatRouteDistance,
  formatRouteDuration,
  routeDistanceMeters,
  type MapPlace,
  type RoutePoint,
} from "@/components/davomat/MobileRouteMap";
import { ExternalMapsLinks, PlaceNavLinks } from "@/components/davomat/ExternalMapsLinks";
import { BranchPinSearch } from "@/components/davomat/BranchPinSearch";
import {
  fetchMobilePermissions,
  fetchMobileSessionDetail,
  fetchDayAttendancePlaces,
  fetchMobileSessions,
  fetchPharmacyMapPins,
  type DayAttendanceMark,
  type MobilePermissionRow,
  type PharmacyMapPin,
} from "@/lib/mobile-attendance-api";
import { foldScript } from "@/lib/script-fold";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { displayBranchName } from "@/lib/pharmacy-staff-api";
import {
  ArrowLeft,
  Loader2,
  MapPin,
  Navigation,
  Radio,
  RefreshCw,
  Route,
} from "lucide-react";

type SessionRow = {
  id: number;
  employeeId: number;
  workDate: string;
  status: string;
  securityStatus: string;
  startTime: string | null;
  endTime: string | null;
  startLatitude: number;
  startLongitude: number;
  endLatitude?: number | null;
  endLongitude?: number | null;
  fullName?: string | null;
  position?: string | null;
  durationMin?: number | null;
  routeTrackingEnabled?: boolean;
};

type PermEmp = {
  id: number;
  name: string;
  position: string | null;
  location: string | null;
  tracking: boolean;
  hasSession: boolean;
  sessionStatus: string | null;
  checkInAt?: string | null;
  checkOutAt?: string | null;
};

function todayYmdLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("uz-UZ", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Tashkent",
    });
  } catch {
    return iso;
  }
}

function buildPoints(detail: Awaited<ReturnType<typeof fetchMobileSessionDetail>>): RoutePoint[] {
  const s = detail.session;
  const pts: RoutePoint[] = [];
  const seen = new Set<string>();
  const push = (
    lat: number,
    lng: number,
    kind: RoutePoint["kind"],
    time?: string | null,
    accuracy?: number | null,
  ) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    const key = `${kind}:${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (seen.has(key) && kind === "track") return;
    seen.add(key);
    pts.push({ lat, lng, kind, time: time || null, accuracy: accuracy ?? null });
  };

  push(Number(s.startLatitude), Number(s.startLongitude), "start", fmtTime(s.startTime), s.startAccuracy);

  const ordered = [...detail.points].sort(
    (a, b) =>
      a.sequenceNumber - b.sequenceNumber ||
      String(a.recordedAt || "").localeCompare(String(b.recordedAt || "")),
  );
  for (const p of ordered) {
    if (p.pointType === "start" || p.pointType === "end") continue;
    push(Number(p.latitude), Number(p.longitude), "track", fmtTime(p.recordedAt), p.accuracy);
  }

  if (s.endLatitude != null && s.endLongitude != null) {
    push(Number(s.endLatitude), Number(s.endLongitude), "end", fmtTime(s.endTime), s.endAccuracy);
  } else if (s.status !== "open") {
    const lastTrack = [...pts].reverse().find((p) => p.kind === "track");
    if (lastTrack) push(lastTrack.lat, lastTrack.lng, "end", lastTrack.time, lastTrack.accuracy);
  }

  return pts;
}

function pointsFromSessionRow(s: SessionRow): RoutePoint[] {
  const pts: RoutePoint[] = [];
  if (Number.isFinite(s.startLatitude) && Number.isFinite(s.startLongitude)) {
    pts.push({
      lat: Number(s.startLatitude),
      lng: Number(s.startLongitude),
      kind: "start",
      time: fmtTime(s.startTime),
    });
  }
  if (s.endLatitude != null && s.endLongitude != null) {
    pts.push({
      lat: Number(s.endLatitude),
      lng: Number(s.endLongitude),
      kind: "end",
      time: fmtTime(s.endTime),
    });
  }
  return pts;
}

export default function AdminKochmaXaritaPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = canViewKochmaAdmin(user?.role);

  const [date, setDate] = useState(todayYmdLocal);
  const [empId, setEmpId] = useState<number | "">("");
  const [perms, setPerms] = useState<MobilePermissionRow[]>([]);
  const [dayMarks, setDayMarks] = useState<DayAttendanceMark[]>([]);
  const [daySessions, setDaySessions] = useState<SessionRow[]>([]);
  const [empSessions, setEmpSessions] = useState<SessionRow[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [points, setPoints] = useState<RoutePoint[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMap, setLoadingMap] = useState(false);
  const [empQ, setEmpQ] = useState("");
  const [pins, setPins] = useState<PharmacyMapPin[]>([]);
  const [pinsWithoutGps, setPinsWithoutGps] = useState(0);
  const [selectedPin, setSelectedPin] = useState<PharmacyMapPin | null>(null);
  const [focusPinId, setFocusPinId] = useState<number | null>(null);
  const [focusToken, setFocusToken] = useState(0);

  const employees = useMemo((): PermEmp[] => {
    const sessByEmp = new Map<number, SessionRow>();
    for (const s of daySessions) {
      const prev = sessByEmp.get(s.employeeId);
      if (!prev || (s.status === "open" && prev.status !== "open")) {
        sessByEmp.set(s.employeeId, s);
      }
    }
    const q = foldScript(empQ.trim());
    if (dayMarks.length > 0) {
      return dayMarks
        .map((m) => ({
          id: m.employeeId,
          name: m.fullName,
          position: m.position,
          location: m.location,
          tracking: Boolean(m.sessionId),
          hasSession: true,
          sessionStatus: m.sessionStatus ?? (m.checkOutAt ? "closed" : "open"),
          checkInAt: m.checkInAt,
          checkOutAt: m.checkOutAt,
        }))
        .filter((e) => {
          const name = e.name.trim();
          if (!name || /^Xodim #\d+$/.test(name)) return false;
          return (
            !q ||
            foldScript(name).includes(q) ||
            foldScript(String(e.position || "")).includes(q) ||
            foldScript(String(e.location || "")).includes(q)
          );
        })
        .sort((a, b) => String(b.checkInAt || "").localeCompare(String(a.checkInAt || "")));
    }
    return perms
      .map((p) => {
        const sess = sessByEmp.get(p.employeeId);
        return {
          id: p.employeeId,
          name: p.fullName || `Xodim #${p.employeeId}`,
          position: p.position ?? null,
          location: p.location ?? null,
          tracking: Boolean(p.routeTrackingEnabled),
          hasSession: Boolean(sess),
          sessionStatus: sess?.status ?? null,
        };
      })
      .filter((e) => {
        const name = e.name.trim();
        if (!name || /^Xodim #\d+$/.test(name)) return false;
        return (
          !q ||
          foldScript(name).includes(q) ||
          foldScript(String(e.position || "")).includes(q) ||
          foldScript(String(e.location || "")).includes(q)
        );
      })
      .sort((a, b) => {
        if (a.hasSession !== b.hasSession) return a.hasSession ? -1 : 1;
        return a.name.localeCompare(b.name, "uz");
      });
  }, [perms, daySessions, dayMarks, empQ]);

  const selectedEmp = employees.find((e) => e.id === empId);
  const selectedSession =
    empSessions.find((s) => s.id === sessionId) || daySessions.find((s) => s.id === sessionId);

  const loadBase = useCallback(async () => {
    setLoadingList(true);
    try {
      const [p, s] = await Promise.all([
        fetchMobilePermissions("active"),
        fetchMobileSessions({ from: date, to: date }),
      ]);
      setPerms(p.permissions);
      setDaySessions(s.sessions as SessionRow[]);
      const day = await fetchDayAttendancePlaces(date);
      setDayMarks(day.marks);
      const branches = await fetchPharmacyMapPins();
      setPins(branches.pins);
      setPinsWithoutGps(branches.withoutGps);
    } catch (e) {
      toast({
        title: "Yuklanmadi",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoadingList(false);
    }
  }, [date, toast]);

  useEffect(() => {
    if (allowed) void loadBase();
  }, [allowed, loadBase]);

  useEffect(() => {
    if (!empId) {
      setEmpSessions([]);
      setSessionId(null);
      setPoints([]);
      return;
    }
    const mark = dayMarks.find((m) => m.employeeId === empId);
    if (mark && !mark.sessionId) {
      setEmpSessions([]);
      setSessionId(null);
      const pts: RoutePoint[] = [];
      if (mark.checkInLat != null && mark.checkInLng != null) {
        pts.push({
          lat: mark.checkInLat,
          lng: mark.checkInLng,
          kind: "start",
          time: fmtTime(mark.checkInAt),
        });
      }
      if (mark.checkOutLat != null && mark.checkOutLng != null) {
        pts.push({
          lat: mark.checkOutLat,
          lng: mark.checkOutLng,
          kind: "end",
          time: fmtTime(mark.checkOutAt),
        });
      }
      setPoints(pts);
      return;
    }
    void (async () => {
      setLoadingList(true);
      try {
        const s = await fetchMobileSessions({
          from: date,
          to: date,
          employeeId: Number(empId),
        });
        const list = s.sessions as SessionRow[];
        setEmpSessions(list);
        setSessionId(list[0]?.id ?? null);
        if (!list[0]) setPoints([]);
      } catch (e) {
        toast({ title: "Sessiyalar", description: (e as Error).message, variant: "destructive" });
      } finally {
        setLoadingList(false);
      }
    })();
  }, [empId, date, dayMarks, toast]);

  useEffect(() => {
    if (!empId) return;
    const mark = dayMarks.find((m) => m.employeeId === Number(empId));
    if (mark && !mark.sessionId) return;
    if (mark?.sessionId && sessionId !== mark.sessionId) return;
    if (!sessionId) return;
    const row =
      empSessions.find((s) => s.id === sessionId) || daySessions.find((s) => s.id === sessionId);
    if (row) setPoints(pointsFromSessionRow(row));

    let cancelled = false;
    void (async () => {
      setLoadingMap(true);
      try {
        const d = await fetchMobileSessionDetail(sessionId);
        if (!cancelled) {
          const built = buildPoints(d);
          setPoints(built.length ? built : row ? pointsFromSessionRow(row) : []);
        }
      } catch (e) {
        if (!cancelled) {
          toast({ title: "Xarita", description: (e as Error).message, variant: "destructive" });
        }
      } finally {
        if (!cancelled) setLoadingMap(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, empSessions, daySessions, toast, empId, dayMarks]);

  const pickBranch = (p: PharmacyMapPin) => {
    setSelectedPin(p);
    setFocusPinId(p.id);
    setFocusToken((n) => n + 1);
  };

  const places = useMemo<MapPlace[]>(
    () => [
      OFFICE_MAP_PLACE,
      ...pins.map((p) => ({
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        name: p.name,
        mudirName: p.mudirName,
        coordinatorName: p.coordinatorName,
        phone: p.phone,
        hours: p.hours || "Belgilanmagan",
        tone: "branch" as const,
      })),
    ],
    [pins],
  );

  const distanceM = points.length >= 2 ? routeDistanceMeters(points) : 0;
  const distanceLabel = formatRouteDistance(distanceM);

  if (!allowed) {
    return <div className="p-6 text-sm text-muted-foreground">Ruxsat yo‘q.</div>;
  }

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 pb-28">
      <header className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-4 bg-gradient-to-br from-sky-50 via-card to-indigo-50/30 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:from-sky-950/35 dark:to-indigo-950/20">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Button asChild variant="ghost" size="sm" className="-ml-2 h-8 rounded-lg px-2 text-muted-foreground">
                <Link href="/admin/kochma-davomat">
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  Orqaga
                </Link>
              </Button>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-300/70 bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-sky-800 dark:border-sky-700 dark:text-sky-200">
                Tarix · A → B
              </span>
            </div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
              <Navigation className="h-6 w-6 text-sky-600" />
              Ko‘chma xarita
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Barcha dorixonalar saqlangan GPS nuqtada. Nuqtani bosing — filial nomi, mudir,
              koordinator va dorixona raqami chiqadi. Xodim tanlansa, uning A → B yo‘li ham shu xaritada.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" className="h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700">
              <Link href="/admin/kochma-live">
                <Radio className="mr-1.5 h-4 w-4" />
                Jonli kuzatuv
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-xl"
              onClick={() => void loadBase()}
              disabled={loadingList}
            >
              {loadingList ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <aside className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sana</label>
            <Input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setSessionId(null);
                setPoints([]);
              }}
              className="mt-1.5 rounded-xl"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Xodim qidirish (krill / lotin)
            </label>
            <Input
              value={empQ}
              onChange={(e) => setEmpQ(e.target.value)}
              placeholder="Ism…"
              className="mt-1.5 rounded-xl"
            />
          </div>
          <BranchPinSearch pins={pins} onPick={pickBranch} />
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {dayMarks.length > 0 ? "Shu kuni davomat" : "Ruxsat berilganlar"}
              </span>
              <Badge variant="secondary" className="rounded-full text-[10px] font-normal">
                {employees.length}
              </Badge>
            </div>
            <div className="max-h-[min(52vh,420px)] space-y-1 overflow-y-auto rounded-xl border border-border p-1">
              {loadingList && employees.length === 0 ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : employees.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  Ko‘chma davomatga ruxsat berilgan xodim yo‘q. Avval «Ko‘chma davomat»da ruxsat bering.
                </p>
              ) : (
                employees.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setEmpId(e.id)}
                    className={cn(
                      "flex w-full flex-col rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                      empId === e.id
                        ? "bg-sky-500/15 font-medium text-sky-900 dark:text-sky-100"
                        : "hover:bg-muted",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate">{e.name}</span>
                      {e.hasSession ? (
                        <Badge
                          className={cn(
                            "shrink-0 rounded-md border-0 px-1.5 py-0 text-[9px] font-semibold",
                            e.sessionStatus === "open"
                              ? "bg-emerald-600 text-white"
                              : "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200",
                          )}
                        >
                          {e.sessionStatus === "open" ? "Ishda" : "GPS"}
                        </Badge>
                      ) : (
                        <span className="shrink-0 text-[10px] text-muted-foreground/70">—</span>
                      )}
                    </span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {e.position || "—"}
                      {e.location ? ` · ${displayBranchName(e.location)}` : ""}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {e.checkInAt
                        ? `${fmtTime(e.checkInAt)} – ${fmtTime(e.checkOutAt)}`
                        : e.hasSession
                          ? "bugun yo‘l bor"
                          : "GPS yo‘q"}
                      {e.tracking ? " · yo‘l yozilgan" : ""}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          {empId ? (
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Sessiya · {date}
              </div>
              <div className="max-h-44 space-y-1.5 overflow-y-auto">
                {empSessions.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
                    Shu kuni GPS yo‘q. Xodim Davomatda lokatsiyaga ruxsat bersa — yo‘nalish chiqadi.
                  </p>
                ) : (
                  empSessions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSessionId(s.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-xs transition-colors",
                        sessionId === s.id
                          ? "border-sky-500 bg-sky-500/10 shadow-sm"
                          : "border-border hover:bg-muted",
                      )}
                    >
                      <div>
                        <div className="font-semibold tabular-nums">
                          {fmtTime(s.startTime)} — {fmtTime(s.endTime)}
                        </div>
                        <div className="text-muted-foreground">
                          {s.durationMin != null ? formatRouteDuration(s.durationMin) : "ochiq"}
                        </div>
                      </div>
                      <Badge
                        className={cn(
                          "rounded-md border-0 text-[10px]",
                          s.status === "open"
                            ? "bg-emerald-600 text-white"
                            : "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
                        )}
                      >
                        {s.status === "open" ? "Ishda" : "Yopiq"}
                      </Badge>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : null}

          {selectedSession && points.length > 0 ? (
            <div className="rounded-xl border border-sky-200/80 bg-gradient-to-br from-sky-50/90 to-indigo-50/40 p-3 text-xs dark:border-sky-900 dark:from-sky-950/40 dark:to-indigo-950/30">
              <div className="font-semibold text-foreground">{selectedEmp?.name}</div>
              <div className="mt-2 space-y-1 text-muted-foreground">
                <div className="flex items-start gap-1.5">
                  <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[9px] font-bold text-white">
                    A
                  </span>
                  <div>
                    <div>Boshlanish: {fmtTime(selectedSession.startTime)}</div>
                    <div className="font-mono text-[10px] tabular-nums opacity-80">
                      {Number(selectedSession.startLatitude).toFixed(5)},{" "}
                      {Number(selectedSession.startLongitude).toFixed(5)}
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-1.5">
                  <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rose-600 text-[9px] font-bold text-white">
                    B
                  </span>
                  <div>
                    <div>Yakun: {fmtTime(selectedSession.endTime)}</div>
                    {selectedSession.endLatitude != null && selectedSession.endLongitude != null ? (
                      <div className="font-mono text-[10px] tabular-nums opacity-80">
                        {Number(selectedSession.endLatitude).toFixed(5)},{" "}
                        {Number(selectedSession.endLongitude).toFixed(5)}
                      </div>
                    ) : (
                      <div className="text-[10px] opacity-70">Hali yopilmagan</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 pt-1 font-semibold text-sky-800 dark:text-sky-200">
                  <Route className="h-3.5 w-3.5" />
                  A → B: {distanceLabel}
                  {selectedSession.durationMin != null
                    ? ` · ${formatRouteDuration(selectedSession.durationMin)}`
                    : ""}{" "}
                  · {points.length} nuqta
                </div>
              </div>
              <div className="mt-3 border-t border-sky-200/60 pt-3 dark:border-sky-900">
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Aniq joylar (xarita / Google)
                </p>
                <ExternalMapsLinks points={points} compact />
              </div>
            </div>
          ) : null}
        </aside>

        <section className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex flex-col gap-2 border-b border-border px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-semibold">{selectedEmp?.name || "Xarita"}</div>
              <p className="text-[11px] text-muted-foreground">
                {pins.length} ta dorixona nuqtada
                {pinsWithoutGps > 0 ? ` · ${pinsWithoutGps} tasida joylashuv yo‘q, qo‘yilmadi` : ""}
              </p>
            </div>
            {loadingMap ? <Loader2 className="h-4 w-4 animate-spin text-sky-600" /> : null}
          </div>
          <div className="relative overflow-hidden rounded-b-2xl">
            <MobileRouteMap
              points={points}
              places={places}
              focusPlaceId={focusPinId}
              focusToken={focusToken}
              onPlaceSelect={(p) => {
                const row =
                  p.id === OFFICE_MAP_PLACE.id
                    ? {
                        id: OFFICE_MAP_PLACE.id,
                        name: OFFICE_MAP_PLACE.name,
                        lat: OFFICE_MAP_PLACE.lat,
                        lng: OFFICE_MAP_PLACE.lng,
                        mudirName: "",
                        coordinatorName: "",
                        phone: "",
                        hours: OFFICE_MAP_PLACE.hours,
                      }
                    : pins.find((x) => x.id === p.id) || null;
                setSelectedPin(row);
                setFocusPinId(p.id);
              }}
              height="min(74vh, 720px)"
              className="min-h-[min(74vh,720px)] w-full"
              emptyHint={
                pins.length
                  ? ""
                  : !empId
                    ? "Chapdan ruxsat berilgan xodimni tanlang — A→B yo‘nalish chiqadi"
                    : !sessionId
                      ? "Shu kuni GPS sessiyasi yo‘q — xodim Davomatda Keldim bosganida chiqadi"
                      : "Bu sessiyada GPS nuqtalari hali yo‘q"
              }
            />
            {selectedPin ? (
              <div className={cn(
                "pointer-events-auto absolute bottom-4 left-1/2 z-[1000] w-[min(92%,380px)] -translate-x-1/2 rounded-2xl border bg-white/95 p-3 shadow-xl backdrop-blur dark:bg-slate-950/95",
                selectedPin.id < 0 ? "border-blue-300 dark:border-blue-800" : "border-teal-200 dark:border-teal-800",
              )}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className={cn(
                      "text-[10px] font-bold uppercase tracking-wide",
                      selectedPin.id < 0 ? "text-blue-700 dark:text-blue-300" : "text-teal-700 dark:text-teal-300",
                    )}>
                      {selectedPin.id < 0 ? "Asosiy ofis" : "Dorixona"}
                    </p>
                    <p className="text-base font-bold leading-tight">{selectedPin.name}</p>
                  </div>
                  <button
                    type="button"
                    className="rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                    onClick={() => setSelectedPin(null)}
                  >
                    Yopish
                  </button>
                </div>
                <dl className="mt-2 space-y-1 text-sm">
                  {selectedPin.id < 0 ? null : (
                    <>
                      <div className="flex gap-2">
                        <dt className="w-28 shrink-0 text-muted-foreground">Mudir</dt>
                        <dd className="font-medium">{selectedPin.mudirName}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-28 shrink-0 text-muted-foreground">Koordinator</dt>
                        <dd className="font-medium">{selectedPin.coordinatorName}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-28 shrink-0 text-muted-foreground">Dorixona raqami</dt>
                        <dd className="font-medium">{selectedPin.phone}</dd>
                      </div>
                    </>
                  )}
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-muted-foreground">Ish vaqti</dt>
                    <dd className="font-medium">{selectedPin.hours || "Belgilanmagan"}</dd>
                  </div>
                </dl>
                <PlaceNavLinks lat={selectedPin.lat} lng={selectedPin.lng} name={selectedPin.name} />
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
