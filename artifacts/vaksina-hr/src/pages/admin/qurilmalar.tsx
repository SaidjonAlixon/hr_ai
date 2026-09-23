import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { canManageUsers, canViewKochmaAdmin } from "@/lib/roles";
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
  DialogFooter,
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
  Building2,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Store,
  Users,
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

function StatusBadge({ status }: { status: string }) {
  if (status === "active")
    return (
      <Badge className="bg-emerald-100 text-emerald-800" title="Hozir faol session bor">
        Hozir onlayn
      </Badge>
    );
  if (status === "pending")
    return (
      <Badge className="bg-amber-100 text-amber-900" title="Admin tasdiqlashi kerak">
        Tasdiqlash kutilmoqda
      </Badge>
    );
  if (status === "blocked")
    return (
      <Badge className="bg-rose-100 text-rose-800" title="Kirish taqiqlangan">
        Bloklangan
      </Badge>
    );
  if (status === "inactive")
    return (
      <Badge className="bg-sky-100 text-sky-900" title="Tasdiqlangan, lekin hozir session yo‘q">
        Offline (tasdiqlangan)
      </Badge>
    );
  return <Badge variant="secondary">Noma’lum</Badge>;
}

function displayOsBrowser(os?: string | null, browser?: string | null) {
  const o = (os || "").trim();
  const b = (browser || "").trim();
  if (!o && !b) return "Aniqlanmagan";
  if (!o) return b;
  if (!b) return o;
  return `${o} · ${b}`;
}

function ActionBtn({
  children,
  hint,
  ...props
}: React.ComponentProps<typeof Button> & { hint: string }) {
  return (
    <div className="flex min-w-[9.5rem] flex-col gap-0.5">
      <Button {...props}>{children}</Button>
      <span className="px-0.5 text-[10px] leading-tight text-muted-foreground">{hint}</span>
    </div>
  );
}

