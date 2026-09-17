import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { canManageUsers } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  MobileRouteMap,
  routeDistanceMeters,
  type RoutePoint,
} from "@/components/davomat/MobileRouteMap";
import { ExternalMapsLinks } from "@/components/davomat/ExternalMapsLinks";
import {
  fetchMobileLive,
  fetchMobileSessionDetail,
} from "@/lib/mobile-attendance-api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  History,
  Loader2,
  MapPinned,
  Radio,
  RefreshCw,
  Route,
  Signal,
} from "lucide-react";

type LiveRow = Awaited<ReturnType<typeof fetchMobileLive>>["live"][number];

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("uz-UZ", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Asia/Tashkent",
    });
  } catch {
    return iso;
  }
}

function buildLivePoints(detail: Awaited<ReturnType<typeof fetchMobileSessionDetail>>): RoutePoint[] {
  const s = detail.session;
  const pts: RoutePoint[] = [];
  pts.push({
    lat: Number(s.startLatitude),
    lng: Number(s.startLongitude),
    kind: "start",
    time: fmtTime(s.startTime),
    accuracy: s.startAccuracy,
  });
  const ordered = [...detail.points]
    .filter((p) => p.pointType !== "start" && p.pointType !== "end")
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  for (const p of ordered) {
    pts.push({
      lat: Number(p.latitude),
      lng: Number(p.longitude),
      kind: "track",
      time: fmtTime(p.recordedAt),
      accuracy: p.accuracy,
    });
  }
  return pts;
}

function rowKey(l: LiveRow): string {
  return l.sessionId != null ? `s:${l.sessionId}` : `e:${l.employeeId}`;
}

