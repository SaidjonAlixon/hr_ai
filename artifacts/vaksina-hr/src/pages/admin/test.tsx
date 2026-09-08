import { useCallback, useEffect, useState } from "react";
import { Bell, Clock3, Send, Smartphone, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { canManageSettings } from "@/lib/roles";
import {
  cancelNotifTest,
  fetchNotifTestPending,
  fetchNotifTestStatus,
  scheduleNotifTest,
  sendNotifTestNow,
  type NotifTestPending,
  type NotifTestStatus,
} from "@/lib/notif-test-api";
import { enableWebPush, getLocalPushState, isWebPushSupported } from "@/lib/web-push-client";

const PRESETS = [1, 2, 3, 5, 10] as const;

export default function AdminTestPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = canManageSettings(user?.role);

  const [status, setStatus] = useState<NotifTestStatus | null>(null);
  const [pending, setPending] = useState<NotifTestPending[]>([]);
  const [minutes, setMinutes] = useState(1);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [localPush, setLocalPush] = useState<{
    supported: boolean;
    permission: string;
    subscribed: boolean;
  }>({ supported: false, permission: "unsupported", subscribed: false });

  const refresh = useCallback(async () => {
    if (!allowed) return;
    try {
      const [s, p, local] = await Promise.all([
        fetchNotifTestStatus(),
        fetchNotifTestPending(),
        getLocalPushState(),
      ]);
      setStatus(s);
      setPending(p.pending);
      setLocalPush(local);
    } catch (e) {
      toast({
        title: "Yuklanmadi",
        description: e instanceof Error ? e.message : "Xato",
        variant: "destructive",
      });
    }
  }, [allowed, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!allowed) return;
    const t = setInterval(() => {
      void fetchNotifTestPending()
        .then((p) => setPending(p.pending))
        .catch(() => undefined);
      void getLocalPushState().then(setLocalPush).catch(() => undefined);
    }, 5_000);
    return () => clearInterval(t);
  }, [allowed]);

  const onEnablePush = async () => {
    setBusy(true);
    try {
      const r = await enableWebPush();
      if (!r.ok) {
        toast({ title: "Push yoqilmadi", description: r.error, variant: "destructive" });
      } else {
        toast({
          title: "Telefon push yoqildi",
          description: `Qurilma ulandi (${r.devices || 1}). Endi test yuboring — ilova yopiq bo‘lsa ham chiqadi.`,
        });
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onSendNow = async () => {
    setBusy(true);
    try {
      if ((status?.pushDevices || 0) < 1) {
        const en = await enableWebPush();
        if (!en.ok) {
          toast({ title: "Avval push yoqing", description: en.error, variant: "destructive" });
          setBusy(false);
          return;
        }
      }
      const r = await sendNotifTestNow({ text: text.trim() || undefined });
      toast({ title: "Yuborildi", description: r.message });
      await refresh();
    } catch (e) {
      toast({
        title: "Xato",
        description: e instanceof Error ? e.message : "Yuborilmadi",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const onSchedule = async () => {
    setBusy(true);
    try {
      if ((status?.pushDevices || 0) < 1) {
        const en = await enableWebPush();
        if (!en.ok) {
          toast({ title: "Avval push yoqing", description: en.error, variant: "destructive" });
          setBusy(false);
          return;
        }
        await refresh();
      }
      const r = await scheduleNotifTest({
        delayMinutes: minutes,
        text: text.trim() || undefined,
      });
      toast({
        title: "Taymer qo‘yildi",
        description: `${r.job.delayMinutes} daqiqadan keyin telefon tizim bildirishnomasi keladi. Ilovani yopib kutishingiz mumkin.`,
      });
      await refresh();
    } catch (e) {
      toast({
        title: "Xato",
        description: e instanceof Error ? e.message : "Rejalashtirilmadi",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async (id: string) => {
    try {
      await cancelNotifTest(id);
      await refresh();
      toast({ title: "Bekor qilindi" });
    } catch (e) {
      toast({
        title: "Xato",
        description: e instanceof Error ? e.message : "O‘chirilmadi",
        variant: "destructive",
      });
    }
  };

  if (!allowed) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Faqat admin / direktor uchun.</div>
    );
  }

  const pushOk = (status?.pushDevices || 0) > 0 || localPush.subscribed;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Test — bildirishnoma</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Telefonning o‘z tizim bildirishnomasi (Chrome / Safari) — Telegram ochiq bo‘lishi shart emas.
          SMS kabi lock screen’da chiqadi.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="h-4 w-4" />
            Telefon push (asosiy)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <span
              className={`rounded-md px-2 py-1 text-xs ${
                pushOk
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "bg-amber-500/15 text-amber-800"
              }`}
            >
              Push: {pushOk ? `yoqilgan (${status?.pushDevices || 1} qurilma)` : "yoqilmagan"}
            </span>
            <span className="rounded-md bg-muted px-2 py-1 text-xs">
              Brauzer: {isWebPushSupported() ? "Push OK" : "qo‘llab-quvvatlamaydi"}
            </span>
            <span className="rounded-md bg-muted px-2 py-1 text-xs">
              Ruxsat: {localPush.permission}
            </span>
            <span
              className={`rounded-md px-2 py-1 text-xs ${
                status?.telegramLinked
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              Telegram: {status?.telegramLinked ? "bonus" : "ixtiyoriy"}
            </span>
          </div>

          <Button type="button" disabled={busy} onClick={() => void onEnablePush()}>
            <Bell className="mr-1.5 h-3.5 w-3.5" />
            Telefon push yoqish (majburiy qadam)
          </Button>

          <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-3 text-[12px] leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">Qanday ishlaydi</p>
            <p>
              <strong>Android (Chrome):</strong> shu saytni oching → «Telefon push yoqish» → ruxsat bering.
              Keyin ilovani yopib test yuboring.
            </p>
            <p>
              <strong>iPhone (Safari):</strong> Share → «Add to Home Screen» → ochilgan ikonka orqali
              kiring (oddiy Safari tab emas) → «Telefon push yoqish». iOS 16.4+ kerak. HTTPS domen
              (masalan Vercel) da ishlaydi.
            </p>
            <p>
              Local IP (`http://192…`) da push ishlamaydi — faqat <strong>HTTPS</strong> yoki localhost.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock3 className="h-4 w-4" />
            Yuborish
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Necha daqiqadan keyin</Label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((m) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={minutes === m ? "default" : "outline"}
                  onClick={() => setMinutes(m)}
                >
                  {m} daq
                </Button>
              ))}
            </div>
            <Input
              type="number"
              min={1}
              max={120}
              value={minutes}
              onChange={(e) => setMinutes(Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
              className="max-w-[140px]"
            />
          </div>
          <div className="space-y-2">
            <Label>Matn (ixtiyoriy)</Label>
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Masalan: Test — 2 daqiqadan keyin"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => void onSchedule()}>
              <Clock3 className="mr-1.5 h-4 w-4" />
              {minutes} daqiqadan keyin yubor
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void onSendNow()}>
              <Send className="mr-1.5 h-4 w-4" />
              Hozir yubor
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Kutilayotgan testlar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!pending.length ? (
            <p className="text-sm text-muted-foreground">Hozircha yo‘q.</p>
          ) : (
            pending.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {p.delayMinutes} daq · qoldi ~{p.remainSeconds}s
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(p.sendAt).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" })}
                    {p.text ? ` · ${p.text}` : ""}
                  </p>
                </div>
                <Button type="button" size="icon" variant="ghost" onClick={() => void onCancel(p.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
