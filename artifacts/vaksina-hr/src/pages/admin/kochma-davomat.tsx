import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { canManageUsers } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { MobileRouteMap, type RoutePoint } from "@/components/davomat/MobileRouteMap";
import {
  fetchMobileDashboard,
  fetchMobileEmployees,
  fetchMobilePermissions,
  fetchMobileSessionDetail,
  fetchMobileSettings,
  grantMobilePermission,
  patchMobilePermission,
  revokeMobilePermission,
  saveMobileSettings,
  type MobilePermissionRow,
  type MobileSettings,
} from "@/lib/mobile-attendance-api";
import {
  Loader2,
  MapPinned,
  Plus,
  RefreshCw,
  Route,
  Settings2,
  ShieldAlert,
  UserPlus,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

const WEEKDAYS = [
  { n: 1, l: "Du" },
  { n: 2, l: "Se" },
  { n: 3, l: "Ch" },
  { n: 4, l: "Pa" },
  { n: 5, l: "Ju" },
  { n: 6, l: "Sh" },
  { n: 7, l: "Ya" },
];

const PERM_LABEL: Record<string, string> = {
  permanent: "Doimiy",
  temporary: "Vaqtinchalik",
  weekdays: "Kunlik",
  shift: "Smena",
};

function Kpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent: "sky" | "emerald" | "slate" | "amber" | "rose";
}) {
  const accents = {
    sky: "border-sky-200/80 bg-gradient-to-br from-sky-50 to-white text-sky-900 dark:border-sky-800/50 dark:from-sky-950/40 dark:to-card dark:text-sky-100",
    emerald:
      "border-emerald-200/80 bg-gradient-to-br from-emerald-50 to-white text-emerald-900 dark:border-emerald-800/50 dark:from-emerald-950/40 dark:to-card dark:text-emerald-100",
    slate:
      "border-border bg-gradient-to-br from-muted/40 to-card text-foreground",
    amber:
      "border-amber-200/80 bg-gradient-to-br from-amber-50 to-white text-amber-950 dark:border-amber-800/50 dark:from-amber-950/40 dark:to-card dark:text-amber-100",
    rose: "border-rose-200/80 bg-gradient-to-br from-rose-50 to-white text-rose-950 dark:border-rose-800/50 dark:from-rose-950/40 dark:to-card dark:text-rose-100",
  };
  const bar = {
    sky: "bg-sky-500",
    emerald: "bg-emerald-500",
    slate: "bg-slate-400",
    amber: "bg-amber-500",
    rose: "bg-rose-500",
  };
  return (
    <div className={cn("relative overflow-hidden rounded-2xl border p-3.5 shadow-sm", accents[accent])}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      <span className={cn("absolute inset-x-0 bottom-0 h-0.5", bar[accent])} aria-hidden />
    </div>
  );
}

