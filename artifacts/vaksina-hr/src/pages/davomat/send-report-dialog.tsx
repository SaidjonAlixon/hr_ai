import { useEffect, useMemo, useState } from "react";
import { Clock, Crown, Loader2, MessagesSquare, Send, UserRound, Users } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Switch } from "../../components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { useToast } from "../../hooks/use-toast";
import {
  fetchAutoReportConfig,
  fetchSendReportOptions,
  saveAutoReportConfig,
  sendCoordinatorReports,
  type AutoReportConfig,
  type AutoReportSettings,
  type ReportListKind,
  type ReportSendMode,
  type SendReportOptions,
} from "../../lib/davomat-api";
import { cn } from "../../lib/utils";
import { ScheduledReports } from "./scheduled-reports";

const LISTS: { key: ReportListKind; label: string; hint: string; tone: string }[] = [
  { key: "absent", label: "Kelmaganlar", hint: "bugun kelmagan", tone: "text-rose-600" },
  { key: "late", label: "Kechikkanlar", hint: "kech kelgan", tone: "text-amber-600" },
  { key: "present", label: "Kelganlar", hint: "o‘z vaqtida kelgan", tone: "text-emerald-600" },
];

type SendTarget = "personal" | "group" | "both";

const INTERVALS = [30, 60, 120, 180, 240, 360];

function intervalLabel(min: number): string {
  if (min < 60) return `${min} daqiqada`;
  return min % 60 ? `${Math.floor(min / 60)} soat ${min % 60} daqiqada` : `${min / 60} soatda`;
}

const TARGETS: { key: SendTarget; icon: typeof Send; title: string; sub: string }[] = [
  { key: "personal", icon: UserRound, title: "Shaxsiyga", sub: "Telegram + platforma" },
  { key: "group", icon: MessagesSquare, title: "Guruhga", sub: "nik bilan belgilab" },
  { key: "both", icon: Send, title: "Ikkalasiga", sub: "shaxsiy va guruh" },
];

