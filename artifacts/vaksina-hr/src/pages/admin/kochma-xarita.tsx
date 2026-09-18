import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { canManageUsers } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  MobileRouteMap,
  formatRouteDistance,
  formatRouteDuration,
  routeDistanceMeters,
  type RoutePoint,
} from "@/components/davomat/MobileRouteMap";
import { ExternalMapsLinks } from "@/components/davomat/ExternalMapsLinks";
import {
  fetchMobileSessionDetail,
  fetchMobileSessions,
} from "@/lib/mobile-attendance-api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Loader2,
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
  const allowed = canManageUsers(user?.role);

  const [date, setDate] = useState(todayYmdLocal);
  const [empId, setEmpId] = useState<number | "">("");
  const [daySessions, setDaySessions] = useState<SessionRow[]>([]);
  const [empSessions, setEmpSessions] = useState<SessionRow[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [points, setPoints] = useState<RoutePoint[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMap, setLoadingMap] = useState(false);
  const [empQ, setEmpQ] = useState("");

  const employees = useMemo(() => {
    const map = new Map<number, { id: number; name: string; position: string | null }>();
    for (const s of daySessions) {
      if (!map.has(s.employeeId)) {
        map.set(s.employeeId, {
          id: s.employeeId,
          name: s.fullName || `Xodim #${s.employeeId}`,
          position: s.position ?? null,
        });
      }
    }
    const q = empQ.trim().toLowerCase();
    return [...map.values()]
      .filter((e) => !q || e.name.toLowerCase().includes(q) || String(e.position || "").toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, "uz"));
  }, [daySessions, empQ]);

  const selectedEmp = employees.find((e) => e.id === empId);
  const selectedSession = empSessions.find((s) => s.id === sessionId) || daySessions.find((s) => s.id === sessionId);

  const loadBase = useCallback(async () => {
    setLoadingList(true);
    try {
      const s = await fetchMobileSessions({ from: date, to: date });
      setDaySessions(s.sessions as SessionRow[]);
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
  }, [empId, date, toast]);

  useEffect(() => {
    if (!sessionId) {
      setPoints([]);
      return;
    }
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
  }, [sessionId, empSessions, daySessions, toast]);

  const distanceM = points.length >= 2 ? routeDistanceMeters(points) : 0;
  const distanceLabel = formatRouteDistance(distanceM);

  if (!allowed) {
    return <div className="p-6 text-sm text-muted-foreground">Faqat admin uchun.</div>;
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
              Yo‘nalish xaritasi
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Tanlangan kun va xodimning GPS yo‘li — boshlanish (A) dan tugash (B) gacha.
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
              Xodim qidirish
            </label>
            <Input
              value={empQ}
              onChange={(e) => setEmpQ(e.target.value)}
              placeholder="Ism…"
              className="mt-1.5 rounded-xl"
            />
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Xodim
            </div>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border p-1">
              {employees.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">Ruxsat berilgan xodim yo‘q</p>
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
                    <span className="truncate">{e.name}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{e.position || "—"}</span>
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
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-[9px] font-bold text-white">
                    A
                  </span>
                  Boshlanish: {fmtTime(selectedSession.startTime)}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-[9px] font-bold text-white">
                    B
                  </span>
                  Yakun: {fmtTime(selectedSession.endTime)}
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
                  Aniq joylar
                </p>
                <ExternalMapsLinks points={points} compact />
              </div>
            </div>
          ) : null}
        </aside>

        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className="text-sm font-semibold">{selectedEmp?.name || "Xarita"}</div>
            {loadingMap ? <Loader2 className="h-4 w-4 animate-spin text-sky-600" /> : null}
          </div>
          <MobileRouteMap
            points={points}
            height="min(74vh, 720px)"
            className="min-h-[min(74vh,720px)] w-full"
            emptyHint={
              !empId
                ? "Chapdan xodimni tanlang — A→B yo‘nalish chiqadi"
                : !sessionId
                  ? "Sessiya tanlang yoki shu kuni GPS yo‘q"
                  : "Bu sessiyada GPS hali yo‘q"
            }
          />
        </section>
      </div>
    </div>
  );
}