export default function AdminKochmaDavomatPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = canManageUsers(user?.role);

  const [loading, setLoading] = useState(true);
  const [dash, setDash] = useState<Awaited<ReturnType<typeof fetchMobileDashboard>> | null>(null);
  const [perms, setPerms] = useState<MobilePermissionRow[]>([]);
  const [settings, setSettings] = useState<MobileSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapPoints, setMapPoints] = useState<RoutePoint[]>([]);
  const [mapTitle, setMapTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const [empQ, setEmpQ] = useState("");
  const [staffGroup, setStaffGroup] = useState<"pharmacy" | "office" | "">("");
  const [empOptions, setEmpOptions] = useState<
    Array<{ id: number; fullName: string; position: string | null; location: string | null }>
  >([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [permType, setPermType] = useState("permanent");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [shiftKey, setShiftKey] = useState<string>("");
  const [note, setNote] = useState("");
  const [routeOn, setRouteOn] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [d, p, s] = await Promise.all([
        fetchMobileDashboard(),
        fetchMobilePermissions("active"),
        fetchMobileSettings(),
      ]);
      setDash(d);
      setPerms(p.permissions);
      setSettings(s.settings);
      setRouteOn(s.settings.routeTrackingDefault);
    } catch (e) {
      toast({
        title: "Yuklanmadi",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (allowed) void reload();
  }, [allowed, reload]);

  useEffect(() => {
    if (!grantOpen) return;
    if (!staffGroup) {
      setEmpOptions([]);
      return;
    }
    const t = window.setTimeout(() => {
      void fetchMobileEmployees(empQ, staffGroup).then((r) => setEmpOptions(r.employees));
    }, 200);
    return () => window.clearTimeout(t);
  }, [grantOpen, empQ, staffGroup]);

  const openMap = async (sessionId: number, name: string) => {
    try {
      const d = await fetchMobileSessionDetail(sessionId);
      const pts: RoutePoint[] = d.points.map((p) => ({
        lat: p.latitude,
        lng: p.longitude,
        kind: p.pointType === "start" ? "start" : p.pointType === "end" ? "end" : "track",
        time: p.recordedAt,
        accuracy: p.accuracy,
      }));
      if (!pts.length && d.session.startLatitude != null) {
        pts.push({
          lat: d.session.startLatitude,
          lng: d.session.startLongitude,
          kind: "start",
          time: d.session.startTime,
          accuracy: d.session.startAccuracy,
        });
        if (d.session.endLatitude != null && d.session.endLongitude != null) {
          pts.push({
            lat: d.session.endLatitude,
            lng: d.session.endLongitude,
            kind: "end",
            time: d.session.endTime,
            accuracy: d.session.endAccuracy,
          });
        }
      }
      setMapPoints(pts);
      setMapTitle(name);
      setMapOpen(true);
    } catch (e) {
      toast({ title: "Xarita", description: (e as Error).message, variant: "destructive" });
    }
  };

  const onGrant = async () => {
    if (!selectedIds.length) {
      toast({ title: "Xodim tanlang", variant: "destructive" });
      return;
    }
    if (selectedIds.length > 1) {
      const ok = window.confirm(
        `${selectedIds.length} ta xodimga ko‘chma davomat ruxsati beriladi. Tasdiqlaysizmi?`,
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      await grantMobilePermission({
        employeeIds: selectedIds,
        permissionType: permType,
        startDate: startDate || null,
        endDate: endDate || null,
        weekdays: permType === "weekdays" ? weekdays : null,
        shiftKey: permType === "shift" ? shiftKey || null : null,
        note: note || null,
        routeTrackingEnabled: routeOn,
      });
      toast({ title: "Ruxsat berildi", description: `${selectedIds.length} xodim` });
      setGrantOpen(false);
      setSelectedIds([]);
      await reload();
    } catch (e) {
      toast({ title: "Xato", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const toggleEmp = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleModule = async (enabled: boolean) => {
    if (!settings) return;
    try {
      const r = await saveMobileSettings({ ...settings, enabled });
      setSettings(r.settings);
      setDash((d) => (d ? { ...d, settingsEnabled: enabled } : d));
      toast({ title: enabled ? "Modul yoqildi" : "Modul o‘chirildi" });
    } catch (e) {
      toast({ title: "Xato", description: (e as Error).message, variant: "destructive" });
    }
  };

  if (!allowed) {
    return <div className="p-6 text-sm text-muted-foreground">Faqat admin uchun.</div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-24">
      {/* Hero */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-4 border-b border-border bg-gradient-to-br from-sky-50/80 via-card to-card px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:from-sky-950/30">
          <div className="min-w-0">
            <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-sky-200/70 bg-sky-100/60 px-2.5 py-0.5 text-[11px] font-semibold text-sky-800 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-500" aria-hidden />
              Admin · GPS
            </div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              <MapPinned className="h-6 w-6 text-sky-600 dark:text-sky-400" />
              Ko‘chma davomat
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Faqat siz belgilagan xodimlar — filial geofencesiz davomat. Jonli kuzatuv alohida
              (barcha xodimlar).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-xl"
              onClick={() => void reload()}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
            <Button asChild variant="outline" size="sm" className="h-9 rounded-xl">
              <Link href="/admin/kochma-xarita">
                <Route className="mr-1.5 h-4 w-4" />
                Xarita
              </Link>
            </Button>
            <Button asChild size="sm" className="h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700">
              <Link href="/admin/kochma-live">
                <MapPinned className="mr-1.5 h-4 w-4" />
                Jonli
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-xl"
              onClick={() => {
                void (async () => {
                  try {
                    const s = await fetchMobileSettings();
                    setSettings(s.settings);
                  } catch (e) {
                    toast({
                      title: "Sozlamalar",
                      description: (e as Error).message,
                      variant: "destructive",
                    });
                  }
                  setSettingsOpen(true);
                })();
              }}
            >
              <Settings2 className="mr-1.5 h-4 w-4" />
              Sozlamalar
            </Button>
            <Button
              size="sm"
              className="h-9 rounded-xl"
              onClick={() => {
                setStaffGroup("");
                setSelectedIds([]);
                setEmpQ("");
                setEmpOptions([]);
                setGrantOpen(true);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Ruxsat berish
            </Button>
          </div>
        </div>

        {/* Module status strip */}
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6",
            dash?.settingsEnabled
              ? "bg-emerald-50/80 dark:bg-emerald-950/25"
              : "bg-rose-50/80 dark:bg-rose-950/25",
          )}
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              Modul: {dash?.settingsEnabled ? "Yoqilgan" : "O‘chirilgan"}
            </p>
            <p className="text-xs text-muted-foreground">
              {dash?.settingsEnabled
                ? "Ruxsat berilgan xodimlar ko‘chma davomatdan foydalana oladi"
                : "Barcha ko‘chma davomat boshlashlari bloklangan"}
            </p>
          </div>
          <Switch
            checked={Boolean(dash?.settingsEnabled)}
            onCheckedChange={(v) => void toggleModule(v)}
          />
        </div>
      </section>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        <Kpi label="Ruxsat berilgan" value={dash?.totalPermissions ?? "—"} accent="sky" />
        <Kpi label="Bugun faol" value={dash?.activeOpenToday ?? "—"} accent="emerald" />
        <Kpi label="Bugun boshlangan" value={dash?.startedToday ?? "—"} accent="slate" />
        <Kpi label="Bugun yopilgan" value={dash?.closedToday ?? "—"} accent="slate" />
        <Kpi label="Hozir ishda" value={dash?.workingNow ?? "—"} accent="emerald" />
        <Kpi label="Shubhali" value={dash?.suspiciousToday ?? "—"} accent="amber" />
        <Kpi label="Security event" value={dash?.securityEventsToday ?? "—"} accent="rose" />
        <Kpi
          label="Bugungi sana"
          value={dash?.today ? dash.today.slice(5).replace("-", ".") : "—"}
          accent="sky"
        />
      </div>

      {/* Permissions */}
      <Card className="overflow-hidden rounded-2xl border-border shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 border-b border-border bg-muted/30 px-4 py-3.5 sm:px-5">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Users className="h-4 w-4 text-sky-600" />
            Ruxsatlar
            {perms.length > 0 ? (
              <Badge variant="secondary" className="ml-1 rounded-full font-normal">
                {perms.length}
              </Badge>
            ) : null}
          </CardTitle>
          <Button size="sm" variant="ghost" className="h-8 rounded-lg text-xs" onClick={() => setGrantOpen(true)}>
            <UserPlus className="mr-1 h-3.5 w-3.5" />
            Qo‘shish
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            </div>
          ) : perms.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-14 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-50 text-sky-600 ring-1 ring-sky-100 dark:bg-sky-950/40 dark:ring-sky-900">
                <MapPinned className="h-7 w-7" />
              </div>
              <p className="text-base font-semibold text-foreground">Hali ruxsat berilmagan</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Xodimni tanlab «Ruxsat berish» orqali ko‘chma davomatni yoqing.
              </p>
              <Button className="mt-5 rounded-xl" onClick={() => setGrantOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Birinchi ruxsat
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/20 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 sm:px-5">Xodim</th>
                    <th className="px-3 py-3">Ruxsat</th>
                    <th className="px-3 py-3">Tracking</th>
                    <th className="px-3 py-3">Bugun</th>
                    <th className="px-4 py-3 sm:px-5">Amallar</th>
                  </tr>
                </thead>
                <tbody>
                  {perms.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-border/70 transition-colors last:border-0 hover:bg-muted/25"
                    >
                      <td className="px-4 py-3.5 sm:px-5">
                        <div className="font-medium text-foreground">{p.fullName}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {p.position || "—"}
                          {p.location ? ` · ${p.location}` : ""}
                        </div>
                        {p.note ? (
                          <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground/80">
                            {p.note}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3.5">
                        <Badge
                          variant="secondary"
                          className="rounded-md bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200"
                        >
                          {PERM_LABEL[p.permissionType] || p.permissionType}
                        </Badge>
                        {p.startDate || p.endDate ? (
                          <div className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                            {p.startDate || "…"} — {p.endDate || "…"}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={p.routeTrackingEnabled}
                            onCheckedChange={(v) => {
                              void patchMobilePermission(p.id, { routeTrackingEnabled: v }).then(
                                reload,
                              );
                            }}
                          />
                          <span className="text-xs text-muted-foreground">
                            {p.routeTrackingEnabled ? "ON" : "OFF"}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3.5">
                        {p.todaySession ? (
                          <div className="space-y-1">
                            <Badge
                              className={cn(
                                "rounded-md border-0 text-[10px] font-semibold",
                                p.todaySession.status === "open"
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
                                  : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
                              )}
                            >
                              {p.todaySession.status === "open" ? "Ishda" : "Yakunlangan"}
                            </Badge>
                            {p.todaySession.securityStatus === "suspicious" ? (
                              <div className="flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                                <ShieldAlert className="h-3 w-3" /> Shubhali
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 sm:px-5">
                        <div className="flex flex-wrap gap-1.5">
                          {p.todaySession ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 rounded-lg"
                              onClick={() => void openMap(p.todaySession!.id, p.fullName || "Xodim")}
                            >
                              <Route className="mr-1 h-3.5 w-3.5" />
                              Xarita
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 rounded-lg text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40"
                            onClick={() => {
                              if (!window.confirm("Ruxsatni bekor qilasizmi?")) return;
                              void revokeMobilePermission(p.id).then(reload);
                            }}
                          >
                            Bekor
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="px-1 text-xs text-muted-foreground">
        Xodim alohida sahifa ko‘rmaydi — ruxsat berilgach asosiy{" "}
        <Link href="/davomat-face" className="font-medium text-sky-600 underline-offset-2 hover:underline">
          Davomat
        </Link>{" "}
        da yashil zonadan tashqarida ham ishlaydi; GPS avtomatik yoziladi.
      </p>

      {/* Grant */}
      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Ko‘chma davomatga ruxsat</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Bo‘lim</Label>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors",
                    staffGroup === "pharmacy"
                      ? "border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                      : "border-border bg-card text-muted-foreground hover:bg-muted",
                  )}
                  onClick={() => {
                    setStaffGroup("pharmacy");
                    setSelectedIds([]);
                    setEmpQ("");
                  }}
                >
                  Dorixona
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors",
                    staffGroup === "office"
                      ? "border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                      : "border-border bg-card text-muted-foreground hover:bg-muted",
                  )}
                  onClick={() => {
                    setStaffGroup("office");
                    setSelectedIds([]);
                    setEmpQ("");
                  }}
                >
                  Ofis
                </button>
              </div>
            </div>

            {!staffGroup ? (
              <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                Avval Dorixona yoki Ofisni tanlang — keyin xodimlar chiqadi.
              </p>
            ) : (
              <div>
                <Label>Xodim qidirish ({staffGroup === "pharmacy" ? "Dorixona" : "Ofis"})</Label>
                <Input
                  value={empQ}
                  onChange={(e) => setEmpQ(e.target.value)}
                  placeholder="Ism…"
                  className="mt-1 rounded-xl"
                />
                <div className="mt-2 max-h-48 space-y-0.5 overflow-y-auto rounded-xl border border-border p-1.5">
                  {empOptions.length === 0 ? (
                    <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                      Xodim topilmadi
                    </p>
                  ) : (
                    empOptions.map((e) => (
                      <label
                        key={e.id}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
                      >
                        <Checkbox
                          checked={selectedIds.includes(e.id)}
                          onCheckedChange={() => toggleEmp(e.id)}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {e.fullName}
                          <span className="text-muted-foreground"> · {e.position || "—"}</span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
                {selectedIds.length > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">{selectedIds.length} tanlandi</p>
                ) : null}
              </div>
            )}
            <div>
              <Label>Amal qilish turi</Label>
              <Select value={permType} onValueChange={setPermType}>
                <SelectTrigger className="mt-1 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="permanent">Doimiy</SelectItem>
                  <SelectItem value="temporary">Vaqtinchalik (sana)</SelectItem>
                  <SelectItem value="weekdays">Ma’lum kunlar</SelectItem>
                  <SelectItem value="shift">Ma’lum smena</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {permType === "temporary" ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Boshlanish</Label>
                  <Input
                    type="date"
                    className="mt-1 rounded-xl"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Tugash</Label>
                  <Input
                    type="date"
                    className="mt-1 rounded-xl"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
            ) : null}
            {permType === "weekdays" ? (
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((d) => (
                  <label key={d.n} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={weekdays.includes(d.n)}
                      onCheckedChange={(v) =>
                        setWeekdays((prev) =>
                          v ? [...prev, d.n] : prev.filter((x) => x !== d.n),
                        )
                      }
                    />
                    {d.l}
                  </label>
                ))}
              </div>
            ) : null}
            {permType === "shift" ? (
              <Select value={shiftKey || "one"} onValueChange={setShiftKey}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Smena" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="one">1-smena</SelectItem>
                  <SelectItem value="two">2-smena</SelectItem>
                  <SelectItem value="three">3-smena</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
            <div>
              <Label>Izoh</Label>
              <Textarea
                className="mt-1 rounded-xl"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Mijozlar bilan tashqi ish"
              />
            </div>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 text-sm">
              <span>Ish vaqtida GPS yo‘nalishini qayd etish</span>
              <Switch checked={routeOn} onCheckedChange={setRouteOn} />
            </label>
            {routeOn ? (
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                Yo‘nalish faqat brauzer/sahifa ochiq bo‘lganda ishlaydi — 100% background tracking
                kafolatlanmaydi.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setGrantOpen(false)}>
              Bekor
            </Button>
            <Button className="rounded-xl" disabled={busy} onClick={() => void onGrant()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Saqlash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Ko‘chma davomat sozlamalari</DialogTitle>
          </DialogHeader>
          {settings ? (
            <div className="space-y-3 text-sm">
              {(
                [
                  ["enabled", "Modul yoqilgan"],
                  ["requireGps", "GPS majburiy"],
                  ["routeTrackingDefault", "Tracking default"],
                  ["detectSuspicious", "Shubhali harakat aniqlash"],
                  ["createSecurityEvents", "Security event yaratish"],
                ] as const
              ).map(([k, label]) => (
                <label
                  key={k}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2"
                >
                  <span>{label}</span>
                  <Switch
                    checked={Boolean(settings[k])}
                    onCheckedChange={(v) => setSettings({ ...settings, [k]: v })}
                  />
                </label>
              ))}
              <div>
                <Label>GPS interval (daq)</Label>
                <Select
                  value={String(settings.gpsIntervalMin)}
                  onValueChange={(v) => setSettings({ ...settings, gpsIntervalMin: Number(v) })}
                >
                  <SelectTrigger className="mt-1 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 5, 10, 15, 30].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} daqiqa
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Maks. GPS accuracy</Label>
                <Select
                  value={String(settings.maxAccuracyMeters)}
                  onValueChange={(v) =>
                    setSettings({ ...settings, maxAccuracyMeters: Number(v) })
                  }
                >
                  <SelectTrigger className="mt-1 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} m
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">Sozlamalar yuklanmoqda…</p>
          )}
          <DialogFooter>
            <Button
              className="rounded-xl"
              disabled={!settings}
              onClick={() => {
                if (!settings) return;
                void saveMobileSettings(settings)
                  .then(() => {
                    toast({ title: "Sozlamalar saqlandi" });
                    setSettingsOpen(false);
                    void reload();
                  })
                  .catch((e) =>
                    toast({
                      title: "Xato",
                      description: (e as Error).message,
                      variant: "destructive",
                    }),
                  );
              }}
            >
              Saqlash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Map */}
      <Dialog open={mapOpen} onOpenChange={setMapOpen}>
        <DialogContent className="max-w-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle>Xarita — {mapTitle}</DialogTitle>
          </DialogHeader>
          <MobileRouteMap points={mapPoints} height={380} />
          <p className="text-[11px] text-muted-foreground">
            🟢 Boshlanish · ⚪ GPS nuqtalar · 🔴 Yakun. Yo‘l faqat haqiqiy GPS nuqtalardan.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
