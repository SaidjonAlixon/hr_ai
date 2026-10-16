import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { canManageKochmaAdmin, canViewKochmaAdmin } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  approveDevice,
  blockDevice,
  fetchDeviceDetail,
  fetchDeviceSettings,
  fetchDevices,
  fetchDeviceSummary,
  fetchEnforceUsers,
  fetchLoginHistory,
  fetchSecurityEvents,
  rejectDevice,
  revokeAllUserSessions,
  revokeDeviceSessions,
  saveDeviceSettings,
  setPrimaryDevice,
  setUserEnforce,
  unblockDevice,
  type DeviceRow,
  type DeviceSettings,
} from "@/lib/device-security-api";
import {
  Ban,
  Building2,
  CheckCircle2,
  Clock3,
  KeyRound,
  Loader2,
  LogOut,
  Monitor,
  MonitorSmartphone,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Star,
  Store,
  Tablet,
  Users,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

function fmt(v: string | null | undefined) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("uz-UZ", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function statusMeta(status: string) {
  if (status === "active")
    return {
      label: "Hozir onlayn",
      hint: "Xodim hozir shu qurilmadan tizimda",
      className: "bg-emerald-500/12 text-emerald-800 ring-1 ring-emerald-500/25 dark:text-emerald-300",
      dot: "bg-emerald-500",
    };
  if (status === "pending")
    return {
      label: "Tasdiq kutilmoqda",
      hint: "Admin ruxsati bo‘lmaguncha kirish ochilmaydi",
      className: "bg-amber-500/12 text-amber-900 ring-1 ring-amber-500/25 dark:text-amber-300",
      dot: "bg-amber-500",
    };
  if (status === "blocked")
    return {
      label: "Bloklangan",
      hint: "Bu qurilmadan kirish taqiqlangan",
      className: "bg-rose-500/12 text-rose-800 ring-1 ring-rose-500/25 dark:text-rose-300",
      dot: "bg-rose-500",
    };
  if (status === "inactive")
    return {
      label: "Offline",
      hint: "Tasdiqlangan, lekin hozir ochiq session yo‘q",
      className: "bg-sky-500/12 text-sky-900 ring-1 ring-sky-500/25 dark:text-sky-300",
      dot: "bg-sky-500",
    };
  return {
    label: "Noma’lum",
    hint: "",
    className: "bg-muted text-muted-foreground ring-1 ring-border",
    dot: "bg-muted-foreground",
  };
}

function StatusBadge({ status, compact }: { status: string; compact?: boolean }) {
  const m = statusMeta(status);
  return (
    <span
      title={m.hint}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
        m.className,
        compact && "px-2 py-0.5",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

function deviceKind(type?: string | null) {
  const t = String(type || "").toLowerCase();
  if (t === "mobile") return { label: "Telefon", Icon: Smartphone };
  if (t === "tablet") return { label: "Planshet", Icon: Tablet };
  if (t === "desktop") return { label: "Kompyuter", Icon: Monitor };
  return { label: "Qurilma", Icon: MonitorSmartphone };
}

function displayOsBrowser(os?: string | null, browser?: string | null) {
  const o = (os || "").trim();
  const b = (browser || "").trim();
  if (!o && !b) return "Aniqlanmagan";
  if (!o) return b;
  if (!b) return o;
  return `${o} · ${b}`;
}

export default function AdminQurilmalarPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = canViewKochmaAdmin(user?.role);
  const canEdit = canManageKochmaAdmin(user?.role);

  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [pendingDevices, setPendingDevices] = useState<DeviceRow[]>([]);
  const [summary, setSummary] = useState({
    total: 0,
    active: 0,
    pending: 0,
    blocked: 0,
    suspicious: 0,
  });
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{
    device: DeviceRow;
    user: Record<string, unknown>;
    sessions: Array<Record<string, unknown>>;
  } | null>(null);
  const [settings, setSettings] = useState<DeviceSettings | null>(null);
  const [enforceUsers, setEnforceUsers] = useState<
    Array<{
      id: number;
      fullName: string;
      login: string;
      role: string;
      enforced: boolean;
      staffGroup: string;
      departmentName: string | null;
    }>
  >([]);
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const [busy, setBusy] = useState(false);
  const [showOffice, setShowOffice] = useState(true);
  const [showPharmacy, setShowPharmacy] = useState(true);
  const [enforceQ, setEnforceQ] = useState("");
  const [enforceStatus, setEnforceStatus] = useState<"all" | "on" | "off">("all");

  const filteredEnforceUsers = useMemo(() => {
    const qn = enforceQ.trim().toLowerCase();
    return enforceUsers.filter((u) => {
      const g = String(u.staffGroup || "").toLowerCase();
      if (!showOffice && g === "office") return false;
      if (!showPharmacy && g === "pharmacy") return false;
      if (!showOffice && !showPharmacy) return false;
      if (enforceStatus === "on" && !u.enforced) return false;
      if (enforceStatus === "off" && u.enforced) return false;
      if (!qn) return true;
      const hay = [u.fullName, u.login, u.role, u.departmentName, u.staffGroup]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(qn);
    });
  }, [enforceUsers, showOffice, showPharmacy, enforceQ, enforceStatus]);

  const enforceCounts = useMemo(() => {
    const office = enforceUsers.filter((u) => u.staffGroup === "office");
    const pharmacy = enforceUsers.filter((u) => u.staffGroup === "pharmacy");
    return {
      office: office.length,
      pharmacy: pharmacy.length,
      officeOn: office.filter((u) => u.enforced).length,
      pharmacyOn: pharmacy.filter((u) => u.enforced).length,
      filteredOn: filteredEnforceUsers.filter((u) => u.enforced).length,
    };
  }, [enforceUsers, filteredEnforceUsers]);

  const pendingRequests = pendingDevices;

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const [sum, list, pendingList, st, users, hist, ev] = await Promise.all([
        fetchDeviceSummary(),
        fetchDevices({ q: q.trim() || undefined, status }),
        fetchDevices({ status: "pending" }),
        fetchDeviceSettings(),
        fetchEnforceUsers(),
        fetchLoginHistory(),
        fetchSecurityEvents(),
      ]);
      setSummary(sum);
      setDevices(list.devices);
      setPendingDevices(pendingList.devices);
      setSettings(st);
      setEnforceUsers(users.users);
      setLogs(hist.logs);
      setEvents(ev.events);
    } catch (err) {
      toast({
        title: "Yuklanmadi",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [allowed, q, status, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (id: number) => {
    setDetailId(id);
    setDetail(null);
    try {
      const d = await fetchDeviceDetail(id);
      setDetail(d as typeof detail);
    } catch (err) {
      toast({ title: "Xato", description: (err as Error).message, variant: "destructive" });
    }
  };

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    if (!canEdit) {
      toast({ title: "Faqat admin o‘zgartira oladi", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await fn();
      toast({ title: okMsg });
      await load();
      if (detailId) await openDetail(detailId);
    } catch (err) {
      toast({ title: "Xato", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (!allowed) {
    return <div className="py-16 text-center text-muted-foreground">Ruxsat yo‘q</div>;
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 pb-10">
      <header className="relative overflow-hidden rounded-2xl border border-[#1e3a8a]/15 bg-gradient-to-br from-[#0f274f] via-[#1e3a8a] to-[#2d4a8a] px-5 py-6 text-white shadow-lg sm:px-7">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute bottom-0 left-1/3 h-24 w-48 rounded-full bg-sky-300/20 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium ring-1 ring-white/15">
              <Shield className="h-3.5 w-3.5" />
              Qurilma xavfsizligi
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Qurilmalar</h1>
            <p className="mt-2 text-sm leading-relaxed text-white/80">
              Xodim qaysi telefon yoki kompyuterdan kirganini ko‘ring. Asosiy qurilmani belgilang,
              begona kirishni tasdiqlang yoki bloklang.
              {!canEdit ? " · Sizda faqat ko‘rish huquqi bor." : ""}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="bg-white/95 text-[#1e3a8a] hover:bg-white"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Yangilash
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi icon={<Shield className="h-4 w-4" />} label="Jami qurilma" value={summary.total} tone="slate" />
        <Kpi icon={<ShieldCheck className="h-4 w-4" />} label="Hozir onlayn" value={summary.active} tone="emerald" />
        <Kpi icon={<Clock3 className="h-4 w-4" />} label="Tasdiq kutilmoqda" value={summary.pending} tone="amber" />
        <Kpi icon={<ShieldOff className="h-4 w-4" />} label="Bloklangan" value={summary.blocked} tone="rose" />
        <Kpi icon={<ShieldAlert className="h-4 w-4" />} label="Shubhali (7 kun)" value={summary.suspicious} tone="orange" />
      </div>

      <Tabs defaultValue="requests" className="space-y-4">
        <TabsList className="ds-tabs h-auto flex-wrap gap-1 rounded-xl bg-muted/60 p-1">
          <TabsTrigger value="requests" className="ds-tab relative rounded-lg px-3 py-2">
            Ruxsat so‘rovlari
            {summary.pending > 0 ? (
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                {summary.pending}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="devices" className="ds-tab rounded-lg px-3 py-2">
            Qurilmalar
          </TabsTrigger>
          <TabsTrigger value="enforce" className="ds-tab rounded-lg px-3 py-2">
            Majburiy xodimlar
          </TabsTrigger>
          <TabsTrigger value="settings" className="ds-tab rounded-lg px-3 py-2">
            Sozlamalar
          </TabsTrigger>
          <TabsTrigger value="history" className="ds-tab rounded-lg px-3 py-2">
            Login tarixi
          </TabsTrigger>
          <TabsTrigger value="events" className="ds-tab rounded-lg px-3 py-2">
            Xavfsizlik hodisalari
          </TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="mt-0 space-y-4">
          <Card className="overflow-hidden border-amber-200/80 bg-gradient-to-br from-amber-50/90 via-white to-orange-50/40 shadow-sm dark:border-amber-500/30 dark:from-amber-500/10 dark:via-background dark:to-background">
            <CardHeader className="border-b border-amber-200/60 pb-4 dark:border-amber-500/20">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
                    </span>
                    Ruxsat so‘raganlar
                  </CardTitle>
                  <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                    Tasdiqlansa — shu qurilma/IP asosiy bo‘ladi, eski joylar avtomatik yopiladi.
                    Rad etilsa — shu qurilmadan kira olmaydi.
                  </p>
                </div>
                <Badge className="bg-amber-500 text-white hover:bg-amber-500">
                  {pendingRequests.length} ta kutmoqda
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 p-3 sm:p-4">
              {pendingRequests.length === 0 ? (
                <div className="rounded-xl border border-dashed border-amber-200/80 bg-white/60 px-4 py-12 text-center dark:bg-background/40">
                  <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-500/70" />
                  <p className="font-medium">Yangi so‘rov yo‘q</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Xodim boshqa qurilmadan kirsa, so‘rov shu yerda chiqadi.
                  </p>
                </div>
              ) : (
                pendingRequests.map((d) => {
                  const kind = deviceKind(d.deviceType);
                  const Icon = kind.Icon;
                  return (
                    <div
                      key={d.id}
                      className="rounded-2xl border border-amber-200/70 bg-white p-4 shadow-sm ring-1 ring-amber-500/10 dark:border-amber-500/25 dark:bg-card"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => void openDetail(d.id)}
                        >
                          <div className="flex items-start gap-3">
                            <div className="rounded-xl bg-amber-500/15 p-2.5 text-amber-800 dark:text-amber-300">
                              <Icon className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold">{d.fullName}</span>
                                <StatusBadge status="pending" compact />
                              </div>
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                {d.login}
                                {d.phone ? ` · ${d.phone}` : ""}
                                {d.departmentName ? ` · ${d.departmentName}` : ""}
                              </div>
                              <div className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                                <div>
                                  <span className="text-muted-foreground">Qurilma: </span>
                                  <span className="font-medium">{d.deviceName || kind.label}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">IP: </span>
                                  <span className="font-mono text-xs font-medium">
                                    {d.lastIp || d.ipAddress || "—"}
                                  </span>
                                </div>
                                <div className="text-xs text-muted-foreground sm:col-span-2">
                                  {displayOsBrowser(d.os, d.browser)} · {fmt(d.lastSeenAt)}
                                </div>
                              </div>
                              {d.foreignDevice || d.lastApprovalAt ? (
                                <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs dark:border-rose-500/30 dark:bg-rose-500/10">
                                  <div className="flex items-center gap-1.5 font-semibold text-rose-800 dark:text-rose-300">
                                    <ShieldAlert className="h-3.5 w-3.5" />
                                    Boshqa qurilmadan kiryapti
                                  </div>
                                  {d.primaryDeviceName ? (
                                    <p className="mt-1 text-rose-900/80 dark:text-rose-200/80">
                                      Asosiy: <span className="font-medium">{d.primaryDeviceName}</span>
                                    </p>
                                  ) : null}
                                  {d.lastApprovalAt ? (
                                    <p className="mt-0.5 text-rose-900/80 dark:text-rose-200/80">
                                      Oxirgi ruxsat: <span className="font-medium tabular-nums">{fmt(d.lastApprovalAt)}</span>
                                      {d.lastApprovalDeviceName ? ` · ${d.lastApprovalDeviceName}` : ""}
                                    </p>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </button>

                        {canEdit ? (
                          <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
                            <Button
                              type="button"
                              disabled={busy}
                              className="h-11 min-w-[140px] rounded-xl bg-emerald-600 hover:bg-emerald-700"
                              onClick={(e) => {
                                e.stopPropagation();
                                void run(
                                  () => approveDevice(d.id),
                                  "Tasdiqlandi — shu qurilma asosiy, eski joylar yopildi",
                                );
                              }}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                              Tasdiqlash
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              disabled={busy}
                              className="h-11 min-w-[140px] rounded-xl"
                              onClick={(e) => {
                                e.stopPropagation();
                                void run(() => rejectDevice(d.id), "Rad etildi — bu qurilmadan kirolmaydi");
                              }}
                            >
                              <XCircle className="h-4 w-4" />
                              Rad etish
                            </Button>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">Faqat admin tasdiqlaydi</p>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="devices" className="mt-0 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-11 rounded-xl border-border/70 bg-background pl-9 shadow-sm"
                placeholder="Xodim, login, telefon, IP…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-11 w-full rounded-xl sm:w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha holatlar</SelectItem>
                <SelectItem value="active">Hozir onlayn</SelectItem>
                <SelectItem value="pending">Tasdiq kutilmoqda</SelectItem>
                <SelectItem value="blocked">Bloklangan</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card className="overflow-hidden border-border/60 shadow-sm">
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead>
                  <tr className="border-b bg-gradient-to-r from-slate-50 to-white text-[11px] uppercase tracking-wide text-muted-foreground dark:from-slate-900/50 dark:to-background">
                    <th className="px-4 py-3 font-semibold">Xodim</th>
                    <th className="px-4 py-3 font-semibold">Qurilma</th>
                    <th className="px-4 py-3 font-semibold">Holat</th>
                    <th className="px-4 py-3 font-semibold">Faollik</th>
                    <th className="px-4 py-3 font-semibold">IP</th>
                    <th className="px-4 py-3 font-semibold">Amallar</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => {
                    const kind = deviceKind(d.deviceType);
                    const Icon = kind.Icon;
                    const isPending = d.status === "pending" || (!d.isVerified && !d.isBlocked);
                    return (
                      <tr
                        key={d.id}
                        className="border-b border-border/50 transition-colors hover:bg-[#1e3a8a]/[0.04]"
                      >
                        <td
                          className="cursor-pointer px-4 py-3.5"
                          onClick={() => void openDetail(d.id)}
                        >
                          <div className="font-semibold text-foreground">{d.fullName}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <span>{d.login}</span>
                            {d.phone ? <span>· {d.phone}</span> : null}
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            <span
                              className={cn(
                                "rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                                d.staffGroup === "pharmacy"
                                  ? "bg-teal-500/10 text-teal-800 dark:text-teal-300"
                                  : "bg-sky-500/10 text-sky-800 dark:text-sky-300",
                              )}
                            >
                              {d.staffGroup === "pharmacy" ? "Dorixona" : "Ofis"}
                            </span>
                            {d.departmentName ? (
                              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {d.departmentName}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td
                          className="cursor-pointer px-4 py-3.5"
                          onClick={() => void openDetail(d.id)}
                        >
                          <div className="flex items-start gap-2.5">
                            <div className="mt-0.5 rounded-lg bg-muted/80 p-2 ring-1 ring-border/60">
                              <Icon className="h-4 w-4 text-[#1e3a8a] dark:text-sky-300" />
                            </div>
                            <div>
                              <div className="font-medium">{d.deviceName || "Nomsiz qurilma"}</div>
                              <div className="text-xs text-muted-foreground">
                                {kind.label} · {displayOsBrowser(d.os, d.browser)}
                              </div>
                              {d.isPrimary ? (
                                <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                                  <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                                  Asosiy qurilma
                                </div>
                              ) : (
                                <div className="mt-1 text-[11px] text-muted-foreground">Asosiy emas</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <StatusBadge status={d.status} />
                        </td>
                        <td className="px-4 py-3.5 text-xs tabular-nums text-muted-foreground">
                          {fmt(d.lastSeenAt)}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">
                          {d.lastIp || d.ipAddress || "—"}
                        </td>
                        <td className="px-4 py-3.5">
                          {isPending && canEdit ? (
                            <div className="flex flex-col gap-1.5 sm:flex-row">
                              <Button
                                type="button"
                                size="sm"
                                disabled={busy}
                                className="h-9 rounded-lg bg-emerald-600 hover:bg-emerald-700"
                                onClick={() =>
                                  void run(
                                    () => approveDevice(d.id),
                                    "Tasdiqlandi — asosiy qilindi",
                                  )
                                }
                              >
                                Tasdiq
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                disabled={busy}
                                className="h-9 rounded-lg"
                                onClick={() =>
                                  void run(() => rejectDevice(d.id), "Rad etildi")
                                }
                              >
                                Rad
                              </Button>
                            </div>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-9 rounded-lg"
                              onClick={() => void openDetail(d.id)}
                            >
                              Batafsil
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!loading && devices.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-14 text-center">
                        <div className="mx-auto max-w-sm space-y-2">
                          <MonitorSmartphone className="mx-auto h-8 w-8 text-muted-foreground/50" />
                          <p className="font-medium">Hali qurilma yo‘q</p>
                          <p className="text-sm text-muted-foreground">
                            Xodimni «Majburiy xodimlar» dan yoqing — keyin birinchi login shu yerda
                            chiqadi.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="enforce" className="mt-0 space-y-4">
          <Card className="overflow-hidden border-border/70 shadow-sm">
            <CardHeader className="space-y-4 border-b bg-gradient-to-br from-slate-50 to-white pb-4 dark:from-slate-900/40 dark:to-background">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="h-4 w-4 text-[#1e3a8a]" />
                    Majburiy xodimlar
                  </CardTitle>
                  <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                    Yoqilganda xodim faqat o‘z asosiy qurilmasidan kira oladi. Boshqa joydan urinish
                    bloklanadi va adminga so‘rov keladi.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary" className="tabular-nums">
                    Ko‘rsatilmoqda: {filteredEnforceUsers.length}
                  </Badge>
                  <Badge className="bg-emerald-100 text-emerald-800 tabular-nums dark:bg-emerald-500/15 dark:text-emerald-300">
                    Yoqilgan: {enforceCounts.filteredOn}
                  </Badge>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-all",
                    showOffice
                      ? "border-sky-300 bg-sky-50/80 shadow-sm dark:border-sky-500/40 dark:bg-sky-500/10"
                      : "border-border/70 bg-card hover:bg-muted/40",
                  )}
                >
                  <Checkbox
                    checked={showOffice}
                    onCheckedChange={(v) => setShowOffice(v === true)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-semibold">
                      <Building2 className="h-4 w-4 text-sky-600" />
                      Ofis
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {enforceCounts.office} ta · yoqilgan {enforceCounts.officeOn}
                    </p>
                  </div>
                </label>

                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-all",
                    showPharmacy
                      ? "border-teal-300 bg-teal-50/80 shadow-sm dark:border-teal-500/40 dark:bg-teal-500/10"
                      : "border-border/70 bg-card hover:bg-muted/40",
                  )}
                >
                  <Checkbox
                    checked={showPharmacy}
                    onCheckedChange={(v) => setShowPharmacy(v === true)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-semibold">
                      <Store className="h-4 w-4 text-teal-700" />
                      Dorixona
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Mudir, farmasevt, stajyor, koordinator · {enforceCounts.pharmacy} ta · yoqilgan{" "}
                      {enforceCounts.pharmacyOn}
                    </p>
                  </div>
                </label>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-10 rounded-xl border-border/70 bg-background pl-9"
                    placeholder="Ism, login, rol, bo‘lim…"
                    value={enforceQ}
                    onChange={(e) => setEnforceQ(e.target.value)}
                  />
                </div>
                <Select
                  value={enforceStatus}
                  onValueChange={(v) => setEnforceStatus(v as "all" | "on" | "off")}
                >
                  <SelectTrigger className="h-10 w-full rounded-xl sm:w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Barcha holat</SelectItem>
                    <SelectItem value="on">Faqat yoqilgan</SelectItem>
                    <SelectItem value="off">Faqat o‘chirilgan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>

            <CardContent className="max-h-[min(560px,60vh)] space-y-2 overflow-y-auto p-3 sm:p-4">
              {!showOffice && !showPharmacy ? (
                <EmptyHint text="Ofis yoki Dorixona ni belgilang — xodimlar shu yerda chiqadi" />
              ) : filteredEnforceUsers.length === 0 ? (
                <EmptyHint text="Mos xodim topilmadi" />
              ) : (
                filteredEnforceUsers.map((u) => (
                  <div
                    key={u.id}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                      u.enforced
                        ? "border-emerald-200/80 bg-emerald-50/40 dark:border-emerald-500/25 dark:bg-emerald-500/5"
                        : "border-border/60 bg-card hover:bg-muted/30",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{u.fullName}</span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            u.staffGroup === "pharmacy"
                              ? "border-teal-200 text-teal-800 dark:border-teal-500/30 dark:text-teal-300"
                              : "border-sky-200 text-sky-700 dark:border-sky-500/30 dark:text-sky-300",
                          )}
                        >
                          {u.staffGroup === "pharmacy" ? "Dorixona" : "Ofis"}
                        </Badge>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {u.login} · {u.role}
                        {u.departmentName ? ` · ${u.departmentName}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="hidden text-[11px] font-medium text-muted-foreground sm:inline">
                        {u.enforced ? "1 qurilma" : "Erkin"}
                      </span>
                      <Switch
                        checked={u.enforced}
                        disabled={busy || !canEdit}
                        onCheckedChange={(v) =>
                          void run(
                            () => setUserEnforce(u.id, v),
                            v ? "Majburiy yoqildi — faqat 1 qurilma" : "Majburiy o‘chirildi",
                          )
                        }
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="mt-0">
          {settings ? (
            <Card className="border-border/70 shadow-sm">
              <CardHeader className="border-b pb-4">
                <CardTitle className="text-base">Umumiy sozlamalar</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Qaysi guruhga qurilma himoyasi qo‘llanadi va qancha qurilma ruxsat etiladi.
                </p>
              </CardHeader>
              <CardContent className="space-y-5 pt-5">
                <div>
                  <Label className="text-sm font-semibold">Kimlarga qo‘llanadi?</Label>
                  <Select
                    value={settings.enforcementMode}
                    onValueChange={(v) => setSettings({ ...settings, enforcementMode: v })}
                  >
                    <SelectTrigger className="mt-1.5 h-11 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">O‘chiq — hech kimga</SelectItem>
                      <SelectItem value="selected">Faqat «Majburiy» yoqilganlar</SelectItem>
                      <SelectItem value="office">Barcha ofis xodimlari</SelectItem>
                      <SelectItem value="pharmacy">Barcha dorixona xodimlari</SelectItem>
                      <SelectItem value="all">Hammaga</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    «Majburiy» yoqilgan alohida xodimlar rejimdan qat’i nazar 1 qurilmaga bog‘lanadi.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <PolicyCard title="Ofis" tone="sky">
                    <FieldNum
                      label="Maksimal qurilma soni"
                      hint="Bir xodim nechta qurilmadan kirishi mumkin"
                      value={settings.officeMaxDevices}
                      onChange={(n) => setSettings({ ...settings, officeMaxDevices: n })}
                    />
                    <Toggle
                      label="Admin tasdiqi kerak"
                      hint="Yangi qurilma avtomatik emas — admin tasdiqlaydi"
                      checked={settings.officeRequireApprove}
                      onChange={(v) => setSettings({ ...settings, officeRequireApprove: v })}
                    />
                    <Toggle
                      label="Begona qurilmani bloklash"
                      hint="Asosiy dan boshqa joydan kirishni to‘xtatadi"
                      checked={settings.officeBlockForeign}
                      onChange={(v) => setSettings({ ...settings, officeBlockForeign: v })}
                    />
                    <Toggle
                      label="QR orqali tekshirish"
                      checked={settings.officeVerifyQr}
                      onChange={(v) => setSettings({ ...settings, officeVerifyQr: v })}
                    />
                    <Toggle
                      label="Face ID orqali tekshirish"
                      checked={settings.officeVerifyFace}
                      onChange={(v) => setSettings({ ...settings, officeVerifyFace: v })}
                    />
                  </PolicyCard>

                  <PolicyCard title="Dorixona" tone="teal">
                    <FieldNum
                      label="Maksimal qurilma soni"
                      hint="Odatda 1 — faqat o‘z telefoni"
                      value={settings.pharmacyMaxDevices}
                      onChange={(n) => setSettings({ ...settings, pharmacyMaxDevices: n })}
                    />
                    <Toggle
                      label="Admin tasdiqi kerak"
                      hint="O‘chiq bo‘lsa 1-telefon avtomatik asosiy bo‘ladi"
                      checked={settings.pharmacyRequireApprove}
                      onChange={(v) => setSettings({ ...settings, pharmacyRequireApprove: v })}
                    />
                    <Toggle
                      label="Begona qurilmani bloklash"
                      hint="Boshqa telefonda kirish mumkin emas"
                      checked={settings.pharmacyBlockForeign}
                      onChange={(v) => setSettings({ ...settings, pharmacyBlockForeign: v })}
                    />
                    <Toggle
                      label="QR orqali tekshirish"
                      checked={settings.pharmacyVerifyQr}
                      onChange={(v) => setSettings({ ...settings, pharmacyVerifyQr: v })}
                    />
                    <Toggle
                      label="Face ID orqali tekshirish"
                      checked={settings.pharmacyVerifyFace}
                      onChange={(v) => setSettings({ ...settings, pharmacyVerifyFace: v })}
                    />
                  </PolicyCard>
                </div>

                <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-4">
                  <Toggle
                    label="IP o‘zgarishini yozib borish"
                    hint="Boshqa joydan kirganda jurnalda chiqadi"
                    checked={settings.logIpChanges}
                    onChange={(v) => setSettings({ ...settings, logIpChanges: v })}
                  />
                  <Toggle
                    label="Shubhali login haqida xabar"
                    hint="Adminlarga bildirishnoma yuboriladi"
                    checked={settings.suspiciousNotify}
                    onChange={(v) => setSettings({ ...settings, suspiciousNotify: v })}
                  />
                </div>

                <Button
                  type="button"
                  className="h-11 rounded-xl bg-[#1e3a8a] hover:bg-[#16306f]"
                  disabled={busy || !canEdit}
                  onClick={() => void run(() => saveDeviceSettings(settings), "Sozlamalar saqlandi")}
                >
                  Sozlamalarni saqlash
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="history" className="mt-0">
          <Card className="overflow-hidden border-border/70 shadow-sm">
            <CardHeader className="border-b pb-3">
              <CardTitle className="text-base">Login tarixi</CardTitle>
              <p className="text-sm text-muted-foreground">Muvaffaqiyatli, bloklangan va rad etilgan kirishlar.</p>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-semibold">Vaqt</th>
                    <th className="px-4 py-3 font-semibold">Xodim</th>
                    <th className="px-4 py-3 font-semibold">IP</th>
                    <th className="px-4 py-3 font-semibold">Natija</th>
                    <th className="px-4 py-3 font-semibold">Sabab</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={String(l.id)} className="border-b border-border/50">
                      <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
                        {fmt(String(l.createdAt || ""))}
                      </td>
                      <td className="px-4 py-3 font-medium">{String(l.fullName || l.userId || "—")}</td>
                      <td className="px-4 py-3 font-mono text-xs">{String(l.ipAddress || "—")}</td>
                      <td className="px-4 py-3">
                        <LoginStatus status={String(l.status)} />
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {String(l.failureReason || "—")}
                      </td>
                    </tr>
                  ))}
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        Hali yozuv yo‘q
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events" className="mt-0">
          <Card className="border-border/70 shadow-sm">
            <CardHeader className="border-b pb-3">
              <CardTitle className="text-base">Xavfsizlik hodisalari</CardTitle>
              <p className="text-sm text-muted-foreground">
                Begona qurilma, bloklash va almashtirish so‘rovlari.
              </p>
            </CardHeader>
            <CardContent className="space-y-2 p-4">
              {events.map((e) => (
                <div
                  key={String(e.id)}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-card px-3.5 py-3"
                >
                  <div>
                    <div className="font-medium">{String(e.fullName || e.userId || "—")}</div>
                    <div className="text-xs text-muted-foreground">
                      {String(e.eventType)} · {fmt(String(e.createdAt || ""))}
                    </div>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {String(e.severity)}
                  </Badge>
                </div>
              ))}
              {events.length === 0 ? (
                <EmptyHint text="Hozircha hodisa yo‘q" />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={detailId != null}
        onOpenChange={(o) => {
          if (!o) {
            setDetailId(null);
            setDetail(null);
          }
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-xl gap-0 overflow-hidden p-0 sm:rounded-2xl">
          {detail ? (
            <DeviceDetailBody
              detail={detail}
              canEdit={canEdit}
              busy={busy}
              onAction={run}
            />
          ) : (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DeviceDetailBody({
  detail,
  canEdit,
  busy,
  onAction,
}: {
  detail: {
    device: DeviceRow;
    user: Record<string, unknown>;
    sessions: Array<Record<string, unknown>>;
  };
  canEdit: boolean;
  busy: boolean;
  onAction: (fn: () => Promise<unknown>, okMsg: string) => Promise<void>;
}) {
  const d = detail.device;
  const kind = deviceKind(d.deviceType);
  const Icon = kind.Icon;
  const meta = statusMeta(d.status);
  const openSessions = detail.sessions.filter((s) => {
    const revoked = Boolean(s.revokedAt);
    const expired = s.expiresAt && new Date(String(s.expiresAt)).getTime() <= Date.now();
    return !revoked && !expired;
  }).length;

  return (
    <>
      <div className="relative overflow-hidden border-b bg-gradient-to-br from-slate-50 via-white to-sky-50/60 px-5 pb-5 pt-6 dark:from-slate-900 dark:via-background dark:to-background">
        <DialogHeader className="space-y-3 text-left">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-[#1e3a8a] p-3 text-white shadow-md shadow-[#1e3a8a]/25">
              <Icon className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1 pr-6">
              <DialogTitle className="text-xl font-bold tracking-tight">
                {String(detail.user.fullName || d.fullName || "Xodim")}
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm">
                {String(detail.user.login || d.login || "—")} · {kind.label}
              </DialogDescription>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={d.status} />
            {d.isPrimary ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-500/25 dark:text-amber-300">
                <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                Asosiy qurilma
              </span>
            ) : (
              <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                Asosiy emas
              </span>
            )}
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{meta.hint}</p>
        </DialogHeader>
      </div>

      <div className="max-h-[min(48vh,420px)] space-y-4 overflow-y-auto px-5 py-4">
        <div className="grid grid-cols-2 gap-2.5">
          <InfoTile label="Qurilma" value={d.deviceName || "Nomsiz"} />
          <InfoTile label="Tizim" value={displayOsBrowser(d.os, d.browser)} />
          <InfoTile label="IP manzil" value={d.lastIp || d.ipAddress || "—"} mono />
          <InfoTile label="Oxirgi faollik" value={fmt(d.lastSeenAt)} />
          <InfoTile label="Oxirgi login" value={fmt(d.lastLoginAt)} />
          <InfoTile label="Birinchi ko‘rilgan" value={fmt(d.firstSeenAt)} />
        </div>

        {detail.sessions.length > 0 ? (
          <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Sessionlar
              </p>
              <span className="text-xs text-muted-foreground">
                {openSessions > 0 ? `${openSessions} ochiq` : "Ochiq yo‘q"}
              </span>
            </div>
            <ul className="space-y-1.5">
              {detail.sessions.slice(0, 6).map((s) => {
                const revoked = Boolean(s.revokedAt);
                const expired =
                  s.expiresAt && new Date(String(s.expiresAt)).getTime() <= Date.now();
                const live = !revoked && !expired;
                return (
                  <li
                    key={String(s.id)}
                    className="flex items-center justify-between gap-2 rounded-lg bg-background/80 px-2.5 py-1.5 text-xs"
                  >
                    <span className="tabular-nums text-muted-foreground">{fmt(String(s.createdAt || ""))}</span>
                    <span
                      className={cn(
                        "font-semibold",
                        live ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
                      )}
                    >
                      {live ? "Ochiq" : revoked ? "Yopilgan" : "Muddati o‘tgan"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <details className="group rounded-xl border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none font-medium text-foreground/80">
            Texnik ID (kerak bo‘lsa)
          </summary>
          <p className="mt-2 break-all font-mono text-[10px] leading-relaxed">{d.deviceId}</p>
        </details>
      </div>

      <div className="border-t bg-muted/30 px-5 py-4">
        {canEdit ? (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Amallar
            </p>
            <div className="grid gap-2">
              {!d.isVerified ? (
                <>
                  <ActionRow
                    icon={<CheckCircle2 className="h-4 w-4" />}
                    title="Tasdiqlash"
                    desc="Shu qurilmadan kirishga ruxsat beradi (asosiy bo‘lishi mumkin)"
                    tone="primary"
                    disabled={busy}
                    onClick={() => void onAction(() => approveDevice(d.id), "Tasdiqlandi")}
                  />
                  <ActionRow
                    icon={<XCircle className="h-4 w-4" />}
                    title="Rad etish"
                    desc="So‘rovni bekor qiladi va qurilmani bloklaydi"
                    tone="danger"
                    disabled={busy}
                    onClick={() => void onAction(() => rejectDevice(d.id), "Rad etildi")}
                  />
                </>
              ) : null}

              {d.isVerified && !d.isPrimary ? (
                <ActionRow
                  icon={<Star className="h-4 w-4" />}
                  title="Asosiy qilish"
                  desc="Faqat shu qurilmadan kirish mumkin bo‘ladi"
                  tone="primary"
                  disabled={busy}
                  onClick={() => void onAction(() => setPrimaryDevice(d.id), "Asosiy qilindi")}
                />
              ) : null}

              {d.isBlocked ? (
                <ActionRow
                  icon={<KeyRound className="h-4 w-4" />}
                  title="Blokdan chiqarish"
                  desc="Yana shu qurilmadan kirishga ruxsat"
                  tone="primary"
                  disabled={busy}
                  onClick={() => void onAction(() => unblockDevice(d.id), "Blokdan chiqarildi")}
                />
              ) : (
                <ActionRow
                  icon={<Ban className="h-4 w-4" />}
                  title="Bloklash"
                  desc="Shu qurilmadan kirishni butunlay taqiqlaydi"
                  tone="danger"
                  disabled={busy}
                  onClick={() => void onAction(() => blockDevice(d.id), "Bloklandi")}
                />
              )}

              <ActionRow
                icon={<LogOut className="h-4 w-4" />}
                title="Sessionni yopish"
                desc="Faqat shu qurilmadagi ochiq kirishni yopadi"
                tone="neutral"
                disabled={busy}
                onClick={() => void onAction(() => revokeDeviceSessions(d.id), "Session tugatildi")}
              />
              <ActionRow
                icon={<ShieldOff className="h-4 w-4" />}
                title="Barcha joylardan chiqarish"
                desc="Xodimning barcha qurilmalaridagi sessionlarni yopadi"
                tone="neutral"
                disabled={busy}
                onClick={() =>
                  void onAction(() => revokeAllUserSessions(d.userId), "Barcha sessionlar tugatildi")
                }
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Faqat ko‘rish — o‘zgartirish admin uchun.</p>
        )}
      </div>
    </>
  );
}

function ActionRow({
  icon,
  title,
  desc,
  tone,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  tone: "primary" | "danger" | "neutral";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-all disabled:opacity-50",
        tone === "primary" &&
          "border-[#1e3a8a]/25 bg-[#1e3a8a]/[0.06] hover:bg-[#1e3a8a]/[0.12] dark:border-sky-500/30 dark:bg-sky-500/10",
        tone === "danger" &&
          "border-rose-200 bg-rose-50/80 hover:bg-rose-100/80 dark:border-rose-500/30 dark:bg-rose-500/10",
        tone === "neutral" && "border-border/70 bg-background hover:bg-muted/50",
      )}
    >
      <span
        className={cn(
          "mt-0.5 rounded-lg p-2",
          tone === "primary" && "bg-[#1e3a8a] text-white",
          tone === "danger" && "bg-rose-600 text-white",
          tone === "neutral" && "bg-muted text-foreground",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{desc}</span>
      </span>
    </button>
  );
}

function InfoTile({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-0.5 truncate text-sm font-medium", mono && "font-mono text-xs")}>
        {value || "—"}
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "slate" | "emerald" | "amber" | "rose" | "orange";
}) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    rose: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
    orange: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  };
  return (
    <Card className="border-border/60 shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="flex items-center gap-3 p-4">
        <div className={cn("rounded-xl p-2.5", tones[tone])}>{icon}</div>
        <div>
          <div className="text-2xl font-bold tabular-nums tracking-tight">{value}</div>
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function PolicyCard({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "sky" | "teal";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "space-y-3 rounded-2xl border p-4",
        tone === "sky" && "border-sky-200/80 bg-sky-50/40 dark:border-sky-500/20 dark:bg-sky-500/5",
        tone === "teal" && "border-teal-200/80 bg-teal-50/40 dark:border-teal-500/20 dark:bg-teal-500/5",
      )}
    >
      <p className="font-semibold">{title}</p>
      {children}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Label className="text-sm font-medium">{label}</Label>
        {hint ? <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5 shrink-0" />
    </div>
  );
}

function FieldNum({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <Label className="text-xs font-semibold">{label}</Label>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
      <Input
        type="number"
        min={1}
        max={5}
        className="mt-1.5 h-9 rounded-lg"
        value={value}
        onChange={(e) => onChange(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
      />
    </div>
  );
}

function LoginStatus({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "success")
    return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">OK</Badge>;
  if (s === "blocked" || s === "fail")
    return <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300">{status}</Badge>;
  if (s === "pending")
    return <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">Kutilmoqda</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