export function SendReportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [options, setOptions] = useState<SendReportOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<ReportSendMode>("coordinators");
  const [lists, setLists] = useState<ReportListKind[]>(["absent", "late", "present"]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [target, setTarget] = useState<SendTarget>("both");
  const [shifts, setShifts] = useState<Set<string>>(new Set());
  const [auto, setAuto] = useState<AutoReportConfig | null>(null);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [intervalMin, setIntervalMin] = useState(60);
  const [fromHm, setFromHm] = useState("09:00");
  const [toHm, setToHm] = useState("21:00");
  const [savingAuto, setSavingAuto] = useState(false);
  const toPersonal = target !== "group";
  const toGroup = target !== "personal";

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    Promise.all([fetchSendReportOptions(), fetchAutoReportConfig()])
      .then(([o, a]) => {
        if (!alive) return;
        setOptions(o);
        setPicked(new Set(o.coordinators.map((c) => c.id)));
        setShifts(new Set(o.shifts.map((s) => s.key)));
        setAuto(a);
        setAutoEnabled(a.enabled);
        setIntervalMin(a.intervalMin);
        setFromHm(a.fromHm);
        setToHm(a.toHm);
      })
      .catch((err) => toast({ title: "Ma’lumot yuklanmadi", description: (err as Error).message, variant: "destructive" }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, toast]);

  const shiftOptions = options?.shifts ?? [];
  const allShifts = shiftOptions.length > 0 && shifts.size === shiftOptions.length;
  const toggleShift = (key: string) =>
    setShifts((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const currentSettings = (): AutoReportSettings => ({
    mode,
    lists,
    coordinatorIds: allPicked ? [] : [...picked],
    buckets: allShifts ? [] : [...shifts],
    toPersonal,
    toGroup,
  });

  const onSaveAuto = async (enabled: boolean) => {
    if (savingAuto) return;
    if (enabled && blocker) {
      toast({ title: "Sozlama to‘liq emas", description: blocker, variant: "destructive" });
      return;
    }
    setSavingAuto(true);
    try {
      const a = await saveAutoReportConfig({ enabled, intervalMin, fromHm, toHm, settings: currentSettings() });
      setAuto(a);
      setAutoEnabled(a.enabled);
      toast({
        title: a.enabled ? "Avtomatik yuborish yoqildi" : "Avtomatik yuborish o‘chirildi",
        description: a.enabled
          ? `Har ${intervalLabel(a.intervalMin)}, ${a.fromHm}–${a.toHm}. Keyingisi: ${a.nextAt ?? "—"}.`
          : undefined,
      });
    } catch (err) {
      toast({ title: "Saqlanmadi", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSavingAuto(false);
    }
  };

  const coordinators = options?.coordinators ?? [];
  const allPicked = coordinators.length > 0 && picked.size === coordinators.length;
  const pickedStaff = useMemo(
    () => coordinators.filter((c) => picked.has(c.id)).reduce((n, c) => n + c.staff, 0),
    [coordinators, picked],
  );

  const toggleList = (key: ReportListKind) =>
    setLists((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  const toggleCoord = (id: number) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const blocker = !lists.length
    ? "Kamida bitta holatni tanlang"
    : shiftOptions.length && !shifts.size
      ? "Kamida bitta smenani tanlang"
      : !picked.size
      ? "Kamida bitta koordinatorni tanlang"
      : target === "group" && options && !options.group
        ? "Guruh hali belgilanmagan"
        : mode === "director" && options && !options.directors.length
          ? "Faol direktor topilmadi"
          : null;

  const onSend = async () => {
    if (sending || blocker) return;
    setSending(true);
    try {
      const r = await sendCoordinatorReports(currentSettings());
      const who = r.mode === "director" ? `Direktor: ${r.recipients} ta` : `Koordinatorlar: ${r.coordinators} ta`;
      const lines = [
        `${who}, xodimlar: ${r.people} ta.`,
        toPersonal ? `Shaxsiy chatga: ${r.personal}.` : null,
        toGroup ? `Guruhga: ${r.groupReady ? r.group : "guruh hali belgilanmagan"}.` : null,
        r.notInBot.length ? `Botga kirmagan: ${r.notInBot.join(", ")}.` : null,
        r.failed.length ? `Xato: ${r.failed.join("; ")}.` : null,
      ].filter(Boolean);
      toast({
        title: r.people ? "Hisobot yuborildi" : "Tanlangan holatda xodim yo‘q",
        description: lines.join("\n"),
        variant: r.failed.length ? "destructive" : undefined,
      });
      if (r.people) onOpenChange(false);
    } catch (err) {
      toast({ title: "Hisobot yuborilmadi", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const section = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";

  return (
    <Dialog open={open} onOpenChange={(o) => !sending && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Davomat hisobotini yuborish</DialogTitle>
          <DialogDescription>Shu daqiqadagi holat bo‘yicha PDF jadval tayyorlanadi.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <div className={section}>Kimga</div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { key: "coordinators", icon: Users, title: "Koordinatorlarga", sub: "har biriga o‘z xodimlari" },
                  { key: "director", icon: Crown, title: "Direktorga", sub: "bitta to‘liq hisobot" },
                ] as const
              ).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMode(m.key)}
                  className={cn(
                    "flex items-start gap-2 rounded-lg border p-3 text-left transition",
                    mode === m.key ? "border-sky-500 bg-sky-50 ring-1 ring-sky-500 dark:bg-sky-950/40" : "hover:bg-muted/50",
                  )}
                >
                  <m.icon className={cn("mt-0.5 h-4 w-4", mode === m.key ? "text-sky-600" : "text-muted-foreground")} />
                  <span>
                    <span className="block text-sm font-semibold">{m.title}</span>
                    <span className="block text-xs text-muted-foreground">{m.sub}</span>
                  </span>
                </button>
              ))}
            </div>
            {mode === "director" && options ? (
              <p className="text-xs text-muted-foreground">
                {options.directors.length
                  ? options.directors.map((d) => `${d.name}${d.hasTelegram ? "" : " (botga kirmagan)"}`).join(", ")
                  : "Faol direktor topilmadi"}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className={section}>Qaysi xodimlar</div>
            <div className="grid grid-cols-3 gap-2">
              {LISTS.map((l) => (
                <label
                  key={l.key}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-lg border p-2.5",
                    lists.includes(l.key) ? "bg-muted/40" : "opacity-70",
                  )}
                >
                  <Checkbox checked={lists.includes(l.key)} onCheckedChange={() => toggleList(l.key)} className="mt-0.5" />
                  <span>
                    <span className={cn("block text-sm font-semibold", l.tone)}>{l.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{l.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className={section}>Smena {shiftOptions.length ? `· ${shifts.size}/${shiftOptions.length}` : ""}</div>
              {shiftOptions.length ? (
                <button
                  type="button"
                  className="text-xs font-medium text-sky-600 hover:underline"
                  onClick={() => setShifts(allShifts ? new Set() : new Set(shiftOptions.map((s) => s.key)))}
                >
                  {allShifts ? "Hammasini olib tashlash" : "Hammasini tanlash"}
                </button>
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {shiftOptions.map((s) => (
                <label
                  key={s.key}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-sm font-medium",
                    shifts.has(s.key) ? "bg-muted/40" : "opacity-70",
                  )}
                >
                  <Checkbox checked={shifts.has(s.key)} onCheckedChange={() => toggleShift(s.key)} />
                  {s.label}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className={section}>
                Koordinatorlar {coordinators.length ? `· ${picked.size}/${coordinators.length}` : ""}
              </div>
              {coordinators.length ? (
                <button
                  type="button"
                  className="text-xs font-medium text-sky-600 hover:underline"
                  onClick={() => setPicked(allPicked ? new Set() : new Set(coordinators.map((c) => c.id)))}
                >
                  {allPicked ? "Hammasini olib tashlash" : "Hammasini tanlash"}
                </button>
              ) : null}
            </div>
            <div className="max-h-56 overflow-y-auto rounded-lg border">
              {loading ? (
                <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
                </div>
              ) : coordinators.length ? (
                coordinators.map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-2.5 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/40"
                  >
                    <Checkbox checked={picked.has(c.id)} onCheckedChange={() => toggleCoord(c.id)} />
                    <span className="flex-1 truncate font-medium">{c.name}</span>
                    {!c.hasTelegram ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                        botga kirmagan
                      </span>
                    ) : null}
                    <span className="w-14 text-right text-xs text-muted-foreground">{c.staff} xodim</span>
                  </label>
                ))
              ) : (
                <div className="p-3 text-sm text-muted-foreground">Koordinator topilmadi</div>
              )}
            </div>
            {options?.withoutCoordinator ? (
              <p className="text-xs text-muted-foreground">
                Koordinatori biriktirilmagan {options.withoutCoordinator} xodim hisobotga kirmaydi.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className={section}>Qayerga</div>
            <div className="grid grid-cols-3 gap-2">
              {TARGETS.map((tg) => (
                <button
                  key={tg.key}
                  type="button"
                  onClick={() => setTarget(tg.key)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border p-2.5 text-center transition",
                    target === tg.key ? "border-sky-500 bg-sky-50 ring-1 ring-sky-500 dark:bg-sky-950/40" : "hover:bg-muted/50",
                  )}
                >
                  <tg.icon className={cn("h-4 w-4", target === tg.key ? "text-sky-600" : "text-muted-foreground")} />
                  <span className="text-sm font-semibold">{tg.title}</span>
                  <span className="text-[11px] leading-tight text-muted-foreground">{tg.sub}</span>
                </button>
              ))}
            </div>
            {toGroup ? (
              <p className={cn("text-xs", options?.group ? "text-muted-foreground" : "text-amber-600")}>
                {options?.group
                  ? `Guruh: ${options.group.title}${options.group.topic ? ` · ${options.group.topic}` : ""} (har biri nik bilan belgilanadi)`
                  : "Guruh hali belgilanmagan: «Koordinatorlar» mavzusida /hisobot_guruh deb yozing"}
              </p>
            ) : null}
          </div>

          <ScheduledReports open={open} shifts={shiftOptions} groupReady={!!options?.group} />

          <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  <Clock className="h-4 w-4 text-sky-600" /> Avtomatik yuborish
                </div>
                <div className="text-xs text-muted-foreground">
                  {auto?.enabled
                    ? `Yoqilgan: har ${intervalLabel(auto.intervalMin)}, ${auto.fromHm}–${auto.toHm}. Keyingisi: ${auto.nextAt ?? "—"}`
                    : "O‘chirilgan. Yuqoridagi sozlama bilan belgilangan vaqtda o‘zi yuboradi."}
                </div>
              </div>
              <Switch checked={autoEnabled} onCheckedChange={setAutoEnabled} disabled={savingAuto || loading} />
            </div>
            {autoEnabled ? (
              <>
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">Qancha vaqtda bir</div>
                  <div className="flex flex-wrap gap-1.5">
                    {INTERVALS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setIntervalMin(m)}
                        className={cn(
                          "rounded-md border px-2.5 py-1 text-xs font-medium transition",
                          intervalMin === m ? "border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-950/40" : "hover:bg-muted/50",
                        )}
                      >
                        {intervalLabel(m)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-xs text-muted-foreground">Soat</span>
                  <input
                    type="time"
                    value={fromHm}
                    onChange={(e) => setFromHm(e.target.value)}
                    className="h-8 rounded-md border bg-background px-2 text-sm"
                  />
                  <span className="text-muted-foreground">—</span>
                  <input
                    type="time"
                    value={toHm}
                    onChange={(e) => setToHm(e.target.value)}
                    className="h-8 rounded-md border bg-background px-2 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">oralig‘ida</span>
                </div>
              </>
            ) : null}
            {autoEnabled || auto?.enabled ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full gap-2"
                disabled={savingAuto || loading}
                onClick={() => void onSaveAuto(autoEnabled)}
              >
                {savingAuto ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
                {autoEnabled ? "Avtomatik yuborishni saqlash" : "Avtomatik yuborishni o‘chirish"}
              </Button>
            ) : null}
          </div>
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {blocker ?? `${picked.size} koordinator · ${pickedStaff} xodim`}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={sending} onClick={() => onOpenChange(false)}>
              Bekor qilish
            </Button>
            <Button type="button" className="gap-2" disabled={sending || loading || !!blocker} onClick={() => void onSend()}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Yuborish
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
