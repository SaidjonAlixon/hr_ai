import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { canManageUsers } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  MobileRouteMap,
  routeDistanceMeters,
  type RoutePoint,
} from "@/components/davomat/MobileRouteMap";
import {
  fetchMobilePermissions,
  fetchMobileSessionDetail,
  fetchMobileSessions,
  type MobilePermissionRow,
} from "@/lib/mobile-attendance-api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Loader2,
  Navigation,
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
  const push = (lat: number, lng: number, kind: RoutePoint["kind"], time?: string | null, accuracy?: number | null) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    const key = `${kind}:${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (seen.has(key) && kind === "track") return;
    seen.add(key);
    pts.push({ lat, lng, kind, time: time || null, accuracy: accuracy ?? null });
  };

  // 1) sessiyadagi boshlanish
  push(Number(s.startLatitude), Number(s.startLongitude), "start", fmtTime(s.startTime), s.startAccuracy);

  // 2) barcha GPS nuqtalar (start/end ham bo‘lishi mumkin)
  const ordered = [...detail.points].sort(
    (a, b) =>
      a.sequenceNumber - b.sequenceNumber ||
      String(a.recordedAt || "").localeCompare(String(b.recordedAt || "")),
  );
  for (const p of ordered) {
    const kind: RoutePoint["kind"] =
      p.pointType === "start" ? "start" : p.pointType === "end" ? "end" : "track";
    if (kind === "start" || kind === "end") continue; // sessiyadan qo‘yamiz
    push(Number(p.latitude), Number(p.longitude), "track", fmtTime(p.recordedAt), p.accuracy);
  }

  // 3) tugash
  if (s.endLatitude != null && s.endLongitude != null) {
    push(Number(s.endLatitude), Number(s.endLongitude), "end", fmtTime(s.endTime), s.endAccuracy);
  } else {
    const lastTrack = [...pts].reverse().find((p) => p.kind === "track");
    if (lastTrack && s.status === "open") {
      // ochiq sessiya — oxirgi GPS ni "joriy" deb belgilamaymiz, faqat yo‘l
    } else if (lastTrack && pts.filter((p) => p.kind === "start").length) {
      push(lastTrack.lat, lastTrack.lng, "end", lastTrack.time, lastTrack.accuracy);
    }
  }

  // Agar faqat bitta start bo‘lsa ham — ko‘rsatamiz
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
  const [perms, setPerms] = useState<MobilePermissionRow[]>([]);
  const [empId, setEmpId] = useState<number | "">("");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [points, setPoints] = useState<RoutePoint[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMap, setLoadingMap] = useState(false);
  const [empQ, setEmpQ] = useState("");

  const employees = useMemo(() => {
    const map = new Map<number, { id: number; name: string; position: string | null }>();
    for (const p of perms) {
      if (!map.has(p.employeeId)) {
        map.set(p.employeeId, {
          id: p.employeeId,
          name: p.fullName || `Xodim #${p.employeeId}`,
          position: p.position ?? null,
        });
      }
    }
    for (const s of sessions) {
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
  }, [perms, sessions, empQ]);

  const selectedEmp = employees.find((e) => e.id === empId);
  const selectedSession = sessions.find((s) => s.id === sessionId);

  const loadBase = useCallback(async () => {
    setLoadingList(true);
    try {
      const [p, s] = await Promise.all([
        fetchMobilePermissions("active"),
        fetchMobileSessions({ from: date, to: date }),
      ]);
      setPerms(p.permissions);
      setSessions(s.sessions as SessionRow[]);
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
        setSessions((prev) => {
          const others = prev.filter((x) => x.employeeId !== Number(empId));
          return [...others, ...list];
        });
        const first = list[0];
        setSessionId(first?.id ?? null);
        if (!first) setPoints([]);
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
    const row = sessions.find((s) => s.id === sessionId);
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
  }, [sessionId, sessions, toast]);

  const empSessions = useMemo(
    () =>
      sessions
        .filter((s) => (empId ? s.employeeId === Number(empId) : true))
        .sort((a, b) => String(b.startTime || "").localeCompare(String(a.startTime || ""))),
    [sessions, empId],
  );

  const distanceM = points.length >= 2 ? routeDistanceMeters(points) : 0;
  const distanceLabel =
    distanceM < 1000 ? `${Math.round(distanceM)} m` : `${(distanceM / 1000).toFixed(2)} km`;

  if (!allowed) {
    return <div className="p-6 text-sm text-muted-foreground">Faqat admin uchun.</div>;
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1 h-8 rounded-lg px-2 text-muted-foreground">
            <Link href="/admin/kochma-davomat">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Ko‘chma davomat
            </Link>
          </Button>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
            <Navigation className="h-6 w-6 text-sky-600" />
            Yo‘nalish xaritasi
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Xodimni tanlang — qayerdan qayerga yurganini navigator kabi ko‘ring (A → B).
          </p>
        </div>
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

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Sidebar */}
        <Card className="overflow-hidden rounded-2xl border-border shadow-sm">
          <CardContent className="space-y-3 p-4">
            <div>
              <Label>Sana</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setSessionId(null);
                  setPoints([]);
                }}
                className="mt-1 rounded-xl"
              />
            </div>
            <div>
              <Label>Xodim qidirish</Label>
              <Input
                value={empQ}
                onChange={(e) => setEmpQ(e.target.value)}
                placeholder="Ism…"
                className="mt-1 rounded-xl"
              />
            </div>
            <div>
              <Label>Xodim</Label>
              <div className="mt-1 max-h-52 space-y-0.5 overflow-y-auto rounded-xl border border-border p-1">
                {employees.length === 0 ? (
                  <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                    Ruxsat berilgan xodim yo‘q
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
                          ? "bg-sky-500/15 text-sky-900 dark:text-sky-100"
                          : "hover:bg-muted",
                      )}
                    >
                      <span className="truncate font-medium">{e.name}</span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {e.position || "—"}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            {empId ? (
              <div>
                <Label>Sessiya ({date})</Label>
                <div className="mt-1 max-h-44 space-y-1 overflow-y-auto">
                  {empSessions.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                      Shu kuni sessiya yo‘q
                    </p>
                  ) : (
                    empSessions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSessionId(s.id)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors",
                          sessionId === s.id
                            ? "border-sky-500 bg-sky-500/10"
                            : "border-border hover:bg-muted",
                        )}
                      >
                        <div>
                          <div className="font-semibold tabular-nums">
                            {fmtTime(s.startTime)} — {fmtTime(s.endTime)}
                          </div>
                          <div className="text-muted-foreground">
                            {s.durationMin != null ? `${s.durationMin} daq` : "ochiq"}
                          </div>
                        </div>
                        <Badge
                          variant="secondary"
                          className={cn(
                            "rounded-md text-[10px]",
                            s.status === "open"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-100 text-slate-700",
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
              <div className="rounded-xl border border-sky-200/70 bg-sky-50/60 p-3 text-xs dark:border-sky-900 dark:bg-sky-950/30">
                <div className="font-semibold text-foreground">{selectedEmp?.name}</div>
                <div className="mt-1 space-y-0.5 text-muted-foreground">
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
                  <div className="flex items-center gap-1.5 pt-1 font-medium text-sky-800 dark:text-sky-200">
                    <Route className="h-3.5 w-3.5" />
                    Masofa: {distanceLabel} · {points.length} nuqta
                  </div>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Map — doim to‘liq ochiq */}
        <Card className="min-h-[min(72vh,680px)] overflow-hidden rounded-2xl border-border shadow-sm lg:min-h-0">
          <CardContent className="relative h-full min-h-[min(72vh,680px)] p-0">
            {loadingMap ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40">
                <Loader2 className="h-7 w-7 animate-spin text-sky-600" />
              </div>
            ) : null}
            <MobileRouteMap
              points={points}
              height="min(72vh, 680px)"
              className="h-full min-h-[min(72vh,680px)] w-full rounded-2xl"
              emptyHint={
                !empId
                  ? "Chapdan xodimni tanlang — yo‘nalish shu xaritada chiqadi"
                  : !sessionId
                    ? "Sessiya tanlang — A (boshlanish) va B (tugash) chiqadi"
                    : "Bu sessiyada GPS hali yo‘q"
              }
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