export default function AdminKochmaLivePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = canManageUsers(user?.role);

  const [liveList, setLiveList] = useState<LiveRow[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [points, setPoints] = useState<RoutePoint[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [polledAt, setPolledAt] = useState<string | null>(null);

  const selected = liveList.find((l) => rowKey(l) === selectedKey) || null;
  const selectedSessionId = selected?.sessionId ?? null;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return liveList;
    return liveList.filter(
      (l) =>
        String(l.fullName || "").toLowerCase().includes(needle) ||
        String(l.position || "").toLowerCase().includes(needle),
    );
  }, [liveList, q]);

  const refreshList = useCallback(async () => {
    try {
      const r = await fetchMobileLive();
      setLiveList(r.live);
      setOnlineCount(Number(r.onlineCount ?? r.live.filter((l) => l.presence === "online").length));
      setPolledAt(r.polledAt);
      setSelectedKey((prev) => {
        if (prev && r.live.some((l) => rowKey(l) === prev)) return prev;
        const firstOnline = r.live.find((l) => l.presence === "online" && l.sessionId != null);
        if (firstOnline) return rowKey(firstOnline);
        return r.live[0] ? rowKey(r.live[0]) : null;
      });
    } catch (e) {
      toast({ title: "Live", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!allowed) return;
    void refreshList();
    const t = window.setInterval(() => void refreshList(), 8_000);
    return () => window.clearInterval(t);
  }, [allowed, refreshList]);

  useEffect(() => {
    if (!selectedSessionId) {
      setPoints([]);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const d = await fetchMobileSessionDetail(selectedSessionId);
        if (!cancelled) setPoints(buildLivePoints(d));
      } catch {
        /* keep last */
      }
    };
    void tick();
    const t = window.setInterval(() => void tick(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [selectedSessionId]);

  const distanceM = points.length >= 2 ? routeDistanceMeters(points) : 0;
  const distanceLabel =
    distanceM < 1000 ? `${Math.round(distanceM)} m` : `${(distanceM / 1000).toFixed(2)} km`;

  if (!allowed) {
    return <div className="p-6 text-sm text-muted-foreground">Faqat admin uchun.</div>;
  }

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 pb-28">
      <header className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-4 bg-gradient-to-br from-emerald-50 via-card to-sky-50/40 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:from-emerald-950/40 dark:to-sky-950/20">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Button asChild variant="ghost" size="sm" className="-ml-2 h-8 rounded-lg px-2 text-muted-foreground">
                <Link href="/admin/kochma-davomat">
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  Orqaga
                </Link>
              </Button>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/70 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-800 dark:border-emerald-700 dark:text-emerald-200">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Real-vaqt
              </span>
            </div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
              <Radio className="h-6 w-6 text-emerald-600" />
              Jonli kuzatuv
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Davomatda lokatsiya ruxsati berilgan xodimlar — qayerdaligi va harakati real vaqtda.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm" className="h-9 rounded-xl">
              <Link href="/admin/kochma-xarita">
                <History className="mr-1.5 h-4 w-4" />
                Kunlik xarita
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-xl"
              onClick={() => void refreshList()}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground sm:px-6">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <Signal className="h-3.5 w-3.5 text-emerald-600" />
            {onlineCount} online · {liveList.length} jami
          </span>
          <span className="tabular-nums">
            Yangilandi: {polledAt ? fmtTime(polledAt) : "—"} · har 5–8 soniya
          </span>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <aside className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Qidirish
            </label>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ism…"
              className="mt-1.5 rounded-xl"
            />
          </div>

          <div className="min-h-0 flex-1">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Kuzatuvdagi xodimlar
            </div>
            <div className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-0.5">
              {filtered.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
                  {loading ? "Yuklanmoqda…" : "Hozir kuzatiladigan xodim yo‘q"}
                  <p className="mt-2 text-[11px]">
                    Ko‘chma ruxsat berilgan xodim Davomatda lokatsiyaga ruxsat bersa — bu yerda chiqadi.
                  </p>
                </div>
              ) : (
                filtered.map((l) => {
                  const key = rowKey(l);
                  const online = l.presence === "online";
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedKey(key)}
                      className={cn(
                        "w-full rounded-xl border px-3 py-2.5 text-left transition-all",
                        selectedKey === key
                          ? "border-emerald-500 bg-emerald-500/10 shadow-sm"
                          : "border-border hover:bg-muted/60",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-sm">
                            {l.fullName || `Xodim #${l.employeeId}`}
                          </div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {l.position || "—"}
                          </div>
                        </div>
                        <Badge
                          className={cn(
                            "shrink-0 rounded-md border-0 text-[10px] text-white",
                            online ? "bg-emerald-600" : "bg-slate-500",
                          )}
                        >
                          {online ? "ONLINE" : "OFFLINE"}
                        </Badge>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums text-muted-foreground">
                        {l.startTime ? <span>{fmtTime(l.startTime)} dan</span> : <span>GPS kutilmoqda</span>}
                        {l.sessionId != null ? (
                          <>
                            <span>{l.durationMin} daq</span>
                            <span>{l.pointCount} nuqta</span>
                          </>
                        ) : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {selected ? (
            <div
              className={cn(
                "rounded-xl border p-3 text-xs",
                selected.presence === "online"
                  ? "border-emerald-200/80 bg-gradient-to-br from-emerald-50/90 to-sky-50/50 dark:border-emerald-900 dark:from-emerald-950/40 dark:to-sky-950/30"
                  : "border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-950/40",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-foreground">{selected.fullName}</div>
                <Badge
                  className={cn(
                    "rounded-md border-0 text-[10px] text-white",
                    selected.presence === "online" ? "bg-emerald-600" : "bg-slate-500",
                  )}
                >
                  {selected.presence === "online" ? "Online" : "Offline"}
                </Badge>
              </div>
              <div className="mt-2 space-y-1 text-muted-foreground">
                <div className="flex justify-between gap-2">
                  <span>Boshlanish</span>
                  <span className="font-medium tabular-nums text-foreground">{fmtTime(selected.startTime)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Oxirgi GPS</span>
                  <span className="font-medium tabular-nums text-foreground">{fmtTime(selected.liveAt)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Masofa</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-sky-800 dark:text-sky-200">
                    <Route className="h-3.5 w-3.5" />
                    {distanceLabel} · {points.length} nuqta
                  </span>
                </div>
                {selected.liveLatitude != null && selected.liveLongitude != null ? (
                  <div className="pt-1 font-mono text-[10px] text-foreground/80">
                    {selected.liveLatitude.toFixed(5)}, {selected.liveLongitude.toFixed(5)}
                  </div>
                ) : (
                  <p className="pt-1 text-[11px] text-amber-700 dark:text-amber-300">
                    Lokatsiya o‘chirilgan yoki hali GPS yo‘q — offline
                  </p>
                )}
              </div>
              {points.length > 0 ? (
                <div className="mt-3 border-t border-border/60 pt-3">
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Aniq joylar
                  </p>
                  <ExternalMapsLinks points={points} compact />
                </div>
              ) : null}
            </div>
          ) : null}
        </aside>

        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <MapPinned className="h-4 w-4 text-emerald-600" />
              {selected?.fullName || "Xarita"}
            </div>
            {selected?.presence === "online" ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                Jonli yangilanmoqda
              </span>
            ) : selected ? (
              <span className="text-[11px] font-semibold text-slate-500">Offline</span>
            ) : null}
          </div>
          <MobileRouteMap
            points={points}
            height="min(74vh, 720px)"
            liveMode={selected?.presence === "online"}
            followLive={selected?.presence === "online"}
            className="min-h-[min(74vh,720px)] w-full"
            emptyHint={
              liveList.length === 0
                ? "Xodim Davomat sahifasida lokatsiyaga ruxsat bersa — joyi shu yerda chiqadi"
                : selectedSessionId == null
                  ? "Bu xodim hali GPS bermagan yoki lokatsiya o‘chirilgan (offline)"
                  : "Chapdan xodimni tanlang — joriy joy pulsatsiya bilan chiqadi"
            }
          />
        </section>
      </div>
    </div>
  );
}
