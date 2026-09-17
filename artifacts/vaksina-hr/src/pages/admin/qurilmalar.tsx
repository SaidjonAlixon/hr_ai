import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { canManageUsers } from "@/lib/roles";
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
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
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
    return <Badge className="bg-emerald-100 text-emerald-800">Faol</Badge>;
  if (status === "pending")
    return <Badge className="bg-amber-100 text-amber-900">Tasdiqlash kutilmoqda</Badge>;
  if (status === "blocked")
    return <Badge className="bg-rose-100 text-rose-800">Bloklangan</Badge>;
  return <Badge variant="secondary">Faol emas</Badge>;
}

export default function AdminQurilmalarPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = canManageUsers(user?.role);

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
      <div className="py-16 text-center text-muted-foreground">Faqat admin uchun</div>
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

      <Tabs defaultValue="devices">
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="devices">Qurilmalar</TabsTrigger>
          <TabsTrigger value="enforce">Majburiy userlar</TabsTrigger>
          <TabsTrigger value="settings">Sozlamalar</TabsTrigger>
          <TabsTrigger value="history">Login tarixi</TabsTrigger>
          <TabsTrigger value="events">Security events</TabsTrigger>
        </TabsList>

        <TabsContent value="devices" className="mt-4 space-y-4">
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
                <SelectItem value="active">Faol</SelectItem>
                <SelectItem value="pending">Kutilmoqda</SelectItem>
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
                    <th className="px-3 py-2">OS / Browser</th>
                    <th className="px-3 py-2">IP</th>
                    <th className="px-3 py-2">Oxirgi</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Asosiy</th>
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
                        {d.os || "—"} / {d.browser || "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{d.lastIp || d.ipAddress || "—"}</td>
                      <td className="px-3 py-2 text-xs tabular-nums">{fmt(d.lastSeenAt)}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={d.status} />
                      </td>
                      <td className="px-3 py-2">{d.isPrimary ? "✅" : "—"}</td>
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

        <TabsContent value="enforce" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Device security majburiy qilinadigan userlar</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[480px] space-y-2 overflow-y-auto">
              {enforceUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{u.fullName}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {u.login} · {u.role} · {u.staffGroup}
                      {u.departmentName ? ` · ${u.departmentName}` : ""}
                    </div>
                  </div>
                  <Switch
                    checked={u.enforced}
                    disabled={busy}
                    onCheckedChange={(v) =>
                      void run(() => setUserEnforce(u.id, v), v ? "Majburiy yoqildi" : "O‘chirildi")
                    }
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
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
                  disabled={busy}
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

        <TabsContent value="history" className="mt-4">
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

        <TabsContent value="events" className="mt-4">
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
          </DialogHeader>
          {detail ? (
            <div className="space-y-2 text-sm">
              <Row label="Xodim" value={String(detail.user.fullName || "")} />
              <Row label="Qurilma" value={detail.device.deviceName || "—"} />
              <Row label="Device ID" value={detail.device.deviceId} mono />
              <Row label="OS" value={detail.device.os || "—"} />
              <Row label="Browser" value={detail.device.browser || "—"} />
              <Row label="IP" value={detail.device.lastIp || detail.device.ipAddress || "—"} mono />
              <Row label="Birinchi" value={fmt(detail.device.firstSeenAt)} />
              <Row label="Oxirgi" value={fmt(detail.device.lastSeenAt)} />
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Status:</span>
                <StatusBadge status={detail.device.status} />
                {detail.device.isPrimary ? <Badge>Asosiy</Badge> : null}
              </div>
            </div>
          ) : (
            <Loader2 className="h-5 w-5 animate-spin" />
          )}
          <DialogFooter className="flex-wrap gap-2 sm:justify-start">
            {detail && !detail.device.isVerified ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void run(() => approveDevice(detail.device.id), "Tasdiqlandi")}
              >
                Tasdiqlash
              </Button>
            ) : null}
            {detail && !detail.device.isVerified ? (
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => void run(() => rejectDevice(detail.device.id), "Rad etildi")}
              >
                Rad etish
              </Button>
            ) : null}
            {detail ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void run(() => setPrimaryDevice(detail.device.id), "Asosiy qilindi")}
                >
                  Asosiy qurilma
                </Button>
                {detail.device.isBlocked ? (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void run(() => unblockDevice(detail.device.id), "Blokdan chiqarildi")}
                  >
                    Blokdan chiqarish
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => void run(() => blockDevice(detail.device.id), "Bloklandi")}
                  >
                    Bloklash
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(() => revokeDeviceSessions(detail.device.id), "Session tugatildi")
                  }
                >
                  Sessionni tugatish
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => revokeAllUserSessions(detail.device.userId),
                      "Barcha sessionlar tugatildi",
                    )
                  }
                >
                  Barcha sessionlarni tugatish
                </Button>
              </>
            ) : null}
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
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-lg bg-muted p-2">{icon}</div>
        <div>
          <div className="text-2xl font-bold tabular-nums">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-right font-medium", mono && "font-mono text-xs")}>{value}</span>
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