export default function AdminQurilmalarPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = canViewKochmaAdmin(user?.role);
  const canEdit = canManageUsers(user?.role);

  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [devices, setDevices] = useState<DeviceRow[]>([]);
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

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const [sum, list, st, users, hist, ev] = await Promise.all([
        fetchDeviceSummary(),
        fetchDevices({ q: q.trim() || undefined, status }),
        fetchDeviceSettings(),
        fetchEnforceUsers(),
        fetchLoginHistory(),
        fetchSecurityEvents(),
      ]);
      setSummary(sum);
      setDevices(list.devices);
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
    return (
      <div className="py-16 text-center text-muted-foreground">Ruxsat yo‘q</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <MonitorSmartphone className="h-7 w-7 text-primary" />
            Qurilmalar
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Device Security — faqat tanlangan / ofis / dorixona scope dagi xodimlar uchun majburiy
            {!canEdit ? " · Faqat ko‘rish (o‘zgartirish admin)" : ""}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Yangilash
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi icon={<Shield className="h-4 w-4" />} label="Jami" value={summary.total} />
        <Kpi icon={<ShieldCheck className="h-4 w-4 text-emerald-600" />} label="Faol" value={summary.active} />
        <Kpi icon={<ShieldAlert className="h-4 w-4 text-amber-600" />} label="Kutilmoqda" value={summary.pending} />
        <Kpi icon={<ShieldOff className="h-4 w-4 text-rose-600" />} label="Bloklangan" value={summary.blocked} />
        <Kpi icon={<ShieldAlert className="h-4 w-4 text-rose-700" />} label="Shubhali (7 kun)" value={summary.suspicious} />
      </div>

      <Tabs defaultValue="devices" className="space-y-4">
        <TabsList className="ds-tabs">
          <TabsTrigger value="devices" className="ds-tab">
            Qurilmalar
          </TabsTrigger>
          <TabsTrigger value="enforce" className="ds-tab">
            Majburiy userlar
          </TabsTrigger>
          <TabsTrigger value="settings" className="ds-tab">
            Sozlamalar
          </TabsTrigger>
          <TabsTrigger value="history" className="ds-tab">
            Login tarixi
          </TabsTrigger>
          <TabsTrigger value="events" className="ds-tab">
            Security events
          </TabsTrigger>
        </TabsList>

        <TabsContent value="devices" className="mt-0 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Xodim, telefon, IP, Device ID…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha holatlar</SelectItem>
                <SelectItem value="active">Hozir onlayn</SelectItem>
                <SelectItem value="pending">Tasdiqlash kutilmoqda</SelectItem>
                <SelectItem value="blocked">Bloklangan</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card className="overflow-hidden">
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Xodim</th>
                    <th className="px-3 py-2">Login / tel</th>
                    <th className="px-3 py-2">Bo‘lim</th>
                    <th className="px-3 py-2">Qurilma</th>
                    <th className="px-3 py-2">Tizim / Brauzer</th>
                    <th className="px-3 py-2">IP</th>
                    <th className="px-3 py-2">Oxirgi faollik</th>
                    <th className="px-3 py-2">Holat</th>
                    <th className="px-3 py-2">Asosiy?</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => (
                    <tr
                      key={d.id}
                      className="cursor-pointer border-b hover:bg-muted/40"
                      onClick={() => void openDetail(d.id)}
                    >
                      <td className="px-3 py-2 font-medium">
                        {d.fullName}
                        <div className="text-[10px] text-muted-foreground">{d.staffGroup}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {d.login}
                        <div className="text-muted-foreground">{d.phone || "—"}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">{d.departmentName || "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        {d.deviceName || "—"}
                        <div className="text-muted-foreground">{d.deviceType}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {displayOsBrowser(d.os, d.browser)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{d.lastIp || d.ipAddress || "—"}</td>
                      <td className="px-3 py-2 text-xs tabular-nums">{fmt(d.lastSeenAt)}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={d.status} />
                      </td>
                      <td className="px-3 py-2 text-xs">{d.isPrimary ? "Ha · asosiy" : "Yo‘q"}</td>
                    </tr>
                  ))}
                  {!loading && devices.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
                        Qurilma yo‘q — xodimni «Majburiy userlar» dan yoqing
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
                    <Users className="h-4 w-4 text-primary" />
                    Majburiy userlar
                  </CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Ofis yoki Dorixona bo‘yicha belgilang — ro‘yxat chiqadi, qidirib filter qiling
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
                    <div className="flex items-center gap-2 font-semibold text-foreground">
                      <Building2 className="h-4 w-4 text-sky-600" />
                      Ofis
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Ofis xodimlari · {enforceCounts.office} ta · yoqilgan {enforceCounts.officeOn}
                    </p>
                  </div>
                </label>

                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-all",
                    showPharmacy
                      ? "border-violet-300 bg-violet-50/80 shadow-sm dark:border-violet-500/40 dark:bg-violet-500/10"
                      : "border-border/70 bg-card hover:bg-muted/40",
                  )}
                >
                  <Checkbox
                    checked={showPharmacy}
                    onCheckedChange={(v) => setShowPharmacy(v === true)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-semibold text-foreground">
                      <Store className="h-4 w-4 text-violet-600" />
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
                    placeholder="Ism, login, rol, bo‘lim bo‘yicha qidirish…"
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
                <div className="rounded-xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
                  Ofis yoki Dorixona checkboxini belgilang — xodimlar shu yerda chiqadi
                </div>
              ) : filteredEnforceUsers.length === 0 ? (
                <div className="rounded-xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
                  Mos xodim topilmadi
                </div>
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
                              ? "border-violet-200 text-violet-700 dark:border-violet-500/30 dark:text-violet-300"
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
                      <span className="hidden text-[11px] text-muted-foreground sm:inline">
                        {u.enforced ? "Majburiy" : "O‘chirilgan"}
                      </span>
                      <Switch
                        checked={u.enforced}
                        disabled={busy || !canEdit}
                        onCheckedChange={(v) =>
                          void run(
                            () => setUserEnforce(u.id, v),
                            v ? "Majburiy yoqildi" : "O‘chirildi",
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
            <Card>
              <CardContent className="space-y-4 pt-5">
                <div>
                  <Label>Enforcement mode</Label>
                  <Select
                    value={settings.enforcementMode}
                    onValueChange={(v) => setSettings({ ...settings, enforcementMode: v })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">Off (hech kim)</SelectItem>
                      <SelectItem value="selected">Selected (tanlangan userlar)</SelectItem>
                      <SelectItem value="office">Ofis xodimlari</SelectItem>
                      <SelectItem value="pharmacy">Dorixona xodimlari</SelectItem>
                      <SelectItem value="all">Hammasi</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-3 rounded-xl border p-3">
                    <p className="font-semibold">Ofis</p>
                    <FieldNum
                      label="Max qurilma"
                      value={settings.officeMaxDevices}
                      onChange={(n) => setSettings({ ...settings, officeMaxDevices: n })}
                    />
                    <Toggle
                      label="Admin tasdiq"
                      checked={settings.officeRequireApprove}
                      onChange={(v) => setSettings({ ...settings, officeRequireApprove: v })}
                    />
                    <Toggle
                      label="Boshqa qurilmani bloklash"
                      checked={settings.officeBlockForeign}
                      onChange={(v) => setSettings({ ...settings, officeBlockForeign: v })}
                    />
                    <Toggle
                      label="QR device verify"
                      checked={settings.officeVerifyQr}
                      onChange={(v) => setSettings({ ...settings, officeVerifyQr: v })}
                    />
                    <Toggle
                      label="Face device verify"
                      checked={settings.officeVerifyFace}
                      onChange={(v) => setSettings({ ...settings, officeVerifyFace: v })}
                    />
                  </div>
                  <div className="space-y-3 rounded-xl border p-3">
                    <p className="font-semibold">Dorixona</p>
                    <FieldNum
                      label="Max qurilma"
                      value={settings.pharmacyMaxDevices}
                      onChange={(n) => setSettings({ ...settings, pharmacyMaxDevices: n })}
                    />
                    <Toggle
                      label="Admin tasdiq"
                      checked={settings.pharmacyRequireApprove}
                      onChange={(v) => setSettings({ ...settings, pharmacyRequireApprove: v })}
                    />
                    <Toggle
                      label="Boshqa qurilmani bloklash"
                      checked={settings.pharmacyBlockForeign}
                      onChange={(v) => setSettings({ ...settings, pharmacyBlockForeign: v })}
                    />
                    <Toggle
                      label="QR device verify"
                      checked={settings.pharmacyVerifyQr}
                      onChange={(v) => setSettings({ ...settings, pharmacyVerifyQr: v })}
                    />
                    <Toggle
                      label="Face device verify"
                      checked={settings.pharmacyVerifyFace}
                      onChange={(v) => setSettings({ ...settings, pharmacyVerifyFace: v })}
                    />
                  </div>
                </div>
                <Toggle
                  label="IP o‘zgarishini qayd qilish"
                  checked={settings.logIpChanges}
                  onChange={(v) => setSettings({ ...settings, logIpChanges: v })}
                />
                <Toggle
                  label="Shubhali login notification"
                  checked={settings.suspiciousNotify}
                  onChange={(v) => setSettings({ ...settings, suspiciousNotify: v })}
                />
                <Button
                  type="button"
                  disabled={busy || !canEdit}
                  onClick={() =>
                    void run(() => saveDeviceSettings(settings), "Sozlamalar saqlandi")
                  }
                >
                  Saqlash
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="history" className="mt-0">
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Vaqt</th>
                    <th className="px-3 py-2">Xodim</th>
                    <th className="px-3 py-2">IP</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Sabab</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={String(l.id)} className="border-b">
                      <td className="px-3 py-2 text-xs">{fmt(String(l.createdAt || ""))}</td>
                      <td className="px-3 py-2">{String(l.fullName || l.userId || "—")}</td>
                      <td className="px-3 py-2 font-mono text-xs">{String(l.ipAddress || "—")}</td>
                      <td className="px-3 py-2">{String(l.status)}</td>
                      <td className="px-3 py-2 text-xs">{String(l.failureReason || "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events" className="mt-0">
          <Card>
            <CardContent className="space-y-2 p-4">
              {events.map((e) => (
                <div key={String(e.id)} className="rounded-lg border px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{String(e.fullName || e.userId || "—")}</span>
                    <Badge variant="outline">{String(e.severity)}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {String(e.eventType)} · {fmt(String(e.createdAt || ""))}
                  </div>
                </div>
              ))}
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">Hozircha event yo‘q</p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={detailId != null} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Qurilma tafsilotlari</DialogTitle>
            <p className="text-xs text-muted-foreground">
              Xodimning qaysi telefon/kompyuterdan kirgani va nima qilish mumkinligi.
            </p>
          </DialogHeader>
          {detail ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
                <Row
                  label="Xodim"
                  value={String(detail.user.fullName || detail.device.fullName || "—")}
                />
                <Row
                  label="Login"
                  value={String(detail.user.login || detail.device.login || "—")}
                />
                <Row
                  label="Qurilma nomi"
                  value={detail.device.deviceName || "Nomsiz qurilma"}
                />
                <Row
                  label="Turi"
                  value={
                    detail.device.deviceType === "mobile"
                      ? "Telefon / planshet"
                      : detail.device.deviceType === "desktop"
                        ? "Kompyuter"
                        : detail.device.deviceType === "tablet"
                          ? "Planshet"
                          : detail.device.deviceType || "Aniqlanmagan"
                  }
                />
                <Row label="Tizim (OS)" value={detail.device.os?.trim() || "Aniqlanmagan"} />
                <Row label="Brauzer" value={detail.device.browser?.trim() || "Aniqlanmagan"} />
                <Row
                  label="IP manzil"
                  value={detail.device.lastIp || detail.device.ipAddress || "—"}
                  mono
                />
                <Row label="Birinchi marta ko‘rilgan" value={fmt(detail.device.firstSeenAt)} />
                <Row label="Oxirgi faollik" value={fmt(detail.device.lastSeenAt)} />
                <Row
                  label="Oxirgi login"
                  value={fmt(detail.device.lastLoginAt)}
                />
                <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
                  <span className="text-muted-foreground">Holat:</span>
                  <StatusBadge status={detail.device.status} />
                  {detail.device.isPrimary ? (
                    <Badge title="Shu xodim uchun asosiy ruxsat etilgan qurilma">
                      Asosiy qurilma
                    </Badge>
                  ) : (
                    <Badge variant="outline">Asosiy emas</Badge>
                  )}
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {detail.device.status === "active"
                    ? "Xodim hozir shu qurilmadan tizimda."
                    : detail.device.status === "inactive"
                      ? "Qurilma tasdiqlangan, lekin hozir ochiq session yo‘q (offline)."
                      : detail.device.status === "pending"
                        ? "Hali tasdiqlanmagan — kirish to‘liq ochilmaydi."
                        : detail.device.status === "blocked"
                          ? "Bloklangan — bu qurilmadan kirish mumkin emas."
                          : "Holat aniqlanmadi."}
                </p>
                <details className="text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer select-none font-medium text-foreground/80">
                    Ichki identifikator (Device ID)
                  </summary>
                  <p className="mt-1 break-all font-mono text-[10px]">{detail.device.deviceId}</p>
                </details>
              </div>

              {(detail.sessions?.length ?? 0) > 0 ? (
                <div className="rounded-xl border p-3">
                  <p className="mb-2 text-xs font-semibold text-foreground">
                    Sessionlar ({detail.sessions.length})
                  </p>
                  <ul className="max-h-28 space-y-1 overflow-y-auto text-[11px] text-muted-foreground">
                    {detail.sessions.slice(0, 8).map((s) => {
                      const revoked = Boolean(s.revokedAt);
                      const expired =
                        s.expiresAt && new Date(String(s.expiresAt)).getTime() <= Date.now();
                      const live = !revoked && !expired;
                      return (
                        <li key={String(s.id)} className="flex justify-between gap-2">
                          <span>{fmt(String(s.createdAt || ""))}</span>
                          <span className={live ? "font-medium text-emerald-700" : ""}>
                            {live ? "Ochiq" : revoked ? "Yopilgan" : "Muddati o‘tgan"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <Loader2 className="h-5 w-5 animate-spin" />
          )}
          <DialogFooter className="flex-col items-stretch gap-3 sm:flex-col sm:space-x-0">
            {canEdit ? (
              <>
            <p className="text-[11px] font-medium text-muted-foreground">Amallar</p>
            <div className="flex flex-wrap gap-3">
              {detail && !detail.device.isVerified ? (
                <ActionBtn
                  size="sm"
                  hint="Kirishga ruxsat beradi"
                  disabled={busy}
                  onClick={() => void run(() => approveDevice(detail.device.id), "Tasdiqlandi")}
                >
                  Tasdiqlash
                </ActionBtn>
              ) : null}
              {detail && !detail.device.isVerified ? (
                <ActionBtn
                  size="sm"
                  variant="destructive"
                  hint="Rad etib bloklaydi"
                  disabled={busy}
                  onClick={() => void run(() => rejectDevice(detail.device.id), "Rad etildi")}
                >
                  Rad etish
                </ActionBtn>
              ) : null}
              {detail ? (
                <>
                  {!detail.device.isPrimary ? (
                    <ActionBtn
                      size="sm"
                      variant="secondary"
                      hint="Shu qurilmani asosiy qiladi"
                      disabled={busy}
                      onClick={() =>
                        void run(() => setPrimaryDevice(detail.device.id), "Asosiy qilindi")
                      }
                    >
                      Asosiy qilish
                    </ActionBtn>
                  ) : (
                    <ActionBtn size="sm" variant="secondary" hint="Allaqachon asosiy" disabled>
                      Asosiy qurilma
                    </ActionBtn>
                  )}
                  {detail.device.isBlocked ? (
                    <ActionBtn
                      size="sm"
                      hint="Yana kirishga ruxsat"
                      disabled={busy}
                      onClick={() =>
                        void run(() => unblockDevice(detail.device.id), "Blokdan chiqarildi")
                      }
                    >
                      Blokdan chiqarish
                    </ActionBtn>
                  ) : (
                    <ActionBtn
                      size="sm"
                      variant="destructive"
                      hint="Shu qurilmadan kirishni taqiqlaydi"
                      disabled={busy}
                      onClick={() => void run(() => blockDevice(detail.device.id), "Bloklandi")}
                    >
                      Bloklash
                    </ActionBtn>
                  )}
                  <ActionBtn
                    size="sm"
                    variant="outline"
                    hint="Faqat shu qurilmadagi ochiq kirishni yopadi"
                    disabled={busy}
                    onClick={() =>
                      void run(() => revokeDeviceSessions(detail.device.id), "Session tugatildi")
                    }
                  >
                    Sessionni yopish
                  </ActionBtn>
                  <ActionBtn
                    size="sm"
                    variant="outline"
                    hint="Xodimning barcha qurilmalaridan chiqaradi"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => revokeAllUserSessions(detail.device.userId),
                        "Barcha sessionlar tugatildi",
                      )
                    }
                  >
                    Barcha sessionlarni yopish
                  </ActionBtn>
                </>
              ) : null}
            </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Faqat ko‘rish — o‘zgartirish admin uchun</p>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <Card className="border-border/70 shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-xl bg-muted/80 p-2.5 ring-1 ring-border/50">{icon}</div>
        <div>
          <div className="text-2xl font-bold tabular-nums tracking-tight">{value}</div>
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("max-w-[60%] break-words text-right font-medium", mono && "font-mono text-xs")}>
        {value || "—"}
      </span>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="text-sm font-normal">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function FieldNum({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min={1}
        max={5}
        className="mt-1 h-8"
        value={value}
        onChange={(e) => onChange(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
      />
    </div>
  );
}
